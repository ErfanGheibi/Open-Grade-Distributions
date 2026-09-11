# Extracts the UNSW grade-distribution disclosure log into a clean CSV/TXT.
#
# Why this needed a real parser instead of a generic table extractor:
# the PDF isn't a drawn table -- each grade percentage is just free text
# positioned at an x-coordinate, and columns with 0% simply have no text
# at all (no "0.00%" placeholder). So column alignment can only be
# recovered by comparing each value's x-position to the x-position of its
# column header (FL, UF, AF, ... PW), which repeats on every page.
#
# Usage: put this script in the same folder as the source PDF and run:
#   pip install pdfplumber --break-system-packages
#   python3 extract_grade_distributions.py

import pdfplumber
import re
import csv
from collections import defaultdict

INPUT = "UNSW_disclosure_log_grade_distributions_21T3-24T2.pdf"  # path to the source PDF
OUT_CSV = "UNSW_grade_distributions_21T3-24T2.csv"
OUT_TXT = "UNSW_grade_distributions_21T3-24T2.txt"

GRADE_COLS = ["FL","UF","AF","CN","EF","EM","PS","CR","DN","HD","SY",
              "AS","CM","CO","EC","PE","AW","NC","NF","PW"]

# Left-section column boundaries (x0 cutoffs), determined from the
# fixed template used throughout the document.
FACULTY_END = 131.3       # Faculty column: x0 < this
CAREER_END = 185.5        # Academic Career column
COURSE_END = 300.0        # Course column
YEAR_END = 318.0          # Year column
TERM_END = 358.0          # Term column (grade section starts after this)

YEAR_RE = re.compile(r"^\d{4}$")
PCT_RE = re.compile(r"^\d+(\.\d+)?%$")
REDACT_A_RE = re.compile(r"^\d+\(a\),?$")
REDACT_B_RE = re.compile(r"^\d+\(b\)$")

def group_into_lines(words, tol=1.0):
    lines = defaultdict(list)
    for w in words:
        # round 'top' to nearest tol to merge words on the same visual line
        key = round(w["top"] / tol) * tol
        lines[key].append(w)
    for key in lines:
        lines[key].sort(key=lambda w: w["x0"])
    return [lines[k] for k in sorted(lines.keys())]

def get_header_positions(lines):
    """Find the grade-header row (FL, UF, AF ... PW) and return {code: x0}."""
    for line in lines:
        texts = [w["text"] for w in line]
        if "FL" in texts and "PW" in texts and len(texts) >= 15:
            return {w["text"]: w["x0"] for w in line if w["text"] in GRADE_COLS}
    return None

def is_data_row(line):
    """A data row has a 4-digit year token positioned in the Year column."""
    for w in line:
        if COURSE_END <= w["x0"] < YEAR_END and YEAR_RE.match(w["text"]):
            return True
    return False

def bucket_left_fields(line):
    faculty, career, course, year, term = [], [], [], [], []
    for w in line:
        x = w["x0"]
        if x < FACULTY_END:
            faculty.append(w["text"])
        elif x < CAREER_END:
            career.append(w["text"])
        elif x < COURSE_END:
            course.append(w["text"])
        elif x < YEAR_END:
            year.append(w["text"])
        elif x < TERM_END:
            term.append(w["text"])
    return (" ".join(faculty), " ".join(career), " ".join(course),
            " ".join(year), " ".join(term))

def merge_grade_tokens(line):
    """Words in the grade section, merging '3(a),' + '3(b)' redaction pairs
    into a single unit so they aren't split across two columns."""
    tokens = [w for w in line if w["x0"] >= TERM_END]
    tokens.sort(key=lambda w: w["x0"])
    units = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if REDACT_A_RE.match(t["text"]) and i + 1 < len(tokens) and REDACT_B_RE.match(tokens[i+1]["text"]):
            units.append({"x0": t["x0"], "text": "REDACTED (GIPA s.3(a)/3(b))"})
            i += 2
        else:
            units.append({"x0": t["x0"], "text": t["text"]})
            i += 1
    return units

def assign_to_columns(units, header_pos):
    row = {code: "" for code in GRADE_COLS}
    for u in units:
        # nearest header column by x0 distance
        best_code = min(header_pos.keys(), key=lambda c: abs(header_pos[c] - u["x0"]))
        if row[best_code]:
            row[best_code] += " " + u["text"]
        else:
            row[best_code] = u["text"]
    return row

def main():
    all_rows = []
    with pdfplumber.open(INPUT) as pdf:
        for pageno, page in enumerate(pdf.pages):
            words = page.extract_words()
            if not words:
                page.flush_cache()
                continue
            lines = group_into_lines(words)
            header_pos = get_header_positions(lines)
            if header_pos is None:
                page.flush_cache()
                continue  # e.g. the legend page at the very start
            for line in lines:
                if not is_data_row(line):
                    continue
                faculty, career, course, year, term = bucket_left_fields(line)
                units = merge_grade_tokens(line)
                grades = assign_to_columns(units, header_pos)
                record = {
                    "Faculty": faculty,
                    "Academic Career": career,
                    "Course": course,
                    "Year": year,
                    "Term": term,
                }
                record.update(grades)
                all_rows.append(record)
            page.flush_cache()
            if pageno % 20 == 0:
                print(f"page {pageno}: {len(all_rows)} rows so far", flush=True)

    fieldnames = ["Faculty", "Academic Career", "Course", "Year", "Term"] + GRADE_COLS

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    # Also a plain-text pipe-delimited version for easy eyeballing
    with open(OUT_TXT, "w", encoding="utf-8") as f:
        f.write(" | ".join(fieldnames) + "\n")
        for r in all_rows:
            f.write(" | ".join(str(r[c]) for c in fieldnames) + "\n")

    print(f"Extracted {len(all_rows)} data rows.")

if __name__ == "__main__":
    main()
