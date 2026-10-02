// PrismaClient singleton.
// In dev (`node --watch`) the process reloads modules on every file change;
// storing the client on globalThis prevents opening a new pool per reload.
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__prismaClient ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prismaClient = prisma;
}

module.exports = prisma;
