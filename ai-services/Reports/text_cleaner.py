import re


def clean_text(text: str) -> str:
    if not text:
        return ""

    cleaned = text.replace("\x00", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()
