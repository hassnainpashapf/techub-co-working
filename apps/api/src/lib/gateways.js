// Phase 31 Track 5: Payment Gateway Framework.
// Pluggable gateways: manual (always on) + jazzcash/easypaisa stubs.
// Real provider credentials (env) aane par stubs ko asal API calls se badlo —
// neeche har stub me "EXTENSION POINT" comments me integration steps hain.
const crypto = require('crypto');

const registry = new Map();

// Shared webhook secret — har gateway ke webhook signature isi se verify hota hai.
// Production me GATEWAY_WEBHOOK_SECRET env lazmi set karo.
function webhookSecret() {
  return process.env.GATEWAY_WEBHOOK_SECRET || process.env.JWT_ACCESS_SECRET || 'dev-webhook-secret';
}

function registerGateway(name, impl) {
  if (!name || typeof name !== 'string') throw new Error('Gateway name required');
  if (!impl || typeof impl.createPaymentLink !== 'function' || typeof impl.verifyWebhook !== 'function') {
    throw new Error(`Gateway "${name}" must implement createPaymentLink + verifyWebhook`);
  }
  registry.set(name, { name, displayName: impl.displayName || name, ...impl });
}

function getGateway(name) {
  return registry.get(name) || null;
}

function getAvailableGateways() {
  return [...registry.values()].map((g) => {
    let configured = true;
    try {
      configured = g.isConfigured ? !!g.isConfigured() : true;
    } catch {
      configured = false;
    }
    return { name: g.name, displayName: g.displayName, configured };
  });
}

// ---------------------------------------------------------------------------
// Built-in: manual ("Pay at reception / bank transfer") — hamesha available.
// ---------------------------------------------------------------------------
registerGateway('manual', {
  displayName: 'Manual / Pay at Reception',
  isConfigured: () => true,
  async createPaymentLink({ amount, invoiceId, memberEmail, tenantId }) {
    const reference = `MAN-${invoiceId.slice(-8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    return {
      configured: true,
      reference,
      instructions:
        `Please pay Rs ${Number(amount).toLocaleString()} at the reception desk ` +
        `or via bank transfer. Show this reference: ${reference}. ` +
        `Aap ki invoice ${memberEmail ? `(${memberEmail}) ` : ''}reception par verify ho jayegi.`,
    };
  },
  // Manual webhook: sirf HMAC-signed payloads accept karta hai.
  // Signature = HMAC-SHA256(rawBody, webhookSecret()), header: x-gateway-signature
  async verifyWebhook(payload, rawBody, headers) {
    const sig = headers['x-gateway-signature'] || headers['X-Gateway-Signature'];
    if (!sig) return { valid: false, reason: 'missing-signature' };
    const expected = crypto.createHmac('sha256', webhookSecret()).update(rawBody || '').digest('hex');
    const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return { valid: false, reason: 'bad-signature' };
    const status = payload && payload.status === 'paid' ? 'paid' : 'failed';
    return { valid: true, status, gatewayRef: payload.reference || null, amount: payload.amount != null ? Number(payload.amount) : null };
  },
});

// ---------------------------------------------------------------------------
// Stub: JazzCash
// EXTENSION POINT — asal integration ke steps:
//  1. Env set karo: JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, JAZZCASH_RETURN_URL,
//     JAZZCASH_INTEGRITY_SALT, (sandbox: JAZZCASH_SANDBOX=true)
//  2. createPaymentLink me JazzCash "Mobile Account / Card" API (v2.0) par POST karo:
//     pp_MerchantID, pp_Password, pp_TxnRefNo, pp_Amount (paisa me *100),
//     pp_TxnCurrency=PKR, pp_TxnDateTime, pp_TxnExpiryDateTime,
//     pp_ReturnURL, pp_SecureHash (HMAC-SHA256 sorted fields + integrity salt)
//  3. verifyWebhook me pp_SecureHash dobara compute karke compare karo.
// Docs: https://sandbox.jazzcash.com.pk (merchant docs)
// ---------------------------------------------------------------------------
registerGateway('jazzcash', {
  displayName: 'JazzCash',
  isConfigured: () => !!(process.env.JAZZCASH_MERCHANT_ID && process.env.JAZZCASH_PASSWORD),
  async createPaymentLink({ amount, invoiceId }) {
    if (!this.isConfigured()) return { configured: false, reason: 'JazzCash credentials not configured (JAZZCASH_MERCHANT_ID / JAZZCASH_PASSWORD)' };
    // TODO: asal JazzCash API call yahan (stub — abhi link generate nahi hoti)
    return { configured: false, reason: 'JazzCash live integration pending — stub only' };
  },
  async verifyWebhook(payload, rawBody, headers) {
    // TODO: pp_SecureHash verify karo (sorted postback fields + JAZZCASH_INTEGRITY_SALT)
    return { valid: false, reason: 'jazzcash-not-configured' };
  },
});

// ---------------------------------------------------------------------------
// Stub: Easypaisa
// EXTENSION POINT — asal integration ke steps:
//  1. Env set karo: EASYPAYSA_STORE_ID, EASYPAYSA_HASH_KEY, EASYPAYSA_RETURN_URL
//  2. createPaymentLink me Easypaisa "order" API par POST (orderId, transactionAmount,
//     hash = HMAC-SHA256(sorted params, HASH_KEY)) → payment URL milegi.
//  3. verifyWebhook me callback ka hash dobara compute karke compare karo.
// Docs: https://developer.easypaisa.com.pk
// ---------------------------------------------------------------------------
registerGateway('easypaisa', {
  displayName: 'Easypaisa',
  isConfigured: () => !!(process.env.EASYPAYSA_STORE_ID && process.env.EASYPAYSA_HASH_KEY),
  async createPaymentLink({ amount, invoiceId }) {
    if (!this.isConfigured()) return { configured: false, reason: 'Easypaisa credentials not configured (EASYPAYSA_STORE_ID / EASYPAYSA_HASH_KEY)' };
    // TODO: asal Easypaisa API call yahan (stub — abhi link generate nahi hoti)
    return { configured: false, reason: 'Easypaisa live integration pending — stub only' };
  },
  async verifyWebhook(payload, rawBody, headers) {
    // TODO: callback hash verify karo
    return { valid: false, reason: 'easypaisa-not-configured' };
  },
});

module.exports = { registerGateway, getGateway, getAvailableGateways, webhookSecret };
