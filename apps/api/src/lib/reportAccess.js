// Phase 52 Track 9: Report sharing & permissions helper.
//
// Integration note (coordinator `apps/api/src/routes/custom-reports.js` me jore):
//   const { filterReports, canViewReport, canEditReport } = require('../lib/reportAccess');
//
//   // GET / — list: access filter ke baad hi bhejein
//   const reports = await prisma.customReport.findMany({ where: { tenantId } });
//   res.json(filterReports(req.user, reports));
//
//   // GET /:id  aur  POST /:id/run — view guard
//   const report = await prisma.customReport.findFirst({ where: { id, tenantId } });
//   if (!report) return res.status(404).json({ error: 'Report nahi mili' });
//   if (!canViewReport(req.user, report)) return res.status(403).json({ error: 'Access denied' });
//
//   // PUT /:id  aur  DELETE /:id — edit guard
//   if (!canEditReport(req.user, report)) return res.status(403).json({ error: 'Sirf owner ya admin edit kar sakta hai' });

'use strict';

/**
 * Kya user ye report dekh/run kar sakta hai?
 * @param {{id?:string, role?:string}} user - req.user
 * @param {{ownerId?:string|null, isPublic?:boolean, sharedWithRoles?:string[]|null}} report
 */
function canViewReport(user, report) {
  if (!user || !report) return false;
  // super_admin ko sab nazar aata hai
  if (user.role === 'super_admin') return true;
  // owner hamesha dekh sakta hai
  if (report.ownerId && user.id && String(report.ownerId) === String(user.id)) return true;
  // public report sab staff ko
  if (report.isPublic) return true;
  // role-based sharing
  const shared = report.sharedWithRoles;
  if (Array.isArray(shared) && shared.length && user.role && shared.includes(user.role)) return true;
  return false;
}

/**
 * Kya user ye report edit/delete kar sakta hai?
 * Owner + ceo/admin/super_admin.
 */
function canEditReport(user, report) {
  if (!user || !report) return false;
  if (user.role === 'super_admin') return true;
  if (report.ownerId && user.id && String(report.ownerId) === String(user.id)) return true;
  if (['ceo', 'admin'].includes(user.role)) return true;
  return false;
}

/**
 * List endpoint ke liye: sirf woh reports rakho jo user dekh sakta hai.
 */
function filterReports(user, reports) {
  if (!Array.isArray(reports)) return [];
  return reports.filter((r) => canViewReport(user, r));
}

/**
 * Share settings validate karo (PUT/PATCH par use karein).
 * @returns {{ok:boolean, value?:string[]|null, error?:string}}
 */
function validateSharing(input) {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (!Array.isArray(input)) return { ok: false, error: 'sharedWithRoles array hona chahiye' };
  const allowed = ['ceo', 'admin', 'manager', 'finance_officer', 'receptionist', 'ops', 'office_boy', 'member'];
  const clean = [...new Set(input.map((r) => String(r).toLowerCase()))];
  const bad = clean.filter((r) => !allowed.includes(r));
  if (bad.length) return { ok: false, error: `Ghalat roles: ${bad.join(', ')}` };
  return { ok: true, value: clean };
}

module.exports = { canViewReport, canEditReport, filterReports, validateSharing };
