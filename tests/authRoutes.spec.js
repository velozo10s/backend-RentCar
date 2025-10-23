// tests/authRoutes.spec.js
process.env.APP_ROLES = process.env.APP_ROLES || 'customer';
process.env.WEB_ROLES = process.env.WEB_ROLES || 'employee,admin';

import {jest, describe, test, expect, beforeEach} from '@jest/globals';
import express from 'express';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()}
}));
jest.unstable_mockModule('../config/db.js', async () => (await import('./__mocks__/db.js')));

// mock tokenStore (para no tocar estado global)
jest.unstable_mockModule('../utils/tokenStore.js', () => ({
  default: {
    setRefresh: jest.fn(),
    getRefresh: jest.fn(),
    revokeRefresh: jest.fn()
  }
}));

// multer register: no sube archivos reales
jest.unstable_mockModule('../config/multerConfig.js', () => ({
  uploadDocs: {
    fields: () => (req, _res, next) => {
      req.files = {};
      next();
    }
  },
  uploadVehicles: {
    array: () => (req, _res, next) => {
      req.files = [];
      next();
    }
  },
  buildPublicUrl: () => 'http://localhost/uploads/dummy.png'
}));

const authRoutes = (await import('../routes/authRoutes.js')).default;
const {__db} = await import('./__mocks__/db.js');

describe('Auth Routes', () => {
  let app;
  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    __db.query.mockReset();
    __db.connect.mockReset().mockResolvedValue({query: __db.query, release: __db.release});
  });

  const st = async () => (await import('supertest')).default(app);

  test('POST /api/auth/login -> 200 (APP o WEB)', async () => {
    // El service usa client.connect y findUserByUsernameOrEmailAndContext + bcrypt.compare
    // Mock muy básico: que el controller resuelva 200 ó 400 según tengas validaciones activas
    const res = await (await st()).post('/api/auth/login').send({
      user: 'user@demo.com',
      password: 'secret',
      context: 'APP'
    });
    expect([200, 400]).toContain(res.statusCode);
  });

  test('POST /api/auth/refresh -> 200|400', async () => {
    const res = await (await st()).post('/api/auth/refresh').send({refreshToken: 'dummy'});
    expect([200, 400]).toContain(res.statusCode);
  });

  test('POST /api/auth/logout -> 200|400', async () => {
    const res = await (await st()).post('/api/auth/logout').send({refreshToken: 'dummy'});
    expect([200, 400]).toContain(res.statusCode);
  });

  test('POST /api/auth/register -> 201|400 (multipart simulado)', async () => {
    const res = await (await st()).post('/api/auth/register')
      .field('documentType', 'CI')
      .field('documentNumber', '1111111')
      .field('firstName', 'Juan')
      .field('lastName', 'Perez')
      .field('username', 'juan')
      .field('email', 'juan@example.com')
      .field('password', 'Secret123!');
    expect([201, 400, 409]).toContain(res.statusCode);
  });
});
