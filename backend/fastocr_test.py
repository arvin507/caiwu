"""
本地离线 OCR 验证脚本（fast-ocr 底层引擎 = RapidOCR）
- 每张 PDF 首页转 PNG，喂给 RapidOCR
- 利用包围盒坐标做几何归位提取结构化字段（而非纯文本顺序）
- 与数据库真值（百度 OCR 解析结果）自动比对
"""
import os, re, glob, json
import fitz  # pymupdf
from rapidocr_onnxruntime import RapidOCR

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
GROUND_TRUTH = {
    "inv-5a534d3e-0134-4efc-8fd5-e787ddef720a.pdf": {
        "invoice_number": "26312000005060606851",
        "seller": "添猫科技（浙江）有限公司上海分公司",
        "amount_with_tax": "22.60",
        "tax_amount": "0.66",
    },
    "inv-7aa9356a-1f61-49f0-a7ee-0a32dd47e5fb.pdf": {
        "invoice_number": "26337000000699146182",
        "seller": "上海星巴克咖啡经营有限公司杭州分公司",
        "amount_with_tax": "55.50",
        "tax_amount": "3.14",
    },
    "inv-1334236d-1279-41ea-ab2f-91e251ececc7.pdf": {
        "invoice_number": "26337000000711672681",
        "seller": "浙江顺丰速运有限公司",
        "amount_with_tax": "237.50",
        "tax_amount": "13.44",
    },
}

def normalize_num_spaces(text):
    # 去掉金额内部空格：含「数字. 数字」与「数字 .数字」「数字 数字」
    t = re.sub(r"(\d)\s+\.(\d)", r"\1.\2", text)
    t = re.sub(r"([0-9.]+)\s+([0-9])", r"\1\2", t)
    return t

def box_center(box):
    xs = [p[0] for p in box]; ys = [p[1] for p in box]
    return ((min(xs)+max(xs))/2, (min(ys)+max(ys))/2)

def pdf_to_png(pdf_path, dpi=200):
    doc = fitz.open(pdf_path)
    pix = doc[0].get_pixmap(dpi=dpi)
    out = pdf_path + ".png"
    pix.save(out)
    doc.close()
    return out

def extract_invoice_number(items):
    blob = " ".join(it["text"] for it in items)
    m = re.search(r"发票号码[：:\s]*([0-9][0-9\s]{8,}[0-9])", blob)
    if m:
        return re.sub(r"\s+", "", m.group(1))
    return None

def extract_amount_with_tax(items):
    # 价税合计 行上的 ¥ 金额
    for it in items:
        if "价税合计" in it["text"]:
            m = re.search(r"[¥￥]?\s*(\d+\.\d{2})", normalize_num_spaces(it["text"]))
            if m:
                return m.group(1)
    # 退路：包含「小写」且含 ¥ 的行
    for it in items:
        if "小写" in it["text"]:
            m = re.search(r"[¥￥]?\s*(\d+\.\d{2})", normalize_num_spaces(it["text"]))
            if m:
                return m.group(1)
    return None

def extract_tax_amount(items):
    # 税额 = 价税合计 行之前最近的金额数字（部分发票 ¥ 符号被误识别，故放宽前缀）
    total_idx = next((i for i, it in enumerate(items) if "价税合计" in it["text"]), None)
    if total_idx is None:
        return None
    for i in range(total_idx - 1, -1, -1):
        m = re.search(r"(\d+\.\d{2})", normalize_num_spaces(items[i]["text"]))
        if m:
            return m.group(1)
    return None

def extract_seller(items):
    # 这些发票版式：购买方在左、销售方在右（同高并排）→ 销售方名称是 x 中心最靠右的「名称：」
    best = None
    for it in items:
        if "名称" in it["text"]:
            cx = box_center(it["box"])[0]
            m = re.search(r"名称[：:]\s*([\u4e00-\u9fa5A-Za-z0-9（）()]+)", it["text"])
            if m and len(m.group(1)) > 3:
                if best is None or cx > best[0]:
                    best = (cx, m.group(1))
    return best[1] if best else None

def main():
    ocr = RapidOCR()
    pdfs = sorted(glob.glob(os.path.join(UPLOAD_DIR, "inv-*.pdf")))
    print(f"找到发票 PDF: {len(pdfs)} 张\n")
    for pdf in pdfs:
        base = os.path.basename(pdf)
        png = pdf_to_png(pdf)
        result, _ = ocr(png)
        items = [{"box": r[0], "text": r[1], "score": float(r[2])} for r in result] if result else []
        gt = GROUND_TRUTH.get(base, {})
        got = {
            "invoice_number": extract_invoice_number(items),
            "amount_with_tax": extract_amount_with_tax(items),
            "tax_amount": extract_tax_amount(items),
            "seller": extract_seller(items),
        }
        avg = round(sum(i["score"] for i in items)/len(items), 3) if items else 0
        def mark(k):
            g, w = got[k], gt.get(k)
            return "OK" if (g and w and g.strip() == w.strip()) else f"got={g!r} want={w!r}"
        print(f"=== {base} ===")
        print(f"  OCR 行数: {len(items)}, 平均置信度: {avg}")
        print(f"  发票号码: {mark('invoice_number')}")
        print(f"  价税合计: {mark('amount_with_tax')}")
        print(f"  税额:     {mark('tax_amount')}")
        print(f"  销售方:   {mark('seller')}")
        print()

if __name__ == "__main__":
    main()
