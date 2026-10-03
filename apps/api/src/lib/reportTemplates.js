/**
 * Phase 52 Track 7 — Report Templates Library
 * 10 ready-made CustomReport definitions. Clone -> saved CustomReport (draft).
 *
 * NOTE (coordinator): Track 1 ka `reportEngine.js` ENTITY_REGISTRY abhi parallel
 * ban raha hai. Neeche column field names entity briefs ke standard names se
 * liye hain — merge waqt ENTITY_REGISTRY ke allowed fields se verify kar lena;
 * mismatch ho to template ke columns adjust karna (engine sirf allowlist fields
 * accept karega).
 */

// Filter ops jo reportEngine support karta hai (track 1 brief):
// eq, neq, gt, gte, lt, lte, contains, in, isNull, notNull

const TEMPLATES = [
  {
    key: 'overdue-invoices',
    title: 'Overdue Invoices',
    titleUr: 'Baqaya Invoices',
    description: 'Tamam overdue invoices — member, raqam, due date aur din ke sath',
    entity: 'invoices',
    columns: [
      { field: 'number', label: 'Invoice #' },
      { field: 'memberName', label: 'Member' },
      { field: 'status', label: 'Status' },
      { field: 'total', label: 'Total' },
      { field: 'currency', label: 'Currency' },
      { field: 'dueDate', label: 'Due Date' },
      { field: 'daysOverdue', label: 'Days Overdue' },
    ],
    filters: [{ field: 'status', op: 'eq', value: 'overdue' }],
    sorts: [{ field: 'dueDate', dir: 'asc' }],
    groupBy: null,
  },
  {
    key: 'member-directory-export',
    title: 'Member Directory Export',
    titleUr: 'Members ki List',
    description: 'Active members — contact details aur plan ke sath export-ready',
    entity: 'members',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'company', label: 'Company' },
      { field: 'status', label: 'Status' },
      { field: 'planName', label: 'Plan' },
      { field: 'createdAt', label: 'Joined' },
    ],
    filters: [{ field: 'status', op: 'in', value: ['active', 'trial'] }],
    sorts: [{ field: 'name', dir: 'asc' }],
    groupBy: null,
  },
  {
    key: 'booking-utilization',
    title: 'Booking Utilization',
    titleUr: 'Bookings ka Istemaal',
    description: 'Meeting rooms/units ki booking — kitni dafa, kitne ghante',
    entity: 'bookings',
    columns: [
      { field: 'title', label: 'Booking' },
      { field: 'memberName', label: 'Member' },
      { field: 'unitName', label: 'Unit' },
      { field: 'startTime', label: 'Start' },
      { field: 'endTime', label: 'End' },
      { field: 'status', label: 'Status' },
    ],
    filters: [{ field: 'status', op: 'eq', value: 'confirmed' }],
    sorts: [{ field: 'startTime', dir: 'desc' }],
    groupBy: 'unitName',
  },
  {
    key: 'revenue-by-month',
    title: 'Revenue by Month',
    titleUr: 'Mahine ke hisab se Revenue',
    description: 'Monthly collections — payments ka mahana khulasa',
    entity: 'payments',
    columns: [
      { field: 'createdAt', label: 'Date' },
      { field: 'amount', label: 'Amount' },
      { field: 'currency', label: 'Currency' },
      { field: 'method', label: 'Method' },
      { field: 'status', label: 'Status' },
      { field: 'memberName', label: 'Member' },
    ],
    filters: [{ field: 'status', op: 'eq', value: 'completed' }],
    sorts: [{ field: 'createdAt', dir: 'desc' }],
    groupBy: 'month',
  },
  {
    key: 'expense-breakdown',
    title: 'Expense Breakdown',
    titleUr: 'Kharchon ki Tafseel',
    description: 'Category-wise expenses — kahan kitna kharch hua',
    entity: 'expenses',
    columns: [
      { field: 'title', label: 'Expense' },
      { field: 'category', label: 'Category' },
      { field: 'amount', label: 'Amount' },
      { field: 'status', label: 'Status' },
      { field: 'expenseDate', label: 'Date' },
    ],
    filters: [{ field: 'status', op: 'eq', value: 'approved' }],
    sorts: [{ field: 'expenseDate', dir: 'desc' }],
    groupBy: 'category',
  },
  {
    key: 'lead-pipeline',
    title: 'Lead Pipeline',
    titleUr: 'Leads ka Pipeline',
    description: 'CRM leads stage-wise — kon kahan atka hai',
    entity: 'leads',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'stage', label: 'Stage' },
      { field: 'score', label: 'Score' },
      { field: 'source', label: 'Source' },
      { field: 'createdAt', label: 'Created' },
    ],
    filters: [{ field: 'stage', op: 'neq', value: 'lost' }],
    sorts: [
      { field: 'score', dir: 'desc' },
      { field: 'createdAt', dir: 'desc' },
    ],
    groupBy: 'stage',
  },
  {
    key: 'attendance-summary',
    title: 'Staff Attendance Summary',
    titleUr: 'Staff Hazri ka Khulasa',
    description: 'Staff attendance — present/absent/late counts',
    entity: 'attendance',
    columns: [
      { field: 'employeeName', label: 'Employee' },
      { field: 'date', label: 'Date' },
      { field: 'status', label: 'Status' },
      { field: 'checkIn', label: 'Check In' },
      { field: 'checkOut', label: 'Check Out' },
    ],
    filters: [],
    sorts: [{ field: 'date', dir: 'desc' }],
    groupBy: 'status',
  },
  {
    key: 'ticket-sales',
    title: 'Event Ticket Sales',
    titleUr: 'Event Tickets ki Farokht',
    description: 'Ticket types ke hisab se sales aur revenue',
    entity: 'tickets',
    columns: [
      { field: 'eventTitle', label: 'Event' },
      { field: 'ticketTypeName', label: 'Ticket Type' },
      { field: 'buyerName', label: 'Buyer' },
      { field: 'buyerEmail', label: 'Email' },
      { field: 'price', label: 'Price' },
      { field: 'status', label: 'Status' },
      { field: 'purchasedAt', label: 'Purchased' },
    ],
    filters: [{ field: 'status', op: 'in', value: ['valid', 'used'] }],
    sorts: [{ field: 'purchasedAt', dir: 'desc' }],
    groupBy: 'ticketTypeName',
  },
  {
    key: 'vendor-spend',
    title: 'Vendor Spend',
    titleUr: 'Vendors par Kharch',
    description: 'Vendor-wise purchase orders aur bills ka khulasa',
    entity: 'vendors',
    columns: [
      { field: 'name', label: 'Vendor' },
      { field: 'company', label: 'Company' },
      { field: 'email', label: 'Email' },
      { field: 'complianceStatus', label: 'Compliance' },
      { field: 'totalSpend', label: 'Total Spend' },
    ],
    filters: [],
    sorts: [{ field: 'totalSpend', dir: 'desc' }],
    groupBy: null,
  },
  {
    key: 'churn-risk-members',
    title: 'Churn Risk Members',
    titleUr: 'Jaane ka Khatra wale Members',
    description: 'High churn-risk members — retention action ke liye',
    entity: 'members',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'status', label: 'Status' },
      { field: 'churnScore', label: 'Churn Score' },
      { field: 'lastBookingAt', label: 'Last Booking' },
    ],
    filters: [{ field: 'churnScore', op: 'gte', value: 50 }],
    sorts: [{ field: 'churnScore', dir: 'desc' }],
    groupBy: null,
  },
];

function getTemplates() {
  return TEMPLATES.map((t) => ({
    key: t.key,
    title: t.title,
    titleUr: t.titleUr,
    description: t.description,
    entity: t.entity,
    columnCount: t.columns.length,
    hasFilters: t.filters.length > 0,
    groupBy: t.groupBy,
  }));
}

function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null;
}

/** Template se CustomReport create payload (Track 1 ke model shape me) */
function toReportPayload(template, { tenantId, ownerId, name } = {}) {
  return {
    tenantId,
    name: name || template.title,
    entity: template.entity,
    columns: template.columns,
    filters: template.filters,
    sorts: template.sorts,
    groupBy: template.groupBy,
    isPublic: false,
    ownerId: ownerId || null,
  };
}

module.exports = { TEMPLATES, getTemplates, getTemplate, toReportPayload };
