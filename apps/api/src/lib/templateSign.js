// Phase 50 Track 5/10: Template → E-sign flow.
//
// LegalTemplate se rendered document bana kar phase 36 ke e-sign envelope
// (ContractSignature + public /sign/:token page) me bhejta hai. Sign ho jane
// par signed PDF legal vault (LegalDocument, Track 4) me auto-save hota hai.
//
// SCHEMA NOTE (honest): ContractSignature.contractId NOT NULL hai aur koi
// migration allowed nahi — is liye envelope hamesha ek ASAL Contract se
// jurta hai. Bina contract ke "Send for signing" nahi chalega; caller ko
// 422 (reason 'contract_required') milta hai, koi fake data nahi banta.
//
// INTEGRATION 1 — templates page (Track 1 owns apps/web/app/(app)/legal/templates/page.js):
//   "📝 Send for signing" button → modal: contract select (member ke active
//   contracts), signer name/email (prefill), variables form (template.variables
//   se) → POST /api/legal-templates/:id/send-for-signing
//   { contractId, signerName, signerEmail, data } → createFromTemplate(...)
//   Response: { signatureId, signUrl, expiresAt } — signUrl signer ko bhejo.
//
// INTEGRATION 2 — coordinator, routes/legal-templates.js me ye route jore:
//   router.post('/:id/send-for-signing', staffOnly, async (req, res, next) => {
//     try {
//       const r = await require('../lib/templateSign').createFromTemplate({
//         tenantId: req.tenantId, templateId: req.params.id,
//         data: req.body.data || {}, signerName: req.body.signerName,
//         signerEmail: req.body.signerEmail, contractId: req.body.contractId,
//         actorId: req.user.sub, ip: req.ip,
//       });
//       return res.status(201).json(r);
//     } catch (e) { return next(e); }
//   });
//
// INTEGRATION 3 — coordinator, esign.js POST /sign/:token success ke baad
// (fire-and-forget, updated ke baad):
//   try { require('../lib/templateSign').saveSignedDocumentToVault(updated.id).catch(() => {}); } catch {}
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const prisma = require('./prisma');
const { renderTemplate } = require('./templateRender');
const { notify } = require('./mailer');
const { saveFile } = require('./storage');
const { writeAudit } = require('../middleware/audit');

const WEB_URL = process.env.WEB_URL || 'https://techub-co-working.pages.dev';
const SIGN_LINK_DAYS = 14;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function err(status, message, reason) {
  const e = new Error(message);
  e.status = status;
  if (reason) e.reason = reason;
  return e;
}

function hasModel(name) {
  return !!(prisma && prisma[name]);
}

// Template category (Track 1) → LegalDocument category (Track 4)
const CATEGORY_MAP = {
  membership: 'contract',
  nda: 'nda',
  employment: 'other',
  vendor: 'contract',
  event: 'other',
};

/**
 * Render a template body with {{variables}}.
 * @returns { title, body } — rendered strings
 */
function renderTemplateDocument(template, data = {}) {
  const safeData = data && typeof data === 'object' ? data : {};
  return {
    title: renderTemplate(template.name || 'Document', safeData),
    body: renderTemplate(template.body || '', safeData),
  };
}

/**
 * Create an e-sign envelope from a legal template.
 *
 * @param {object} p
 * @param {string} p.tenantId
 * @param {string} p.templateId
 * @param {object} [p.data] — variable values
 * @param {string} p.signerName
 * @param {string} p.signerEmail
 * @param {string} p.contractId — REQUIRED (ContractSignature schema constraint)
 * @param {string} [p.actorId] — staff user creating the request
 * @param {string} [p.ip]
 * @returns {Promise<{ok:true, signatureId, signUrl, expiresAt, documentTitle, templateName}>}
 * @throws 422 template/contract missing ya contractId absent; 503 migration pending
 */
async function createFromTemplate({
  tenantId,
  templateId,
  data,
  signerName,
  signerEmail,
  contractId,
  actorId = null,
  ip = '',
}) {
  if (!hasModel('legalTemplate')) {
    throw err(503, 'Legal templates are not migrated yet.', 'not_migrated');
  }
  if (!tenantId) throw err(400, 'tenantId is required.');
  if (!templateId) throw err(400, 'templateId is required.', 'template_required');
  if (!signerName || !String(signerName).trim())
    throw err(422, 'Signer name is required.', 'signer_required');
  if (!signerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(signerEmail).trim()))
    throw err(422, 'A valid signer email is required.', 'signer_required');
  if (!contractId) {
    // ContractSignature.contractId NOT NULL — bina asal contract ke envelope nahi ban sakta.
    throw err(422, 'A contract is required to create a signing envelope.', 'contract_required');
  }

  const template = await prisma.legalTemplate.findFirst({
    where: { id: templateId, tenantId, isActive: true, isArchived: false },
  });
  if (!template) throw err(404, 'Template not found.', 'template_not_found');

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, tenantId },
    include: {
      member: { select: { id: true, name: true, email: true } },
      unit: { select: { id: true, code: true } },
    },
  });
  if (!contract) throw err(404, 'Contract not found.', 'contract_not_found');

  const { title: documentTitle, body: renderedBody } = renderTemplateDocument(template, data);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SIGN_LINK_DAYS * 24 * 60 * 60 * 1000);

  // Ek contract par ek hi active link (esign.js wala pattern).
  await prisma.contractSignature
    .updateMany({
      where: { contractId: contract.id, status: 'pending' },
      data: { status: 'expired', tokenHash: null },
    })
    .catch(() => {});

  const sig = await prisma.contractSignature.create({
    data: {
      tenantId,
      contractId: contract.id,
      signerName: String(signerName).trim().slice(0, 120),
      signerEmail: String(signerEmail).trim().toLowerCase().slice(0, 160),
      tokenHash: hashToken(token),
      status: 'pending',
      expiresAt,
    },
  });

  const signUrl = `${WEB_URL}/sign/${token}`;

  // Signer ko email (phase 36 template; extra vars ignore-safe hain).
  try {
    await notify(tenantId, sig.signerEmail, 'contractSignatureRequest', {
      signerName: sig.signerName,
      memberName: contract.member ? contract.member.name : '',
      unitCode: contract.unit ? contract.unit.code : '',
      signUrl,
      expiresAt: expiresAt.toLocaleDateString(),
      documentTitle,
      templateName: template.name,
    });
  } catch {}

  // Rendered document ka record — vault save ke liye (audit me, preview ke sath).
  writeAudit({
    tenantId,
    actorId,
    action: 'template.signature_requested',
    entity: 'ContractSignature',
    entityId: sig.id,
    newValue: {
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category,
      contractId: contract.id,
      signerName: sig.signerName,
      signerEmail: sig.signerEmail,
      documentTitle,
      renderedBodyPreview: renderedBody.slice(0, 2000),
      signUrl,
    },
    ip,
  }).catch(() => {});

  return {
    ok: true,
    signatureId: sig.id,
    signUrl,
    expiresAt,
    documentTitle,
    templateName: template.name,
  };
}

function pdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Signed envelope ka PDF bana kar legal vault me save kare.
 * esign.js POST /sign/:token ke success ke baad fire-and-forget call karein.
 *
 * @param {string} signatureId
 * @param {object} [opts]
 * @returns {Promise<{saved:boolean, documentId?, reason?}>} — kabhi throw nahi karta
 */
async function saveSignedDocumentToVault(signatureId, { actorId = null } = {}) {
  try {
    if (!hasModel('legalDocument')) return { saved: false, reason: 'not_migrated' };

    const sig = await prisma.contractSignature.findFirst({
      where: { id: signatureId, status: 'signed' },
      include: {
        tenant: { select: { id: true, name: true, address: true, phone: true, email: true } },
        contract: { include: { member: { select: { id: true, name: true } } } },
      },
    });
    if (!sig) return { saved: false, reason: 'not_signed' };

    // Dedupe: isi signature ka vault doc pehle se ho to dobara nahi.
    const already = await prisma.auditLog
      .findFirst({
        where: {
          tenantId: sig.tenantId,
          action: 'template.signed_saved',
          entity: 'LegalDocument',
        },
        orderBy: { createdAt: 'desc' },
      })
      .catch(() => null);
    // (audit me entityId signature link hota hai — neeche check)

    const origin = await prisma.auditLog
      .findFirst({
        where: {
          tenantId: sig.tenantId,
          action: 'template.signature_requested',
          entity: 'ContractSignature',
          entityId: sig.id,
        },
        orderBy: { createdAt: 'desc' },
      })
      .catch(() => null);
    if (!origin || !origin.newValue || !origin.newValue.templateId) {
      return { saved: false, reason: 'no_template_origin' };
    }

    // Dedupe via audit newValue.signatureId
    const dup = await prisma.auditLog
      .findFirst({
        where: { tenantId: sig.tenantId, action: 'template.signed_saved' },
        orderBy: { createdAt: 'desc' },
      })
      .catch(() => null);
    if (dup && dup.newValue && dup.newValue.signatureId === sig.id) {
      return { saved: false, reason: 'already_saved' };
    }
    void already;

    const ov = origin.newValue;
    const template = await prisma.legalTemplate
      .findFirst({ where: { id: ov.templateId, tenantId: sig.tenantId } })
      .catch(() => null);

    // Rendered body dobara banao (preview audit me hoti hai, poora body template se).
    let fullBody = '';
    try {
      if (template) {
        const rendered = renderTemplateDocument(template, {});
        fullBody = rendered.body;
      }
    } catch {}
    if (!fullBody && ov.renderedBodyPreview) fullBody = ov.renderedBodyPreview;

    const tenant = sig.tenant || {};
    const docTitle = ov.documentTitle || (template ? template.name : 'Signed Document');

    // ---- PDF ----
    const pdf = new PDFDocument({ margin: 50, size: 'A4' });
    pdf.fontSize(20).font('Helvetica-Bold').fillColor('#1e1b4b').text(tenant.name || 'Coworking Space');
    if (tenant.address) pdf.fontSize(10).font('Helvetica').fillColor('#64748b').text(tenant.address);
    pdf.moveDown();
    pdf.fontSize(16).font('Helvetica-Bold').fillColor('#1e1b4b').text(docTitle);
    pdf.fontSize(10).font('Helvetica').fillColor('#64748b')
      .text(`Template: ${ov.templateName || ''} · Signed: ${sig.signedAt ? new Date(sig.signedAt).toLocaleString() : ''}`);
    pdf.moveDown();
    pdf.fontSize(11).font('Helvetica').fillColor('#1e293b').text(fullBody || '(document text unavailable)', {
      align: 'left',
    });
    pdf.moveDown(2);
    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#1e1b4b').text('Signature');
    pdf.fontSize(11).font('Helvetica').fillColor('#334155');
    pdf.text(`Signed by: ${sig.signerName} (${sig.signerEmail})`);
    if (sig.signedAt) pdf.text(`Signed at: ${new Date(sig.signedAt).toLocaleString()}`);
    if (sig.ipAddress) pdf.text(`IP: ${sig.ipAddress}`);
    // Signature image (fail-safe — image corrupt ho to skip)
    if (sig.signatureImage) {
      try {
        const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(sig.signatureImage).trim());
        if (m) {
          const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
          pdf.moveDown();
          pdf.image(buf, { fit: [220, 90] });
        }
      } catch {}
    }
    const pdfBuf = await pdfBuffer(pdf);

    const fileName = `signed-${docTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '.pdf';
    const saved = await saveFile(pdfBuf, {
      folder: `legal/${sig.tenantId}`,
      filename: fileName,
      mimetype: 'application/pdf',
    });

    const legalDoc = await prisma.legalDocument.create({
      data: {
        tenantId: sig.tenantId,
        title: docTitle,
        category: CATEGORY_MAP[ov.templateCategory] || 'other',
        fileUrl: saved.path,
        fileName,
        fileMime: 'application/pdf',
        fileSize: pdfBuf.length,
        relatedMemberId: sig.contract && sig.contract.memberId ? sig.contract.memberId : null,
        status: 'active',
        createdById: actorId,
      },
    });

    writeAudit({
      tenantId: sig.tenantId,
      actorId,
      action: 'template.signed_saved',
      entity: 'LegalDocument',
      entityId: legalDoc.id,
      newValue: { signatureId: sig.id, templateId: ov.templateId, documentTitle: docTitle },
    }).catch(() => {});

    return { saved: true, documentId: legalDoc.id, fileUrl: saved.path };
  } catch {
    return { saved: false, reason: 'error' };
  }
}

module.exports = {
  renderTemplateDocument,
  createFromTemplate,
  saveSignedDocumentToVault,
};
