// 本地离线 OCR 调用包装：常驻 Python worker 池（local_ocr.py --server 模式）。
//
// 为什么用常驻 worker 池而非每次 spawn：
//  - 旧实现每次上传都 spawn 新 python + 重新加载 Paddle 模型（固定 ~1.4s/次），
//    且跨请求毫无热缓存——这是「识别慢」的主因。
//  - 现在启动时只加载一次模型，之后每个上传请求仅付「推理」成本；多 worker 并行，
//    批量上传吞吐随 worker 数线性提升。
//
// 进程间协议（行分隔 JSON，走 stdin/stdout）：
//   请求：{"id": <uuid>, "path": <发票文件绝对路径>}
//   响应：{"id": <uuid>, "ok": true,  "data": <ParsedInvoice>}
//         {"id": <uuid>, "ok": false, "error": <简短错误>}
//
// Python 解释器（取第一个可用）：
//  1. 环境变量 LOCAL_OCR_PYTHON（部署时显式指定，最优先；GPU 版指向 gpu venv）
//  2. C:/py311/python.exe —— 专用 Paddle 运行时（独立 Python 3.11，经典稳定组合
//     paddleocr==2.9 + paddlepaddle==2.6，中文识别准确率远高于最初乱码的 RapidOCR）
//  3. 隔离 venv（.workbuddy 默认 3.13，仅 rapidocr-onnxruntime 兜底）
//  4. 系统 python3 / python
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import type { ParsedInvoice } from './invoiceParser'

const PY_CANDIDATES: string[] = [
  process.env.LOCAL_OCR_PYTHON,
  'C:/py311/python.exe',
  'C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe',
  '/usr/local/bin/python3',
  'python3',
  'python',
].filter(Boolean) as string[]

function resolvePython(): string {
  for (const c of PY_CANDIDATES) {
    if (existsSync(c)) return c
  }
  return 'python3'
}

const SCRIPT_PATH = path.join(process.cwd(), 'local_ocr.py')

const REQUEST_TIMEOUT = 60_000

/**
 * 构造传给 Python worker 的「净化环境」（同旧实现，并补 OMP_NUM_THREADS）。
 * 见旧注释：必须丢弃 PYTHONPATH/PYTHONHOME/CODEBUDDY_ / NODE_ 等前缀的污染变量，
 * 否则 py311 在 next dev 继承的污染环境里会段错误（0xC0000005）。
 * ompThreads：每个 worker 使用的 OpenMP 线程数（按 CPU 核数 / worker 数分配，
 * 避免多 worker 超额订阅）。
 */
function buildOcrEnv(ompThreads: number): NodeJS.ProcessEnv {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue
    const uk = k.toUpperCase()
    if (uk === 'PYTHONPATH' || uk === 'PYTHONHOME' || uk === 'PYTHONSTARTUP' || uk === 'PYTHONCASEOK') continue
    if (uk.startsWith('CODEBUDDY_') || uk.startsWith('NODE_') || uk.startsWith('NVM_')) continue
    if (uk === 'VIRTUAL_ENV' || uk.startsWith('CONDA_')) continue
    clean[k] = v
  }
  clean['PATH'] = [
    'C:/py311',
    'C:/py311/Lib/site-packages',
    'C:/Windows/system32',
    'C:/Windows',
  ].join(path.delimiter)
  clean['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
  clean['PYTHONIOENCODING'] = 'utf-8'
  clean['OMP_NUM_THREADS'] = String(Math.max(1, ompThreads))
  return clean as NodeJS.ProcessEnv
}

interface Pending {
  resolve: (v: ParsedInvoice) => void
  reject: (e: Error) => void
  timer?: NodeJS.Timeout
}

interface Worker {
  proc: ChildProcess
  inflight: Map<string, Pending>
  alive: boolean
}

let pool: Worker[] = []
let poolSize = 0

function targetPoolSize(): number {
  if (poolSize === 0) {
    const n = parseInt(process.env.LOCAL_OCR_WORKERS || '2', 10)
    poolSize = Number.isFinite(n) && n >= 1 ? n : 2
  }
  return poolSize
}

function spawnWorker(): Worker {
  const cores = os.cpus().length || 4
  const omp = Math.max(1, Math.floor(cores / Math.max(1, targetPoolSize())))
  const proc = spawn(resolvePython(), [SCRIPT_PATH, '--server'], {
    env: buildOcrEnv(omp),
  })
  const w: Worker = { proc, inflight: new Map(), alive: true }

  let buf = ''
  proc.stdout?.on('data', (d) => {
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      try {
        const resp = JSON.parse(line) as {
          id?: string
          ok?: boolean
          data?: ParsedInvoice
          error?: string
        }
        const id = resp.id
        if (!id) continue
        const p = w.inflight.get(id)
        if (!p) continue
        w.inflight.delete(id)
        if (p.timer) clearTimeout(p.timer)
        if (resp.ok) p.resolve(resp.data as ParsedInvoice)
        else p.reject(new Error(`本地 OCR 失败: ${resp.error ?? '未知错误'}`))
      } catch {
        // 忽略损坏行（理论上每行都是完整 JSON）
      }
    }
  })

  const failAll = (msg: string) => {
    w.alive = false
    for (const [, p] of w.inflight) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new Error(msg))
    }
    w.inflight.clear()
  }

  proc.on('exit', (code, signal) => {
    failAll(`OCR worker 已退出(code=${code},signal=${signal})`)
  })
  proc.on('error', (e) => {
    failAll(`OCR worker 启动失败: ${e.message}`)
  })

  return w
}

/** 确保存活 worker 数量补足到目标池大小（自动重建崩溃的 worker）。 */
function ensurePool(): void {
  targetPoolSize()
  const aliveCount = pool.filter((w) => w.alive).length
  let need = poolSize - aliveCount
  while (need-- > 0) pool.push(spawnWorker())
  pool = pool.filter((w) => w.alive)
}

/**
 * 调用本地 OCR 引擎识别一张发票文件，返回结构化字段。
 * 从 worker 池中选最空闲的存活 worker 发送请求；worker 进程内模型常驻，无重载成本。
 * @param filePath 落盘后的发票绝对路径（图片 / PDF）
 * @throws 引擎失败 / 超时 / worker 不可用 时抛错，由上层记为 parseError
 */
export async function localOcr(filePath: string): Promise<ParsedInvoice> {
  ensurePool()
  const candidates = pool.filter((w) => w.alive)
  if (candidates.length === 0) {
    throw new Error('本地 OCR worker 不可用（全部退出）')
  }
  // 最空闲优先，天然负载均衡
  candidates.sort((a, b) => a.inflight.size - b.inflight.size)
  const w = candidates[0]
  const id = randomUUID()

  return new Promise<ParsedInvoice>((resolve, reject) => {
    const pending: Pending = {
      resolve,
      reject,
      timer: setTimeout(() => {
        w.inflight.delete(id)
        // 该 worker 可能卡死，杀掉让其被下一次 ensurePool 重建
        w.proc.kill()
        reject(new Error(`本地 OCR 超时(${REQUEST_TIMEOUT}ms)`))
      }, REQUEST_TIMEOUT),
    }
    w.inflight.set(id, pending)
    try {
      w.proc.stdin?.write(JSON.stringify({ id, path: filePath }) + '\n')
    } catch (e) {
      if (pending.timer) clearTimeout(pending.timer)
      w.inflight.delete(id)
      reject(e as Error)
    }
  })
}
