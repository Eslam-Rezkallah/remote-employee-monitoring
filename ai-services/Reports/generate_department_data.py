import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pandas as pd
from PyPDF2 import PdfReader


BASE_DIR = Path(__file__).resolve().parent
DATASET_DIR = BASE_DIR / "Dataset"
TASKS_OUTPUT = BASE_DIR / "department_employee_tasks.csv"
SKILLS_OUTPUT = BASE_DIR / "department_employee_skills.csv"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

KEYWORD_SKILLS = {
    "react": "React",
    "typescript": "TypeScript",
    "tailwind": "TailwindCSS",
    "storybook": "Storybook",
    "lighthouse": "Lighthouse",
    "playwright": "Playwright",
    "wcag": "WCAG compliance",
    "aria": "Accessibility",
    "sql": "SQL",
    "graphql": "GraphQL",
    "kafka": "Kafka",
    "redis": "Redis",
    "node.js": "Node.js",
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "terraform": "Terraform",
    "aws": "AWS",
    "grafana": "Grafana",
    "pagerduty": "PagerDuty",
    "python": "Python",
    "pandas": "pandas",
    "airflow": "Airflow",
    "postgresql": "PostgreSQL",
    "ocr": "OCR",
    "rag": "RAG",
    "ner": "NER",
    "sentiment": "Sentiment analysis",
    "figma": "Figma",
    "design system": "Design systems",
    "usability": "Usability testing",
    "a/b": "A/B test analysis",
    "funnel": "Funnel analysis",
    "forecast": "Forecasting",
    "segmentation": "Customer segmentation",
    "fraud": "Fraud detection",
    "recommendation": "Recommendation systems",
    "xss": "XSS testing",
    "sqli": "SQL injection testing",
    "idor": "IDOR testing",
    "owasp": "OWASP testing",
    "burp": "Burp Suite",
    "nmap": "Nmap",
    "bloodhound": "BloodHound",
    "mimikatz": "Mimikatz",
    "jmeter": "JMeter",
    "load test": "Load testing",
}


def clean_name(value: str) -> str:
    value = (value or "").replace("\xa0", " ")
    value = value.replace("â€“", "-").replace("â€”", " - ")
    value = re.sub(r"[\u2022\u25aa\u25cf\uf0b7]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" |:-")


def read_docx_lines(path: Path) -> list[str]:
    with ZipFile(path) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    lines = []
    for para in root.findall(".//w:p", NS):
        parts = [node.text for node in para.findall(".//w:t", NS) if node.text]
        line = "".join(parts).strip()
        if line:
            lines.append(clean_name(line))
    return lines


def read_pdf_lines(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    lines = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        for line in page_text.splitlines():
            cleaned = clean_name(line)
            if cleaned:
                lines.append(cleaned)
    return lines


def read_file_lines(path: Path) -> list[str]:
    if path.suffix.lower() == ".docx":
        return read_docx_lines(path)
    if path.suffix.lower() == ".pdf":
        return read_pdf_lines(path)
    return []


def joined_text(lines: list[str]) -> str:
    return clean_name(" \n ".join(lines))


def extract_employee_name(lines: list[str], path: Path) -> str:
    for idx, line in enumerate(lines):
        if line == "Employee Name" and idx + 1 < len(lines):
            return lines[idx + 1]

    parts = path.stem.split("_")
    if len(parts) >= 4 and parts[1].lower() == "report":
        return " ".join(parts[2:-2])
    return ""


def extract_tasks(lines: list[str], path: Path) -> list[str]:
    task_titles = []
    for idx, line in enumerate(lines):
        if line == "Description" and idx > 0:
            title = clean_name(re.sub(r"^[^A-Za-z0-9]+", "", lines[idx - 1]))
            if 3 <= len(title) <= 120:
                task_titles.append(title)

    if task_titles:
        return sorted(set(task_titles))

    title = clean_name(lines[0] if lines else path.stem)
    return [title] if title else []


def extract_skills(lines: list[str], text: str) -> list[str]:
    skills = set()

    for idx, line in enumerate(lines):
        lowered = line.lower()
        if lowered.startswith("technologies / tools") or lowered.startswith("tools used"):
            if idx + 1 < len(lines):
                for piece in re.split(r",|/| and ", lines[idx + 1]):
                    piece = clean_name(piece)
                    if 2 <= len(piece) <= 50:
                        skills.add(piece)

    lower_text = text.lower()
    for keyword, label in KEYWORD_SKILLS.items():
        if keyword in lower_text:
            skills.add(label)

    return sorted(skills)


def build_rows() -> tuple[list[dict], list[dict]]:
    task_rows = []
    skill_rows = []

    for path in sorted(DATASET_DIR.rglob("*")):
        if path.suffix.lower() not in {".docx", ".pdf"}:
            continue

        department = path.parent.name
        lines = read_file_lines(path)
        if not lines:
            continue

        text = joined_text(lines)
        employee_name = extract_employee_name(lines, path)
        if not employee_name:
            continue

        for task in extract_tasks(lines, path):
            task_rows.append(
                {
                    "Department": department,
                    "employee_name": employee_name,
                    "task": task,
                }
            )

        for skill in extract_skills(lines, text):
            skill_rows.append(
                {
                    "Department": department,
                    "employee_name": employee_name,
                    "skill": skill,
                }
            )

    return task_rows, skill_rows


def main() -> None:
    if not DATASET_DIR.exists():
        raise FileNotFoundError(f"Dataset folder not found: {DATASET_DIR}")

    task_rows, skill_rows = build_rows()

    tasks_df = pd.DataFrame(task_rows).drop_duplicates().sort_values(
        ["Department", "employee_name", "task"]
    )
    skills_df = pd.DataFrame(skill_rows).drop_duplicates().sort_values(
        ["Department", "employee_name", "skill"]
    )

    tasks_df.to_csv(TASKS_OUTPUT, index=False, encoding="utf-8-sig")
    skills_df.to_csv(SKILLS_OUTPUT, index=False, encoding="utf-8-sig")

    print(f"Saved {len(tasks_df)} task rows to {TASKS_OUTPUT.name}")
    print(f"Saved {len(skills_df)} skill rows to {SKILLS_OUTPUT.name}")


if __name__ == "__main__":
    main()
