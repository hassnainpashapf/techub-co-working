// All business dates are UTC calendar days — pin TZ before anything else.
process.env.TZ = 'UTC';
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/auth-extended'));
app.use('/api/audit-logs', require('./routes/audit-logs'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/users', require('./routes/users'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/spaces', require('./routes/spaces'));
app.use('/api/buildings', require('./routes/buildings'));
app.use('/api/members', require('./routes/members'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/membership-plans', require('./routes/membership-plans'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/visitors', require('./routes/visitors'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/email-settings', require('./routes/email-settings'));
app.use('/api/refunds', require('./routes/refunds'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));

// 404 for unknown API paths
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found' } });
});

// Central error handler: zod is handled by validateBody upstream; here we
// normalize everything else. Stack traces only leak in non-production.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const body = { error: { message: err.message || 'Internal server error' } };
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    body.error.stack = err.stack;
  }
  res.status(status).json(body);
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`coworking-saas API ready on http://localhost:${PORT}`);
});
