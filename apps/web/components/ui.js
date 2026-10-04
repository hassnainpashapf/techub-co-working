'use client';

// Fobework design system primitives
// Tokens: page bg #0a0a14, cards #141422 solid rounded-2xl border-white/[0.06],
// accent purple #8b5cf6, lavender badge bg #ddd6fe, muted text slate-400.

export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className="flex items-center justify-center py-8">
      <div
        className={`animate-spin rounded-full border-2 border-white/10 border-t-[#8b5cf6] ${sizes[size] || sizes.md}`}
      />
    </div>
  );
}

export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[24px] 4xl:text-[32px] font-bold text-white tracking-tight">{title}</h1>
        {sub && <p className="text-[13.5px] 4xl:text-[15px] text-slate-400 mt-1">{sub}</p>}
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
  slate: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  ),
};

export function StatCard({ label, value, sub, accent = 'violet', icon, trend }) {
  const accents = {
    indigo: { iconBg: 'bg-indigo-500/15 text-indigo-300', text: 'text-indigo-300' },
    blue: { iconBg: 'bg-blue-500/15 text-blue-300', text: 'text-blue-300' },
    green: { iconBg: 'bg-green-500/15 text-green-300', text: 'text-green-300' },
    amber: { iconBg: 'bg-amber-500/15 text-amber-300', text: 'text-amber-300' },
    red: { iconBg: 'bg-red-500/15 text-red-300', text: 'text-red-300' },
    violet: { iconBg: 'bg-[#8b5cf6]/15 text-[#c4b5fd]', text: 'text-[#c4b5fd]' },
    purple: { iconBg: 'bg-[#8b5cf6]/15 text-[#c4b5fd]', text: 'text-[#c4b5fd]' },
    slate: { iconBg: 'bg-white/[0.07] text-slate-300', text: 'text-slate-400' },
  };
  const a = accents[accent] || accents.violet;
  return (
    <div className="rounded-2xl bg-[#141422] border border-white/[0.06] p-5 hover:border-[#8b5cf6]/35 hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <span className={`w-11 h-11 rounded-2xl flex items-center justify-center ${a.iconBg}`}>
          {icon || STAT_ICONS[accent] || STAT_ICONS.violet}
        </span>
      </div>
      <p className="text-[28px] 4xl:text-[38px] font-bold text-white tracking-tight">{value}</p>
      <div className="flex items-center gap-2 mt-1.5">
        {trend && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
            trend.dir === 'up' ? 'bg-green-500/15 text-green-300' : trend.dir === 'down' ? 'bg-red-500/15 text-red-300' : 'bg-white/[0.07] text-slate-300'
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

const toneStyles = {
  green: 'bg-green-500/15 text-green-300',
  amber: 'bg-amber-500/15 text-amber-300',
  red: 'bg-red-500/15 text-red-300',
  blue: 'bg-blue-500/15 text-blue-300',
  slate: 'bg-white/[0.07] text-slate-300',
  indigo: 'bg-indigo-500/15 text-indigo-300',
  violet: 'bg-[#8b5cf6]/15 text-[#c4b5fd]',
  purple: 'bg-[#8b5cf6]/15 text-[#c4b5fd]',
  lavender: 'bg-[#ddd6fe] text-[#4c1d95]',
};

export function Badge({ tone = 'slate', children, className = '', dot = false }) {
  const dotColors = {
    green: 'bg-green-400', amber: 'bg-amber-400', red: 'bg-red-400', blue: 'bg-blue-400',
    slate: 'bg-slate-400', indigo: 'bg-indigo-400', violet: 'bg-[#8b5cf6]', purple: 'bg-[#8b5cf6]',
    lavender: 'bg-[#4c1d95]',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold ${
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
    <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#141422]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-400 py-3.5 px-4 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-white/[0.04] hover:bg-white/[0.02] last:border-0 transition-colors">
              {columns.map((c) => (
                <td key={c.key} className="py-3.5 px-4 align-middle text-slate-200">
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

export function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeUp"
      onClick={onClose}
    >
      <div
        className="bg-[#141422] border border-white/10 rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.6)] w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] sticky top-0 bg-[#141422] rounded-t-2xl">
          <h3 className="text-[16px] font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 text-xl leading-none transition-all">
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
      <div className="mx-auto w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-2xl mb-4 text-slate-400">
        {icon || '📭'}
      </div>
      <p className="font-semibold text-white text-[15px]">{title || 'Nothing here yet'}</p>
      {hint && <p className="text-sm text-slate-500 mt-1.5 max-w-xs mx-auto">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="bg-red-500/10 border border-red-500/25 text-red-200 text-sm rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
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
      <label className="block text-[13px] font-medium text-slate-300 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
