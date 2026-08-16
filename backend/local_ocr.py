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
    """对单张图片/PDF页（已落盘为图片）做 OCR，返回 list[(box, text, score)]。

    健壮性：PaddleOCR 2.9.x 在复杂版面（带表格线/印章的扫描件）下，
    部分行会返回 3 元组 [box, (text, score), cls] 或 text 已是字符串；
    这里统一兼容 2/3 元组，并安全取出 (text, score)。
    """
    name, eng = _init_engine()
    out = []

    def _unpack(line):
        """从单行解析出 (box, text, score)，兼容多种返回形态。"""
        # 形态1：长度 2/3 的 [box, (text,score)[, cls]]
        if isinstance(line, (list, tuple)) and len(line) >= 2:
            box = line[0]
            payload = line[1]
            if isinstance(payload, (list, tuple)) and len(payload) >= 2:
                # (text, score)
                return box, str(payload[0]), float(payload[1])
            # 退路：payload 本身就是 (text, score) 不可解时，跳过
            return None
        return None

    if name == "paddleocr":
        res = eng.ocr(img_path, cls=True)
        if res:
            for page in res:
                if not page:
                    continue
                for line in page:
                    r = _unpack(line)
                    if r:
                        out.append(r)
        return out
    else:
        # RapidOCR: ocr(path) -> ( [ [box, text, score], ... ], _ )
        res, _ = eng(img_path)
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
    """把文件渲染为图片并 OCR，返回 (items, page_bounds)。

    items：合并坐标后的识别行列表（box 已按页 y 偏移连续）。
    page_bounds：list of (y0, y1)，每页 items 在整体坐标中的 y 区间，
                 供多张发票「按页切分」使用。

    图片：直接识别（单页，page_bounds 为 [(0, +inf)]）。
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
    page_bounds = []  # (y0, y1)
    y_offset = 0.0
    # 临时 png 写到系统临时目录（避免在 workspace/uploads 下触发文件删除钩子）
    tmpdir = tempfile.mkdtemp(prefix="local_ocr_")
    page_idx = 0
    try:
        for page in pages:
            src, page_h = page
            if isinstance(src, str):
                # 图片文件（单页）：bound 用一个足够大的上界即可
                recs = recognize(src)
                for (b, t, s) in recs:
                    items.append({"box": [list(p) for p in b], "text": t, "score": s})
                page_bounds.append((y_offset, y_offset + 1e9))
            else:
                # PDF 页：pixmap 转临时 png（系统 temp 目录）
                tmp = os.path.join(tmpdir, f"page{page_idx}.png")
                page_idx += 1
                src.save(tmp)
                recs = recognize(tmp)
                y0 = y_offset
                for (b, t, s) in recs:
                    bb = [list(p) for p in b]
                    for p in bb:
                        p[1] += y_offset
                    items.append({"box": bb, "text": t, "score": s})
                y_offset += (page_h or 0)
                page_bounds.append((y0, y_offset))
    finally:
        # 清理临时目录；删除钩子可能抛非 OSError，故广谱捕获，忽略清理失败
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
    return items, page_bounds


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
    # 价税合计 / 小写 标签行上的 ¥ 金额（优先）。
    # 新版电子发票（数电票）常把金额放在标签的下一行，如：
    #   "价税合计 (大写)" / "肆佰捌拾陆圆捌角陆分" / "（小写）" / "￥ 486.86"
    # 因此本行抽不到金额时，向后拼接至多 2 行再抽，兼容标签与值分行识别的版式。
    for i, it in enumerate(items):
        if "价税合计" in it["text"] or "小写" in it["text"]:
            window = it["text"]
            for j in range(i + 1, min(i + 3, len(items))):
                window += " " + items[j]["text"]
            v = _extract_amount_from_line(normalize_num_spaces(window))
            if v:
                return v
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
        # 一行内可能同时含 金额 与 税额（如明细行「... 459.30 459.30 6% 27.56」），
        # 必须收集该行全部金额，否则税额会被漏抽导致配对失败。
        for v in _extract_all_amounts_from_line(normalize_num_spaces(it["text"])):
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
    for i, it in enumerate(items):
        if "开票日期" in it["text"]:
            # 先在本行找（传统版式：标签与日期同行）
            m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", it["text"])
            if not m:
                m = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", it["text"])
            # 数电票：日期常写在「开票日期:」的下一行，本行没命中就向后看至多 2 行
            if not m:
                for j in range(i + 1, min(i + 3, len(items))):
                    m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", items[j]["text"])
                    if m:
                        break
                    m = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", items[j]["text"])
                    if m:
                        break
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


def extract_buyer_tax_id(items):
    # 购买方在左 → x 中心最靠左的「识别号」行后的 15~20 位
    # （OCR 常把识别号识别成全角，先归一化再匹配）
    best = None
    for it in items:
        if "识别号" in it["text"]:
            cx = box_center(it["box"])[0]
            norm = normalize_fullwidth(it["text"])
            m = re.search(r"识别号[：:]?\s*([A-Z0-9]{15,20})", norm)
            if m:
                if best is None or cx < best[0]:
                    best = (cx, m.group(1))
    return best[1] if best else None


# 标准增值税税率集合（用于把「税额/金额」反推的税率吸附到最近档位）
_STD_RATES = [0.01, 0.03, 0.05, 0.06, 0.09, 0.11, 0.13, 0.16, 0.17]


def _snap_rate(r):
    """把任意 0~1 的税率吸附到最接近的标准档位。"""
    return min(_STD_RATES, key=lambda x: abs(x - r))


def extract_tax_rate(items):
    """从票面「税率」标签旁抽百分比税率，如 13% / 9% / 6%。"""
    for it in items:
        m = re.search(r"税率[：:\s]*(\d{1,2})\s*%", it["text"])
        if m:
            return round(int(m.group(1)) / 100, 2)
    return None


def extract_voucher_title(items):
    """抽出票面标题，用于区分「专票 / 普票」（能否抵扣的前提）。

    判定优先级（避免数电票与普通电子发票混淆）：
      - 含「专用」或「增值税专用发票」或「机动车销售统一发票」 → 专票类（可抵）
      - 含「普通」或「增值税电子普通发票」 → 普票类（不可抵）
      - 仅含「电子发票」且未标注专/普 → 视为未知（规则引擎按普票处理，可人工改）
    """
    blob = " ".join(it["text"] for it in items)
    # 「专用发票」是专票最强特征词，优先匹配（兼容「增值税专用发票」「电子专用发票」
    # 以及 OCR 把「增值税专用发票」切成多词导致「增值税专用发票」整串缺失的情况）
    if "专用发票" in blob or "增值税专用发票" in blob or "电子专票" in blob or "增值税电子专用发票" in blob:
        return "增值税专用发票"
    if "机动车销售统一发票" in blob:
        return "机动车销售统一发票"
    if "增值税普通发票" in blob or "增值税电子普通发票" in blob or "电子普票" in blob:
        return "增值税普通发票"
    # 数电票：标题常为「电子发票（增值税专用发票）」/「电子发票（普通发票）」
    if "电子发票" in blob and "专用" in blob:
        return "增值税专用发票"
    if "电子发票" in blob and "普通" in blob:
        return "增值税普通发票"
    if "电子发票" in blob:
        return "电子发票"
    return None


def _calc_vat_tax_rate(items, amount, tax):
    """增值税票面税率：优先用 税额/金额 反推并吸附到标准档（最准），
    否则取票面「税率 13%」文本，再否则返回 None。"""
    ocr = extract_tax_rate(items)
    if amount and tax:
        try:
            r = round(float(tax) / float(amount), 4)
            if 0 < r < 1:
                return f"{_snap_rate(r):.2f}"
        except (ValueError, TypeError):
            pass
    if ocr is not None:
        return f"{ocr:.2f}"
    return None


def _parse_vat(items):
    """对一组 items（单张增值税专/普票）抽取字段。"""
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
        "invoiceType": "vat",
        "invoiceCode": extract_invoice_code(items),
        "invoiceNumber": extract_invoice_number(items),
        "invoiceDate": extract_invoice_date(items),
        "sellerName": extract_seller(items),
        "buyerName": extract_buyer(items),
        "buyerTaxNo": extract_buyer_tax_id(items),
        "voucherTitle": extract_voucher_title(items),
        "amount": amount,
        "taxAmount": tax,
        "taxRate": _calc_vat_tax_rate(items, amount, tax),
        "totalAmount": total,
        "sellerTaxId": extract_seller_tax_id(items),
        "rawText": "\n".join(it["text"] for it in items),
    }


def _parse_train(items):
    """对一组 items（单张火车票）抽取字段。"""
    return parse_train_ticket(items)


def _looks_like_single_invoice(items):
    """启发式判断：整份文件是否「很可能只有一张发票」。

    单张发票通常能在全文中找到唯一的「价税合计」或「合 计」金额行（增值税票），
    或唯一「票价」行（火车票）。多张合并时这些关键行会出现多次，命中即视为多张。
    返回 True 表示按单张处理（保持旧行为，零回归）。
    """
    total_idx = next((i for i, it in enumerate(items) if "价税合计" in it["text"]), None)
    if total_idx is not None:
        # 价税合计出现 >1 次 → 多张
        cnt = sum(1 for it in items if "价税合计" in it["text"])
        if cnt > 1:
            return False
    # 火车票特征：票价行出现多次 → 多张
    fare_cnt = sum(1 for it in items if "票价" in it["text"])
    if fare_cnt > 1:
        return False
    return True


def parse_file(file_path):
    """识别发票文件并返回结构化 dict。

    异常（文件不存在 / 未识别到文字 / 栅格化失败等）向上抛，由调用方决定如何处理。
    模型已在进程内加载（_init_engine 有缓存），本函数不再触发重载。

    ⚠️ 多页 / 多张发票支持（2026-08-15）：
      合并 PDF（一页一张、或多页拼多张）过去只识别第一张。现改为：
        1. 先按「整份是否只有一张」启发式判断（_looks_like_single_invoice）；
           单张 → 维持旧逻辑，返回扁平结构（零回归）。
        2. 多张 → 逐页探测该页发票类型（火车票 / 增值税），按探测类型把
           整份 items 切成每张发票的 items 块（边界 = 各页 y 范围，跨页同一张
           也安全合并），每张独立 parse，最终返回
           {"multi": True, "pageCount": N, "pages": [per-page dict, ...]}。
      兼容：单页图片 / 单张 PDF 仍返回扁平 {invoiceType,...}，上游按
      (resp.get("multi")) 区分。
    """
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")
    items, page_bounds = render_pages_to_items(file_path)
    if not items:
        raise RuntimeError("未识别到任何文字")

    # 单张：维持旧行为，返回扁平结构（含 train / vat）
    if _looks_like_single_invoice(items):
        if detect_train_ticket(items):
            return _parse_train(items)
        return _parse_vat(items)

    # 多张：按页探测类型并逐张切分解析
    page_types = []
    for (y0, y1) in page_bounds:
        sub = [it for it in items if y0 <= it["box"][0][1] and it["box"][0][1] < y1]
        page_types.append("train" if detect_train_ticket(sub) else "vat")

    pages = []
    for idx, (y0, y1) in enumerate(page_bounds):
        sub = [it for it in items if y0 <= it["box"][0][1] and it["box"][0][1] < y1]
        if not sub:
            continue  # 空页跳过（不应发生）
        parsed = _parse_train(sub) if page_types[idx] == "train" else _parse_vat(sub)
        pages.append(parsed)

    if len(pages) == 0:
        # 极端兜底：整份当一张增值税处理
        return _parse_vat(items)

    return {
        "multi": True,
        "pageCount": len(page_bounds),
        "pages": pages,
    }


# ── 火车票（铁路电子客票）识别 ───────────────────────────────────
def detect_train_ticket(items):
    """判断是否铁路电子客票（火车票）。

    强特征（任一出现即判定为火车票，优先级高于增值税票）：
      电子客票 / 车次 / 票价 / 买票请到12306 / 中国铁路 / 始发改签
    这些词在增值税专/普票里不会出现。
    """
    blob = " ".join(it["text"] for it in items)
    markers = ("电子客票", "车次", "票价", "买票请到12306", "中国铁路", "始发改签")
    return any(m in blob for m in markers)


def _find(items, regex, group=0, flags=0):
    """在全部识别行里找第一个匹配 regex 的捕获组（默认返回整段匹配 group=0）。"""
    for it in items:
        m = re.search(regex, it["text"], flags)
        if m:
            return m.group(group)
    return None


def _find_all(items, regex, group=1, flags=0):
    """收集全部匹配行（按出现顺序）。"""
    out = []
    for it in items:
        m = re.search(regex, it["text"], flags)
        if m:
            out.append(m.group(group))
    return out


def _normalize_amount(raw):
    """把 OCR 噪声金额归一化为 '123.45' 标准两位小数形式。

    OCR 常见噪声：
      - 小数点「.」被误识别为下划线「_」、逗号「,」、间隔号「·」、句号「。」或全角句号「．」
      - 数字本身可能是全角（由 normalize_fullwidth 先归一半角）
    返回 None 表示无法解析；否则一律返回 int.XX（两位小数）。
    """
    if not raw:
        return None
    s = normalize_fullwidth(raw)
    # 统一常见误识的小数/分隔符为「.」
    s = s.replace("_", ".").replace("·", ".").replace("。", ".").replace("．", ".")
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[^0-9.,]", "", s)  # 仅保留数字、点、逗号
    # 处理千分位/小数点歧义：
    #   同时含 , 和 . → 视 , 为千分位，去掉（如 1,234.00 → 1234.00）
    #   仅含 ,       → 视 , 为小数点（如 62,00 → 62.00）
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    m = re.match(r"(\d+)(?:\.(\d{1,2}))?", s)
    if not m:
        return None
    int_part, dec_part = m.groups()
    # 小数位：1 位表示十分位（如 137.5 → 137.50），2 位原样；
    # 必须向右补 0（ljust），不能用 zfill 左补（会把 137.5 错成 137.05）。
    dec = (dec_part if dec_part is not None else "00").ljust(2, "0")
    return f"{int(int_part)}.{dec}"


# 金额 token：整数任意位 + 可选千分位逗号 + 可选的小数部分（小数分隔符兼容
# 正常的 . 以及 OCR 误识的 _/·/。/．）。先优先匹配「含小数」的金额，纯整数兜底。
_AMOUNT_RE = re.compile(r"\d+(?:,\d{3})*(?:[._,·。．]\d{1,2})?")
_AMOUNT_INT_RE = re.compile(r"\d+(?:,\d{3})*")


def _extract_amount_from_line(text):
    """从一行文本抽取第一个金额并归一成 '123.45'（两位小数）。

    兼容 OCR 噪声：小数点被误识为下划线/逗号/间隔号/句号/全角句号、
    数字全角、金额内部被插空格（调用方先 normalize_num_spaces）、千分位逗号。
    优先取含小数的金额，避免在没有小数点时误抓其它整数；无匹配返回 None。
    火车票票价与增值税「价税合计/金额/税额」共用。
    """
    if not text:
        return None
    m = _AMOUNT_RE.search(text)
    if not m:
        m = _AMOUNT_INT_RE.search(text)
    if not m:
        return None
    return _normalize_amount(m.group(0))


def _extract_all_amounts_from_line(text):
    """从一行文本抽取全部金额（用于明细行同时含 金额/税额 的场景），
    返回归一成 '123.45' 的列表；无匹配返回空列表。
    """
    if not text:
        return []
    out = []
    for m in _AMOUNT_RE.finditer(text):
        v = _normalize_amount(m.group(0))
        if v:
            out.append(v)
    if not out:
        for m in _AMOUNT_INT_RE.finditer(text):
            v = _normalize_amount(m.group(0))
            if v:
                out.append(v)
    return out


def extract_train_tax(items):
    """数电铁路电子客票票面直接印「税额 ¥X.XX」，抽出它（纸质火车票无此行返回 None）。

    取「税额」标签行及其后至多 2 行拼接，兼容数电票标签与值分行版式。
    """
    for i, it in enumerate(items):
        if "税额" in it["text"]:
            window = it["text"]
            for j in range(i + 1, min(i + 3, len(items))):
                window += " " + items[j]["text"]
            v = _extract_amount_from_line(normalize_num_spaces(window))
            if v:
                return v
    return None


def parse_train_ticket(items):
    """解析铁路电子客票，抽取行程相关字段。

    用户决策：票价直接当 totalAmount，不拆分金额/税额（票面仅印一个票价）。
    ownerName 维持上传人（与增值税票一致），本函数不处理归属人。
    """
    raw_text = "\n".join(it["text"] for it in items)

    # 发票号 / 开票日期：复用通用抽取（火车票也有这两字段）
    invoice_number = extract_invoice_number(items)
    invoice_date = extract_invoice_date(items)

    # 出发站 / 到达站：含「站」的中文地名行（按出现顺序，首个=出发，次个=到达）
    stations = _find_all(items, r"([\u4e00-\u9fa5]{2,}站)")
    departure = stations[0] if len(stations) >= 1 else None
    arrival = stations[1] if len(stations) >= 2 else None

    # 车次：G/D/C/K/Z/T/L + 数字（如 G7608）
    train_no = _find(items, r"\b([GCDZKLT]\d{1,5})\b")

    # 乘车日期 + 开车时间：2026年07月31日 12:29开（两者可能其一缺失，逐个安全解析）
    ride_date = _find(items, r"(\d{4})年(\d{1,2})月(\d{1,2})日")
    depart_time = _find(items, r"(\d{1,2}):(\d{2})开")
    ride_date_iso = None
    depart_time_hm = None
    if ride_date:
        m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", ride_date)
        if m:
            y, mo, d = m.groups()
            ride_date_iso = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    if depart_time:
        m = re.match(r"(\d{1,2}):(\d{2})开", depart_time)
        if m:
            hh, mm = m.groups()
            depart_time_hm = f"{int(hh):02d}:{mm}"
    departure_datetime = (
        f"{ride_date_iso} {depart_time_hm}" if ride_date_iso and depart_time_hm else None
    )

    # 车厢/座位：04车13C号
    car_seat = _find(items, r"(\d{1,2}车\d{1,3}[A-F]?号)")

    # 席别：二等座/一等座/商务座/特等座/软卧/硬卧/硬座/无座…
    seat_class = _find(
        items,
        r"(一等座|二等座|商务座|特等座|优选一等座|软卧|硬卧|软座|硬座|无座|一等卧|二等卧)",
    )

    # 票价 → totalAmount（不拆分金额/税额）
    # OCR 常把小数点「.」误识别为「_」（如 62_00）、逗号、间隔号或全角句号；
    # 先用宽松正则抓出数字串，再由 _normalize_amount 归一成标准两位小数。
    _fare_raw = _find(
        items,
        r"票价[：:]\s*[¥￥]?\s*([0-9０-９]+(?:[._,·。．\s]?[0-9０-９]{2})?)",
        group=1,
    )
    fare = _normalize_amount(_fare_raw) if _fare_raw else None
    total_amount = fare  # 用户决策：直接当价税合计

    # 数电铁路客票票面直接给「税额」，优先采用（更准）；纸质火车票无此行 → None，
    # 规则引擎按 票价/(1+9%)×9% 公式兜底计算。有了税额可倒推不含税金额。
    train_tax = extract_train_tax(items)
    train_amount = None
    if fare and train_tax:
        try:
            train_amount = f"{round(float(fare) - float(train_tax), 2):.2f}"
        except (ValueError, TypeError):
            train_amount = None

    # 电子客票号 / 身份证号：OCR 常把数字、星号识别成全角，
    # 先对整行做全角→半角归一化再抽取，避免漏抽。
    _et_raw = _find(items, r"电子客票号[：:]\s*(.{15,30})", group=1)
    electronic_ticket_no = (
        re.sub(r"\D", "", normalize_fullwidth(_et_raw)) if _et_raw else None
    )
    # 身份证号行：归一化后匹配「数字+星号(半/全角)+数字」的遮挡形态
    _id_candidate = None
    for it in items:
        norm = normalize_fullwidth(it["text"]).replace("＊", "*")
        if re.search(r"\d{4,10}\*{2,8}\d{2,6}", norm):
            _id_candidate = norm
            break
    id_no = _id_candidate

    # 乘车人：紧跟在身份证号行之后的「纯中文姓名」行（布局稳定）；
    # 兜底：找 2~4 字纯中文且非站/座/关键字 的行。
    passenger = _extract_passenger(items, id_no)

    # 购买方名称 / 统一社会信用代码（与增值税票同源）
    buyer_name = _find(items, r"购买方名称[：:]\s*([\u4e00-\u9fa5A-Za-z0-9（）()]+)", group=1)
    buyer_tax_id = _find(
        items,
        r"统一社会信用代码[：:]\s*([A-Z0-9]{15,20})",
        group=1,
    )
    if buyer_tax_id:
        buyer_tax_id = normalize_fullwidth(buyer_tax_id)

    # 改签/退票标记
    ticket_note = _find(items, r"(始发改签|改签|退票)")

    # 销售方：铁路电子客票卖方为「中国铁路」（票面常不单独印销售方名称）
    seller_name = "中国铁路"

    return {
        "invoiceType": "train",
        "invoiceCode": None,
        "invoiceNumber": invoice_number,
        "invoiceDate": invoice_date,
        "sellerName": seller_name,
        "buyerName": buyer_name,
        "buyerTaxNo": buyer_tax_id,
        "voucherTitle": "电子发票（铁路电子客票）",
        "amount": train_amount,
        "taxAmount": train_tax,
        "taxRate": "0.09",       # 铁路电子客票法定抵扣率 9%（公告2024年第8号）
        "totalAmount": total_amount,
        "sellerTaxId": buyer_tax_id,  # 火车票无「销售方税号」，用购买方信用代码占位/展示
        "passengerName": passenger,
        "departureStation": departure,
        "arrivalStation": arrival,
        "trainNo": train_no,
        "rideDate": ride_date_iso,
        "departureTime": depart_time_hm,
        "departureDateTime": departure_datetime,
        "carSeatNo": car_seat,
        "seatClass": seat_class,
        "fare": fare,
        "electronicTicketNo": electronic_ticket_no,
        "idNo": id_no,
        "ticketNote": ticket_note,
        "rawText": raw_text,
    }


def _extract_passenger(items, id_no):
    """从包围盒行里抽乘车人姓名。

    主策略：身份证号行的下一行若为 2~4 字纯中文姓名则取之（火车票布局稳定：
    身份证号 → 乘车人 → 电子客票号）。
    兜底：在整页找第一个 2~4 字纯中文、且非站名/席别/关键字的行。
    """
    idx = None
    if id_no:
        for i, it in enumerate(items):
            if re.search(r"\d{4,10}\*{2,8}\d{2,6}", it["text"]):
                idx = i
                break
    if idx is not None and idx + 1 < len(items):
        nxt = items[idx + 1]["text"].strip()
        if re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", nxt):
            return nxt
    # 兜底
    stop = ("站", "座", "卧", "开", "改", "签", "退", "税", "信", "电", "客",
            "铁", "国", "局", "码", "号", "总", "金", "日", "月", "年", "期")
    for it in items:
        t = it["text"].strip()
        if re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", t) and not any(s in t for s in stop):
            return t
    return None


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
