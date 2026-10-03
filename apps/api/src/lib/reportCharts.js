// Phase 52 — Report chart data helpers (Track 6).
// chartData(rows, {xField, yField, type}) -> aggregated, chart-ready JSON.
// No DB access: pure function over reportEngine rows. Top 12 categories,
// remainder goes into an "Others" bucket (bar/pie). Line charts keep natural
// x order (dates) capped at 30 points.
//
// INTEGRATION (Track 2 — apps/web/app/(app)/reports/builder/[id]/page.js):
// Add a "📊 Chart" toggle in the preview toolbar. On toggle, call
// POST /api/report-charts/:id {xField, yField, type: bar|line|pie}
// (coordinator: add this route calling chartData(runReport(...), opts)),
// then render points as SVG using the app's existing bar/line/pie patterns
// (dashboard StatCards + SVG charts). "Others" bucket is already included.
// type=line sorts labels naturally — use for date x fields.

const TOP_N = 12;
const OTHERS_LABEL = 'Others';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function labelOf(v) {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// Aggregate rows: label -> summed value
function aggregate(rows, xField, yField) {
  const map = new Map();
  for (const r of rows || []) {
    const label = labelOf(r ? r[xField] : undefined);
    const prev = map.get(label) || 0;
    map.set(label, prev + (yField ? num(r[yField]) : 1));
  }
  return map;
}

function chartData(rows, { xField, yField, type } = {}) {
  if (!xField) throw new Error('xField is required');
  const t = ['bar', 'line', 'pie'].includes(type) ? type : 'bar';
  const map = aggregate(rows, xField, yField);

  let points;
  if (t === 'line') {
    // Natural x order (works for date-ish labels), cap 30 points
    points = [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, 30)
      .map(([label, value]) => ({ label, value: round2(value) }));
  } else {
    // Top 12 by value desc + Others bucket
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, TOP_N);
    const rest = sorted.slice(TOP_N);
    points = top.map(([label, value]) => ({ label, value: round2(value) }));
    if (rest.length) {
      const othersValue = rest.reduce((s, [, v]) => s + v, 0);
      points.push({ label: OTHERS_LABEL, value: round2(othersValue) });
    }
  }

  const total = round2(points.reduce((s, p) => s + p.value, 0));
  return {
    type: t,
    xField,
    yField: yField || null,
    aggregation: yField ? 'sum' : 'count',
    points,
    total,
    truncated: t === 'line' ? map.size > 30 : map.size > TOP_N,
  };
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

module.exports = { chartData, TOP_N };
