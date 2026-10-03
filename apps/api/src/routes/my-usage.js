// Phase 51 Track 7/10: Member Portal — My Usage (GET /api/my-usage)
// Member auth (authenticate + requireTenantUser). Dependencies: Track 1 (UtilityMeter),
// Track 2 (MeterReading), Track 3 (UtilityBill). Koi bhi model merge na ho to wo section
// gracefully empty/null milta hai — poora endpoint 500 nahi hota.
//
// Coordinator:
// - Mount: app.use('/api/my-usage', require('./routes/my-usage'));  (member-auth portal routes ke sath)
// - Sidebar link: NAHI — portal page hai (/portal/usage). Portal nav me "My Usage" link
//   `/portal/usage` par jor sakte hain.
// - Server.js/Sidebar.js is track me nahi chhue.

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);

// ---------------------------------------------------------------------------
// Model guards (Phase 51 fragments parallel chal rahe hain — graceful degrade)
// ---------------------------------------------------------------------------
function has(model) {
  return !!(prisma && typeof prisma[model]?.findMany === 'function');
}
const ready = {
  meter: () => has('utilityMeter'),
  reading: () => has('meterReading'),
  bill: () => has('utilityBill'),
};

// ---------------------------------------------------------------------------
// Member resolution (ai-chat.js myMember pattern)
// ---------------------------------------------------------------------------
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const TYPE_LABEL = { electricity: 'Bijli', water: 'Pani', gas: 'Gas', internet: 'Internet' };
const TYPE_UNIT = { electricity: 'kWh', water: 'gal', gas: 'm³', internet: 'GB' };

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// GET /api/my-usage — mere meters, last readings, utility bills, monthly trend
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: 'Member record nahi mila.' });

    const pendingMigration = [];
    const out = {
      member: { id: member.id, name: member.name, email: member.email },
      meters: [],
      bills: [],
      trend: [],
      pendingMigration,
    };

    // Mere units: active contracts se (fallback: sab contracts)
    let unitIds = [];
    try {
      const contracts = await prisma.contract.findMany({
        where: { memberId: member.id, ...tf },
        select: { unitId: true, status: true },
      });
      const active = contracts.filter((c) => c.status === 'active');
      unitIds = [...new Set((active.length ? active : contracts).map((c) => c.unitId).filter(Boolean))];
    } catch {
      unitIds = [];
    }

    // ---- Meters (mere units par lage) ----
    let meters = [];
    if (ready.meter()) {
      try {
        meters = await prisma.utilityMeter.findMany({
          where: {
            ...tf,
            isActive: true,
            OR: [{ unitId: { in: unitIds.length ? unitIds : ['__none__'] } }, { unitId: null }],
          },
          include: { unit: { select: { name: true } } },
          orderBy: { name: 'asc' },
        });
      } catch {
        pendingMigration.push('utilityMeter');
        meters = [];
      }
    } else {
      pendingMigration.push('utilityMeter');
    }

    // ---- Last readings per meter ----
    const meterIds = meters.map((m) => m.id);
    let readingsByMeter = {};
    if (ready.reading() && meterIds.length) {
      try {
        const readings = await prisma.meterReading.findMany({
          where: { meterId: { in: meterIds }, ...tf },
          orderBy: { readAt: 'desc' },
        });
        for (const r of readings) {
          (readingsByMeter[r.meterId] = readingsByMeter[r.meterId] || []).push(r);
        }
      } catch {
        pendingMigration.push('meterReading');
      }
    } else if (meterIds.length) {
      pendingMigration.push('meterReading');
    }

    out.meters = meters.map((m) => {
      const rs = readingsByMeter[m.id] || [];
      const last = rs[0] || null;
      const prev = rs[1] || null;
      return {
        id: m.id,
        name: m.name,
        type: m.type,
        typeLabel: TYPE_LABEL[m.type] || m.type,
        unit: TYPE_UNIT[m.type] || '',
        unitName: m.unit?.name || (m.unitId ? '—' : 'Shared / Building'),
        meterNumber: m.meterNumber || null,
        lastReading: last ? num(last.reading) : null,
        lastReadAt: last ? last.readAt : null,
        lastConsumption: last && prev ? Math.max(0, num(last.reading) - num(prev.reading)) : null,
      };
    });

    // ---- Utility bills (meri) ----
    if (ready.bill()) {
      try {
        const bills = await prisma.utilityBill.findMany({
          where: { memberId: member.id, ...tf },
          orderBy: { periodEnd: 'desc' },
          take: 24,
        });
        out.bills = bills.map((b) => ({
          id: b.id,
          periodStart: b.periodStart || null,
          periodEnd: b.periodEnd || null,
          type: b.type || null,
          typeLabel: b.type ? TYPE_LABEL[b.type] || b.type : null,
          consumption: b.consumption != null ? num(b.consumption) : null,
          amount: num(b.amount),
          status: b.status || 'unpaid',
          invoiceId: b.invoiceId || null,
        }));
      } catch {
        pendingMigration.push('utilityBill');
      }
    } else {
      pendingMigration.push('utilityBill');
    }

    // ---- Monthly trend (pichhle 6 mahine, per type) ----
    // Cumulative readings se: har month me (max - min) per meter, type-wise sum.
    const trendMap = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trendMap[monthKey(d)] = {};
    }
    for (const m of meters) {
      const rs = (readingsByMeter[m.id] || []).slice().sort((a, b) => new Date(a.readAt) - new Date(b.readAt));
      const byMonth = {};
      for (const r of rs) {
        const k = monthKey(new Date(r.readAt));
        if (!(k in trendMap)) continue;
        (byMonth[k] = byMonth[k] || []).push(num(r.reading));
      }
      for (const [k, vals] of Object.entries(byMonth)) {
        if (vals.length >= 2) {
          const c = Math.max(0, vals[vals.length - 1] - vals[0]);
          trendMap[k][m.type] = (trendMap[k][m.type] || 0) + c;
        }
      }
    }
    out.trend = Object.keys(trendMap).map((k) => ({
      month: monthLabel(k),
      byType: Object.fromEntries(
        Object.entries(trendMap[k]).map(([t, v]) => [t, Math.round(v * 100) / 100])
      ),
      total: Math.round(Object.values(trendMap[k]).reduce((a, b) => a + b, 0) * 100) / 100,
    }));

    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: 'Usage load nahi ho saka.' });
  }
});

module.exports = router;
