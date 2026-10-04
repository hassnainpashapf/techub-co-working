'use client';

// Shared HD chart library — all charts render at real pixel size via
// ResizeObserver (no preserveAspectRatio="none" stretching, no blur filters),
// so text and shapes stay crisp on every screen including 4K.

import { useEffect, useRef, useState } from 'react';

export function useChartWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)));
    ro.observe(el);
    setW(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, Math.max(w, 60)];
}

function GridLines({ W, top, bottom, H, count = 3 }) {
  const inner = H - top - bottom;
  return (
    <g>
      {Array.from({ length: count }, (_, k) => {
        const f = (k + 1) / (count + 1);
        const y = Math.round(top + inner * f);
        return <line key={k} x1="0" y1={y} x2={W} y2={y} stroke="rgba(0,0,0,0.07)" strokeWidth="1" />;
      })}
    </g>
  );
}

function XLabel({ x, y, children, color = 'rgba(0,0,0,0.55)' }) {
  return (
    <text x={Math.round(x)} y={y} textAnchor="middle" fill={color} fontSize="11" fontWeight="600">
      {children}
    </text>
  );
}

let gradSeq = 0;
function useGradId(prefix) {
  const [id] = useState(() => `${prefix}-${++gradSeq}-${Math.random().toString(36).slice(2, 7)}`);
  return id;
}

// Vertical bar chart. data: [{ label, value }]
export function HDBarChart({ data, height = 180, color = '#0f766e', barColors = null }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 28, padT = 10;
  const gradId = useGradId('hdbar');
  const max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const slot = W / Math.max(data.length, 1);
  const barW = Math.max(Math.min(slot * 0.56, 72), 6);
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="100%" stopColor={color} stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <GridLines W={W} top={padT} bottom={padB} H={H} />
        {data.map((d, i) => {
          const v = Number(d.value) || 0;
          const h = Math.max((v / max) * (H - padB - padT - 4), v > 0 ? 3 : 1);
          const x = Math.round(i * slot + (slot - barW) / 2);
          const y = Math.round(H - padB - h);
          const fill = barColors ? barColors[i % barColors.length] : `url(#${gradId})`;
          return (
            <g key={i}>
              <rect x={x} y={y} width={Math.round(barW)} height={Math.round(h)} rx="4" fill={fill} opacity={barColors ? 0.88 : 1}>
                <title>{d.label}: {v.toLocaleString()}</title>
              </rect>
              {data.length <= 18 && <XLabel x={i * slot + slot / 2} y={H - 9}>{String(d.label).slice(0, 10)}</XLabel>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Grouped bar chart (e.g. revenue vs expenses per location).
// data: [{ label, values: [v1, v2, ...] }], colors: [c1, c2, ...]
export function HDGroupedBarChart({ data, height = 190, colors = ['#10b981', '#f43f5e'] }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 28, padT = 10;
  const gradIds = colors.map((c) => useGradId('hdg'));
  const max = Math.max(...data.flatMap((d) => d.values.map(Number)), 1);
  const slot = W / Math.max(data.length, 1);
  const groupW = Math.min(slot * 0.72, 96);
  const bw = Math.max(groupW / colors.length - 5, 8);
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          {colors.map((c, ci) => (
            <linearGradient key={ci} id={gradIds[ci]} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.95" />
              <stop offset="100%" stopColor={c} stopOpacity="0.35" />
            </linearGradient>
          ))}
        </defs>
        <GridLines W={W} top={padT} bottom={padB} H={H} />
        {data.map((d, i) => {
          const gx = i * slot + (slot - groupW) / 2;
          return (
            <g key={i}>
              {d.values.map((vRaw, vi) => {
                const v = Number(vRaw) || 0;
                const h = Math.max((v / max) * (H - padB - padT - 4), v > 0 ? 3 : 1);
                return (
                  <rect key={vi} x={Math.round(gx + vi * (bw + 5))} y={Math.round(H - padB - h)}
                    width={Math.round(bw)} height={Math.round(h)} rx="3" fill={`url(#${gradIds[vi]})`}>
                    <title>{d.label}: {v.toLocaleString()}</title>
                  </rect>
                );
              })}
              {data.length <= 12 && <XLabel x={i * slot + slot / 2} y={H - 9}>{String(d.label).slice(0, 12)}</XLabel>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Stacked bar chart. data: [{ label, ...segmentValues }], segments: [{ key, color, label }]
export function HDStackedBarChart({ data, height = 220, segments }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 28, padT = 10;
  const totalOf = (d) => segments.reduce((s, seg) => s + (Number(d[seg.key]) || 0), 0);
  const max = Math.max(...data.map(totalOf), 1);
  const slot = W / Math.max(data.length, 1);
  const barW = Math.max(Math.min(slot * 0.52, 72), 8);
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <GridLines W={W} top={padT} bottom={padB} H={H} />
        {data.map((d, i) => {
          const total = totalOf(d);
          const h = Math.max((total / max) * (H - padB - padT - 4), total > 0 ? 3 : 1);
          const x = Math.round(i * slot + (slot - barW) / 2);
          let y = H - padB;
          return (
            <g key={i}>
              {segments.map((s) => {
                const v = Number(d[s.key]) || 0;
                const sh = total > 0 ? (v / total) * h : 0;
                y -= sh;
                return sh > 0.5 ? (
                  <rect key={s.key} x={x} y={Math.round(y)} width={Math.round(barW)} height={Math.round(sh)} fill={s.color} fillOpacity="0.92">
                    <title>{s.label}: {v.toLocaleString()}</title>
                  </rect>
                ) : null;
              })}
              {data.length <= 18 && <XLabel x={i * slot + slot / 2} y={H - 9}>{String(d.label).slice(0, 8)}</XLabel>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Profit/loss bar chart with center zero line. data: [{ label, profit }]
export function HDProfitBarChart({ data, height = 220 }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 26, padT = 10;
  const posId = useGradId('hdpos');
  const negId = useGradId('hdneg');
  const maxAbs = Math.max(...data.map((d) => Math.abs(Number(d.profit) || 0)), 1);
  const midY = padT + (H - padB - padT) / 2;
  const scale = ((H - padB - padT) / 2 - 2) / maxAbs;
  const slot = W / Math.max(data.length, 1);
  const barW = Math.max(Math.min(slot * 0.56, 64), 6);
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id={posId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={negId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <line x1="0" y1={Math.round(midY)} x2={W} y2={Math.round(midY)} stroke="rgba(0,0,0,0.25)" strokeWidth="1" strokeDasharray="5 4" />
        {data.map((d, i) => {
          const p = Number(d.profit) || 0;
          const h = Math.max(Math.abs(p) * scale, p === 0 ? 1 : 3);
          const x = Math.round(i * slot + (slot - barW) / 2);
          const y = p >= 0 ? midY - h : midY;
          return (
            <g key={i}>
              <rect x={x} y={Math.round(y)} width={Math.round(barW)} height={Math.round(h)} rx="3"
                fill={p >= 0 ? `url(#${posId})` : `url(#${negId})`}>
                <title>{d.label}: {p.toLocaleString()}</title>
              </rect>
              {data.length <= 18 && <XLabel x={i * slot + slot / 2} y={H - 8}>{String(d.label).slice(0, 8)}</XLabel>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Multi-line chart. labels: [..], series: [{ name, values: [...], color }]
export function HDMultiLineChart({ labels, series, height = 220, showDots = true }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 30, padT = 12, padX = 10;
  const max = Math.max(...series.flatMap((s) => s.values.map(Number)), 1);
  const n = labels.length;
  const px = (i) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2));
  const py = (v) => H - padB - (Number(v) / max) * (H - padB - padT);
  const pts = (values) => values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <GridLines W={W} top={padT} bottom={padB} H={H} />
        {series.map((s, si) => (
          <g key={si}>
            <polyline points={pts(s.values)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {showDots && s.values.map((v, i) => (
              <circle key={i} cx={px(i)} cy={py(v)} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2.5">
                <title>{s.name} — {labels[i]}: {Number(v).toLocaleString()}</title>
              </circle>
            ))}
          </g>
        ))}
        {labels.map((l, i) => (
          (n <= 14 || i % Math.ceil(n / 12) === 0) ? (
            <XLabel key={i} x={px(i)} y={H - 10}>{String(l).slice(0, 8)}</XLabel>
          ) : null
        ))}
      </svg>
    </div>
  );
}

// Forecast chart: solid history line + dashed forecast line with "today" split.
export function HDForecastChart({ history, forecast, height = 240 }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 28, padT = 14;
  const gradId = useGradId('hdfc');
  const all = [...history, ...forecast];
  const n = all.length;
  const px = (i) => (n === 1 ? W / 2 : 10 + (i / (n - 1)) * (W - 20));
  const py = (v) => H - padB - Math.max(0, Math.min(1, Number(v))) * (H - padB - padT) + 6;
  const pts = (arr, offset) => arr.map((d, i) => `${px(offset + i).toFixed(1)},${py(d.rate).toFixed(1)}`).join(' ');
  const split = history.length;
  const splitX = px(split - 0.5);
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1="0" y1={Math.round(py(f))} x2={W} y2={Math.round(py(f))} stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
            <text x={W - 4} y={Math.round(py(f)) - 4} textAnchor="end" fill="rgba(0,0,0,0.45)" fontSize="11" fontWeight="600">
              {Math.round(f * 100)}%
            </text>
          </g>
        ))}
        <polygon points={`10,${py(0)} ${pts(history, 0)} ${px(split - 1).toFixed(1)},${py(0)}`} fill={`url(#${gradId})`} />
        <line x1={splitX} y1={8} x2={splitX} y2={H - padB} stroke="rgba(0,0,0,0.25)" strokeWidth="1" strokeDasharray="5 4" />
        <text x={splitX} y={20} textAnchor="middle" fill="rgba(0,0,0,0.5)" fontSize="11" fontWeight="600">today</text>
        <polyline points={pts(history, 0)} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
        <polyline
          points={`${px(split - 1).toFixed(1)},${py(history[history.length - 1]?.rate || 0).toFixed(1)} ${pts(forecast, split)}`}
          fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round"
        />
        {all.map((d, i) => (
          <circle key={i} cx={px(i)} cy={py(d.rate)} r="3.5" fill={i < split ? '#3b82f6' : '#f59e0b'} stroke="#fff" strokeWidth="1.5">
            <title>{d.label}: {(Number(d.rate) * 100).toFixed(1)}%</title>
          </circle>
        ))}
        {all.map((d, i) => (
          (n <= 14 || i % 2 === 0) ? (
            <XLabel key={i} x={px(i)} y={H - 9}>{String(d.label).slice(0, 8)}</XLabel>
          ) : null
        ))}
      </svg>
    </div>
  );
}
