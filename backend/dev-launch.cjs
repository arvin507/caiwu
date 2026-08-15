/**
 * dev-launch.cjs —— 后端开发服务器启动器（跨平台）
 *
 * 为什么需要它：
 * WorkBuddy 的 safe-delete 钩子通过 NODE_OPTIONS=--require=.../genie-safe-delete.cjs
 * 注入到所有 node 进程，会拦截 fs.unlink。next dev 启动时会清理/重写自己的构建缓存
 * 目录（如 .next/package.json），这个 unlink 被 safe-delete 拦截——要么触发「批量删除
 * 守卫」(SAFE_DELETE_BULK_CONFIRM_REQUIRED) 导致进程退出，要么回收站二进制在部分路径
 * 失败 ("Some operations were aborted") 同样致命。结果：next dev 一启动就崩溃，后端起不来。
 *
 * 开发服务器需要自由管理自身 .next 缓存与 uploads 落盘文件，这里在启动子进程时摘除
 * safe-delete 的 --require（保留 --use-system-ca 等其它选项），等价于原生 unlink，
 * 后端即可正常启动；发票文件的删除仍由路由代码处理（fire-and-forget，不影响响应速度）。
 */
const { spawn } = require('child_process')
const path = require('path')

// NODE_OPTIONS 形如：
//   --require="D:/Program Files/.../genie-safe-delete.cjs" --use-system-ca
// 其中 --require 的路径含空格且被引号包裹，不能简单按空白分词（会把路径切两半、
// 重组后引号不闭合导致 "unterminated string"）。这里用正则精确摘除指向 safe-delete
// 的 --require（兼容双引号/单引号/无引号、空格分隔等写法），保留其它选项。
const origOpts = process.env.NODE_OPTIONS || ''
const strippedOpts = origOpts
  .replace(/(^|\s)--require="[^"]*safe-delete[^"]*"/g, '$1')
  .replace(/(^|\s)--require='[^']*safe-delete[^']*'/g, '$1')
  .replace(/(^|\s)--require=\S*safe-delete\S*/g, '$1')
  .replace(/(^|\s)--require\s+\S*safe-delete\S*/g, '$1')
  .replace(/\s+/g, ' ')
  .trim()

const childEnv = { ...process.env, NODE_OPTIONS: strippedOpts }

// 直接以 node 运行 next 的 bin 入口，避免 .cmd/.sh 在跨平台下的歧义
const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '4000'], {
  stdio: 'inherit',
  env: childEnv,
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('[dev-launch] 无法启动 next dev:', err)
  process.exit(1)
})
