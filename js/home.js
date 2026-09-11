/* Home page: aggregated ledger table + per-course dashboard with a
   term-by-term detail table underneath.
   Everything renders from an in-memory array (window.ROWS via data.js) —
   no server, no build step. Filtering/sorting rebuild the table body as a
   single innerHTML string (fast even at ~15k rows) so the browser's own
   Ctrl+F / Cmd+F "find in page" still works against the visible rows. */

const els = {};
let COURSE_AGGS = [];
let filtered = [];
let selectedCode = null;
let selectedCareer = null;
let chart = null;

const SERIES_DEFS = [
  { key: "Fail_norm", label: "Fail", color: GRADE_COLORS.Fail, defaultOn: true },
  { key: "PS_norm", label: "PS", color: GRADE_COLORS.PS, defaultOn: false },
  { key: "CR_norm", label: "CR", color: GRADE_COLORS.CR, defaultOn: false },
  { key: "DN_norm", label: "DN", color: GRADE_COLORS.DN, defaultOn: false },
  { key: "HD_norm", label: "HD", color: GRADE_COLORS.HD, defaultOn: false },
  { key: "WithdrawSum", label: "Withdrawn", color: GRADE_COLORS.Withdraw, defaultOn: true },
];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  els.search = document.getElementById("search");
  els.sort = document.getElementById("sort");
  els.count = document.getElementById("resultCount");
  els.tbody = document.getElementById("tbody");
  els.dashboard = document.getElementById("dashboard");

  const rows = await loadRows();
  buildHero(rows);
  COURSE_AGGS = buildCourseAggregates(rows);
  attachControls();
  applyFilters();
}

function buildHero(rows) {
  const totals = { Fail: 0, PS: 0, CR: 0, DN: 0, HD: 0, n: 0 };
  for (const r of rows) {
    if (r.IsRedacted || r.IsNonStandardGrading) continue;
    totals.Fail += num(r.Fail_norm);
    totals.PS += num(r.PS_norm);
    totals.CR += num(r.CR_norm);
    totals.DN += num(r.DN_norm);
    totals.HD += num(r.HD_norm);
    totals.n++;
  }
  const avg = k => totals[k] / totals.n;
  const bar = document.getElementById("ledgerBar");
  const segs = [
    ["Fail", "c-fail", avg("Fail")],
    ["PS", "c-ps", avg("PS")],
    ["CR", "c-cr", avg("CR")],
    ["DN", "c-dn", avg("DN")],
    ["HD", "c-hd", avg("HD")],
  ];
  const total = segs.reduce((s, [, , v]) => s + v, 0) || 1;
  bar.innerHTML = segs.map(([label, cls, v]) =>
    `<div class="${cls}" style="width:${(v / total * 100).toFixed(2)}%" title="${label} ${v.toFixed(1)}%"></div>`
  ).join("");
}

/* ---------------- per-(course, career) aggregation ---------------- */

function buildCourseAggregates(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.CourseCode + "|" + r.AcademicCareer;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const aggs = [];
  for (const group of groups.values()) {
    const sample = group[0];
    const clean = group.filter(r => !r.IsRedacted && !r.IsNonStandardGrading);
    const agg = {
      CourseCode: sample.CourseCode,
      CourseName: sample.CourseName,
      Faculty: sample.Faculty,
      AcademicCareer: sample.AcademicCareer,
      Row: Math.min(...group.map(r => r.Row)),
      TotalOfferings: group.length,
      CleanOfferings: clean.length,
      IsRedacted: false,
      IsNonStandardGrading: false,
    };

    if (clean.length === 0) {
      const anyRedacted = group.some(r => r.IsRedacted);
      agg.IsRedacted = anyRedacted;
      agg.IsNonStandardGrading = !anyRedacted;
    } else {
      const avg = k => clean.reduce((s, r) => s + num(r[k]), 0) / clean.length;
      agg.Fail_norm = avg("Fail_norm");
      agg.PS_norm = avg("PS_norm");
      agg.CR_norm = avg("CR_norm");
      agg.DN_norm = avg("DN_norm");
      agg.HD_norm = avg("HD_norm");
      agg.WithdrawSum = avg("WithdrawSum");
      agg.Index = avg("Index");
    }
    aggs.push(agg);
  }
  return aggs;
}

function attachControls() {
  let t;
  els.search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(applyFilters, 150);
  });
  els.sort.addEventListener("change", applyFilters);
}

function applyFilters() {
  const q = els.search.value.trim().toLowerCase();

  filtered = COURSE_AGGS.filter(a => {
    if (!q) return true;
    return (a.CourseCode && a.CourseCode.toLowerCase().includes(q)) ||
           (a.CourseName && a.CourseName.toLowerCase().includes(q));
  });

  sortFiltered(els.sort.value);
  renderTable();
}

function sortFiltered(mode) {
  const withVal = (r, k) => (r[k] === undefined || r[k] === null ? null : r[k]);
  const cmp = {
    default: (a, b) => a.Row - b.Row,
    easiest: (a, b) => rankNulls(withVal(a, "Index"), withVal(b, "Index"), true),
    hardest: (a, b) => rankNulls(withVal(a, "Index"), withVal(b, "Index"), false),
    "highest-hd": (a, b) => rankNulls(withVal(a, "HD_norm"), withVal(b, "HD_norm"), true),
    "highest-fail": (a, b) => rankNulls(withVal(a, "Fail_norm"), withVal(b, "Fail_norm"), true),
  }[mode] || ((a, b) => a.Row - b.Row);
  filtered.sort(cmp);
}

// nulls always sort to the bottom regardless of direction
function rankNulls(a, b, descending) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return descending ? b - a : a - b;
}

function renderTable() {
  els.count.textContent = `${filtered.length.toLocaleString()} course${filtered.length === 1 ? "" : "s"}`;
  els.tbody.innerHTML = filtered.map(aggregateRowHtml).join("");

  els.tbody.querySelectorAll("tr[data-code]").forEach(tr => {
    tr.addEventListener("click", () => selectCourse(tr.dataset.code, tr.dataset.career, tr));
  });
}

function aggregateRowHtml(a, i) {
  const sel = a.CourseCode === selectedCode && a.AcademicCareer === selectedCareer ? " selected" : "";
  const careerAbbr = a.AcademicCareer === "P" ? "PG" : "UG";
  const avgTitle = `Averaged over ${a.CleanOfferings} of ${a.TotalOfferings} offering${a.TotalOfferings === 1 ? "" : "s"}`;
  const base = `<tr data-code="${a.CourseCode}" data-career="${a.AcademicCareer}" class="row${sel}" title="${escapeAttr(avgTitle)}">
    <td>${i + 1}</td>
    <td class="al code-cell">${a.CourseCode}</td>
    <td class="al name-cell" title="${escapeAttr(a.CourseName)}">${a.CourseName}</td>
    <td class="career-cell">${careerAbbr}</td>`;

  if (a.IsRedacted) {
    return base + `<td colspan="7" class="redacted-cell">REDACTED BY UNIVERSITY</td></tr>`;
  }
  if (a.IsNonStandardGrading) {
    return base + `<td colspan="6" class="redacted-cell">NON-STANDARD GRADING</td><td></td></tr>`;
  }

  const idx = a.Index;
  const idxCls = idx === undefined || idx === null ? "" : (idx >= 0 ? "index-pos" : "index-neg");
  return base +
    `<td class="t-fail">${fmtPct(a.Fail_norm)}</td>
     <td>${fmtPct(a.PS_norm)}</td>
     <td>${fmtPct(a.CR_norm)}</td>
     <td>${fmtPct(a.DN_norm)}</td>
     <td class="t-hd">${fmtPct(a.HD_norm)}</td>
     <td>${fmtPct(a.WithdrawSum)}</td>
     <td class="${idxCls}">${idx === undefined || idx === null ? "—" : idx.toFixed(1)}</td>
     <td>${miniBar(a)}</td></tr>`;
}

function miniBar(r) {
  if (r.IsRedacted || r.IsNonStandardGrading) return "";
  const segs = [
    ["c-fail", num(r.Fail_norm)],
    ["c-ps", num(r.PS_norm)],
    ["c-cr", num(r.CR_norm)],
    ["c-dn", num(r.DN_norm)],
    ["c-hd", num(r.HD_norm)],
  ];
  const total = segs.reduce((s, [, v]) => s + v, 0) || 1;
  return `<div class="mini-bar">${segs.map(([cls, v]) => `<div class="${cls}" style="width:${(v / total * 100).toFixed(1)}%"></div>`).join("")}</div>`;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

/* ---------------- dashboard (chart + per-term detail table) ---------------- */

function selectCourse(code, career, trEl) {
  selectedCode = code;
  selectedCareer = career;
  document.querySelectorAll("tr.row.selected").forEach(el => el.classList.remove("selected"));
  if (trEl) trEl.classList.add("selected");

  const allOfferings = ROWS.filter(r => r.CourseCode === code);
  const careers = [...new Set(allOfferings.map(r => r.AcademicCareer))];
  // Some courses are cross-listed and run separate Undergraduate and
  // Postgraduate cohorts in the same term with very different results
  // (e.g. a 20-student UG class alongside a 1-student PG class). Averaging
  // those together would blend two different populations into a
  // meaningless number, so we only ever chart the single career the
  // clicked row belongs to.
  const rows = allOfferings.filter(r => r.AcademicCareer === career).sort((a, b) => a.SortKey - b.SortKey);
  if (!rows.length) return;

  // group by term (average across genuine multiple *sections* of the same
  // term + career only -- e.g. two lecture streams of the same cohort)
  const byTerm = new Map();
  for (const r of rows) {
    const key = r.SortKey;
    if (!byTerm.has(key)) byTerm.set(key, []);
    byTerm.get(key).push(r);
  }
  const keys = [...byTerm.keys()].sort((a, b) => a - b);
  const labels = keys.map(k => byTerm.get(k)[0].TermCode || `${String(Math.floor(k / 10)).slice(-2)}T?`);

  const series = {};
  for (const def of SERIES_DEFS) series[def.key] = [];
  const gaps = [];

  keys.forEach((k, i) => {
    const group = byTerm.get(k);
    const usable = group.filter(r => !r.IsRedacted && !r.IsNonStandardGrading);
    if (!usable.length) {
      for (const def of SERIES_DEFS) series[def.key].push(null);
      const reason = group.some(r => r.IsRedacted) ? "redacted" : "non-standard grading";
      gaps.push(`${labels[i]} (${reason})`);
      return;
    }
    for (const def of SERIES_DEFS) {
      const vals = usable.map(r => num(r[def.key]));
      series[def.key].push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  });

  renderDashboard(rows[0], rows, labels, series, gaps, careers, career);
}

function renderDashboard(sample, rows, labels, series, gaps, careers, activeCareer) {
  const clean = rows.filter(r => !r.IsRedacted && !r.IsNonStandardGrading);
  const avg = k => clean.length ? clean.reduce((s, r) => s + num(r[k]), 0) / clean.length : null;
  const careerName = c => c === "P" ? "Postgraduate" : "Undergraduate";
  const titleSuffix = ` <span class="career-tag">(${careerName(activeCareer)})</span>`;

  const toggleItems = SERIES_DEFS.map(d => {
    const a = avg(d.key);
    return `<label class="toggle-item">
      <span class="ti-top"><input type="checkbox" data-key="${d.key}" ${d.defaultOn ? "checked" : ""}>
        <span class="swatch" style="background:${d.color}"></span>${d.label}</span>
      <span class="ti-avg">${a !== null ? a.toFixed(1) + "%" : "—"}</span>
    </label>`;
  }).join("");
  const indexAvg = avg("Index");
  const indexItem = `<div class="toggle-item toggle-item--static">
      <span class="ti-top"><span class="swatch" style="background:transparent;border:1px solid var(--slate-light)"></span>Index</span>
      <span class="ti-avg">${indexAvg !== null ? indexAvg.toFixed(1) : "—"}</span>
    </div>`;

  els.dashboard.innerHTML = `
    <div class="dash-card">
      <h2 class="dash-h2"><span class="code">${sample.CourseCode}</span> — ${sample.CourseName}${titleSuffix}</h2>
      <div class="dash-subhead">
        <div class="meta">${sample.Faculty} · ${careerName(sample.AcademicCareer)} · ${rows.length} offering${rows.length === 1 ? "" : "s"} on record</div>
        <div class="series-toggles-outer"><div class="series-toggles" id="seriesToggles">${toggleItems}${indexItem}</div></div>
      </div>
      <div class="chart-wrap"><canvas id="courseChart"></canvas></div>
      <p class="chart-note">Fail + PS + CR + DN + HD always add to 100% (excluding withdrawals). <b>Withdrawn</b> is a separate figure — the share of <em>all</em> enrolled students who withdrew, not a slice of the 100% above.</p>
      ${gaps.length ? `<div class="dash-gaps"><b>No usable data for:</b> ${gaps.join(", ")}</div>` : ""}
    </div>

    <div class="dash-card detail-card">
      <div class="detail-toolbar">
        <div class="field">
          <label for="detailFrom">From</label>
          <select id="detailFrom"></select>
        </div>
        <div class="field">
          <label for="detailTo">To</label>
          <select id="detailTo"></select>
        </div>
        <div class="result-count" id="detailCount"></div>
      </div>
      <div class="table-caption">
        Term-by-term detail, most recent first. &nbsp;·&nbsp;
        <b>Term codes:</b> <code>T</code> = Semester / Term / Trimester &nbsp; <code>S</code> = Summer &nbsp; <code>H</code> = Hexamester &nbsp;·&nbsp; e.g. <code>24T1</code> = 2024 Term 1, <code>23H5</code> = 2023 Hexamester 5.
      </div>
      <div class="table-scroll detail-scroll">
        <table class="grid">
          <thead>
            <tr>
              <th>#</th>
              <th class="al">Code</th>
              <th class="al">Course name</th>
              <th>Career</th>
              <th>Term</th>
              <th>Fail %</th>
              <th>PS %</th>
              <th>CR %</th>
              <th>DN %</th>
              <th>HD %</th>
              <th>WD %</th>
              <th>Index</th>
              <th>Grades</th>
            </tr>
          </thead>
          <tbody id="detailTbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const toggleWrap = document.getElementById("seriesToggles");
  toggleWrap.querySelectorAll("input").forEach(cb => {
    cb.addEventListener("change", () => {
      const ds = chart.data.datasets.find(d => d.__key === cb.dataset.key);
      ds.hidden = !cb.checked;
      chart.update();
    });
  });

  drawChart(labels, series);
  setupDetailTable(rows);

  els.dashboard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function drawChart(labels, series) {
  const ctx = document.getElementById("courseChart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: SERIES_DEFS.map(d => ({
        __key: d.key,
        label: d.label,
        data: series[d.key],
        borderColor: d.color,
        backgroundColor: d.color,
        spanGaps: false,
        tension: 0.25,
        pointRadius: 3,
        borderWidth: 2,
        hidden: !d.defaultOn,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + "%" } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y === null ? "n/a" : ctx.parsed.y.toFixed(1) + "%"}` },
        },
      },
    },
  });
}

/* ---------------- per-term detail table (always reverse chronological) ---------------- */

function setupDetailTable(rows) {
  const detailFrom = document.getElementById("detailFrom");
  const detailTo = document.getElementById("detailTo");

  const seen = new Map();
  for (const r of rows) seen.set(r.SortKey, termLabel(r));
  const keys = [...seen.keys()].sort((a, b) => a - b);
  const opts = keys.map(k => `<option value="${k}">${seen.get(k)}</option>`).join("");
  detailFrom.innerHTML = opts;
  detailTo.innerHTML = opts;
  detailFrom.value = keys[0];
  detailTo.value = keys[keys.length - 1];

  const render = () => {
    const lo = Math.min(Number(detailFrom.value), Number(detailTo.value));
    const hi = Math.max(Number(detailFrom.value), Number(detailTo.value));
    const visible = rows.filter(r => r.SortKey >= lo && r.SortKey <= hi)
      .sort((a, b) => b.SortKey - a.SortKey); // reverse chronological
    document.getElementById("detailCount").textContent = `${visible.length} term${visible.length === 1 ? "" : "s"}`;
    document.getElementById("detailTbody").innerHTML = visible.map(detailRowHtml).join("");
  };

  detailFrom.addEventListener("change", render);
  detailTo.addEventListener("change", render);
  render();
}

function detailRowHtml(r, i) {
  const careerAbbr = r.AcademicCareer === "P" ? "PG" : "UG";
  const base = `<tr>
    <td>${i + 1}</td>
    <td class="al code-cell">${r.CourseCode}</td>
    <td class="al name-cell" title="${escapeAttr(r.CourseName)}">${r.CourseName}</td>
    <td class="career-cell">${careerAbbr}</td>
    <td>${termLabel(r)}</td>`;

  if (r.IsRedacted) {
    return base + `<td colspan="7" class="redacted-cell">REDACTED BY UNIVERSITY</td></tr>`;
  }
  if (r.IsNonStandardGrading) {
    return base + `<td colspan="6" class="redacted-cell" title="${escapeAttr(r.Note || '')}">NON-STANDARD GRADING <span class="flag" title="${escapeAttr(r.Note || '')}">?</span></td><td></td></tr>`;
  }

  const idx = r.Index;
  const idxCls = idx === undefined || idx === null ? "" : (idx >= 0 ? "index-pos" : "index-neg");
  return base +
    `<td class="t-fail">${fmtPct(r.Fail_norm)}</td>
     <td>${fmtPct(r.PS_norm)}</td>
     <td>${fmtPct(r.CR_norm)}</td>
     <td>${fmtPct(r.DN_norm)}</td>
     <td class="t-hd">${fmtPct(r.HD_norm)}</td>
     <td>${fmtPct(num(r.WithdrawSum))}</td>
     <td class="${idxCls}">${idx === undefined || idx === null ? "—" : idx.toFixed(1)}</td>
     <td>${miniBar(r)}</td></tr>`;
}
