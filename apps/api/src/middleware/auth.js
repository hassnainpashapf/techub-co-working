// authenticate: expects `Authorization: Bearer <accessToken>`.
// Verifies the JWT, enforces type==='access', and attaches the payload as req.user.
// Any failure → 401 {error:{message:'Unauthorized'}}.
const { verifyAccessToken } = require('../lib/auth');
// Phase 32 Track 5: revoked login sessions ko block karo
const { isSessionRevoked } = require('../lib/userSessions');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
  try {
    const payload = verifyAccessToken(token);
    if (!payload || payload.type !== 'access') {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    // Revoked session par token invalid (sirf sid wale naye tokens check hote hain)
    if (payload.sid && (await isSessionRevoked(payload.sid))) {
      return res.status(401).json({ error: { message: 'Session revoked. Please log in again.' } });
    }
    req.user = payload; // { sub, role, tenantId, email, memberId, type, sid? }
    return next();
  } catch (_err) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
}

module.exports = { authenticate };
