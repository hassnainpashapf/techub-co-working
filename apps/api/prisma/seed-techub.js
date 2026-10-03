/* eslint-disable no-console */
// prisma/seed.js — idempotent demo seed for the Coworking SaaS (MVP).
//
// Usage (from apps/api):
//   node prisma/seed.js
//
// Requires DATABASE_URL in the environment.
// All dates are UTC calendar days ("today" = 2026-10-01).
// Decimal fields accept plain JS numbers — passed as numbers throughout.

// Pin UTC so date-only values land on the intended calendar day.
process.env.TZ = 'UTC';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// ---------------------------------------------------------------- helpers ---
const dateOnly = (iso) => new Date(`${iso}T00:00:00Z`); // for @db.Date fields (UTC)
const stamp = (iso) => new Date(iso); // full ISO incl. offset, for timestamps
const pad = (n) => String(n).padStart(2, '0');

const DEMO_PASSWORD = 'demo1234';

// -------------------------------------------------------------- seed data ---
const STAFF = [
  { email: 'superadmin@coworking.app', name: 'Super Admin', role: 'super_admin', tenantId: null },
  { email: 'ceo@demo.com', name: 'Ahmed Raza', role: 'ceo' },
  { email: 'admin@demo.com', name: 'Sara Khan', role: 'admin' },
  { email: 'ops@demo.com', name: 'Bilal Hussain', role: 'operations_manager' },
  { email: 'manager@demo.com', name: 'Usman Tariq', role: 'manager' },
  { email: 'finance@demo.com', name: 'Ayesha Malik', role: 'finance_officer' },
  { email: 'reception@demo.com', name: 'Hina Shahid', role: 'receptionist' },
  { email: 'officeboy@demo.com', name: 'Ramzan Ali', role: 'office_boy' },
];
const MEMBER_LOGIN = { email: 'member@demo.com', name: 'Daniyal Sheikh', role: 'member' };
const SEED_EMAILS = [...STAFF.map((u) => u.email), MEMBER_LOGIN.email];

const UNIT_DEFS = [
  // Ground Floor / Zone A
  { floor: 'Ground Floor', zone: 'Zone A', code: 'HD-01', type: 'hot_desk', price: 15000 },
  { floor: 'Ground Floor', zone: 'Zone A', code: 'HD-02', type: 'hot_desk', price: 15000 },
  { floor: 'Ground Floor', zone: 'Zone A', code: 'HD-03', type: 'hot_desk', price: 15000 },
  { floor: 'Ground Floor', zone: 'Zone A', code: 'HD-04', type: 'hot_desk', price: 15000 },
  { floor: 'Ground Floor', zone: 'Zone A', code: 'DD-01', type: 'dedicated_desk', price: 25000 },
  { floor: 'Ground Floor', zone: 'Zone A', code: 'DD-02', type: 'dedicated_desk', price: 25000 },
  // Ground Floor / Zone B
  { floor: 'Ground Floor', zone: 'Zone B', code: 'HD-05', type: 'hot_desk', price: 15000 },
  { floor: 'Ground Floor', zone: 'Zone B', code: 'HD-06', type: 'hot_desk', price: 15000 },
  { floor: 'Ground Floor', zone: 'Zone B', code: 'DD-03', type: 'dedicated_desk', price: 25000 },
  { floor: 'Ground Floor', zone: 'Zone B', code: 'CB-01', type: 'cabin', price: 60000 },
  { floor: 'Ground Floor', zone: 'Zone B', code: 'MR-01', type: 'meeting_room', price: 5000, capacity: 8 },
  // First Floor / Zone A
  { floor: 'First Floor', zone: 'Zone A', code: 'HD-07', type: 'hot_desk', price: 15000 },
  { floor: 'First Floor', zone: 'Zone A', code: 'HD-08', type: 'hot_desk', price: 15000 },
  { floor: 'First Floor', zone: 'Zone A', code: 'DD-04', type: 'dedicated_desk', price: 25000 },
  { floor: 'First Floor', zone: 'Zone A', code: 'DD-05', type: 'dedicated_desk', price: 25000 },
  { floor: 'First Floor', zone: 'Zone A', code: 'CB-02', type: 'cabin', price: 60000 },
  // First Floor / Zone B
  { floor: 'First Floor', zone: 'Zone B', code: 'DD-06', type: 'dedicated_desk', price: 25000 },
  { floor: 'First Floor', zone: 'Zone B', code: 'CB-03', type: 'cabin', price: 60000 },
  { floor: 'First Floor', zone: 'Zone B', code: 'CB-04', type: 'cabin', price: 60000 },
  { floor: 'First Floor', zone: 'Zone B', code: 'MR-02', type: 'meeting_room', price: 5000, capacity: 12 },
  { floor: 'First Floor', zone: 'Zone B', code: 'PB-01', type: 'phone_booth', price: 8000 },
];

const MEMBER_DEFS = [
  { name: 'Daniyal Sheikh', email: 'daniyal@techstart.pk', phone: '0301-2345678', companyName: 'TechStart Pvt Ltd', status: 'active' },
  { name: 'Fatima Noor', email: 'fatima.noor@gmail.com', phone: '0302-3456789', status: 'active' },
  { name: 'Hamza Iqbal', email: 'hamza@hamzadesigns.pk', phone: '0303-4567890', companyName: 'Hamza Designs', status: 'active' },
  { name: 'Maryam Aslam', email: 'maryam.aslam@gmail.com', phone: '0304-5678901', status: 'active' },
  { name: 'Ali Raza', email: 'ali.raza.freelance@gmail.com', phone: '0305-6789012', companyName: 'Freelancer', status: 'active' },
  { name: 'Zainab Tariq', email: 'zainab@ztconsultancy.pk', phone: '0306-7890123', companyName: 'ZT Consultancy', status: 'active' },
  { name: 'Omar Farooq', email: 'omar.farooq@gmail.com', phone: '0307-8901234', status: 'active' },
  { name: 'Sana Javed', email: 'sana.javed@gmail.com', phone: '0308-9012345', status: 'trial' },
];

const CONTRACT_DEFS = [
  // [memberIdx, unitCode, startDate, endDate]
  { memberIdx: 0, unitCode: 'HD-01', start: '2026-07-01', end: '2026-12-31' },
  { memberIdx: 1, unitCode: 'HD-02', start: '2026-07-01', end: '2026-12-31' },
  { memberIdx: 2, unitCode: 'DD-01', start: '2026-08-15', end: '2026-12-31' },
  { memberIdx: 3, unitCode: 'DD-03', start: '2026-07-01', end: '2026-12-31' },
  { memberIdx: 4, unitCode: 'CB-01', start: '2026-07-01', end: '2026-12-31' },
  { memberIdx: 5, unitCode: 'CB-02', start: '2026-08-15', end: '2026-10-12' }, // expires soon — expiry-reminder demo
  { memberIdx: 6, unitCode: 'HD-07', start: '2026-07-01', end: '2026-12-31' },
  { memberIdx: 7, unitCode: 'DD-04', start: '2026-07-01', end: '2026-12-31' },
];

const PERIODS = [
  { yyyymm: '202608', start: '2026-08-01', end: '2026-08-31', due: '2026-09-07', paidAt: '2026-08-15' },
  { yyyymm: '202609', start: '2026-09-01', end: '2026-09-30', due: '2026-10-07', paidAt: '2026-09-15' },
];
// Payment outcome per contract index for each billing period.
const OUTCOMES = {
  '202608': ['paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'overdue', 'overdue'],
  '202609': ['paid', 'paid', 'paid', 'paid', 'partial', 'partial', 'unpaid', 'unpaid'],
};
const PAY_METHODS = ['cash', 'bank_transfer', 'jazzcash'];

const EXPENSES = [
  { category: 'rent_building', amount: 150000, date: '2026-09-01', paidBy: 'Ahmed Raza', note: 'Monthly building rent – September' },
  { category: 'internet', amount: 12000, date: '2026-09-03', paidBy: 'Bilal Hussain', note: 'PTCL fiber internet bill – September' },
  { category: 'utilities', amount: 35000, date: '2026-09-05', paidBy: 'Bilal Hussain', note: 'Electricity + water bills' },
  { category: 'marketing', amount: 30000, date: '2026-09-08', paidBy: 'Usman Tariq', note: 'Facebook & Instagram ads' },
  { category: 'cleaning', amount: 18000, date: '2026-09-10', paidBy: 'Ramzan Ali', note: 'Cleaning supplies & service' },
  { category: 'kitchen', amount: 9500, date: '2026-09-12', paidBy: 'Hina Shahid', note: 'Tea, coffee & pantry supplies' },
  { category: 'maintenance', amount: 22000, date: '2026-09-15', paidBy: 'Bilal Hussain', note: 'AC servicing – all cabins' },
  { category: 'petty_cash', amount: 4200, date: '2026-09-20', paidBy: 'Hina Shahid', note: 'Miscellaneous petty cash' },
  { category: 'salaries', amount: 280000, date: '2026-09-30', paidBy: 'Ahmed Raza', note: 'September staff salaries' },
  { category: 'internet', amount: 12000, date: '2026-10-01', paidBy: 'Bilal Hussain', note: 'Internet bill – October' },
  { category: 'kitchen', amount: 8000, date: '2026-10-01', paidBy: 'Hina Shahid', note: 'October pantry restock' },
  { category: 'utilities', amount: 36000, date: '2026-10-01', paidBy: 'Bilal Hussain', note: 'October advance electricity' },
];

const TASKS = [
  { title: 'Clean meeting room MR-01', assignee: 'officeboy@demo.com', createdBy: 'admin@demo.com', status: 'pending', priority: 'high' },
  { title: 'Fix AC in Cabin CB-02', description: 'AC not cooling properly', assignee: 'officeboy@demo.com', createdBy: 'ops@demo.com', status: 'in_progress', priority: 'urgent' },
  { title: 'Restock kitchen supplies', assignee: 'officeboy@demo.com', createdBy: 'admin@demo.com', status: 'done', priority: 'medium', completedAt: stamp('2026-09-29T16:00:00+05:00') },
  { title: 'Follow up with trial member', description: 'Call Sana Javed about upgrading from trial', assignee: 'manager@demo.com', createdBy: 'admin@demo.com', status: 'pending', priority: 'medium' },
  { title: 'Prepare monthly P&L', assignee: 'finance@demo.com', createdBy: 'ops@demo.com', status: 'in_progress', priority: 'high' },
  { title: 'Deep clean washrooms', assignee: 'officeboy@demo.com', createdBy: 'ops@demo.com', status: 'pending', priority: 'medium', dueDate: dateOnly('2026-10-02') },
];

const BOOKINGS = [
  { unit: 'MR-01', memberIdx: 0, title: 'Client pitch meeting', start: '2026-09-28T10:00:00+05:00', end: '2026-09-28T12:00:00+05:00' },
  { unit: 'MR-01', memberIdx: 0, title: 'Product demo', start: '2026-10-02T14:00:00+05:00', end: '2026-10-02T15:30:00+05:00' },
  { unit: 'MR-02', memberIdx: 2, title: 'Design review', start: '2026-10-03T11:00:00+05:00', end: '2026-10-03T12:00:00+05:00' },
];

// ------------------------------------------------------------- idempotency ---
async function wipeDemoData() {
  const existing = await prisma.tenant.findUnique({ where: { slug: 'techub' } });
  if (existing) {
    console.log(`Removing existing demo tenant (${existing.id})…`);
    await prisma.tenant.delete({ where: { id: existing.id } }); // relations cascade
  }
  // super_admin has tenantId=null, so it survives the cascade — remove leftovers.
  await prisma.user.deleteMany({ where: { email: { in: SEED_EMAILS } } });
}

// ------------------------------------------------------------------ tenant ---
async function createTenant() {
  // Reuse the existing Techub tenant (id techub-main) — wiped above via cascade.
  const tenant = await prisma.tenant.create({
    data: {
      id: 'techub-main',
      name: 'Techub',
      slug: 'techub',
      email: 'hello@techub.co',
      phone: '0300-1112223',
      address: 'Main Boulevard, Gulberg, Lahore',
      plan: 'growth',
    },
  });
  await prisma.setting.createMany({
    data: [
      { tenantId: tenant.id, key: 'currency', value: 'PKR' },
      { tenantId: tenant.id, key: 'company_name', value: 'Techub' },
      { tenantId: tenant.id, key: 'invoice_prefix', value: 'INV-' },
      { tenantId: tenant.id, key: 'due_grace_days', value: '7' },
      { tenantId: tenant.id, key: 'timezone', value: 'Asia/Karachi' },
    ],
  });
  return tenant;
}

// ------------------------------------------------------------------- users ---
async function createStaffUsers(tenant, passwordHash) {
  const users = {};
  for (const s of STAFF) {
    const user = await prisma.user.create({
      data: {
        tenantId: s.tenantId === null ? null : tenant.id, // null => global super_admin
        name: s.name,
        email: s.email,
        passwordHash,
        role: s.role,
      },
    });
    users[s.email] = user;
  }
  return users;
}

// ------------------------------------------------------------------- space ---
async function createSpace(tenant) {
  const buildings = {};
  for (const b of [
    { name: 'Gulberg Campus', address: 'Main Boulevard, Gulberg, Lahore', city: 'Lahore', phone: '0300-1112223' },
    { name: 'DHA Campus', address: 'Y Block, DHA Phase 3, Lahore', city: 'Lahore', phone: '0300-4445556' },
  ]) {
    buildings[b.name] = await prisma.building.create({ data: { tenantId: tenant.id, ...b } });
  }
  console.log(`${Object.keys(buildings).length} buildings created`);

  const floors = {};
  for (const { name, level, building } of [
    { name: 'Ground Floor', level: 0, building: 'Gulberg Campus' },
    { name: 'First Floor', level: 1, building: 'DHA Campus' },
  ]) {
    floors[name] = await prisma.floor.create({
      data: { tenantId: tenant.id, name, level, buildingId: buildings[building].id },
    });
  }

  const zones = {};
  for (const [floorName, zoneName] of [
    ['Ground Floor', 'Zone A'],
    ['Ground Floor', 'Zone B'],
    ['First Floor', 'Zone A'],
    ['First Floor', 'Zone B'],
  ]) {
    const key = `${floorName}/${zoneName}`;
    zones[key] = await prisma.zone.create({
      data: { tenantId: tenant.id, floorId: floors[floorName].id, name: zoneName },
    });
  }

  const unitsByCode = {};
  for (const def of UNIT_DEFS) {
    const unit = await prisma.unit.create({
      data: {
        tenantId: tenant.id,
        zoneId: zones[`${def.floor}/${def.zone}`].id,
        code: def.code,
        type: def.type,
        status: 'vacant', // contracts below flip rented ones to occupied
        monthlyPrice: def.price,
        capacity: def.capacity ?? 1,
      },
    });
    unitsByCode[def.code] = unit;
  }
  return unitsByCode;
}

// ----------------------------------------------------------------- members ---
async function createMembers(tenant) {
  const members = [];
  for (const m of MEMBER_DEFS) {
    members.push(
      await prisma.member.create({
        data: {
          tenantId: tenant.id,
          name: m.name,
          email: m.email,
          phone: m.phone,
          companyName: m.companyName ?? null,
          status: m.status,
        },
      }),
    );
  }
  return members;
}

// --------------------------------------------------------------- contracts ---
async function createContracts(tenant, members, unitsByCode) {
  const contracts = [];
  for (const def of CONTRACT_DEFS) {
    const unit = unitsByCode[def.unitCode];
    const contract = await prisma.contract.create({
      data: {
        tenantId: tenant.id,
        memberId: members[def.memberIdx].id,
        unitId: unit.id,
        startDate: dateOnly(def.start),
        endDate: dateOnly(def.end),
        rentAmount: Number(unit.monthlyPrice),
        status: 'active',
      },
    });
    await prisma.unit.update({ where: { id: unit.id }, data: { status: 'occupied' } });
    contracts.push(contract);
  }
  return contracts;
}

// ----------------------------------------------------------------- billing ---
// Returns the numbers of the two overdue invoices (for rent_due notifications).
async function createInvoicesAndPayments(tenant, members, contracts) {
  const overdueNumbers = [];
  for (let i = 0; i < contracts.length; i += 1) {
    const contract = contracts[i];
    const rent = Number(contract.rentAmount);
    const seq4 = pad(i + 1);
    for (const p of PERIODS) {
      const outcome = OUTCOMES[p.yyyymm][i];
      const number = `INV-${p.yyyymm}-${seq4}`;

      const invoice = await prisma.invoice.create({
        data: {
          tenantId: tenant.id,
          memberId: members[CONTRACT_DEFS[i].memberIdx].id,
          contractId: contract.id,
          number,
          periodStart: dateOnly(p.start),
          periodEnd: dateOnly(p.end),
          dueDate: dateOnly(p.due), // periodEnd + 7 days
          amount: rent,
          amountPaid: outcome === 'paid' ? rent : outcome === 'partial' ? rent / 2 : 0,
          status: outcome,
        },
      });

      if (outcome === 'paid' || outcome === 'partial') {
        await prisma.payment.create({
          data: {
            tenantId: tenant.id,
            invoiceId: invoice.id,
            amount: outcome === 'paid' ? rent : rent / 2,
            method: PAY_METHODS[i % PAY_METHODS.length],
            receiptNo: `RCP-${p.yyyymm}-${seq4}`,
            paidAt: stamp(`${p.paidAt}T13:${pad(10 + i)}:00+05:00`),
            note: outcome === 'partial' ? 'Partial payment' : 'Monthly rent',
          },
        });
      }
      if (outcome === 'overdue') overdueNumbers.push(number);
    }
  }
  return overdueNumbers;
}

// ---------------------------------------------------------------- expenses ---
async function createExpenses(tenant, createdById) {
  for (const e of EXPENSES) {
    await prisma.expense.create({
      data: {
        tenantId: tenant.id,
        category: e.category,
        amount: e.amount,
        date: dateOnly(e.date),
        paidBy: e.paidBy,
        note: e.note,
        createdById,
      },
    });
  }
}

// -------------------------------------------------------------- attendance ---
async function createAttendance(tenant, users) {
  const staffEmails = [
    'ceo@demo.com',
    'admin@demo.com',
    'ops@demo.com',
    'manager@demo.com',
    'finance@demo.com',
    'reception@demo.com',
    'officeboy@demo.com',
  ];
  const onLeaveToday = 'manager@demo.com';
  for (let i = 0; i < staffEmails.length; i += 1) {
    const email = staffEmails[i];
    const userId = users[email].id;

    // 2026-09-30 — full working day
    await prisma.attendanceRecord.create({
      data: {
        tenantId: tenant.id,
        userId,
        date: dateOnly('2026-09-30'),
        checkIn: stamp(`2026-09-30T09:${pad(5 + i)}:00+05:00`),
        checkOut: stamp(`2026-09-30T18:${pad(5 + i)}:00+05:00`),
      },
    });

    // 2026-10-01 (today) — checked in, not checked out yet (except one on leave)
    if (email === onLeaveToday) {
      await prisma.attendanceRecord.create({
        data: { tenantId: tenant.id, userId, date: dateOnly('2026-10-01'), note: 'Sick leave' },
      });
    } else {
      await prisma.attendanceRecord.create({
        data: {
          tenantId: tenant.id,
          userId,
          date: dateOnly('2026-10-01'),
          checkIn: stamp(`2026-10-01T09:${pad(3 + i)}:00+05:00`),
          checkOut: null,
        },
      });
    }
  }
}

// ------------------------------------------------------------------ leaves ---
async function createLeaves(tenant, users) {
  await prisma.leave.create({
    data: {
      tenantId: tenant.id,
      userId: users['officeboy@demo.com'].id,
      fromDate: dateOnly('2026-10-05'),
      toDate: dateOnly('2026-10-06'),
      reason: 'Family event',
      status: 'pending',
    },
  });
  await prisma.leave.create({
    data: {
      tenantId: tenant.id,
      userId: users['reception@demo.com'].id,
      fromDate: dateOnly('2026-09-22'),
      toDate: dateOnly('2026-09-23'),
      reason: 'Personal errand',
      status: 'approved',
      decidedById: users['admin@demo.com'].id,
    },
  });
}

// ------------------------------------------------------------------- tasks ---
async function createTasks(tenant, users) {
  for (const t of TASKS) {
    await prisma.task.create({
      data: {
        tenantId: tenant.id,
        title: t.title,
        description: t.description ?? null,
        assigneeId: users[t.assignee].id,
        createdById: users[t.createdBy].id,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate ?? null,
        completedAt: t.completedAt ?? null,
      },
    });
  }
}

// ---------------------------------------------------------------- bookings ---
async function createBookings(tenant, users, members, unitsByCode) {
  for (const b of BOOKINGS) {
    await prisma.booking.create({
      data: {
        tenantId: tenant.id,
        unitId: unitsByCode[b.unit].id,
        memberId: members[b.memberIdx].id,
        title: b.title,
        startAt: stamp(b.start),
        endAt: stamp(b.end),
        status: 'confirmed',
        createdById: users['reception@demo.com'].id,
      },
    });
  }
}

// ------------------------------------------------------------ notifications ---
async function createNotifications(tenant, users, overdueNumbers) {
  const officeboyId = users['officeboy@demo.com'].id;
  const memberName = (num) => (num.endsWith('0007') ? 'Omar Farooq' : 'Sana Javed');
  await prisma.notification.createMany({
    data: [
      {
        tenantId: tenant.id,
        role: 'finance_officer',
        type: 'rent_due',
        message: `Rent overdue: invoice ${overdueNumbers[0]} (${memberName(overdueNumbers[0])}) is past its due date.`,
      },
      {
        tenantId: tenant.id,
        role: 'finance_officer',
        type: 'rent_due',
        message: `Rent overdue: invoice ${overdueNumbers[1]} (${memberName(overdueNumbers[1])}) is past its due date.`,
      },
      { tenantId: tenant.id, userId: officeboyId, type: 'task_assigned', message: 'New task assigned: Fix AC in Cabin CB-02 (urgent).' },
      { tenantId: tenant.id, userId: officeboyId, type: 'task_assigned', message: 'New task assigned: Clean meeting room MR-01 (high).' },
      { tenantId: tenant.id, role: 'admin', type: 'general', message: 'Welcome to Techub Coworking SaaS' },
    ],
  });
}

// -------------------------------------------------------------------- main ---
async function main() {
  console.log('Seeding demo data (idempotent)…');
  await wipeDemoData();

  const tenant = await createTenant();
  console.log(`Tenant created: ${tenant.name} (${tenant.slug})`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = await createStaffUsers(tenant, passwordHash);
  console.log(`${STAFF.length} staff users created`);

  // Real owner account (super_admin) — password: Techub@2026!Admin
  const ownerHash = await bcrypt.hash('Techub@2026!Admin', 10);
  users['admin@techub.co'] = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: 'Super Admin',
      email: 'admin@techub.co',
      passwordHash: ownerHash,
      role: 'super_admin',
    },
  });
  console.log('Owner account recreated (admin@techub.co / super_admin)');

  const unitsByCode = await createSpace(tenant);
  console.log(`${UNIT_DEFS.length} units created`);

  const members = await createMembers(tenant);
  console.log(`${members.length} members created`);

  // Member portal login linked to Daniyal Sheikh's member record.
  users[MEMBER_LOGIN.email] = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: MEMBER_LOGIN.name,
      email: MEMBER_LOGIN.email,
      passwordHash,
      role: MEMBER_LOGIN.role,
      memberId: members[0].id,
    },
  });
  console.log('Member login created (member@demo.com → Daniyal Sheikh)');

  const contracts = await createContracts(tenant, members, unitsByCode);
  console.log(`${contracts.length} contracts created (units flipped to occupied)`);

  const overdueNumbers = await createInvoicesAndPayments(tenant, members, contracts);
  console.log(`Invoices + payments created (${overdueNumbers.length} overdue)`);

  await createExpenses(tenant, users['finance@demo.com'].id);
  console.log(`${EXPENSES.length} expenses created`);

  await createAttendance(tenant, users);
  console.log('Attendance records created');

  await createLeaves(tenant, users);
  await createTasks(tenant, users);
  await createBookings(tenant, users, members, unitsByCode);
  console.log('Leaves, tasks, bookings created');

  await createNotifications(tenant, users, overdueNumbers);
  console.log('Notifications created');

  // ---------------------------------------------------------------- summary
  const where = { tenantId: tenant.id };
  const [cUsers, cBuildings, cUnits, cMembers, cContracts, cInvoices, cPayments, cExpenses, cAttendance, cLeaves, cTasks, cBookings, cNotifications] =
    await Promise.all([
      prisma.user.count({ where }),
      prisma.building.count({ where }),
      prisma.unit.count({ where }),
      prisma.member.count({ where }),
      prisma.contract.count({ where }),
      prisma.invoice.count({ where }),
      prisma.payment.count({ where }),
      prisma.expense.count({ where }),
      prisma.attendanceRecord.count({ where }),
      prisma.leave.count({ where }),
      prisma.task.count({ where }),
      prisma.booking.count({ where }),
      prisma.notification.count({ where }),
    ]);

  console.log('\n===== Seed summary =====');
  console.table([
    { entity: 'tenant', count: 1 },
    { entity: 'users (tenant)', count: cUsers },
    { entity: 'buildings', count: cBuildings },
    { entity: 'units', count: cUnits },
    { entity: 'members', count: cMembers },
    { entity: 'contracts', count: cContracts },
    { entity: 'invoices', count: cInvoices },
    { entity: 'payments', count: cPayments },
    { entity: 'expenses', count: cExpenses },
    { entity: 'attendance_records', count: cAttendance },
    { entity: 'leaves', count: cLeaves },
    { entity: 'tasks', count: cTasks },
    { entity: 'bookings', count: cBookings },
    { entity: 'notifications', count: cNotifications },
  ]);

  console.log('\n===== Demo logins (password: demo1234) =====');
  console.table(
    SEED_EMAILS.map((email) => ({
      email,
      role: email === MEMBER_LOGIN.email ? MEMBER_LOGIN.role : STAFF.find((s) => s.email === email).role,
    })),
  );
  console.log('\nDone.');
}

async function run() {
  try {
    await main();
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
