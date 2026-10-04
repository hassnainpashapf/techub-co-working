'use client';

// HostOps light design system primitives
// Tokens: page bg #f4f5f7, sidebar/cards white, primary dark teal #134e4a,
// accent teal #0f766e, headings #111827, secondary #6b7280.

export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className="flex items-center justify-center py-8">
      <div
        className={`animate-spin rounded-full border-2 border-gray-200 border-t-[#0f766e] ${sizes[size] || sizes.md}`}
      />
    </div>
  );
}

export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[24px] 4xl:text-[32px] font-bold text-gray-900 tracking-tight">{title}</h1>
        {sub && <p className="text-[13.5px] 4xl:text-[15px] text-gray-500 mt-1">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const STAT_ICONS = {
  indigo: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  ),
  blue: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
  ),
  green: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
  ),
  amber: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  red: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  ),
  violet: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  ),
  teal: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  ),
  slate: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  ),
};

export function StatCard({ label, value, sub, accent = 'teal', icon, trend }) {
  const accents = {
    indigo: { iconBg: 'bg-indigo-50 text-indigo-600', text: 'text-indigo-600' },
    blue: { iconBg: 'bg-blue-50 text-blue-600', text: 'text-blue-600' },
    green: { iconBg: 'bg-green-50 text-green-600', text: 'text-green-600' },
    amber: { iconBg: 'bg-amber-50 text-amber-600', text: 'text-amber-600' },
    red: { iconBg: 'bg-red-50 text-red-600', text: 'text-red-600' },
    violet: { iconBg: 'bg-teal-50 text-teal-700', text: 'text-teal-700' },
    purple: { iconBg: 'bg-teal-50 text-teal-700', text: 'text-teal-700' },
    teal: { iconBg: 'bg-teal-50 text-teal-700', text: 'text-teal-700' },
    slate: { iconBg: 'bg-gray-100 text-gray-500', text: 'text-gray-500' },
  };
  const a = accents[accent] || accents.teal;
  return (
    <div className="rounded-xl bg-white border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 hover:border-teal-200 hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
        <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${a.iconBg}`}>
          {icon || STAT_ICONS[accent] || STAT_ICONS.teal}
        </span>
      </div>
      <p className="text-[28px] 4xl:text-[38px] font-bold text-gray-900 tracking-tight">{value}</p>
      <div className="flex items-center gap-2 mt-1.5">
        {trend && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide ${
            trend.dir === 'up' ? 'bg-green-100 text-green-700' : trend.dir === 'down' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
          }`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={trend.dir === 'down' ? 'rotate-180' : ''}>
              <polyline points="18 15 12 9 6 15" />
            </svg>
            {trend.text}
          </span>
        )}
        {sub && <p className={`text-[12.5px] ${a.text}`}>{sub}</p>}
      </div>
    </div>
  );
}

// HostOps pill tones: solid bg, white bold uppercase text, rounded-md
const toneStyles = {
  green: 'bg-[#22c55e] text-white',
  amber: 'bg-[#f59e0b] text-white',
  orange: 'bg-[#f59e0b] text-white',
  red: 'bg-[#ef4444] text-white',
  blue: 'bg-[#3b82f6] text-white',
  slate: 'bg-[#9ca3af] text-white',
  gray: 'bg-[#9ca3af] text-white',
  indigo: 'bg-[#6366f1] text-white',
  violet: 'bg-[#0f766e] text-white',
  purple: 'bg-[#0f766e] text-white',
  teal: 'bg-[#0f766e] text-white',
  dark: 'bg-[#1f2937] text-white',
  lavender: 'bg-[#ccfbf1] text-[#134e4a]',
};

export function Badge({ tone = 'slate', children, className = '', dot = false }) {
  const dotColors = {
    green: 'bg-green-500', amber: 'bg-amber-500', orange: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500',
    slate: 'bg-gray-400', gray: 'bg-gray-400', indigo: 'bg-indigo-500', violet: 'bg-teal-600', purple: 'bg-teal-600',
    teal: 'bg-teal-600', dark: 'bg-gray-800', lavender: 'bg-teal-700',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide ${
        toneStyles[tone] || toneStyles.slate
      } ${className}`}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${dotColors[tone] || dotColors.slate}`} />
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dotColors[tone] || dotColors.slate}`} />
        </span>
      )}
      {children}
    </span>
  );
}

export function DataTable({ columns, rows, empty }) {
  if (!rows || rows.length === 0) {
    return <EmptyState title={empty?.title || 'No records found'} hint={empty?.hint} />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left text-[11.5px] font-semibold uppercase tracking-wider text-gray-500 py-3.5 px-4 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-gray-100 hover:bg-teal-50/40 last:border-0 transition-colors">
              {columns.map((c) => (
                <td key={c.key} className="py-3.5 px-4 align-middle text-gray-900">
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, open }) {
  if (open === false) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4 animate-fadeUp"
      onClick={onClose}
    >
      <div
        className="bg-white border border-gray-200 rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.18)] w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-xl">
          <h3 className="text-[16px] font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xl leading-none transition-all">
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, icon }) {
  return (
    <div className="text-center py-14 px-6">
      <div className="mx-auto w-14 h-14 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-2xl mb-4 text-gray-400">
        {icon || '📭'}
      </div>
      <p className="font-semibold text-gray-900 text-[15px]">{title || 'Nothing here yet'}</p>
      {hint && <p className="text-sm text-gray-500 mt-1.5 max-w-xs mx-auto">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="btn-sm btn-secondary shrink-0">
          Retry
        </button>
      )}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
