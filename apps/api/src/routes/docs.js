'use strict';
// Swagger UI + OpenAPI spec. Mount: app.use('/api/docs', require('./routes/docs'))
const express = require('express');
const router = express.Router();
const { buildSpec, endpointCount } = require('../lib/openapi');

// Spec JSON — hamesha available, koi dependency nahi
router.get('/openapi.json', (req, res) => {
  res.json(buildSpec());
});

// Lightweight endpoint index (docs UI ke baghair bhi kaam ki list)
router.get('/index', (req, res) => {
  const spec = buildSpec();
  const endpoints = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      endpoints.push({ method: method.toUpperCase(), path, summary: op.summary, tags: op.tags });
    }
  }
  res.json({ count: endpointCount(), endpoints });
});

// Swagger UI — lazy load taake package missing ho to server crash na ho
let swaggerUi = null;
try {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  swaggerUi = require('swagger-ui-express');
} catch (e) {
  swaggerUi = null;
}

if (swaggerUi) {
  router.use('/', swaggerUi.serve);
  router.get('/', swaggerUi.setup(buildSpec(), {
    customSiteTitle: 'CoworkOS API Docs',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
  }));
} else {
  router.get('/', (req, res) => res.status(503).json({
    error: 'API docs UI not installed',
    hint: 'Run: npm install swagger-ui-express (apps/api me), phir container restart karo.',
    spec: '/api/docs/openapi.json',
  }));
}

module.exports = router;
