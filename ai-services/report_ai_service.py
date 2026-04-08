import json
import re
import sys
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

BASE_DIR = Path(__file__).resolve().parent
REPORTS_DIR = BASE_DIR / "Reports"
MODEL_NAME = "python-report-v1"
DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
PPTX_NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}

sys.path.insert(0, str(REPORTS_DIR))

try:
    from pdf_extractor import extract_text_from_pdf
except Exception:
    extract_text_from_pdf = None

try:
    from text_cleaner import clean_text
except Exception:
    def clean_text(text):
        return re.sub(r"\s+", " ", str(text or "")).strip()


def read_payload():
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def extract_text_from_docx(path: Path) -> str:
    with ZipFile(path) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    parts = []
    for node in root.findall(".//w:t", DOCX_NS):
        if node.text:
            parts.append(node.text)
    return " ".join(parts)


def extract_text_from_pptx(path: Path) -> str:
    collected = []
    with ZipFile(path) as zf:
        slide_names = sorted(
            name for name in zf.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )
        for slide_name in slide_names:
            root = ET.fromstring(zf.read(slide_name))
            for node in root.findall(".//a:t", PPTX_NS):
                if node.text:
                    collected.append(node.text)
    return " ".join(collected)


def extract_text_from_xlsx(path: Path) -> str:
    with ZipFile(path) as zf:
        shared_strings = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for node in root.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"):
                if node.text:
                    shared_strings.append(node.text)

        text_parts = []
        sheet_names = sorted(
            name for name in zf.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        for sheet_name in sheet_names:
            root = ET.fromstring(zf.read(sheet_name))
            for cell in root.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                cell_type = cell.attrib.get("t")
                value_node = cell.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                if value_node is None or value_node.text is None:
                    continue
                value = value_node.text
                if cell_type == "s":
                    try:
                        text_parts.append(shared_strings[int(value)])
                    except Exception:
                        continue
                else:
                    text_parts.append(value)
    return " ".join(text_parts)


def extract_text(path_str: str, mime_type: str = "") -> str:
    path = Path(path_str)
    suffix = path.suffix.lower()

    if suffix == ".pdf" and extract_text_from_pdf:
        with open(path, "rb") as file_obj:
            return extract_text_from_pdf(file_obj) or ""
    if suffix == ".docx":
        return extract_text_from_docx(path)
    if suffix == ".pptx":
        return extract_text_from_pptx(path)
    if suffix == ".xlsx":
        return extract_text_from_xlsx(path)

    if suffix in {".doc", ".ppt", ".xls"}:
        return ""

    if mime_type == "application/pdf" and extract_text_from_pdf:
        with open(path, "rb") as file_obj:
            return extract_text_from_pdf(file_obj) or ""

    return ""


def tokenize(text: str):
    return re.findall(r"[a-zA-Z][a-zA-Z0-9\-\+\.]+", text.lower())


def split_sentences(text: str):
    raw = re.split(r"(?<=[\.\!\?])\s+", text)
    return [item.strip() for item in raw if item.strip()]


def sentence_score(sentence: str, frequencies: Counter) -> int:
    tokens = tokenize(sentence)
    if not tokens:
        return 0
    return sum(frequencies.get(token, 0) for token in tokens)


def summarize_text_heuristic(text: str):
    sentences = split_sentences(text)
    if not sentences:
        return ""

    frequencies = Counter(tokenize(text))
    top_sentences = sorted(
        sentences,
        key=lambda sentence: sentence_score(sentence, frequencies),
        reverse=True,
    )[:3]

    return " ".join(top_sentences)


def top_keywords(text: str):
    stop_words = {
        "the", "and", "for", "with", "that", "this", "from", "are", "was",
        "were", "have", "has", "had", "into", "their", "there", "about",
        "your", "you", "our", "but", "not", "can", "will", "all", "per",
        "report", "department", "file",
    }
    counts = Counter(
        token for token in tokenize(text) if len(token) > 2 and token not in stop_words
    )
    return [word for word, _ in counts.most_common(10)]


def detect_document_type(mime_type: str, original_name: str):
    suffix = Path(original_name or "").suffix.lower()
    if suffix in {".pdf"} or mime_type == "application/pdf":
        return "pdf"
    if suffix in {".doc", ".docx"}:
        return "word"
    if suffix in {".ppt", ".pptx"}:
        return "powerpoint"
    if suffix in {".xls", ".xlsx"}:
        return "excel"
    return "unknown"


def analyze_report(payload):
    file_path = str(payload.get("filePath") or "")
    mime_type = str(payload.get("mimeType") or "")
    original_name = str(payload.get("originalName") or "")

    if not file_path:
        return {
            "aiUsed": False,
            "aiModel": MODEL_NAME,
            "aiFallbackReason": "Missing file path",
        }

    extracted = extract_text(file_path, mime_type)
    cleaned = clean_text(extracted)
    summary = summarize_text_heuristic(cleaned)
    keywords = top_keywords(cleaned)

    return {
      "aiUsed": True,
      "aiModel": MODEL_NAME,
      "documentType": detect_document_type(mime_type, original_name),
      "summary": summary or None,
      "keywords": keywords,
      "extractedTextPreview": cleaned[:1500] if cleaned else None,
      "characterCount": len(cleaned),
      "aiFallbackReason": None if cleaned else "No extractable text found for this file type",
    }


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = read_payload()

    if command == "analyze_report":
        result = analyze_report(payload)
    else:
        result = {
            "aiUsed": False,
            "aiModel": MODEL_NAME,
            "aiFallbackReason": f"Unsupported command: {command}",
        }

    print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
