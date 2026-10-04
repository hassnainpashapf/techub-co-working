'use client';

// Compact shared hero banner for overview pages — single row, minimal height.
export default function OverviewHero({ title, sub, chips = [] }) {
  const todayStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return (
    <div className="relative overflow-hidden rounded-2xl mb-3 shadow-[0_8px_24px_-10px_rgba(13,92,86,0.5)]">
      <div className="absolute inset-0 bg-gradient-to-r from-[#0f766e] via-[#0c5a54] to-[#08312d]" />
      <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-teal-300/20 blur-3xl pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '20px 20px' }} />
      <div className="relative px-4 py-4 flex flex-wrap items-center gap-x-8 gap-y-3 justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] 4xl:text-[24px] font-bold text-white tracking-tight leading-tight">{title}</h1>
          <p className="text-[12px] 4xl:text-[13px] text-teal-100/80 mt-0.5 font-medium">{sub} · {todayStr}</p>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <div key={c.label} className="flex items-center gap-2 pl-3 pr-4 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full shadow-[0_0_6px_currentColor]" style={{ background: c.dot, color: c.dot }} />
                <span className="text-[11.5px] text-teal-100/80 font-medium">{c.label}</span>
                <span className="text-[13.5px] font-bold text-white">{c.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
