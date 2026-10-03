/* Seed default membership plans for a tenant (idempotent).
 * Usage: node prisma/seed-plans.js (requires DATABASE_URL)
 * Creates plans for the "techub" tenant if none exist.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_PLANS = [
  {
    name: 'Hot Desk — Monthly',
    description: 'Flexible hot desk in shared area, business hours access.',
    price: 15000, billingCycle: 'monthly', unitType: 'hot_desk',
    features: ['Shared hot desk', 'High-speed WiFi', 'Business hours access', 'Community events'],
  },
  {
    name: 'Dedicated Desk — Monthly',
    description: 'Your own desk in shared area with locker.',
    price: 25000, billingCycle: 'monthly', unitType: 'dedicated_desk',
    features: ['Reserved desk', 'Personal locker', '24/7 access', 'High-speed WiFi', 'Meeting room credits (4h/mo)'],
  },
  {
    name: 'Private Cabin — Monthly',
    description: 'Lockable private cabin for teams.',
    price: 60000, billingCycle: 'monthly', unitType: 'cabin',
    features: ['Private lockable cabin', '24/7 access', 'Company signage', 'Meeting room credits (10h/mo)', 'Mail handling'],
  },
  {
    name: 'Virtual Office — Monthly',
    description: 'Business address + mail handling, no physical desk.',
    price: 8000, billingCycle: 'monthly', unitType: null,
    features: ['Prestigious business address', 'Mail & courier handling', 'Call answering (optional)', 'Meeting room day passes (2/mo)'],
  },
  {
    name: 'Hot Desk — Yearly',
    description: 'Hot desk billed yearly (2 months free).',
    price: 150000, billingCycle: 'yearly', unitType: 'hot_desk',
    features: ['Shared hot desk', 'High-speed WiFi', 'Business hours access', 'Community events', '2 months free'],
  },
  {
    name: 'Day Pass',
    description: 'Single day coworking access.',
    price: 1500, billingCycle: 'monthly', unitType: null,
    features: ['1 day access', 'High-speed WiFi', 'Coffee & tea'],
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'techub' } });
  if (!tenant) { console.log('techub tenant not found, skipping'); return; }

  const existing = await prisma.membershipPlan.count({ where: { tenantId: tenant.id } });
  if (existing > 0) { console.log(`${existing} plans already exist, skipping`); return; }

  for (const p of DEFAULT_PLANS) {
    await prisma.membershipPlan.create({ data: { ...p, tenantId: tenant.id } });
  }
  console.log(`✓ ${DEFAULT_PLANS.length} membership plans created`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
