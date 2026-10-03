// Phase 47 Track 9: Form submission notifications.
//
// notifyOnSubmission(form, submission):
//   1) form.notifyEmails par answers-summary email (template: formSubmission)
//   2) staff ko in-app Notification (roles: ceo/admin/manager)
//   3) submitter ko confirmation email agar answers me email mil jaye (template: formConfirmation)
//
// Sab fire-and-forget friendly: kabhi throw nahi karta (catch-all).

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtValue(field, raw) {
  if (raw === undefined || raw === null || raw === '') return '—';
  if (Array.isArray(raw)) return raw.map((x) => esc(x)).join(', ') || '—';
  if (typeof raw === 'object') {
    if (raw.url) return `<a href="${esc(raw.url)}">${esc(raw.name || 'File')}</a>`;
    return esc(JSON.stringify(raw));
  }
  return esc(raw);
}

// form.fields se label map banata hai: { fieldId -> { label, type } }
function fieldMap(fields) {
  const map = {};
  for (const f of (fields || [])) {
    if (f && f.id) map[f.id] = { label: f.label || f.id, type: f.type || 'text' };
  }
  return map;
}

// Answers summary ko HTML table banata hai (staff email ke liye).
function answersTableHtml(form, submission) {
  const fields = Array.isArray(form.fields) ? form.fields : [];
  const answers = (submission && submission.answers) || {};
  const map = fieldMap(fields);
  const rows = [];
  for (const f of fields) {
    const meta = map[f.id];
    rows.push(
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;width:35%">${esc(meta.label)}</td>` +
      `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827">${fmtValue(f, answers[f.id])}</td></tr>`
    );
  }
  // Fields list se bahar ke extra answers bhi dikhao (safety).
  for (const key of Object.keys(answers)) {
    if (!map[key]) {
      rows.push(
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;width:35%">${esc(key)}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827">${fmtValue(null, answers[key])}</td></tr>`
      );
    }
  }
  if (!rows.length) return '<p style="color:#6b7280">No answers recorded.</p>';
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.join('')}</table>`;
}

// Answers me se pehla email-type field ya email jaisa value dhoondhta hai.
function findSubmitterEmail(form, submission) {
  const fields = Array.isArray(form.fields) ? form.fields : [];
  const answers = (submission && submission.answers) || {};
  for (const f of fields) {
    if (f.type === 'email' && answers[f.id]) {
      const v = String(answers[f.id]).trim();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return v;
    }
  }
  for (const v of Object.values(answers)) {
    if (typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) return v.trim();
  }
  return null;
}

async function notifyOnSubmission(form, submission) {
  try {
    if (!form || !submission) return { ok: false, reason: 'missing_args' };
    const tenantId = form.tenantId;
    if (!tenantId) return { ok: false, reason: 'missing_tenant' };

    const { notify } = require('./mailer');
    const formTitle = form.title || 'Form';
    const tableHtml = answersTableHtml(form, submission);
    const when = submission.createdAt
      ? new Date(submission.createdAt).toLocaleString()
      : new Date().toLocaleString();

    // 1) Staff emails (notifyEmails list).
    const staffEmails = [...new Set(
      (Array.isArray(form.notifyEmails) ? form.notifyEmails : [])
        .map((e) => String(e || '').trim())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    )];
    for (const to of staffEmails) {
      try {
        await notify(tenantId, to, 'formSubmission', {
          formTitle,
          submittedAt: when,
          answersHtml: tableHtml,
        });
      } catch { /* fail-safe */ }
    }

    // 2) In-app staff notifications (ceo/admin/manager).
    try {
      const prisma = require('./prisma');
      const msg = `📝 New submission: "${formTitle}" (${when})`;
      for (const role of ['ceo', 'admin', 'manager']) {
        await prisma.notification.create({
          data: { tenantId, role, type: 'general', message: msg },
        }).catch(() => {});
      }
    } catch { /* prisma model merge na ho to skip */ }

    // 3) Submitter confirmation (agar email mil jaye).
    const submitterEmail = findSubmitterEmail(form, submission);
    if (submitterEmail) {
      try {
        await notify(tenantId, submitterEmail, 'formConfirmation', {
          formTitle,
          successMessage: form.successMessage || '',
        });
      } catch { /* fail-safe */ }
    }

    return { ok: true, staffEmails: staffEmails.length, submitterNotified: !!submitterEmail };
  } catch {
    return { ok: false, reason: 'unexpected' };
  }
}

module.exports = { notifyOnSubmission, answersTableHtml, findSubmitterEmail };
