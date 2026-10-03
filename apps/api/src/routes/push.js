// Phase 33 Track 10: Web Push subscription API.
// Mount: app.use('/api/push', require('./routes/push'));

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { getVapidPublicKey, sendPushToUser } = require('../lib/push');

const router = express.Router();

// Public key frontend ke liye (subscribe se pehle chahiye hoti hai).
router.get('/vapid-key', (req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) return res.status(503).json({ error: { message: 'Push not configured' } });
  res.json({ publicKey });
});

router.use(authenticate);

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(10).max(500),
    auth: z.string().min(10).max(500),
  }),
});

// Apni subscription save/update karo (endpoint globally unique hai).
router.post('/subscribe', validateBody(subscribeSchema), async (req, res, next) => {
  try {
    if (!prisma.pushSubscription) {
      return res.status(503).json({ error: { message: 'Push subscriptions not migrated yet' } });
    }
    const { endpoint, keys } = req.body;
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.user.sub, keys },
      create: { userId: req.user.sub, endpoint, keys },
    });
    res.status(201).json({ subscription: { id: sub.id, endpoint: sub.endpoint } });
  } catch (e) { next(e); }
});

// Ek device ya tamam devices ki subscription hatao.
// endpoint query param ya body me de sakte hain.
router.delete('/unsubscribe', async (req, res, next) => {
  try {
    if (!prisma.pushSubscription) {
      return res.status(503).json({ error: { message: 'Push subscriptions not migrated yet' } });
    }
    const endpoint = req.query.endpoint || (req.body && req.body.endpoint);
    if (endpoint) {
      const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
      if (!existing || existing.userId !== req.user.sub) {
        return res.json({ removed: 0 });
      }
      await prisma.pushSubscription.delete({ where: { endpoint } });
      return res.json({ removed: 1 });
    }
    const result = await prisma.pushSubscription.deleteMany({ where: { userId: req.user.sub } });
    res.json({ removed: result.count });
  } catch (e) { next(e); }
});

// Meri subscriptions (debugging / settings UI ke liye).
router.get('/subscriptions', async (req, res, next) => {
  try {
    if (!prisma.pushSubscription) return res.json({ subscriptions: [] });
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: req.user.sub },
      select: { id: true, endpoint: true, createdAt: true },
    });
    res.json({ subscriptions: subs });
  } catch (e) { next(e); }
});

// Test push (khud ko) — settings page ka "Send test" button.
router.post('/test', async (req, res, next) => {
  try {
    const result = await sendPushToUser(req.user.sub, {
      title: 'Techub Coworking',
      body: 'Push notifications kaam kar rahi hain! 🎉',
      url: '/notifications',
      tag: 'push-test',
    });
    res.json({ result });
  } catch (e) { next(e); }
});

module.exports = router;
