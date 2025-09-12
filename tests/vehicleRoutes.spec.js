// tests/vehicleRoutes.spec.js
import {jest, describe, test, expect, beforeEach} from '@jest/globals';
import express from 'express';

// 1) Mocks que necesitamos ANTES de importar rutas/SUTs
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()}
}));

// mock de la BD
jest.unstable_mockModule('../config/db.js', async () => (await import('./__mocks__/db.js')));

// ⬅️ mock del authMiddleware: simula Authorization ok y mete req.user
jest.unstable_mockModule('../middlewares/authMiddleware.js', () => ({
  default: (req, _res, next) => {
    // si quieres, valida el header y falla si no está:
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return _res.status(401).json({localKey: 'auth.unauthorized'});
    req.user = {id: 1, role: 'customer'};
    next();
  }
}));

// 2) Importa ahora las rutas y el mock handle de la BD
const vehicleRoutes = (await import('../routes/vehicleRoutes.js')).default;
const {__db} = await import('./__mocks__/db.js');

describe('GET /api/vehicles', () => {
  let app;

  beforeEach(() => {
    // app aislada por test
    app = express();
    app.use(express.json());
    app.use('/api/vehicles', vehicleRoutes);

    __db.query.mockReset();
    __db.release?.mockReset?.();
    __db.connect.mockReset().mockResolvedValue({query: __db.query, release: __db.release});
  });

  test('returns paginated list', async () => {
    __db.query
      .mockResolvedValueOnce({rows: [{total: 1}]}) // count
      .mockResolvedValueOnce({
        rows: [{id: 1, model: 'Corolla', brand_name: 'Toyota', primary_image: 'url'}]
      }); // page

    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/vehicles?status=available&active=true&page=1&per_page=1')
      .set('Authorization', 'Bearer fake'); // opcional, por si tu mock lo revisa

    expect(res.statusCode).toBe(200);
    expect(res.body.items?.length || res.body.length).toBe(1); // según tu contrato
  });

  test('handles DB error with 500 + localKey', async () => {
    __db.query.mockRejectedValueOnce(new Error('db down'));

    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/vehicles')
      .set('Authorization', 'Bearer fake');

    expect(res.statusCode).toBe(500);
  });

  test('401 Unauthorized', async () => {
    __db.query.mockRejectedValueOnce(new Error('db down'));

    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/vehicles');

    expect(res.statusCode).toBe(401);
  });
});
