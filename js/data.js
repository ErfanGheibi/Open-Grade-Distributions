/* Shared data loading + small utilities used by home.js.
   No build step, no framework — plain fetch + array methods. */

const DATA_URL = "data/grades.json";

const GRADE_COLORS = {
  Fail: "#a3352f",
  PS: "#8c8368",
  CR: "#c98a34",
  DN: "#3f8f78",
  HD: "#1f6f5c",
  Withdraw: "#5b6472",
};

let ROWS = null; // cache once loaded

async function loadRows() {
  if (ROWS) return ROWS;
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error("Could not load " + DATA_URL);
  ROWS = await res.json();
  return ROWS;
}

// Term label like "23H4" or "24T1" — pulled straight from the pipeline's
// TermCode column (H = Hexamester, T = every other term system UNSW has
// used: Semester/Term/Trimester/Summer). See the Explanation page.
function termLabel(row) {
  return row.TermCode || `${String(row.Year).slice(-2)}T?`;
}

function fmtPct(v) {
  if (v === null || v === undefined) return "—";
  return v.toFixed(1);
}

function num(v) {
  return v === undefined || v === null ? 0 : v;
}
