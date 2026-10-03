// Phase 29 Track 1: Storage status endpoint.
// Mounted by coordinator at /api/storage (server.js untouched here).
const express = require('express');

const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { getProvider, isS3Configured } = require('../lib/storage');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

// GET /api/storage/status -> { provider, configured, bucket, region, maxUploadMB }
router.get('/status', async (req, res, next) => {
  try {
    const provider = getProvider();
    res.json({
      provider, // 's3' | 'local'
      configured: provider === 's3' ? isS3Configured() : true,
      bucket: process.env.S3_BUCKET || null,
      region: process.env.S3_REGION || (provider === 's3' ? 'us-east-1' : null),
      endpoint: process.env.S3_ENDPOINT || null,
      maxUploadMB: Number(process.env.MAX_UPLOAD_MB) || 25,
    });
  } catch (e) { next(e); }
});

module.exports = router;
