// Phase 32 Track 10: Backup management API — super_admin only.
// Mount: app.use('/api/backups', require('./routes/backups'));
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { runBackup, listBackups, deleteBackup, restoreBackup } = require('../lib/backup');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('super_admin'));

function noModel(res) {
  return res.status(503).json({ error: { message: 'Backup schema not merged yet — BackupRecord model unavailable.' } });
}

// List backups
router.get('/', async (req, res, next) => {
  try {
    if (!prisma.backupRecord) return noModel(res);
    res.json({ backups: await listBackups() });
  } catch (e) { next(e); }
});

// Manual backup now
router.post('/run', async (req, res, next) => {
  try {
    if (!prisma.backupRecord) return noModel(res);
    const result = await runBackup({ note: req.body && req.body.note ? String(req.body.note).slice(0, 500) : 'Manual backup.' });
    await writeAudit(req, 'backup.run', 'BackupRecord', result.id, null, { fileName: result.fileName, method: result.method });
    res.status(201).json({ backup: result });
  } catch (e) { next(e); }
});

// Download a backup file
router.get('/:id/download', async (req, res, next) => {
  try {
    if (!prisma.backupRecord) return noModel(res);
    const rec = await prisma.backupRecord.findUnique({ where: { id: req.params.id } });
    if (!rec) return res.status(404).json({ error: { message: 'Backup not found.' } });
    const fs = require('fs');
    if (!rec.filePath || !fs.existsSync(rec.filePath)) {
      return res.status(404).json({ error: { message: 'Backup file is missing from disk.' } });
    }
    await writeAudit(req, 'backup.download', 'BackupRecord', rec.id, null, { fileName: rec.fileName });
    res.download(rec.filePath, rec.fileName);
  } catch (e) { next(e); }
});

// Restore — dry-run unless {confirm:true}; always takes a safety backup first.
router.post('/:id/restore', async (req, res, next) => {
  try {
    if (!prisma.backupRecord) return noModel(res);
    const confirmed = !!(req.body && req.body.confirm === true);
    const result = await restoreBackup(req.params.id, { confirmed });
    if (result.dryRun) return res.json(result);
    await writeAudit(req, 'backup.restore', 'BackupRecord', req.params.id, null, { backup: result.backup, safetyBackup: result.safetyBackup });
    res.json(result);
  } catch (e) { next(e); }
});

// Delete backup (file + record)
router.delete('/:id', async (req, res, next) => {
  try {
    if (!prisma.backupRecord) return noModel(res);
    const ok = await deleteBackup(req.params.id);
    if (!ok) return res.status(404).json({ error: { message: 'Backup not found.' } });
    await writeAudit(req, 'backup.delete', 'BackupRecord', req.params.id, null, null);
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
