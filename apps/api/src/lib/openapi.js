'use strict';
/**
 * CoworkOS OpenAPI 3.0 spec generator.
 *
 * Central registry: har endpoint yahan `define()` se register hota hai.
 * Route files optionally apne endpoints is tarah contribute kar sakti hain:
 *
 *   const { registerOpenApi } = require('../lib/openapi');
 *   registerOpenApi('/api/widgets', [
 *     { method: 'get', summary: 'List widgets', tags: ['Widgets'], auth: 'jwt', responses: {...} },
 *   ]);
 *
 * `auth` values: 'none' (public), 'jwt' (Bearer JWT), 'apikey' (X-API-Key),
 * 'both' (JWT ya API key — OpenAPI me OR security).
 */
const REGISTRY = [];

function define(def) {
  REGISTRY.push(def);
  return def;
}

function registerOpenApi(base, defs) {
  for (const d of defs || []) REGISTRY.push({ ...d, path: base + (d.path || '') });
}

// ---------- chhote helpers ----------
const json = (schema) => ({ 'application/json': { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const Err = (desc) => ({ description: desc, content: json(ref('Error')) });
const OK = (schema, desc) => ({ description: desc || 'OK', content: json(schema || ref('Success')) });

function sec(auth) {
  if (auth === 'none') return [];
  if (auth === 'jwt') return [{ bearerAuth: [] }];
  if (auth === 'apikey') return [{ apiKey: [] }];
  if (auth === 'both') return [{ bearerAuth: [] }, { apiKey: [] }];
  return [{ bearerAuth: [] }];
}

function qp(name, type, desc, required) {
  return { name, in: 'query', required: !!required, description: desc || '', schema: { type: type || 'string' } };
}
function pp(name, desc) {
  return { name, in: 'path', required: true, description: desc || '', schema: { type: 'string' } };
}

// ---------- shared schemas ----------
const SCHEMAS = {
  Error: {
    type: 'object',
    properties: { error: { type: 'string', example: 'Not found' }, code: { type: 'string', example: 'NOT_FOUND' } },
  },
  Success: { type: 'object', properties: { ok: { type: 'boolean', example: true } } },
  Member: {
    type: 'object',
    properties: {
      id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
      phone: { type: 'string' }, companyName: { type: 'string' }, status: { type: 'string', example: 'active' },
      creditLimit: { type: 'number', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Booking: {
    type: 'object',
    properties: {
      id: { type: 'string' }, unitId: { type: 'string' }, memberId: { type: 'string' },
      startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' },
      status: { type: 'string', example: 'confirmed' }, title: { type: 'string' },
    },
  },
  Invoice: {
    type: 'object',
    properties: {
      id: { type: 'string' }, number: { type: 'string', example: 'INV-202610-0001' },
      memberId: { type: 'string' }, amount: { type: 'number' }, amountPaid: { type: 'number' },
      status: { type: 'string', example: 'unpaid' }, dueDate: { type: 'string', format: 'date' },
      invoiceType: { type: 'string', example: 'standard' },
    },
  },
  Payment: {
    type: 'object',
    properties: {
      id: { type: 'string' }, invoiceId: { type: 'string' }, amount: { type: 'number' },
      method: { type: 'string', example: 'cash' }, paidAt: { type: 'string', format: 'date-time' },
    },
  },
  Unit: {
    type: 'object',
    properties: {
      id: { type: 'string' }, code: { type: 'string', example: 'MR-01' }, name: { type: 'string' },
      type: { type: 'string', example: 'meeting_room' }, capacity: { type: 'integer' },
      pricePerHour: { type: 'number' }, status: { type: 'string', example: 'available' },
    },
  },
  Ticket: {
    type: 'object',
    properties: {
      id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
      status: { type: 'string', example: 'open' }, priority: { type: 'string', example: 'medium' },
      memberId: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Visitor: {
    type: 'object',
    properties: {
      id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' },
      hostMemberId: { type: 'string' }, checkedInAt: { type: 'string', format: 'date-time' },
      checkedOutAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  Contract: {
    type: 'object',
    properties: {
      id: { type: 'string' }, memberId: { type: 'string' }, unitId: { type: 'string' },
      startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' },
      rentAmount: { type: 'number' }, status: { type: 'string', example: 'active' },
    },
  },
  ApiKey: {
    type: 'object',
    properties: {
      id: { type: 'string' }, name: { type: 'string' }, prefix: { type: 'string', example: 'cwk_ab12' },
      scopes: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time', nullable: true },
      lastUsedAt: { type: 'string', format: 'date-time', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
    },
  },
  AuthTokens: {
    type: 'object',
    properties: {
      accessToken: { type: 'string' }, refreshToken: { type: 'string' },
      user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } } },
      mustChangePassword: { type: 'boolean' },
    },
  },
  Paginated: {
    type: 'object',
    properties: {
      data: { type: 'array', items: { type: 'object' } },
      total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' },
    },
  },
};

// ============================================================================
// AUTH — /api/auth
// ============================================================================
define({ method: 'post', path: '/api/auth/login', tags: ['Auth'], auth: 'none',
  summary: 'Login', description: 'Email + password se login. Access + refresh tokens milte hain. 2FA enabled ho to 2faRequired ata hai.',
  requestBody: { required: true, content: json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } }) },
  responses: { 200: OK(ref('AuthTokens'), 'Tokens issued'), 401: Err('Invalid credentials'), 423: Err('Account locked'), 429: Err('Too many attempts') } });

define({ method: 'post', path: '/api/auth/login/2fa', tags: ['Auth'], auth: 'none',
  summary: 'Complete 2FA login', description: 'Login ke baad TOTP code verify karo.',
  requestBody: { required: true, content: json({ type: 'object', required: ['userId', 'code'], properties: { userId: { type: 'string' }, code: { type: 'string', example: '123456' } } }) },
  responses: { 200: OK(ref('AuthTokens'), 'Tokens issued'), 401: Err('Invalid code') } });

define({ method: 'post', path: '/api/auth/refresh', tags: ['Auth'], auth: 'none',
  summary: 'Rotate refresh token', description: 'Purana refresh token revoke hokar naya milta hai. Revoked token dobara bhejne par sab tokens revoke (theft protection).',
  requestBody: { required: true, content: json({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }) },
  responses: { 200: OK(ref('AuthTokens'), 'Tokens rotated'), 401: Err('Invalid or reused token') } });

define({ method: 'post', path: '/api/auth/logout', tags: ['Auth'], auth: 'jwt',
  summary: 'Logout', description: 'Refresh token revoke + cookie clear.',
  responses: { 200: OK(null, 'Logged out'), 401: Err('Unauthorized') } });

define({ method: 'get', path: '/api/auth/me', tags: ['Auth'], auth: 'jwt',
  summary: 'Current user', description: 'Logged-in user ka profile.',
  responses: { 200: OK({ type: 'object' }, 'User profile'), 401: Err('Unauthorized') } });

// ============================================================================
// MEMBERS — /api/members
// ============================================================================
define({ method: 'get', path: '/api/members', tags: ['Members'], auth: 'both',
  summary: 'List members', parameters: [qp('q', 'string', 'Search name/email/phone'), qp('status', 'string', 'active|trial|on_hold|exited'), qp('page', 'integer'), qp('pageSize', 'integer')],
  responses: { 200: OK({ type: 'object', properties: { data: { type: 'array', items: ref('Member') }, total: { type: 'integer' } } }, 'Member list'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/members', tags: ['Members'], auth: 'jwt',
  summary: 'Create member', description: 'Roles: ceo/admin/manager/receptionist. creditLimit sirf finance roles set kar sakte hain.',
  requestBody: { required: true, content: json({ type: 'object', required: ['name', 'email'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, phone: { type: 'string' }, companyName: { type: 'string' }, status: { type: 'string' }, creditLimit: { type: 'number' } } }) },
  responses: { 201: OK(ref('Member'), 'Member created'), 400: Err('Validation error'), 409: Err('Email already exists') } });

define({ method: 'get', path: '/api/members/me', tags: ['Members'], auth: 'jwt',
  summary: 'My member profile', description: 'JWT se linked member record.',
  responses: { 200: OK(ref('Member'), 'Member profile'), 401: Err('Unauthorized'), 404: Err('No member linked') } });

define({ method: 'get', path: '/api/members/{id}', tags: ['Members'], auth: 'both',
  summary: 'Get member', parameters: [pp('id', 'Member ID')],
  responses: { 200: OK(ref('Member'), 'Member'), 404: Err('Not found') } });

define({ method: 'patch', path: '/api/members/{id}', tags: ['Members'], auth: 'jwt',
  summary: 'Update member', parameters: [pp('id', 'Member ID')],
  requestBody: { required: true, content: json({ type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, companyName: { type: 'string' }, status: { type: 'string' }, creditLimit: { type: 'number', nullable: true } } }) },
  responses: { 200: OK(ref('Member'), 'Updated'), 404: Err('Not found') } });

define({ method: 'delete', path: '/api/members/{id}', tags: ['Members'], auth: 'jwt',
  summary: 'Delete member', description: 'Roles: ceo/admin. Financial history wale members par block ho sakta hai.',
  parameters: [pp('id', 'Member ID')],
  responses: { 200: OK(null, 'Deleted'), 404: Err('Not found') } });

define({ method: 'get', path: '/api/members/{id}/timeline', tags: ['Members'], auth: 'jwt',
  summary: 'Member timeline', description: 'Member ki activity timeline (bookings, payments, tickets).',
  parameters: [pp('id', 'Member ID')],
  responses: { 200: OK({ type: 'array', items: { type: 'object' } }, 'Timeline events'), 404: Err('Not found') } });

// ============================================================================
// BOOKINGS — /api/bookings
// ============================================================================
define({ method: 'get', path: '/api/bookings', tags: ['Bookings'], auth: 'both',
  summary: 'List bookings', parameters: [qp('from', 'string', 'Start date YYYY-MM-DD'), qp('to', 'string', 'End date'), qp('unitId', 'string'), qp('memberId', 'string'), qp('status', 'string')],
  responses: { 200: OK({ type: 'array', items: ref('Booking') }, 'Booking list'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/bookings', tags: ['Bookings'], auth: 'jwt',
  summary: 'Create booking', description: 'Overlap par 409, booking rules violation par 422, credit limit exceeded par 402.',
  requestBody: { required: true, content: json({ type: 'object', required: ['unitId', 'startsAt', 'endsAt'], properties: { unitId: { type: 'string' }, memberId: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' }, title: { type: 'string' } } }) },
  responses: { 201: OK(ref('Booking'), 'Booking created'), 402: Err('Credit limit exceeded'), 409: Err('Time slot overlaps'), 422: Err('Booking rule violation') } });

define({ method: 'patch', path: '/api/bookings/{id}', tags: ['Bookings'], auth: 'jwt',
  summary: 'Update booking', parameters: [pp('id', 'Booking ID')],
  requestBody: { required: true, content: json({ type: 'object', properties: { startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' }, status: { type: 'string' }, title: { type: 'string' } } }) },
  responses: { 200: OK(ref('Booking'), 'Updated'), 404: Err('Not found') } });

define({ method: 'delete', path: '/api/bookings/{id}', tags: ['Bookings'], auth: 'jwt',
  summary: 'Cancel booking', parameters: [pp('id', 'Booking ID')],
  responses: { 200: OK(null, 'Cancelled'), 404: Err('Not found') } });

// ============================================================================
// BILLING — /api/billing (invoices + payments)
// ============================================================================
define({ method: 'get', path: '/api/billing/invoices', tags: ['Billing'], auth: 'both',
  summary: 'List invoices', parameters: [qp('status', 'string', 'unpaid|partial|paid|overdue|cancelled'), qp('type', 'string', 'standard|proforma'), qp('memberId', 'string'), qp('page', 'integer')],
  responses: { 200: OK({ type: 'object', properties: { data: { type: 'array', items: ref('Invoice') }, total: { type: 'integer' } } }, 'Invoice list'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/billing/invoices', tags: ['Billing'], auth: 'jwt',
  summary: 'Create invoice', description: 'invoiceType: standard (INV- series) ya proforma (PRO- series). Roles: ceo/admin/finance.',
  requestBody: { required: true, content: json({ type: 'object', required: ['memberId', 'amount'], properties: { memberId: { type: 'string' }, amount: { type: 'number' }, dueDate: { type: 'string', format: 'date' }, invoiceType: { type: 'string', example: 'standard' }, notes: { type: 'string' } } }) },
  responses: { 201: OK(ref('Invoice'), 'Invoice created'), 400: Err('Validation error') } });

define({ method: 'get', path: '/api/billing/invoices/{id}', tags: ['Billing'], auth: 'both',
  summary: 'Get invoice', parameters: [pp('id', 'Invoice ID')],
  responses: { 200: OK(ref('Invoice'), 'Invoice with payments'), 404: Err('Not found') } });

define({ method: 'patch', path: '/api/billing/invoices/{id}/cancel', tags: ['Billing'], auth: 'jwt',
  summary: 'Cancel invoice', parameters: [pp('id', 'Invoice ID')],
  responses: { 200: OK(ref('Invoice'), 'Cancelled'), 400: Err('Already paid'), 404: Err('Not found') } });

define({ method: 'post', path: '/api/billing/invoices/{id}/convert', tags: ['Billing'], auth: 'jwt',
  summary: 'Convert proforma to invoice', description: 'Proforma ko standard invoice me badlo (naya INV- number).',
  parameters: [pp('id', 'Proforma invoice ID')],
  responses: { 200: OK(ref('Invoice'), 'Converted'), 400: Err('Not a proforma invoice') } });

define({ method: 'post', path: '/api/billing/payments', tags: ['Billing'], auth: 'jwt',
  summary: 'Record payment', description: 'Proforma invoices par payment block hai (400).',
  requestBody: { required: true, content: json({ type: 'object', required: ['invoiceId', 'amount'], properties: { invoiceId: { type: 'string' }, amount: { type: 'number' }, method: { type: 'string', example: 'cash' }, notes: { type: 'string' } } }) },
  responses: { 201: OK(ref('Payment'), 'Payment recorded'), 400: Err('Invalid payment') } });

define({ method: 'get', path: '/api/billing/dues', tags: ['Billing'], auth: 'jwt',
  summary: 'Outstanding dues', description: 'Wusool-baqi invoices ki list.',
  responses: { 200: OK({ type: 'array', items: ref('Invoice') }, 'Dues list'), 401: Err('Unauthorized') } });

// ============================================================================
// SPACES / UNITS — /api/spaces
// ============================================================================
define({ method: 'get', path: '/api/spaces/units', tags: ['Units'], auth: 'both',
  summary: 'List units', parameters: [qp('type', 'string', 'meeting_room|desk|office|...'), qp('status', 'string'), qp('q', 'string', 'Search')],
  responses: { 200: OK({ type: 'array', items: ref('Unit') }, 'Unit list'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/spaces/units', tags: ['Units'], auth: 'jwt',
  summary: 'Create unit', description: 'Roles: ceo/admin/manager.',
  requestBody: { required: true, content: json({ type: 'object', required: ['code', 'name', 'type'], properties: { code: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, capacity: { type: 'integer' }, pricePerHour: { type: 'number' }, floorId: { type: 'string' }, zoneId: { type: 'string' } } }) },
  responses: { 201: OK(ref('Unit'), 'Unit created'), 409: Err('Code already exists') } });

define({ method: 'get', path: '/api/spaces/units/{id}', tags: ['Units'], auth: 'both',
  summary: 'Get unit', parameters: [pp('id', 'Unit ID')],
  responses: { 200: OK(ref('Unit'), 'Unit'), 404: Err('Not found') } });

define({ method: 'patch', path: '/api/spaces/units/{id}', tags: ['Units'], auth: 'jwt',
  summary: 'Update unit', parameters: [pp('id', 'Unit ID')],
  requestBody: { required: true, content: json({ type: 'object', properties: { name: { type: 'string' }, capacity: { type: 'integer' }, pricePerHour: { type: 'number' }, status: { type: 'string' } } }) },
  responses: { 200: OK(ref('Unit'), 'Updated'), 404: Err('Not found') } });

define({ method: 'get', path: '/api/spaces/occupancy', tags: ['Units'], auth: 'jwt',
  summary: 'Occupancy snapshot', description: 'Occupied/total units + percentage.',
  responses: { 200: OK({ type: 'object', properties: { total: { type: 'integer' }, occupied: { type: 'integer' }, pct: { type: 'number' } } }, 'Occupancy') } });

// ============================================================================
// TICKETS — /api/tickets
// ============================================================================
define({ method: 'get', path: '/api/tickets', tags: ['Tickets'], auth: 'jwt',
  summary: 'List tickets', parameters: [qp('status', 'string', 'open|in_progress|resolved|closed'), qp('priority', 'string')],
  responses: { 200: OK({ type: 'array', items: ref('Ticket') }, 'Ticket list'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/tickets', tags: ['Tickets'], auth: 'jwt',
  summary: 'Create ticket', description: 'Member apni complaint raise kar sakta hai.',
  requestBody: { required: true, content: json({ type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', example: 'medium' } } }) },
  responses: { 201: OK(ref('Ticket'), 'Ticket created'), 400: Err('Validation error') } });

define({ method: 'get', path: '/api/tickets/{id}', tags: ['Tickets'], auth: 'jwt',
  summary: 'Get ticket', parameters: [pp('id', 'Ticket ID')],
  responses: { 200: OK(ref('Ticket'), 'Ticket with comments'), 404: Err('Not found') } });

define({ method: 'patch', path: '/api/tickets/{id}', tags: ['Tickets'], auth: 'jwt',
  summary: 'Update ticket', description: 'Status/priority/assign (staff). Status change par member ko email jata hai.',
  parameters: [pp('id', 'Ticket ID')],
  requestBody: { required: true, content: json({ type: 'object', properties: { status: { type: 'string' }, priority: { type: 'string' }, assignedTo: { type: 'string' } } }) },
  responses: { 200: OK(ref('Ticket'), 'Updated'), 404: Err('Not found') } });

define({ method: 'post', path: '/api/tickets/{id}/comments', tags: ['Tickets'], auth: 'jwt',
  summary: 'Add comment', parameters: [pp('id', 'Ticket ID')],
  requestBody: { required: true, content: json({ type: 'object', required: ['body'], properties: { body: { type: 'string' } } }) },
  responses: { 201: OK({ type: 'object' }, 'Comment added'), 404: Err('Not found') } });

// ============================================================================
// VISITORS — /api/visitors
// ============================================================================
define({ method: 'get', path: '/api/visitors', tags: ['Visitors'], auth: 'jwt',
  summary: 'List visitors', parameters: [qp('date', 'string', 'YYYY-MM-DD'), qp('q', 'string', 'Search')],
  responses: { 200: OK({ type: 'array', items: ref('Visitor') }, 'Visitor list'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/visitors/check-in', tags: ['Visitors'], auth: 'jwt',
  summary: 'Check in visitor', description: 'Roles: receptionist/manager/admin. Host member ko notify hota hai.',
  requestBody: { required: true, content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, phone: { type: 'string' }, hostMemberId: { type: 'string' }, purpose: { type: 'string' } } }) },
  responses: { 201: OK(ref('Visitor'), 'Checked in'), 400: Err('Validation error') } });

define({ method: 'post', path: '/api/visitors/{id}/check-out', tags: ['Visitors'], auth: 'jwt',
  summary: 'Check out visitor', parameters: [pp('id', 'Visitor ID')],
  responses: { 200: OK(ref('Visitor'), 'Checked out'), 404: Err('Not found') } });

// ============================================================================
// CONTRACTS — /api/contracts
// ============================================================================
define({ method: 'get', path: '/api/contracts', tags: ['Contracts'], auth: 'jwt',
  summary: 'List contracts', parameters: [qp('status', 'string', 'active|expired|cancelled'), qp('memberId', 'string')],
  responses: { 200: OK({ type: 'array', items: ref('Contract') }, 'Contract list'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/contracts', tags: ['Contracts'], auth: 'jwt',
  summary: 'Create contract', description: 'Roles: ceo/admin/manager.',
  requestBody: { required: true, content: json({ type: 'object', required: ['memberId', 'startDate', 'endDate', 'rentAmount'], properties: { memberId: { type: 'string' }, unitId: { type: 'string' }, startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' }, rentAmount: { type: 'number' } } }) },
  responses: { 201: OK(ref('Contract'), 'Contract created'), 400: Err('Validation error') } });

// ============================================================================
// API KEYS — /api/api-keys
// ============================================================================
define({ method: 'get', path: '/api/api-keys', tags: ['API Keys'], auth: 'jwt',
  summary: 'List API keys', description: 'Roles: ceo/admin. Secret kabhi wapas nahi milta — sirf create par ek dafa.',
  responses: { 200: OK({ type: 'array', items: ref('ApiKey') }, 'API keys (metadata only)'), 401: Err('Unauthorized') } });

define({ method: 'post', path: '/api/api-keys', tags: ['API Keys'], auth: 'jwt',
  summary: 'Create API key', description: 'Key `cwk_...` format me banti hai; plaintext secret SIRF is response me milta hai.',
  requestBody: { required: true, content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' }, example: ['read'] }, expiresAt: { type: 'string', format: 'date-time' } } }) },
  responses: { 201: OK({ type: 'object', properties: { id: { type: 'string' }, secret: { type: 'string', description: 'One-time plaintext secret' } } }, 'Key created — save the secret now'), 400: Err('Validation error') } });

define({ method: 'delete', path: '/api/api-keys/{id}', tags: ['API Keys'], auth: 'jwt',
  summary: 'Revoke API key', parameters: [pp('id', 'Key ID')],
  responses: { 200: OK(null, 'Revoked'), 404: Err('Not found') } });

// ============================================================================
// spec builder
// ============================================================================
function buildSpec() {
  const paths = {};
  for (const d of REGISTRY) {
    const p = paths[d.path] || (paths[d.path] = {});
    const item = {
      tags: d.tags || [],
      summary: d.summary || '',
      description: d.description || '',
      security: sec(d.auth === undefined ? 'jwt' : d.auth),
    };
    if (d.parameters && d.parameters.length) item.parameters = d.parameters;
    if (d.requestBody) item.requestBody = d.requestBody;
    item.responses = d.responses || { 200: OK(null, 'OK') };
    p[d.method || 'get'] = item;
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'CoworkOS API',
      version: '1.0.0',
      description: 'Techub Coworking SaaS — multi-tenant REST API. Authentication: JWT Bearer token (login se) ya API key (`X-API-Key: cwk_...` header). Sab tenant-scoped endpoints JWT ke tenant par filter hote hain.',
      contact: { name: 'CoworkOS Support' },
    },
    servers: [{ url: '/api', description: 'Same-origin API base' }],
    tags: [
      { name: 'Auth', description: 'Login, 2FA, token refresh' },
      { name: 'Members', description: 'Member management' },
      { name: 'Bookings', description: 'Unit/room bookings' },
      { name: 'Billing', description: 'Invoices & payments' },
      { name: 'Units', description: 'Spaces, floors, zones, units' },
      { name: 'Tickets', description: 'Complaint/support tickets' },
      { name: 'Visitors', description: 'Visitor check-in/out' },
      { name: 'Contracts', description: 'Membership contracts' },
      { name: 'API Keys', description: 'Programmatic access keys' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'POST /api/auth/login se milne wala accessToken' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'API key, format: cwk_...' },
      },
      schemas: SCHEMAS,
    },
  };
}

function endpointCount() { return REGISTRY.length; }

module.exports = { define, registerOpenApi, buildSpec, endpointCount };
