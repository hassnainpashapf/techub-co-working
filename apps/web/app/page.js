'use client';

import { useState } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Techub Co-Working — modern-classic marketing site (root /)
// Palette: ivory #FAF7F0 · deep forest #0C2E2A · brass #B08A3C · charcoal #1A1A1A
// ---------------------------------------------------------------------------

const IVORY = '#FAF7F0';
const FOREST = '#0C2E2A';
const BRASS = '#B08A3C';
const CHARCOAL = '#1A1A1A';
const STONE = '#6E6759';

function Eyebrow({ children, light }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase"
      style={{ letterSpacing: '0.32em', color: light ? '#D8C08A' : BRASS }}
    >
      {children}
    </p>
  );
}

function Check({ light }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={light ? '#D8C08A' : BRASS} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[3px]">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const AMENITIES = [
  { t: 'High-speed WiFi', d: 'Fibre internet in every corner.', icon: (<><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><circle cx="12" cy="20" r="1" fill="currentColor" /></>) },
  { t: 'Printing & Scanning', d: 'Business-class print room.', icon: (<><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>) },
  { t: 'Meeting Rooms', d: 'Six rooms, bookable by the hour.', icon: (<><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18" /><path d="M9 21V9" /></>) },
  { t: 'Café & Lounge', d: 'Fresh coffee, quiet corners.', icon: (<><path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" /><line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" /></>) },
  { t: '24/7 Secure Access', d: 'Biometric entry, always open.', icon: (<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>) },
  { t: 'Lockers & Storage', d: 'Personal lockers on every floor.', icon: (<><rect x="4" y="2" width="16" height="20" rx="1" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="9" y1="6" x2="9" y2="6" /><line x1="9" y1="12.5" x2="9" y2="12.5" /><line x1="9" y1="17.5" x2="9" y2="17.5" /></>) },
  { t: 'Mail Handling', d: 'A proper business address.', icon: (<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>) },
  { t: 'Community Events', d: 'Weekly talks & Friday socials.', icon: (<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>) },
];

const SPACES = [
  { t: 'Hot Desk', price: 'Rs 8,000', per: '/month', feats: ['Any open desk, first come', 'Business-hours access', 'High-speed WiFi & printing', 'Café & lounge access'] },
  { t: 'Dedicated Desk', price: 'Rs 15,000', per: '/month', feats: ['Your own reserved desk', '24/7 secure access', 'Personal locker included', 'Meeting room credits'] },
  { t: 'Private Office', price: 'Rs 45,000', per: '/month', feats: ['Lockable office for 2–6', 'Company signage & address', '24/7 access for the team', 'Priority room booking'] },
  { t: 'Meeting Room', price: 'Rs 2,500', per: '/hour', feats: ['Six rooms, 4–14 seats', 'Display & video conferencing', 'Whiteboards & refreshments', 'Book by the hour'] },
];

const TIERS = [
  { t: 'Day Pass', price: 'Rs 1,500', per: '/day', tag: null, feats: ['Full-day hot desk access', 'WiFi & printing included', 'Café & lounge access', 'Community events'], featured: false },
  { t: 'Flex Monthly', price: 'Rs 12,000', per: '/month', tag: 'Most popular', feats: ['Unlimited hot desking', '24/7 secure access', '4 meeting-room hours / mo', 'Personal locker', 'Mail handling'], featured: true },
  { t: 'Dedicated', price: 'Rs 25,000', per: '/month', tag: null, feats: ['Reserved dedicated desk', '24/7 secure access', '8 meeting-room hours / mo', 'Business address', 'Guest passes monthly'], featured: false },
];

const QUOTES = [
  { q: 'It has the calm of a private club and the energy of a newsroom. I have done my best work of the decade here.', n: 'Amara Sheikh', r: 'Founder, Northbeam Studio' },
  { q: 'Clients walk in and immediately take us seriously. The rooms, the staff, the coffee — everything is considered.', n: 'Daniyal Raza', r: 'Partner, Raza & Co. Legal' },
  { q: 'I came for a desk and stayed for the community. Three of my largest contracts started as conversations in the lounge.', n: 'Sana Iqbal', r: 'Independent Consultant' },
];

const NAV = [
  { label: 'Spaces', href: '#spaces' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'About', href: '#about' },
  { label: 'Visit', href: '#visit' },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen" style={{ background: IVORY, color: CHARCOAL }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .font-display { font-family: 'Fraunces', Georgia, 'Times New Roman', serif; }
        body { font-family: 'Inter', -apple-system, sans-serif; }
        .grain::before {
          content: '';
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 90% 70% at 50% 0%, rgba(176,138,60,0.06), transparent 60%),
            repeating-linear-gradient(0deg, rgba(12,46,42,0.012) 0 1px, transparent 1px 3px);
        }
        html { scroll-behavior: smooth; }
      `}</style>

      {/* ======================= TOP BAR ======================= */}
      <header className="sticky top-0 z-50 border-b" style={{ background: `${IVORY}F2`, borderColor: '#E5DECF', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-[68px] flex items-center justify-between">
          <Link href="/" className="flex items-baseline gap-2 no-underline">
            <span className="font-display text-[26px] font-semibold" style={{ color: FOREST }}>Techub</span>
            <span className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '0.28em', color: STONE }}>Co-Working</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-[13.5px] font-medium no-underline hover:opacity-70 transition-opacity" style={{ color: CHARCOAL }}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden sm:inline-block text-[13.5px] font-semibold no-underline px-5 py-2.5 rounded-sm border transition-colors"
              style={{ borderColor: FOREST, color: FOREST }}
            >
              Member sign in
            </Link>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              className="md:hidden p-2 -mr-2 bg-transparent border-0 cursor-pointer"
              style={{ color: FOREST }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? (<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>) : (<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>)}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="md:hidden border-t px-5 py-4 flex flex-col gap-1" style={{ background: IVORY, borderColor: '#E5DECF' }}>
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className="py-2.5 text-[15px] font-medium no-underline border-b" style={{ color: CHARCOAL, borderColor: '#EFE9DA' }}>
                {n.label}
              </a>
            ))}
            <Link href="/login" onClick={() => setMenuOpen(false)} className="mt-3 text-center text-[14px] font-semibold no-underline px-5 py-3 rounded-sm border" style={{ borderColor: FOREST, color: FOREST }}>
              Member sign in
            </Link>
          </nav>
        )}
      </header>

      {/* ======================= HERO ======================= */}
      <section className="grain relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 pt-20 sm:pt-28 pb-16 text-center relative">
          <Eyebrow>Est. 2026 · Premium Coworking</Eyebrow>
          <h1 className="font-display font-medium mt-6 leading-[1.08]" style={{ fontSize: 'clamp(42px, 7vw, 76px)', color: FOREST, letterSpacing: '-0.01em' }}>
            Workspaces that <em className="font-display" style={{ color: BRASS }}>work for you.</em>
          </h1>
          <p className="mt-6 text-[16.5px] leading-relaxed max-w-xl mx-auto" style={{ color: STONE }}>
            A timeless place to do your best work — private offices, desks and meeting rooms, run with quiet precision.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5">
            <Link href="/book" className="w-full sm:w-auto text-center text-[15px] font-semibold no-underline px-9 py-3.5 rounded-sm text-white transition-opacity hover:opacity-90" style={{ background: FOREST }}>
              Book a tour
            </Link>
            <a href="#pricing" className="w-full sm:w-auto text-center text-[15px] font-semibold no-underline px-9 py-3.5 rounded-sm border transition-colors" style={{ borderColor: FOREST, color: FOREST }}>
              View membership plans
            </a>
          </div>
          <div className="mt-16 border-t-4 border-double mx-auto max-w-2xl" style={{ borderColor: `${BRASS}55` }} />
          <div className="mt-8 flex items-center justify-center gap-8 sm:gap-14">
            {[
              ['19', 'Workspaces'],
              ['42%', 'Occupancy'],
              ['24/7', 'Access'],
            ].map(([v, l]) => (
              <div key={l} className="text-center">
                <p className="font-display text-[30px] sm:text-[36px] font-semibold" style={{ color: FOREST }}>{v}</p>
                <p className="text-[10.5px] font-semibold uppercase mt-1" style={{ letterSpacing: '0.22em', color: STONE }}>{l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======================= ABOUT ======================= */}
      <section id="about" className="border-t" style={{ borderColor: '#E5DECF' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28 grid md:grid-cols-2 gap-12 md:gap-20">
          <div className="md:sticky md:top-28 self-start">
            <Eyebrow>Our House</Eyebrow>
            <h2 className="font-display font-medium text-[34px] sm:text-[44px] leading-[1.15] mt-5" style={{ color: FOREST }}>
              A classic place to do modern work.
            </h2>
          </div>
          <div>
            <p className="text-[16px] leading-[1.85]" style={{ color: CHARCOAL }}>
              Techub was founded on a simple conviction: that the rooms we work in shape the work itself.
              We built a house of quiet, well-lit rooms — oak desks, brass details, honest materials —
              and paired it with everything a modern practice demands: fibre internet, bookable meeting
              rooms, and staff who remember your name.
            </p>
            <p className="text-[16px] leading-[1.85] mt-5" style={{ color: STONE }}>
              No noise, no gimmicks. Just a considered environment where founders, lawyers, writers and
              builders come each morning to do serious work — and stay for the community they find here.
            </p>
            <blockquote className="mt-8 pl-6 border-l-2" style={{ borderColor: BRASS }}>
              <p className="font-display italic text-[21px] leading-[1.6]" style={{ color: FOREST }}>
                “We keep the building quiet so your thinking can be loud.”
              </p>
              <cite className="not-italic block mt-3 text-[12.5px] font-semibold uppercase" style={{ letterSpacing: '0.18em', color: STONE }}>
                — The Techub House Rules, № 1
              </cite>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ======================= SPACES ======================= */}
      <section id="spaces" className="border-t" style={{ borderColor: '#E5DECF', background: '#F5F1E6' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
          <div className="text-center max-w-2xl mx-auto">
            <Eyebrow>01 — Our Spaces</Eyebrow>
            <h2 className="font-display font-medium text-[34px] sm:text-[44px] mt-5" style={{ color: FOREST }}>
              Rooms for every kind of day.
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: STONE }}>
              From a quiet desk for the afternoon to a private office for the decade — choose what fits, change when it doesn’t.
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {SPACES.map((s) => (
              <div key={s.t} className="rounded-sm border p-7 flex flex-col transition-shadow hover:shadow-[0_12px_32px_rgba(12,46,42,0.08)]" style={{ background: '#FFFFFF', borderColor: '#E5DECF' }}>
                <h3 className="font-display text-[22px] font-semibold" style={{ color: FOREST }}>{s.t}</h3>
                <p className="mt-3">
                  <span className="font-display text-[30px] font-semibold" style={{ color: CHARCOAL }}>{s.price}</span>
                  <span className="text-[13px] ml-1" style={{ color: STONE }}>{s.per}</span>
                </p>
                <div className="my-5 border-t" style={{ borderColor: '#EFE9DA' }} />
                <ul className="flex-1 space-y-2.5">
                  {s.feats.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[13.5px] leading-relaxed" style={{ color: STONE }}>
                      <Check /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/book" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold no-underline" style={{ color: FOREST }}>
                  Enquire <span aria-hidden>→</span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======================= PRICING ======================= */}
      <section id="pricing" className="border-t" style={{ borderColor: '#E5DECF' }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
          <div className="text-center max-w-2xl mx-auto">
            <Eyebrow>02 — Membership</Eyebrow>
            <h2 className="font-display font-medium text-[34px] sm:text-[44px] mt-5" style={{ color: FOREST }}>
              Simple terms, honestly priced.
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: STONE }}>
              No joining fees, no fine print. Cancel with thirty days’ notice.
            </p>
          </div>
          <div className="mt-12 grid md:grid-cols-3 gap-5 items-stretch">
            {TIERS.map((t) => (
              <div
                key={t.t}
                className="rounded-sm border p-8 flex flex-col relative"
                style={{
                  background: t.featured ? FOREST : '#FFFFFF',
                  borderColor: t.featured ? FOREST : '#E5DECF',
                  color: t.featured ? '#FFFFFF' : CHARCOAL,
                }}
              >
                {t.tag && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[10.5px] font-bold uppercase px-4 py-1.5 rounded-sm whitespace-nowrap" style={{ letterSpacing: '0.18em', background: BRASS, color: '#FFFFFF' }}>
                    {t.tag}
                  </span>
                )}
                <h3 className="font-display text-[22px] font-semibold" style={{ color: t.featured ? '#FFFFFF' : FOREST }}>{t.t}</h3>
                <p className="mt-3">
                  <span className="font-display text-[36px] font-semibold">{t.price}</span>
                  <span className="text-[13px] ml-1" style={{ color: t.featured ? '#B9C6C2' : STONE }}>{t.per}</span>
                </p>
                <div className="my-6 border-t" style={{ borderColor: t.featured ? '#234A45' : '#EFE9DA' }} />
                <ul className="flex-1 space-y-3">
                  {t.feats.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: t.featured ? '#E4E9E4' : STONE }}>
                      <Check light={t.featured} /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/book"
                  className="mt-8 text-center text-[14.5px] font-semibold no-underline px-6 py-3 rounded-sm transition-opacity hover:opacity-90"
                  style={t.featured
                    ? { background: BRASS, color: '#FFFFFF' }
                    : { border: `1px solid ${FOREST}`, color: FOREST }}
                >
                  Choose {t.t}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======================= AMENITIES ======================= */}
      <section className="border-t" style={{ borderColor: '#E5DECF', background: '#F5F1E6' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
          <div className="text-center max-w-2xl mx-auto">
            <Eyebrow>03 — Amenities</Eyebrow>
            <h2 className="font-display font-medium text-[34px] sm:text-[44px] mt-5" style={{ color: FOREST }}>
              Everything considered.
            </h2>
          </div>
          <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
            {AMENITIES.map((a) => (
              <div key={a.t} className="text-center px-2">
                <div className="mx-auto w-14 h-14 rounded-full border flex items-center justify-center" style={{ borderColor: `${BRASS}66`, color: FOREST, background: '#FFFFFF' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    {a.icon}
                  </svg>
                </div>
                <h3 className="font-display text-[17px] font-semibold mt-4" style={{ color: FOREST }}>{a.t}</h3>
                <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: STONE }}>{a.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======================= TESTIMONIALS ======================= */}
      <section className="border-t" style={{ borderColor: '#E5DECF' }}>
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
          <div className="text-center">
            <Eyebrow>04 — Members</Eyebrow>
            <h2 className="font-display font-medium text-[34px] sm:text-[44px] mt-5" style={{ color: FOREST }}>
              In their words.
            </h2>
          </div>
          <div className="mt-12 space-y-12">
            {QUOTES.map((t, i) => (
              <figure key={t.n} className="text-center max-w-2xl mx-auto">
                <div className="font-display text-[44px] leading-none select-none" style={{ color: `${BRASS}88` }}>“</div>
                <blockquote className="font-display italic text-[21px] sm:text-[24px] leading-[1.65] -mt-3" style={{ color: FOREST }}>
                  {t.q}
                </blockquote>
                <figcaption className="mt-5">
                  <p className="text-[14px] font-semibold" style={{ color: CHARCOAL }}>{t.n}</p>
                  <p className="text-[12.5px] mt-0.5" style={{ color: STONE }}>{t.r}</p>
                </figcaption>
                {i < QUOTES.length - 1 && (
                  <div className="mt-12 mx-auto w-16 border-t-4 border-double" style={{ borderColor: `${BRASS}55` }} />
                )}
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ======================= VISIT ======================= */}
      <section id="visit" className="border-t" style={{ borderColor: '#E5DECF', background: '#F5F1E6' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28 grid md:grid-cols-2 gap-12 md:gap-20">
          <div>
            <Eyebrow>05 — Visit</Eyebrow>
            <h2 className="font-display font-medium text-[34px] sm:text-[44px] mt-5 leading-[1.15]" style={{ color: FOREST }}>
              The door is open.
            </h2>
            <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
              <div>
                <p className="text-[11px] font-bold uppercase mb-1.5" style={{ letterSpacing: '0.22em', color: BRASS }}>Address</p>
                <p style={{ color: CHARCOAL }}>Techub Co-Working, Main Boulevard<br />Gulberg III, Lahore, Pakistan</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase mb-1.5" style={{ letterSpacing: '0.22em', color: BRASS }}>Hours</p>
                <p style={{ color: CHARCOAL }}>Monday – Saturday, 8:00 – 22:00<br /><span style={{ color: STONE }}>Members enjoy 24/7 secure access.</span></p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase mb-1.5" style={{ letterSpacing: '0.22em', color: BRASS }}>Contact</p>
                <p style={{ color: CHARCOAL }}>+92 300 000 0000<br />hello@techub.co</p>
              </div>
            </div>
          </div>
          <div className="flex items-center">
            <div className="w-full rounded-sm border p-9 sm:p-11" style={{ background: '#FFFFFF', borderColor: '#E5DECF' }}>
              <h3 className="font-display text-[26px] font-semibold" style={{ color: FOREST }}>Plan your visit</h3>
              <p className="mt-3 text-[14.5px] leading-relaxed" style={{ color: STONE }}>
                Come for a coffee and a walk through the house. Tours run every weekday —
                thirty minutes, no obligation, good conversation guaranteed.
              </p>
              <div className="my-7 border-t-4 border-double" style={{ borderColor: `${BRASS}44` }} />
              <Link href="/book" className="block text-center text-[15px] font-semibold no-underline px-8 py-3.5 rounded-sm text-white transition-opacity hover:opacity-90" style={{ background: FOREST }}>
                Book a tour
              </Link>
              <p className="mt-4 text-center text-[12.5px]" style={{ color: STONE }}>
                Prefer to write? <a href="mailto:hello@techub.co" className="font-semibold" style={{ color: FOREST }}>hello@techub.co</a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ======================= CTA BAND ======================= */}
      <section className="grain relative overflow-hidden" style={{ background: FOREST }}>
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-20 sm:py-24 text-center relative">
          <Eyebrow light>Private Tours Daily</Eyebrow>
          <h2 className="font-display font-medium text-[36px] sm:text-[52px] text-white mt-5 leading-[1.15]">
            Come see it <em>in person.</em>
          </h2>
          <p className="mt-5 text-[15.5px] leading-relaxed max-w-lg mx-auto" style={{ color: '#B9C6C2' }}>
            Photographs don’t do quiet justice. Walk the floors, try a desk, meet the members.
          </p>
          <Link href="/book" className="inline-block mt-9 text-[15px] font-bold no-underline px-10 py-4 rounded-sm transition-opacity hover:opacity-90" style={{ background: BRASS, color: '#FFFFFF', letterSpacing: '0.04em' }}>
            Book a tour
          </Link>
        </div>
      </section>

      {/* ======================= FOOTER ======================= */}
      <footer style={{ background: '#0A1F1C', color: '#B9C6C2' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 grid sm:grid-cols-2 md:grid-cols-3 gap-12">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[24px] font-semibold text-white">Techub</span>
              <span className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '0.28em', color: '#7A8B87' }}>Co-Working</span>
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed max-w-xs" style={{ color: '#7A8B87' }}>
              A classic house for modern work. Private offices, desks and meeting rooms in the heart of Lahore.
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase mb-5" style={{ letterSpacing: '0.24em', color: '#D8C08A' }}>Explore</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {[...NAV, { label: 'Book a tour', href: '/book' }, { label: 'Member sign in', href: '/login' }].map((n) => (
                <a key={n.label} href={n.href} className="text-[13.5px] no-underline hover:text-white transition-colors" style={{ color: '#B9C6C2' }}>
                  {n.label}
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase mb-5" style={{ letterSpacing: '0.24em', color: '#D8C08A' }}>Contact</p>
            <p className="text-[13.5px] leading-[1.9]" style={{ color: '#B9C6C2' }}>
              Main Boulevard, Gulberg III<br />Lahore, Pakistan<br />
              <a href="tel:+923000000000" className="no-underline hover:text-white" style={{ color: '#B9C6C2' }}>+92 300 000 0000</a><br />
              <a href="mailto:hello@techub.co" className="no-underline hover:text-white" style={{ color: '#B9C6C2' }}>hello@techub.co</a>
            </p>
          </div>
        </div>
        <div className="border-t" style={{ borderColor: '#1C3532' }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[12.5px]" style={{ color: '#5E716D' }}>© 2026 Techub Co-Working. All rights reserved.</p>
            <p className="text-[12.5px] font-display italic" style={{ color: '#5E716D' }}>Work well, live well.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
