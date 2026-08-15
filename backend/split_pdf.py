"""
拆分多页 PDF 为单页 PDF（供后端把「合并发票 PDF」拆成多张独立发票）。

用法：
    split_pdf.py <源pdf绝对路径> <输出目录>

行为：
    - 把源 PDF 的每一页导出为一个独立 PDF，命名 `<源stem>__p<页号(从1)>.pdf`
      输出到 <输出目录>（不存在则创建）。
    - 只在「源页数 > 1」时才真正拆分；单页 PDF 直接复用源文件（返回 [源路径]），
      避免无谓复制。
    - stdout 打印 JSON 数组（按页序的绝对路径）；任何异常写 stderr 并以非 0 退出。

依赖：pymupdf（与 local_ocr.py 同一运行时）。
"""
import os
import sys
import json

try:
    import pymupdf as fitz
except ImportError:
    sys.stderr.write("缺少 pymupdf，请 pip install pymupdf\n")
    sys.exit(2)


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("用法: split_pdf.py <源pdf> <输出目录>\n")
        sys.exit(2)
    src = sys.argv[1]
    out_dir = sys.argv[2]
    if not os.path.isfile(src):
        sys.stderr.write(f"源文件不存在: {src}\n")
        sys.exit(1)
    if not src.lower().endswith(".pdf"):
        # 非 PDF（图片等）按单页处理：直接返回源路径
        sys.stdout.write(json.dumps([src], ensure_ascii=False))
        return
    doc = fitz.open(src)
    n = doc.page_count
    try:
        if n <= 1:
            # 单页：无需拆分
            sys.stdout.write(json.dumps([src], ensure_ascii=False))
            return
        os.makedirs(out_dir, exist_ok=True)
        stem = os.path.splitext(os.path.basename(src))[0]
        # 去掉可能的 UUID/后缀，避免文件名过长
        if len(stem) > 40:
            stem = stem[:40]
        out_paths = []
        for i in range(n):
            page = doc.load_page(i)
            nd = fitz.open()
            nd.insert_pdf(doc, from_page=i, to_page=i)
            out_path = os.path.join(out_dir, f"{stem}__p{i + 1}.pdf")
            nd.save(out_path)
            nd.close()
            out_paths.append(out_path)
        sys.stdout.write(json.dumps(out_paths, ensure_ascii=False))
    finally:
        doc.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write(f"SPLIT_ERROR: {type(e).__name__}: {e}\n")
        sys.exit(1)
