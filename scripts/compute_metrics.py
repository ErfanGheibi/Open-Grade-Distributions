# Takes the raw extracted grade-distribution CSV (all 15,743 rows, straight
# out of extract_grade_distributions.py -- Faculty/Academic Career/Course/
# Year/Term still combined, redacted rows still present with
# "REDACTED (GIPA s.3(a)/3(b))" in every grade cell) and produces a NEW
# file with everything split into proper columns plus a set of derived
# metric columns appended on the end. Nothing in the source file is
# modified; this always writes fresh copies.
#
# Outputs:
#   UNSW_grades_with_metrics.csv  -- full dataset, all rows, for spreadsheet use
#   grades.json                   -- same data as JSON, consumed by the website
#
# Usage:
#   pip install pandas --break-system-packages   (only needed if you want
#     to explore the CSV yourself -- this script itself has no dependency
#     beyond the standard library)
#   python3 compute_metrics.py

import csv
import json
import re

IN_CSV = "UNSW_grade_distributions_21T3-24T2.csv"
OUT_CSV = "UNSW_grades_with_metrics.csv"
OUT_JSON = "grades.json"

# ---------------------------------------------------------------------------
# Grade-code taxonomy, built from the actual "Grade Code / Grade Description"
# legend printed in the disclosure log PDF (page 1), not guessed:
#
#   FL  Fail                          UF  Unsatisfactory Fail
#   AF  Absent Fail                   NF  Fail / Not Successful / Discontinued
#   PS  Pass                          CR  Credit
#   DN  Distinction                   HD  High Distinction
#   AW  Academic Withdrawal           PW  Permitted Withdrawal
#   CN  Not Yet Competent             CO  Competent
#   CM  Competent with Merit          SY  Successful / Satisfactory
#   EF  Enrolment Continuing          EC  Enrolment Continuing
#   EM  Excluded (Misconduct)         AS  Audited Course (no grade)
#   PE  Professional Experience       NC  Not Completed
#
# A handful of UNSW courses (e.g. COMP4920) are graded on a competency
# scale (CN/CO/CM) instead of the standard FL/PS/CR/DN/HD scale. Those
# rows are detected and flagged rather than silently shown as "0% for
# everything".
# ---------------------------------------------------------------------------
FAIL_CODES = ["FL", "UF", "AF", "NF"]
PASS_STD_CODES = ["PS", "CR", "DN", "HD"]
WITHDRAW_CODES = ["AW", "PW"]
NONSTANDARD_CODES = ["CN", "CO", "CM", "SY"]   # competency / satisfactory scale
OTHER_CODES = ["EF", "EC", "EM", "AS", "PE", "NC"]  # continuing / administrative

ALL_GRADE_COLS = FAIL_CODES + PASS_STD_CODES + WITHDRAW_CODES + NONSTANDARD_CODES + OTHER_CODES
assert len(ALL_GRADE_COLS) == 20

ORIG_FIELDS = ["Faculty", "Academic Career", "Course", "Year", "Term"] + \
              ["FL","UF","AF","CN","EF","EM","PS","CR","DN","HD","SY",
               "AS","CM","CO","EC","PE","AW","NC","NF","PW"]  # order the extractor wrote them in

COURSE_RE = re.compile(
    r"^(?P<code>[A-Z]{2,6}\d{2,5})\s+(?P<name>.+?)\s+"
    r"(?P<course_id>\d{6})\s+(?P<offering_seq>\d)\s+(?:UGRD|PGRD|PGRO)$"
)

CAREER_MAP = {"Undergraduate": "U", "Postgraduate": "P"}

# Best-effort grouping of UNSW's many term-naming conventions (Semester,
# Trimester, Term, Hexamester, Summer ...) into a coarse T1/T2/T3 used only
# for the "23T1-24T2" style date-range filter and for chronological
# ordering on the dashboard charts. This is an approximation on our part
# (UNSW's Hexamester system in particular doesn't map cleanly onto three
# even blocks for every faculty) -- see the Explanation page on the site.
T1_HINTS = ["semester 1", "term 1", "hexamester 1", "hexamester 2", "trimester 1"]
T2_HINTS = ["semester 2", "term 2", "hexamester 3", "hexamester 4", "trimester 2"]
T3_HINTS = ["summer", "term 3", "hexamester 5", "hexamester 6", "trimester 3"]


def simplify_career(value):
    for word, short in CAREER_MAP.items():
        if value.startswith(word):
            return short + value[len(word):]
    return value


def split_course(value):
    m = COURSE_RE.match(value)
    if not m:
        return None
    return m.group("code"), m.group("name"), m.group("course_id"), m.group("offering_seq")


def clean_term(term, year):
    if term.startswith(year + " "):
        term = term[len(year) + 1:]
    # PDF extraction artifact: on some redacted rows the truncated
    # "Canberra" -> "Canber" text runs straight into the first redaction
    # marker with no gap, producing e.g. "Canber3(a),". Strip it back off;
    # the row's redacted status is still correctly detected from the
    # other 19 grade columns regardless.
    term = re.sub(r"3\(a\),?\s*3?\(?b?\)?$", "", term).rstrip()
    return term


# Display code for the Term column, and the ordering key used for the
# date-range filter and the dashboard chart's x-axis. UNSW's disclosure log
# mixes several term-naming systems:
#   Hexamester 1-6   -> H1..H6   (a separate 6-part flexible-delivery calendar)
#   Semester 1/2, Term 1/2/3, Trimester 1/2/3 -> T1/T2/T3
#   Summer sessions   -> S        (its own code -- NOT folded into T3; a
#                                   course can run both a "Term 3" and a
#                                   separate "Summer Term" in the same year,
#                                   and conflating them silently merged two
#                                   genuinely different cohorts' grades in
#                                   earlier versions of this pipeline)
# No course in this dataset mixes the Hexamester system with the Term/
# Summer system, so the two families never need to interleave against each
# other -- each family just needs internally-consistent chronological
# ordering, which SEQ_MAP below provides.
SEQ_MAP = {
    "H1": 1, "H2": 2, "H3": 3, "H4": 4, "H5": 5, "H6": 6,
    "T1": 1, "T2": 3, "T3": 5, "S": 6,
}


def term_code(term_text, year):
    t = term_text.lower()
    yy = str(year)[-2:]
    m = re.search(r"hexamester\s*(\d)", t)
    if m:
        return f"{yy}H{m.group(1)}"
    for keyword in ("semester", "term", "trimester"):
        m = re.search(keyword + r"\s*(\d)", t)
        if m:
            return f"{yy}T{m.group(1)}"
    if "summer" in t:
        return f"{yy}S"
    return f"{yy}T?"


def term_seq(term_code_str):
    # strip the two-digit year prefix, look up the remaining H#/T#/S code
    return SEQ_MAP.get(term_code_str[2:], 0)


def parse_pct(raw):
    raw = raw.strip()
    if not raw or "REDACTED" in raw:
        return None
    return float(raw.rstrip("%"))


def main():
    with open(IN_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        raw_rows = list(reader)

    out_rows = []
    for i, row in enumerate(raw_rows, start=1):
        is_redacted = any("REDACTED" in row[c] for c in ALL_GRADE_COLS)

        split = split_course(row["Course"])
        if split is None:
            # Doesn't happen in this dataset, but don't lose the row silently.
            code, name, course_id, offering_seq = "", row["Course"], "", ""
        else:
            code, name, course_id, offering_seq = split

        term_text = clean_term(row["Term"], row["Year"])
        tcode = term_code(term_text, row["Year"])
        tseq = term_seq(tcode)

        out = {
            "Row": i,
            "Faculty": row["Faculty"],
            "AcademicCareer": simplify_career(row["Academic Career"]),
            "CourseCode": code,
            "CourseName": name,
            "CourseID": course_id,
            "OfferingSeq": offering_seq,
            "Year": int(row["Year"]),
            "T": term_text,
            "TermSeq": tseq,
            "TermCode": tcode,
            "SortKey": int(row["Year"]) * 10 + tseq,
            "IsRedacted": is_redacted,
        }

        if is_redacted:
            for c in ALL_GRADE_COLS:
                out[c] = None
            out.update({
                "FailSum": None, "WithdrawSum": None, "NonstdSum": None, "OtherSum": None,
                "Fail_norm": None, "PS_norm": None, "CR_norm": None, "DN_norm": None, "HD_norm": None,
                "IsNonStandardGrading": False, "Note": "Redacted by university under GIPA s.3(a)/3(b)",
                "Index": None,
            })
            out_rows.append(out)
            continue

        vals = {c: parse_pct(row[c]) or 0.0 for c in ALL_GRADE_COLS}
        for c in ALL_GRADE_COLS:
            out[c] = vals[c] if vals[c] != 0.0 else None  # keep CSV/JSON clean (no 0.00 clutter)

        fail_sum = sum(vals[c] for c in FAIL_CODES)
        pass_std_sum = sum(vals[c] for c in PASS_STD_CODES)
        withdraw_sum = sum(vals[c] for c in WITHDRAW_CODES)
        nonstd_sum = sum(vals[c] for c in NONSTANDARD_CODES)
        other_sum = sum(vals[c] for c in OTHER_CODES)

        # Normalise fail/pass rates against everything EXCEPT withdrawals,
        # per spec ("normalized, not accounting for withdrawals"). We
        # deliberately do NOT also strip out the "other" (EF/EC/EM/AS/PE/NC)
        # or competency-scale (CN/CO/CM/SY) categories from the base --
        # only withdrawals are excluded, as requested.
        norm_base = max(100.0 - withdraw_sum, 1.0)  # guard divide-by-zero
        fail_norm = round(fail_sum / norm_base * 100, 2)
        ps_norm = round(vals["PS"] / norm_base * 100, 2)
        cr_norm = round(vals["CR"] / norm_base * 100, 2)
        dn_norm = round(vals["DN"] / norm_base * 100, 2)
        hd_norm = round(vals["HD"] / norm_base * 100, 2)

        # Flag competency-scale courses (e.g. practicums graded Successful/
        # Not-Yet-Competent instead of Pass-Credit-Distinction-HD). Some of
        # these still carry a standard FL for genuine non-completion, so we
        # key this off the *pass* tiers being unused, not fail+pass together.
        is_nonstandard = pass_std_sum < 1.0 and nonstd_sum > 5.0

        note = ""
        if is_nonstandard:
            parts = [f"{c} {vals[c]:.1f}%" for c in NONSTANDARD_CODES if vals[c] > 0]
            note = "Non-standard (competency) grading: " + ", ".join(parts)
        elif other_sum > 15.0:
            parts = [f"{c} {vals[c]:.1f}%" for c in OTHER_CODES if vals[c] > 0]
            note = "Notable other/continuing grades: " + ", ".join(parts)

        index = None
        if not is_nonstandard:
            index = round(hd_norm - fail_norm + 0.5 * dn_norm + 0.25 * cr_norm, 2)

        out.update({
            "FailSum": round(fail_sum, 2) if fail_sum else None,
            "WithdrawSum": round(withdraw_sum, 2) if withdraw_sum else None,
            "NonstdSum": round(nonstd_sum, 2) if nonstd_sum else None,
            "OtherSum": round(other_sum, 2) if other_sum else None,
            "Fail_norm": fail_norm if fail_sum else 0.0,
            "PS_norm": ps_norm,
            "CR_norm": cr_norm,
            "DN_norm": dn_norm,
            "HD_norm": hd_norm,
            "IsNonStandardGrading": is_nonstandard,
            "Note": note,
            "Index": index,
        })
        out_rows.append(out)

    fieldnames = ["Row", "Faculty", "AcademicCareer", "CourseCode", "CourseName", "CourseID",
                  "OfferingSeq", "Year", "T", "TermSeq", "TermCode", "SortKey", "IsRedacted"] + \
                 ALL_GRADE_COLS + \
                 ["FailSum", "WithdrawSum", "NonstdSum", "OtherSum",
                  "Fail_norm", "PS_norm", "CR_norm", "DN_norm", "HD_norm",
                  "IsNonStandardGrading", "Note", "Index"]

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        # Drop null-valued keys to shrink the payload the website has to
        # fetch/parse (most rows only populate 4-8 of the 20 grade columns).
        compact_rows = [{k: v for k, v in r.items() if v is not None and v != ""} for r in out_rows]
        json.dump(compact_rows, f, separators=(",", ":"))

    n_redacted = sum(1 for r in out_rows if r["IsRedacted"])
    n_nonstd = sum(1 for r in out_rows if r["IsNonStandardGrading"])
    print(f"Wrote {len(out_rows)} rows to {OUT_CSV} and {OUT_JSON}.")
    print(f"  {n_redacted} redacted rows, {n_nonstd} non-standard (competency) grading rows.")


if __name__ == "__main__":
    main()
