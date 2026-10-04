'use client';

export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className="flex items-center justify-center py-8">
      <div
        className={`animate-spin rounded-full border-2 border-white/10 border-t-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)] ${sizes[size] || sizes.md}`}
      />
    </div>
  );
}

export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[24px] 4xl:text-[32px] font-bold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.2)]">{title}</h1>
        {sub && <p className="text-[13.5px] 4xl:text-[15px] text-white/70 mt-1 font-medium">{sub}</p>}
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

export function StatCard({ label, value, sub, accent = 'blue', icon, trend }) {
  const accents = {
    indigo: { bg: 'from-indigo-500/25 to-indigo-600/10', border: 'border-indigo-400/30', glow: 'shadow-[0_0_24px_rgba(99,102,241,0.25)]', text: 'text-indigo-300', iconBg: 'bg-indigo-500/20 text-indigo-300 shadow-[0_0_16px_rgba(99,102,241,0.4)]', bar: 'from-indigo-400 to-indigo-600' },
    blue: { bg: 'from-blue-500/25 to-blue-600/10', border: 'border-blue-400/30', glow: 'shadow-[0_0_24px_rgba(59,130,246,0.25)]', text: 'text-blue-300', iconBg: 'bg-blue-500/20 text-blue-300 shadow-[0_0_16px_rgba(59,130,246,0.4)]', bar: 'from-blue-400 to-blue-600' },
    green: { bg: 'from-green-500/25 to-green-600/10', border: 'border-green-400/30', glow: 'shadow-[0_0_24px_rgba(34,197,94,0.25)]', text: 'text-green-300', iconBg: 'bg-green-500/20 text-green-300 shadow-[0_0_16px_rgba(34,197,94,0.4)]', bar: 'from-green-400 to-green-600' },
    amber: { bg: 'from-amber-500/25 to-amber-600/10', border: 'border-amber-400/30', glow: 'shadow-[0_0_24px_rgba(245,158,11,0.25)]', text: 'text-amber-300', iconBg: 'bg-amber-500/20 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.4)]', bar: 'from-amber-400 to-amber-600' },
    red: { bg: 'from-red-500/25 to-red-600/10', border: 'border-red-400/30', glow: 'shadow-[0_0_24px_rgba(239,68,68,0.25)]', text: 'text-red-300', iconBg: 'bg-red-500/20 text-red-300 shadow-[0_0_16px_rgba(239,68,68,0.4)]', bar: 'from-red-400 to-red-600' },
    violet: { bg: 'from-violet-500/25 to-violet-600/10', border: 'border-violet-400/30', glow: 'shadow-[0_0_24px_rgba(139,92,246,0.25)]', text: 'text-violet-300', iconBg: 'bg-violet-500/20 text-violet-300 shadow-[0_0_16px_rgba(139,92,246,0.4)]', bar: 'from-violet-400 to-violet-600' },
    slate: { bg: 'from-white/[0.08] to-white/[0.03]', border: 'border-white/10', glow: 'shadow-[0_0_24px_rgba(255,255,255,0.08)]', text: 'text-slate-300', iconBg: 'bg-white/10 text-slate-300', bar: 'from-slate-400 to-slate-600' },
  };
  const a = accents[accent] || accents.blue;
  return (
    <div className={`relative overflow-hidden rounded-[20px] bg-gradient-to-br ${a.bg} border ${a.border} ${a.glow} p-5 hover:-translate-y-1.5 hover:shadow-[0_16px_48px_rgba(0,0,0,0.45)] transition-all duration-300 backdrop-blur-sm card-hover group`}>
      <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${a.bar} opacity-70 group-hover:opacity-100 transition-opacity`} />
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/[0.04] blur-2xl group-hover:bg-white/[0.07] transition-colors" />
      <div className="relative flex items-center justify-between mb-3">
        <p className="text-[12px] font-bold uppercase tracking-wider text-white/80">{label}</p>
        <span className={`w-11 h-11 rounded-2xl flex items-center justify-center ${a.iconBg} group-hover:scale-110 transition-transform duration-300`}>
          {icon || STAT_ICONS[accent] || STAT_ICONS.blue}
        </span>
      </div>
      <p className="relative text-[28px] 4xl:text-[38px] font-extrabold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.25)] tracking-tight">{value}</p>
      <div className="relative flex items-center gap-2 mt-1.5">
        {trend && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
            trend.dir === 'up' ? 'bg-emerald-500/15 text-emerald-300' : trend.dir === 'down' ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-slate-300'
          }`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={trend.dir === 'down' ? 'rotate-180' : ''}>
              <polyline points="18 15 12 9 6 15" />
            </svg>
            {trend.text}
          </span>
        )}
        {sub && <p className={`text-[12.5px] font-medium ${a.text}`}>{sub}</p>}
      </div>
    </div>
  );
}

const toneStyles = {
  green: 'bg-green-500/15 text-green-300 border border-green-500/25 shadow-[0_0_12px_rgba(34,197,94,0.2)]',
  amber: 'bg-amber-500/15 text-amber-300 border border-amber-500/25',
  red: 'bg-red-500/15 text-red-300 border border-red-500/25',
  blue: 'bg-blue-500/15 text-blue-300 border border-blue-500/25 shadow-[0_0_12px_rgba(59,130,246,0.2)]',
  slate: 'bg-white/10 text-slate-200 border border-white/10',
  indigo: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/25',
  violet: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  purple: 'bg-purple-500/15 text-purple-300 border border-purple-500/25',
};

export function Badge({ tone = 'slate', children, className = '', dot = false }) {
  const dotColors = {
    green: 'bg-green-400', amber: 'bg-amber-400', red: 'bg-red-400', blue: 'bg-blue-400',
    slate: 'bg-slate-400', indigo: 'bg-indigo-400', violet: 'bg-violet-400', purple: 'bg-purple-400',
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
    <div className="overflow-x-auto rounded-[20px] border border-white/[0.08] bg-gradient-to-b from-[#141422] via-[#12121f] to-[#0e0e18] shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02]">
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left text-[11.5px] font-bold uppercase tracking-wider text-white/70 py-3.5 px-4 whitespace-nowrap first:rounded-tl-[20px] last:rounded-tr-[20px]"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-white/[0.06] hover:bg-gradient-to-r hover:from-blue-500/[0.08] hover:to-violet-500/[0.04] hover:shadow-[inset_0_0_24px_rgba(59,130,246,0.05)] last:border-0 transition-all duration-150 group">
              {columns.map((c) => (
                <td key={c.key} className="py-3.5 px-4 align-middle text-white/90 font-medium group-hover:text-white transition-colors">
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
        className="bg-gradient-to-b from-[#161626] to-[#10101c] border border-blue-400/20 rounded-[20px] shadow-[0_0_60px_rgba(59,130,246,0.25),0_24px_64px_rgba(0,0,0,0.6)] w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-[#141422]/95 backdrop-blur rounded-t-[20px]">
          <h3 className="text-[17px] font-bold text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-xl leading-none transition-all">
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
      <div className="mx-auto w-16 h-16 rounded-2xl glass flex items-center justify-center text-3xl mb-4 shadow-[0_0_32px_rgba(59,130,246,0.15)]">
        {icon || '📭'}
      </div>
      <p className="font-bold text-white text-[15px]">{title || 'Nothing here yet'}</p>
      {hint && <p className="text-sm text-white/55 mt-1.5 max-w-xs mx-auto">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="bg-red-500/10 border border-red-500/30 text-red-200 text-sm font-medium rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3 shadow-[0_0_20px_rgba(239,68,68,0.15)]">
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
      <label className="block text-[13px] font-semibold text-white/90 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
