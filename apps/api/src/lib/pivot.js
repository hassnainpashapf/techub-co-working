// Phase 52 Track 5: Pivot / crosstab engine (pure, no DB).
// Usage: pivot(rows, { rowField, colField, valueField, agg })
//   rows  — array of flat (or nested) objects, e.g. from lib/reportEngine.runReport
//   rowField / colField — field names (dot-paths allowed, e.g. "member.name")
//   valueField — numeric field for sum/avg (ignored for count)
//   agg — 'sum' | 'count' | 'avg' (default 'sum')
// Returns: { rows, cols, matrix, rowTotals, colTotals, grandTotal, agg, rowField, colField, valueField }

function getPath(obj, path) {
  if (obj == null || path == null) return undefined;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function labelOf(v) {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function sortLabels(labels) {
  return labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function pivot(rows, opts = {}) {
  const { rowField, colField, valueField, agg = 'sum' } = opts;
  if (!rowField || !colField) throw new Error('rowField and colField are required');
  if (!['sum', 'count', 'avg'].includes(agg)) throw new Error("agg must be one of: sum, count, avg");
  if ((agg === 'sum' || agg === 'avg') && !valueField) {
    throw new Error('valueField is required for sum/avg');
  }
  if (!Array.isArray(rows)) throw new Error('rows must be an array');

  // accumulators: key `${row}\u0000${col}` -> { sum, n }
  const acc = new Map();
  const rowSet = new Set();
  const colSet = new Set();

  for (const r of rows) {
    const rl = labelOf(getPath(r, rowField));
    const cl = labelOf(getPath(r, colField));
    rowSet.add(rl);
    colSet.add(cl);
    const key = rl + '\u0000' + cl;
    let a = acc.get(key);
    if (!a) { a = { sum: 0, n: 0 }; acc.set(key, a); }
    if (agg === 'count') {
      a.n += 1;
    } else {
      const n = toNumber(getPath(r, valueField));
      if (!Number.isNaN(n)) { a.sum += n; a.n += 1; }
    }
  }

  const rowLabels = sortLabels([...rowSet]);
  const colLabels = sortLabels([...colSet]);

  const val = (a) => {
    if (!a) return 0;
    if (agg === 'count') return a.n;
    if (agg === 'avg') return a.n ? round2(a.sum / a.n) : 0;
    return round2(a.sum);
  };

  const matrix = {};
  const rowTotals = {};
  const colTotals = {};
  let grandTotal = 0;
  for (const c of colLabels) colTotals[c] = 0;

  for (const r of rowLabels) {
    matrix[r] = {};
    let rt = 0;
    for (const c of colLabels) {
      const v = val(acc.get(r + '\u0000' + c));
      matrix[r][c] = v;
      rt += v;
      colTotals[c] += v;
    }
    rowTotals[r] = round2(rt);
    grandTotal += rt;
  }
  for (const c of colLabels) colTotals[c] = round2(colTotals[c]);

  return {
    agg,
    rowField,
    colField,
    valueField: valueField || null,
    rows: rowLabels,
    cols: colLabels,
    matrix,
    rowTotals,
    colTotals,
    grandTotal: round2(grandTotal),
    rowCount: rows.length,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Self-test (node apps/api/src/lib/pivot.js)
if (require.main === module) {
  const assert = require('assert');
  const rows = [
    { status: 'active', type: 'hotdesk', amount: 100 },
    { status: 'active', type: 'hotdesk', amount: 200 },
    { status: 'active', type: 'private', amount: 500 },
    { status: 'trial', type: 'hotdesk', amount: 50 },
  ];
  let p = pivot(rows, { rowField: 'status', colField: 'type', valueField: 'amount', agg: 'sum' });
  assert.strictEqual(p.matrix.active.hotdesk, 300);
  assert.strictEqual(p.matrix.active.private, 500);
  assert.strictEqual(p.rowTotals.active, 800);
  assert.strictEqual(p.colTotals.hotdesk, 350);
  assert.strictEqual(p.grandTotal, 850);
  p = pivot(rows, { rowField: 'status', colField: 'type', agg: 'count' });
  assert.strictEqual(p.matrix.active.hotdesk, 2);
  assert.strictEqual(p.grandTotal, 4);
  p = pivot(rows, { rowField: 'status', colField: 'type', valueField: 'amount', agg: 'avg' });
  assert.strictEqual(p.matrix.active.hotdesk, 150);
  assert.strictEqual(p.matrix.trial.hotdesk, 50);
  // blank handling + dot paths
  p = pivot([{ a: { b: null } }], { rowField: 'a.b', colField: 'x', agg: 'count' });
  assert.deepStrictEqual(p.rows, ['(blank)']);
  assert.deepStrictEqual(p.cols, ['(blank)']);
  assert.strictEqual(p.matrix['(blank)']['(blank)'], 1);
  console.log('pivot self-test: ALL PASS');
}

module.exports = { pivot };
