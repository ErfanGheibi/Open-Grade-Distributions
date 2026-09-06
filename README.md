# Open Grade Distributions

A static site for exploring UNSW's publicly disclosed course grade distributions
(21T3–24T2), built from a GIPA disclosure log PDF. No build step, no backend —
plain HTML/CSS/JS, hostable directly on GitHub Pages.

## Structure

```
index.html          Home page: searchable/sortable grade table + per-course dashboard
explain.html         Methodology: metrics, normalization, the Index formula
source.html          Where the data comes from (UNSW's GIPA disclosure log)
story.html            Placeholder page
developers.html       Placeholder page
css/style.css         All styling (design tokens at the top)
js/data.js             Shared data loading + small utilities
js/home.js             Table/filter/sort/search + course dashboard + chart logic
data/grades.json        The dataset the site actually reads (generated, see below)
data/UNSW_grades_with_metrics.csv   Same data as CSV, for spreadsheet use
scripts/extract_grade_distributions.py   PDF -> raw CSV (position-based extraction)
scripts/compute_metrics.py               Raw CSV -> grades.json / *_with_metrics.csv
scripts/UNSW_grade_distributions_21T3-24T2.csv   Raw extracted data (input to compute_metrics.py)
```

## Running locally

Because the page loads `data/grades.json` via `fetch()`, opening `index.html`
directly from disk (`file://...`) won't work in most browsers (CORS blocks
local file fetches). Serve the folder over HTTP instead:

```bash
cd grade-ledger
python3 -m http.server 8000
# then open http://localhost:8000
```

## Hosting on GitHub Pages

1. Push this folder's contents to a GitHub repository (they can live at the
   repo root, or under `/docs` if you prefer — just set the Pages source
   accordingly).
2. In the repo, go to **Settings → Pages**, set **Source** to the branch/folder
   you pushed to, and save.
3. Your site will be live at `https://<username>.github.io/<repo>/` within a
   minute or two.

No build step, no `npm install`, no GitHub Actions required — it's plain
static files.

## Regenerating the dataset

If you get an updated disclosure log PDF and want to rebuild everything:

```bash
pip install pdfplumber --break-system-packages
cd scripts
python3 extract_grade_distributions.py     # PDF -> UNSW_grade_distributions_*.csv
python3 compute_metrics.py                 # raw CSV -> grades.json + *_with_metrics.csv
cp grades.json ../data/
cp UNSW_grades_with_metrics.csv ../data/
```

## Notes on the data

- Redacted rows (blacked out by UNSW under GIPA s.3(a)/3(b)) are kept in the
  dataset and shown as "REDACTED BY UNIVERSITY" rather than deleted.
- Some courses use a competency grading scale (Competent/Not Yet Competent)
  instead of Fail–High Distinction; these are auto-detected and flagged
  rather than shown as misleading zeros.
- Full reasoning for every derived column is on the site's Explanation page.

This project is an independent, unofficial effort and is not affiliated
with or endorsed by UNSW Sydney.
