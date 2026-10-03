// Phase 47 Track 5/10: Form Analytics.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/form-analytics', require('./routes/form-analytics'));
// NOTE: CustomForm / FormSubmission models tracks 1/2 ke fragments se aate hain —
// migration pending ho to endpoints 503 dete hain (koi crash nahi).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

function modelReady() {
  return (
    prisma &&
    typeof prisma.customForm?.findFirst === 'function' &&
    typeof prisma.formSubmission?.findMany === 'function'
  );
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'forms migration pending' });
  next();
}
router.use(guard);

async function tenantForm(req, id) {
  const tf = tenantFilter(req);
  return prisma.customForm.findFirst({ where: { id, ...tf } });
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(
    x.getUTCDate()
  ).padStart(2, '0')}`;
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// Submission ki answers se field id ki value nikalo (answers: {fieldId: value} ya array bhi handle)
function answerValue(answers, fieldId) {
  if (!answers) return undefined;
  if (Array.isArray(answers)) {
    const hit = answers.find(
      (a) => a && (a.fieldId === fieldId || a.id === fieldId || a.key === fieldId)
    );
    return hit ? hit.value ?? hit.answer : undefined;
  }
  if (typeof answers === 'object') return answers[fieldId];
  return undefined;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v];
}

// GET /api/form-analytics/:formId — full analytics snapshot
router.get('/:formId', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const form = await tenantForm(req, req.params.formId);
    if (!form) return res.status(404).json({ error: 'form not found' });

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const submissions = await prisma.formSubmission.findMany({
      where: { formId: form.id, ...tf },
      select: { id: true, answers: true, submitterName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Submissions over time (daily)
    const perDay = {};
    for (const s of submissions) {
      const k = dayKey(s.createdAt);
      if (!perDay[k]) perDay[k] = { date: k, submissions: 0 };
      perDay[k].submissions += 1;
    }
    const submissionsOverTime = Object.values(perDay).sort((a, b) =>
      a.date < b.date ? -1 : 1
    );

    // Per-field stats
    const fieldStats = fields.map((f) => {
      const values = submissions
        .map((s) => answerValue(s.answers, f.id))
        .filter((v) => v !== undefined && v !== null && v !== '');

      const stat = {
        id: f.id,
        type: f.type,
        label: f.label,
        responses: values.length,
      };

      if (['select', 'radio', 'multiselect', 'checkbox'].includes(f.type)) {
        const counts = {};
        for (const v of values) {
          for (const opt of asArray(v)) {
            const key = String(opt);
            counts[key] = (counts[key] || 0) + 1;
          }
        }
        stat.optionCounts = counts;
      } else if (f.type === 'rating') {
        const nums = values.map(Number).filter((n) => Number.isFinite(n));
        stat.avg = nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
        const dist = {};
        for (const n of nums) dist[String(n)] = (dist[String(n)] || 0) + 1;
        stat.distribution = dist;
      } else if (f.type === 'number') {
        const nums = values.map(Number).filter((n) => Number.isFinite(n));
        stat.avg = nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
        stat.min = nums.length ? Math.min(...nums) : null;
        stat.max = nums.length ? Math.max(...nums) : null;
      }
      // text/textarea/email/phone/date/file: sirf responses count hi kaafi hai
      return stat;
    });

    res.json({
      form: { id: form.id, title: form.title, slug: form.slug, status: form.status },
      totals: { submissions: submissions.length },
      submissionsOverTime,
      fieldStats,
    });
  } catch (e) {
    res.status(500).json({ error: 'analytics failed', detail: e.message });
  }
});

// GET /api/form-analytics/:formId/export.csv — submissions CSV export
router.get('/:formId/export.csv', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const form = await tenantForm(req, req.params.formId);
    if (!form) return res.status(404).json({ error: 'form not found' });

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const submissions = await prisma.formSubmission.findMany({
      where: { formId: form.id, ...tf },
      select: { answers: true, submitterName: true, submitterEmail: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [
      'Submitted At',
      'Submitter Name',
      'Submitter Email',
      ...fields.map((f) => f.label || f.id),
    ];
    const rows = [header];
    for (const s of submissions) {
      rows.push([
        s.createdAt ? new Date(s.createdAt).toISOString() : '',
        s.submitterName || '',
        s.submitterEmail || '',
        ...fields.map((f) => answerValue(s.answers, f.id)),
      ]);
    }

    const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n');
    const fname = `form-submissions-${form.slug || form.id}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: 'csv export failed', detail: e.message });
  }
});

module.exports = router;

// Frontend integration (coordinator): form detail page me "Analytics" tab jorein —
//   GET /api/form-analytics/:formId → { form, totals, submissionsOverTime, fieldStats }
//   tab me: total submissions StatCard, daily submissions curve (SVG, submissionsOverTime se),
//   har field ka stat block:
//     select/radio/multiselect/checkbox → optionCounts bar list
//     rating → avg + distribution
//     number → avg/min/max
//   "Export CSV" button → GET /api/form-analytics/:formId/export.csv (download)
