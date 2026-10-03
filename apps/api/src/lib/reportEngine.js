// Phase 52 Track 1/10: Custom Report Builder — safe query engine.
// Sirf allowlist wale fields chalte hain — koi arbitrary field/query nahi.
// ENTITY_REGISTRY: har entity ke allowed scalar fields + allowed relations (dot-notation).
const prisma = require('./prisma');

// type: string | number | decimal | boolean | date
const ENTITY_REGISTRY = {
  members: {
    model: 'member',
    label: 'Members',
    fields: {
      id: 'string', name: 'string', email: 'string', phone: 'string',
      companyName: 'string', creditLimit: 'decimal',
      createdAt: 'date', updatedAt: 'date',
    },
    relations: {},
  },
  invoices: {
    model: 'invoice',
    label: 'Invoices',
    fields: {
      id: 'string', number: 'string', amount: 'decimal', amountPaid: 'decimal',
      status: 'string', currency: 'string', invoiceType: 'string',
      dueDate: 'date', periodStart: 'date', periodEnd: 'date', createdAt: 'date',
    },
    relations: { member: { label: 'Member', fields: { name: 'string', email: 'string' } } },
  },
  bookings: {
    model: 'booking',
    label: 'Bookings',
    fields: {
      id: 'string', title: 'string', status: 'string',
      startAt: 'date', endAt: 'date', createdAt: 'date',
    },
    relations: { member: { label: 'Member', fields: { name: 'string', email: 'string' } } },
  },
  payments: {
    model: 'payment',
    label: 'Payments',
    fields: {
      id: 'string', amount: 'decimal', method: 'string', currency: 'string',
      receiptNo: 'string', paidAt: 'date', createdAt: 'date',
    },
    relations: {},
  },
  contracts: {
    model: 'contract',
    label: 'Contracts',
    fields: {
      id: 'string', rentAmount: 'decimal', rentCurrency: 'string',
      startDate: 'date', endDate: 'date', createdAt: 'date',
    },
    relations: { member: { label: 'Member', fields: { name: 'string', email: 'string' } } },
  },
  expenses: {
    model: 'expense',
    label: 'Expenses',
    fields: {
      id: 'string', category: 'string', amount: 'decimal', status: 'string',
      date: 'date', note: 'string', createdAt: 'date',
    },
    relations: {},
  },
  tickets: {
    model: 'ticket',
    label: 'Support Tickets',
    fields: {
      id: 'string', title: 'string', category: 'string', status: 'string',
      dueDate: 'date', resolvedAt: 'date', createdAt: 'date',
    },
    relations: { member: { label: 'Member', fields: { name: 'string', email: 'string' } } },
  },
  vendors: {
    model: 'vendor',
    label: 'Vendors',
    fields: {
      id: 'string', name: 'string', company: 'string', email: 'string', phone: 'string',
      category: 'string', complianceStatus: 'string', isActive: 'boolean',
      createdAt: 'date',
    },
    relations: {},
  },
  leads: {
    model: 'lead',
    label: 'Leads',
    fields: {
      id: 'string', name: 'string', email: 'string', phone: 'string', company: 'string',
      source: 'string', stage: 'string', score: 'number',
      createdAt: 'date', updatedAt: 'date',
    },
    relations: {},
  },
};

const FILTER_OPS = ['eq', 'ne', 'contains', 'startsWith', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'];
const MAX_ROWS = 5000;

function coerceValue(type, value) {
  if (value === null || value === undefined) return value;
  if (type === 'number' || type === 'decimal') {
    const n = Number(value);
    if (Number.isNaN(n)) throw Object.assign(new Error('Bad number value: ' + value), { status: 422 });
    return n;
  }
  if (type === 'date') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Bad date value: ' + value), { status: 422 });
    return d;
  }
  if (type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw Object.assign(new Error('Bad boolean value: ' + value), { status: 422 });
  }
  return String(value);
}

// field: "amount" | "member.name" — allowlist se resolve, { field, type, relation } deta hai
function resolveField(entityKey, field) {
  const reg = ENTITY_REGISTRY[entityKey];
  if (!reg) throw Object.assign(new Error('Unknown entity: ' + entityKey), { status: 422 });
  if (typeof field !== 'string' || !field) throw Object.assign(new Error('Bad field'), { status: 422 });
  if (field.includes('.')) {
    const [rel, relField] = field.split('.');
    const relDef = Object.hasOwn(reg.relations, rel) ? reg.relations[rel] : null;
    if (!relDef || !Object.hasOwn(relDef.fields, relField)) {
      throw Object.assign(new Error('Field not allowed: ' + field), { status: 422 });
    }
    return { field: relField, type: relDef.fields[relField], relation: rel };
  }
  if (!Object.hasOwn(reg.fields, field)) throw Object.assign(new Error('Field not allowed: ' + field), { status: 422 });
  return { field, type: reg.fields[field], relation: null };
}

function buildFilterClause(resolved, op, value) {
  if (!FILTER_OPS.includes(op)) throw Object.assign(new Error('Bad filter op: ' + op), { status: 422 });
  const { type } = resolved;
  if (op === 'isNull') {
    const wantNull = value === true || value === 'true';
    return wantNull ? { equals: null } : { not: null };
  }
  if (op === 'in') {
    const arr = Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim());
    return { in: arr.map((v) => coerceValue(type, v)) };
  }
  if ((op === 'contains' || op === 'startsWith') && type !== 'string') {
    throw Object.assign(new Error('Op ' + op + ' sirf text fields par'), { status: 422 });
  }
  const v = coerceValue(type, value);
  if (type === 'decimal' || type === 'number' || type === 'date') {
    return { [op]: v };
  }
  // string
  if (op === 'contains') return { contains: v, mode: 'insensitive' };
  if (op === 'startsWith') return { startsWith: v, mode: 'insensitive' };
  return { [op]: v };
}

function validateDef(def) {
  if (!def || typeof def !== 'object') throw Object.assign(new Error('Report def missing'), { status: 422 });
  const { entity, columns, filters, sorts } = def;
  if (!ENTITY_REGISTRY[entity]) throw Object.assign(new Error('Unknown entity: ' + entity), { status: 422 });
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 40) {
    throw Object.assign(new Error('columns: 1..40 fields lazmi'), { status: 422 });
  }
  const cols = columns.map((c) => {
    const f = typeof c === 'string' ? c : c.field;
    const resolved = resolveField(entity, f);
    return { field: f, label: (typeof c === 'object' && c.label) || f, ...resolved };
  });
  const filterList = Array.isArray(filters) ? filters : [];
  const where = {};
  for (const fl of filterList) {
    const resolved = resolveField(entity, fl.field);
    const clause = buildFilterClause(resolved, fl.op, fl.value);
    const target = resolved.relation ? (where[resolved.relation] ||= {}) : where;
    target[resolved.field] = clause;
  }
  const sortList = Array.isArray(sorts) ? sorts : [];
  const orderBy = [];
  for (const s of sortList.slice(0, 5)) {
    const resolved = resolveField(entity, s.field);
    const dir = s.dir === 'desc' ? 'desc' : 'asc';
    if (resolved.relation) orderBy.push({ [resolved.relation]: { [resolved.field]: dir } });
    else orderBy.push({ [resolved.field]: dir });
  }
  // select: relation fields include me
  const select = {};
  const includes = {};
  for (const c of cols) {
    if (c.relation) (includes[c.relation] ||= { select: {} }).select[c.field] = true;
    else select[c.field] = true;
  }
  return { entity, cols, where, orderBy, select, includes };
}

async function runReport(tenantId, def, { page = 1, limit = 100 } = {}) {
  const reg = ENTITY_REGISTRY[def.entity];
  if (!reg) throw Object.assign(new Error('Unknown entity'), { status: 422 });
  const delegate = prisma[reg.model];
  if (typeof delegate?.findMany !== 'function') {
    throw Object.assign(new Error('Entity not migrated yet'), { status: 503 });
  }
  const v = validateDef(def);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(MAX_ROWS, Math.max(1, parseInt(limit, 10) || 100));
  const skip = (safePage - 1) * safeLimit;
  const where = { tenantId, ...v.where };
  const include = Object.keys(v.includes).length ? v.includes : undefined;
  const [rows, total] = await Promise.all([
    delegate.findMany({
      where,
      select: Object.keys(v.select).length ? v.select : undefined,
      include,
      orderBy: v.orderBy.length ? v.orderBy : [{ createdAt: 'desc' }],
      skip,
      take: safeLimit,
    }),
    delegate.count({ where }),
  ]);
  // flatten relation fields: "member.name" -> row['member.name']
  const flat = rows.map((r) => {
    const out = {};
    for (const c of v.cols) {
      out[c.field] = c.relation ? r[c.relation]?.[c.field] ?? null : r[c.field] ?? null;
    }
    return out;
  });
  return {
    entity: v.entity,
    columns: v.cols.map((c) => ({ field: c.field, label: c.label })),
    rows: flat,
    total,
    page: safePage,
    limit: safeLimit,
    maxRows: MAX_ROWS,
  };
}

function listEntities() {
  return Object.entries(ENTITY_REGISTRY).map(([key, reg]) => ({
    key,
    label: reg.label,
    fields: Object.entries(reg.fields).map(([f, t]) => ({ field: f, type: t })),
    relations: Object.entries(reg.relations).map(([r, rd]) => ({
      relation: r,
      label: rd.label,
      fields: Object.entries(rd.fields).map(([f, t]) => ({ field: r + '.' + f, type: t })),
    })),
  }));
}

module.exports = { ENTITY_REGISTRY, FILTER_OPS, MAX_ROWS, runReport, validateDef, listEntities, resolveField };
