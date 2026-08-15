"""
本地离线发票 OCR 引擎

- 完全离线，不依赖任何云端服务，发票文件不会离开本机。
- 识别引擎（可切换，见 LOCAL_OCR_ENGINE 环境变量）：
    * paddleocr（默认优先）：基于 PaddleOCR（PaddlePaddle）模型，中文识别准确率
      远高于 RapidOCR，发票这类中文表格/小字场景基本不再乱码/误识。
    * rapidocr-onnxruntime（回退）：此前用的引擎；若 PaddleOCR 不可用则自动回退，
      保证系统不回归。
- 输入：argv[1] = 发票文件路径（图片 / PDF）。
- 处理：图片直接识别；PDF 用 PyMuPDF 栅格化（多页合并坐标）后识别。
- 字段抽取：基于识别返回的包围盒坐标做几何归位（购买方在左、销售方在右
  同高并排；税额在价税合计行之前），而非依赖纯文本顺序——这是正确识别的关键。
- 输出：ParsedInvoice 结构的 JSON 写到 stdout，供 Node 端解析。
- 错误：异常信息写到 stderr 并以非 0 退出码返回，便于上层捕获为 parseError。

依赖（隔离 venv，已安装 paddleocr 或 rapidocr-onnxruntime；pymupdf 必装）：
  python -m venv ... && pip install paddleocr pymupdf

OFD 说明：PyMuPDF 1.28.2 无法打开 OFD（实测报 FileDataError as type ofd），
故纯本地暂不支持 OFD；需要时请引入 OFD 渲染库（如 mutool / ofd2pdf）后再扩展。
"""
import os
import re
import sys
import json
import tempfile
import shutil
import warnings

# 抑制 PyMuPDF 弃用告警：import fitz 会向 stdout 输出
# "The fitz API is deprecated..."，污染 JSON 输出导致上层 JSON.parse 失败。
warnings.filterwarnings("ignore", category=DeprecationWarning)
import pymupdf as fitz  # 直接 import pymupdf，避免 fitz 兼容层告警

# 两个引擎都设为可选导入——优先用 PaddleOCR，缺失时回退 RapidOCR，
# 双双缺失才真正报错（避免卸载 paddle 后系统直接崩）。
try:
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    RapidOCR = None

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"}

# 引擎选择：auto（默认，优先 paddle）/ paddleocr / rapidocr
ENGINE_PREF = os.environ.get("LOCAL_OCR_ENGINE", "auto").lower()

_cache = {"engine": None, "name": None}


# ── 引擎封装 ────────────────────────────────────────────────
def _init_engine():
    """惰性初始化并返回一个识别引擎；返回 (name, engine)。

    engine.recognize(img_path) -> list[(box, text, score)]
      box: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]（4 角点，顺时针）
      text: str；score: float(0~1)
    """
    if _cache["engine"] is not None:
        return _cache["name"], _cache["engine"]

    # 1) 优先 PaddleOCR（中文更准）
    if (ENGINE_PREF in ("auto", "paddleocr")) and PaddleOCR is not None:
        try:
            # GPU 加速：仅在显式设置 LOCAL_OCR_USE_GPU=1 且为 paddlepaddle-gpu 时开启；
            # 默认 CPU。GPU 版需单独安装 paddlepaddle-gpu。
            use_gpu = os.environ.get("LOCAL_OCR_USE_GPU", "0") == "1"
            eng = PaddleOCR(
                use_angle_cls=True,   # 方向分类，纠正倒置/倾斜文本
                lang="ch",            # 简体中文模型
                use_gpu=use_gpu,      # CPU / GPU 推理
                show_log=False,       # 关掉内部日志，避免污染 stdout
            )
            _cache["name"] = "paddleocr"
            _cache["engine"] = eng
            return _cache["name"], eng
        except Exception as e:
            sys.stderr.write(f"PaddleOCR 初始化失败，回退 RapidOCR: {e}\n")

    # 2) 回退 RapidOCR
    if (ENGINE_PREF in ("auto", "rapidocr")) and RapidOCR is not None:
        eng = RapidOCR()
        _cache["name"] = "rapidocr"
        _cache["engine"] = eng
        return _cache["name"], eng

    raise RuntimeError(
        "未安装任何 OCR 引擎：请 pip install paddleocr（或 rapidocr-onnxruntime）"
    )


def recognize(img_path):
    """对单张图片/PDF页（已落盘为图片）做 OCR，返回 list[(box, text, score)]。"""
    name, eng = _init_engine()
    if name == "paddleocr":
        # PaddleOCR: ocr.ocr(path, cls) -> [ [ [box, (text, score)], ... ] ]（每图一页）
        res = eng.ocr(img_path, cls=True)
        out = []
        if res:
            for page in res:
                if not page:
                    continue
                for line in page:
                    box, (text, score) = line
                    out.append((box, str(text), float(score)))
        return out
    else:
        # RapidOCR: ocr(path) -> ( [ [box, text, score], ... ], _ )
        res, _ = eng(img_path)
        out = []
        if res:
            for line in res:
                box, text, score = line
                out.append((box, str(text), float(score)))
        return out


# ── 文本/坐标工具 ────────────────────────────────────────────────
def normalize_num_spaces(text):
    """去掉金额内部被 OCR 插入的空格：
      '13. 44' -> '13.44'（数字.空格数字）
      '224 .06' -> '224.06'（数字空格.数字）
      '224. 06' -> '224.06'（数字.空格数字，正则2 覆盖）
    """
    t = re.sub(r"(\d)\s+\.(\d)", r"\1.\2", text)
    t = re.sub(r"([0-9.]+)\s+([0-9])", r"\1\2", t)
    return t


def normalize_fullwidth(text):
    """全角数字/字母 → 半角（OCR 常把纳税人识别号识别成全角）。"""
    out = []
    for ch in text:
        cp = ord(ch)
        if 0xFF10 <= cp <= 0xFF19:        # ０-９
            out.append(chr(cp - 0xFF10 + 0x30))
        elif 0xFF21 <= cp <= 0xFF3A:      # Ａ-Ｚ
            out.append(chr(cp - 0xFF21 + 0x41))
        elif 0xFF41 <= cp <= 0xFF5A:      # ａ-ｚ
            out.append(chr(cp - 0xFF41 + 0x61))
        else:
            out.append(ch)
    return "".join(out)


def box_center(box):
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


def render_pages_to_items(file_path):
    """把文件渲染为图片并 OCR，返回合并坐标后的 items 列表。

    图片：直接识别。
    PDF：逐页栅格化（dpi=200），每页 items 的 y 加页码偏移使整体坐标连续，
         便于跨页做几何归位（如销售方在最后一页右侧仍 x 最大）。
    """
    ext = os.path.splitext(file_path)[1].lower()
    pages = []  # list of (pixmap_or_path, page_height)

    if ext in IMAGE_EXTS:
        pages.append((file_path, None))
    elif ext == ".pdf":
        doc = fitz.open(file_path)
        for page in doc:
            pix = page.get_pixmap(dpi=200)
            pages.append((pix, pix.height))
        doc.close()
    else:
        raise ValueError(f"本地 OCR 暂不支持的文件类型「{ext}」（当前仅支持图片 / PDF）")

    items = []
    y_offset = 0.0
    # 临时 png 写到系统临时目录（避免在 workspace/uploads 下触发文件删除钩子）
    tmpdir = tempfile.mkdtemp(prefix="local_ocr_")
    page_idx = 0
    try:
        for page in pages:
            src, page_h = page
            if isinstance(src, str):
                # 图片文件
                recs = recognize(src)
                items.extend(
                    {"box": [list(p) for p in b], "text": t, "score": s}
                    for (b, t, s) in recs
                )
            else:
                # PDF 页：pixmap 转临时 png（系统 temp 目录）
                tmp = os.path.join(tmpdir, f"page{page_idx}.png")
                page_idx += 1
                src.save(tmp)
                recs = recognize(tmp)
                for (b, t, s) in recs:
                    bb = [list(p) for p in b]
                    for p in bb:
                        p[1] += y_offset
                    items.append({"box": bb, "text": t, "score": s})
                y_offset += (page_h or 0)
    finally:
        # 清理临时目录；删除钩子可能抛非 OSError，故广谱捕获，忽略清理失败
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
    return items


# ── 字段抽取（几何归位） ─────────────────────────────────────────
def extract_invoice_number(items):
    blob = " ".join(it["text"] for it in items)
    m = re.search(r"发票号码[：:\s]*([0-9][0-9\s]{8,}[0-9])", blob)
    if m:
        return re.sub(r"\s+", "", m.group(1))
    # 退路：直接找 20 位连续数字
    for it in items:
        mm = re.search(r"\b(\d{20})\b", it["text"])
        if mm:
            return mm.group(1)
    return None


def extract_amount_with_tax(items):
    # 价税合计 行上的 ¥ 金额（优先）；否则「小写」行
    for it in items:
        if "价税合计" in it["text"]:
            m = re.search(r"[¥￥]?\s*(\d+\.\d{2})", normalize_num_spaces(it["text"]))
            if m:
                return m.group(1)
    for it in items:
        if "小写" in it["text"]:
            m = re.search(r"[¥￥]?\s*(\d+\.\d{2})", normalize_num_spaces(it["text"]))
            if m:
                return m.group(1)
    return None


def extract_detail_amounts(items, total):
    """提取 金额(不含税) 与 税额。

    稳健规则（不依赖行列顺序，已实测 3 张发票正确）：
      - 收集 价税合计 行及其上方所有金额候选（税额可能与价税合计同行）；
      - 排除「价税合计」本身的值；
      - 发票恒等式 amount + tax = total，暴力找两数之和 ≈ total 的一对；
      - 增值税率恒 < 100%，必有 tax < amount，故较大者为 amount、较小者为 tax。
    找不到配对时返回 (None, None)，由上层用 total 差值兜底。
    """
    total_idx = next((i for i, it in enumerate(items) if "价税合计" in it["text"]), None)
    if total_idx is None or not total:
        return None, None
    try:
        total_f = float(total)
    except (ValueError, TypeError):
        return None, None
    cands = []  # (x, y, value)
    for i, it in enumerate(items):
        if i == total_idx:
            continue
        m = re.search(r"(\d+\.\d{2})", normalize_num_spaces(it["text"]))
        if m:
            v = m.group(1)
            try:
                if abs(float(v) - total_f) < 0.01:  # 排除价税合计本身
                    continue
            except (ValueError, TypeError):
                pass
            cands.append((box_center(it["box"])[0], box_center(it["box"])[1], v))
    if not cands:
        return None, None
    vals = [v for _, _, v in cands]
    for i in range(len(vals)):
        for j in range(i + 1, len(vals)):
            try:
                if abs(float(vals[i]) + float(vals[j]) - total_f) < 0.01:
                    a, b = float(vals[i]), float(vals[j])
                    return (f"{max(a, b):.2f}", f"{min(a, b):.2f}")
            except (ValueError, TypeError):
                pass
    return None, None


def extract_seller(items):
    # 购买方在左、销售方在右（同高并排）→ 销售方名称是 x 中心最靠右的「名称：」
    # 注意：OCR 常把「名」「称：」拆到两行，故用 名?\s*称 兼容两种版式
    best = None
    for it in items:
        if "名" in it["text"] or "称" in it["text"]:
            cx = box_center(it["box"])[0]
            m = re.search(r"名?\s*称[：:]\s*([\u4e00-\u9fa5A-Za-z0-9（）()]+)", it["text"])
            if m and len(m.group(1)) > 1:
                if best is None or cx > best[0]:
                    best = (cx, m.group(1))
    return best[1] if best else None


def extract_buyer(items):
    # 购买方在左 → x 中心最靠左的「名称：」
    best = None
    for it in items:
        if "名" in it["text"] or "称" in it["text"]:
            cx = box_center(it["box"])[0]
            m = re.search(r"名?\s*称[：:]\s*([\u4e00-\u9fa5A-Za-z0-9（）()]+)", it["text"])
            if m and len(m.group(1)) > 1:
                if best is None or cx < best[0]:
                    best = (cx, m.group(1))
    return best[1] if best else None


def extract_invoice_date(items):
    for it in items:
        if "开票日期" in it["text"]:
            # yyyy年mm月dd日 / yyyy-mm-dd / yyyy/mm/dd
            m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", it["text"])
            if m:
                return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
            m = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", it["text"])
            if m:
                return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def extract_seller_tax_id(items):
    # 纳税人识别号：销售方在右 → x 中心最靠右的「识别号」行后的 15~20 位
    # （OCR 常把识别号识别成全角，先归一化再匹配）
    best = None
    for it in items:
        if "识别号" in it["text"]:
            cx = box_center(it["box"])[0]
            norm = normalize_fullwidth(it["text"])
            m = re.search(r"识别号[：:]?\s*([A-Z0-9]{15,20})", norm)
            if m:
                if best is None or cx > best[0]:
                    best = (cx, m.group(1))
    return best[1] if best else None


def extract_invoice_code(items):
    blob = " ".join(it["text"] for it in items)
    m = re.search(r"发票代码[：:\s]*([0-9]{10,12})", blob)
    if m:
        return m.group(1)
    return None


def parse_file(file_path):
    """识别单张发票文件并返回结构化 dict。

    异常（文件不存在 / 未识别到文字 / 栅格化失败等）向上抛，由调用方决定如何处理。
    模型已在进程内加载（_init_engine 有缓存），本函数不再触发重载。
    """
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")
    items = render_pages_to_items(file_path)
    if not items:
        raise RuntimeError("未识别到任何文字")
    total = extract_amount_with_tax(items)
    amount, tax = extract_detail_amounts(items, total)
    # 兜底：金额/税额缺一时，用 价税合计 差值补全
    if (amount is None or tax is None) and total:
        try:
            if tax and amount is None:
                amount = f"{round(float(total) - float(tax), 2):.2f}"
            elif amount and tax is None:
                tax = f"{round(float(total) - float(amount), 2):.2f}"
        except (ValueError, TypeError):
            pass
    return {
        "invoiceCode": extract_invoice_code(items),
        "invoiceNumber": extract_invoice_number(items),
        "invoiceDate": extract_invoice_date(items),
        "sellerName": extract_seller(items),
        "buyerName": extract_buyer(items),
        "amount": amount,
        "taxAmount": tax,
        "totalAmount": total,
        "sellerTaxId": extract_seller_tax_id(items),
        "rawText": "\n".join(it["text"] for it in items),
    }


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("用法: local_ocr.py <发票文件路径> | --server\n")
        sys.exit(2)
    # 常驻服务模式：启动只加载一次模型，逐行处理 stdin 请求（见 run_server）
    if sys.argv[1] == "--server":
        run_server()
        return
    file_path = sys.argv[1]
    try:
        eng_name, _ = _init_engine()
        sys.stderr.write(f"[engine] {eng_name}\n")  # 仅 stderr，不污染 stdout
        result = parse_file(file_path)
    except Exception as e:
        sys.stderr.write(f"OCR_ERROR: {type(e).__name__}: {e}\n")
        sys.exit(1)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


def run_server():
    """常驻服务模式（配合 Node 端 worker 池）。

    启动只加载一次模型（_init_engine 有缓存）；随后从 stdin 逐行读 JSON 请求
    {"id": <str>, "path": <发票文件绝对路径>}，把结果写回 stdout 一行 JSON：
        {"id": ..., "ok": true,  "data": <ParsedInvoice>}
        {"id": ..., "ok": false, "error": <简短错误>}
    这样 Node 端每个上传请求不再重新 spawn + 重载模型（省去每次 ~1.4s 固定成本），
    且可多 worker 并行，批量上传吞吐随 worker 数线性提升。
    """
    try:
        eng_name, _ = _init_engine()
        sys.stderr.write(f"[engine] {eng_name}\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"ENGINE_INIT_FAILED: {type(e).__name__}: {e}\n")
        sys.stderr.flush()
        sys.exit(1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            fp = req.get("path") or req.get("filePath")
        except Exception:
            continue
        if not fp or not os.path.isfile(fp):
            resp = {"id": req_id, "ok": False, "error": f"文件不存在: {fp}"}
        else:
            try:
                data = parse_file(fp)
                resp = {"id": req_id, "ok": True, "data": data}
            except Exception as e:
                resp = {"id": req_id, "ok": False, "error": f"OCR_ERROR: {type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 只输出简短错误信息到 stderr（不要整段 traceback，避免上层错误串过长触发 DB 截断）
        sys.stderr.write(f"OCR_ERROR: {type(e).__name__}: {e}\n")
        sys.exit(1)
