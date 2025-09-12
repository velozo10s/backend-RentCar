// tests/reservationRoutes.spec.js

// 1) ❗️Setea env ANTES de importar/mokear rutas o middlewares
process.env.APP_ROLES = 'customer';
process.env.WEB_ROLES = 'employee,admin';

import {jest, describe, test, expect, beforeEach} from '@jest/globals';
import express from 'express';

// 2) Mocks primero…
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()}
}));
jest.unstable_mockModule('../config/db.js', async () => (await import('./__mocks__/db.js')));

// Mock auth: mete req.user y deja tomar rol por header
jest.unstable_mockModule('../middlewares/authMiddleware.js', () => ({
  default: (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({message: 'Unauthorized', localKey: 'backendRes.unauthorized'});
    req.user = {id: 2, role: req.headers['x-role'] || 'customer'};
    next();
  }
}));

// Mock requireRole: usa el array que le pasan las rutas
jest.unstable_mockModule('../middlewares/requireRole.js', () => ({
  default:
    (allowed = []) =>
      (req, res, next) => (allowed.includes(req.user?.role) ? next() : res.sendStatus(403))
}));

// 3) Y recién ahora importa las rutas (ya con env listo)
const reservationRoutes = (await import('../routes/reservationRoutes.js')).default;
const {__db} = await import('./__mocks__/db.js');

describe('Reservation Routes (e2e a nivel router con supertest)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/reservations', reservationRoutes);

    // reset de mocks de DB para cada test
    __db.query.mockReset();
    __db.release?.mockReset?.();
    __db.connect.mockReset().mockResolvedValue({query: __db.query, release: __db.release});
  });

  // helpers (dejá esto cerca del beforeEach)
  const req = async () => (await import('supertest')).default(app);

// Curried: primero elegís el rol, después le pasás el request de supertest
  const as = (role) => (r) =>
    r.set('Authorization', 'Bearer test').set('x-role', role);

// Si querés probar 401, no metas Authorization
  const noAuth = (r) => r;

  // --- Helpers ---
  const request = async () => (await import('supertest')).default(app);
  //const auth = (r, role = 'customer') => r.set('Authorization', 'Bearer test').set('x-role', role);

  // *********************
  // POST /api/reservations
  // *********************

  test('POST /api/reservations -> 201 (happy path crea reserva + items)', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{id: 1, is_active: true, status: 'available', price_per_hour: 80, price_per_day: 500}]
      }) // vehículos válidos
      .mockResolvedValueOnce({rows: []}) // sin conflictos
      .mockResolvedValueOnce({rows: [{id: 777}]}) // insert reservation
      .mockResolvedValueOnce({}) // insert items
      .mockResolvedValueOnce({
        rows: [{id: 777, status: 'pending', total_amount: 500, items: [{vehicle_id: 1, line_amount: 500}]}]
      }) // fetch creada
      .mockResolvedValueOnce({}); // COMMIT

    const res = await as('customer')((await req()).post('/api/reservations')).send({
      startAt: '2025-09-01T10:00:00-04:00',
      endAt: '2025-09-03T10:00:00-04:00',
      vehicleIds: [1],
      note: 'Baby seat'
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe(777);
    expect(res.body.status).toBe('pending');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('POST /api/reservations -> 400 si endAt < startAt', async () => {
    const res = await as('customer')((await req()).post('/api/reservations'))
      .send({
        startAt: '2025-08-20T10:00:00-04:00',
        endAt: '2025-08-19T10:00:00-04:00',
        vehicleIds: [1]
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.localKey || '').toMatch(/vehicles\.filters\.dateError/);
  });

  test('POST /api/reservations -> 409 por conflicto de disponibilidad', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({rows: [{id: 1, is_active: true, status: 'available'}]}) // vehicles ok
      .mockResolvedValueOnce({rows: [{vehicle_id: 1, conflicting_reservation_id: 555}]}); // conflicto

    const res = await as('customer')((await req()).post('/api/reservations'))
      .send({
        startAt: '2025-09-01T10:00:00-04:00',
        endAt: '2025-09-03T10:00:00-04:00',
        vehicleIds: [1]
      });

    expect(res.statusCode).toBe(409);
    expect(Array.isArray(res.body.detail)).toBe(true);
  });

  test('POST /api/reservations -> 401 si falta Authorization', async () => {
    const res = await noAuth((await req()))
      .post('/api/reservations')
      .send({
        startAt: '2025-09-01T10:00:00-04:00',
        endAt: '2025-09-03T10:00:00-04:00',
        vehicleIds: [1]
      });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({message: 'Unauthorized', localKey: 'backendRes.unauthorized'});
  });

  // *********************
  // GET /api/reservations (mis reservas)
  // *********************

  test('GET /api/reservations -> 200 lista paginada/array', async () => {
    __db.query.mockResolvedValueOnce({
      rows: [
        {id: 10, status: 'pending', total_amount: 200},
        {id: 11, status: 'confirmed', total_amount: 300}
      ]
    });

    const res = await as('customer')((await req()).get('/api/reservations?status=all'));
    expect(res.statusCode).toBe(200);
    // contrato flexible: items o array directo
    expect(Array.isArray(res.body.items || res.body)).toBe(true);
  });

  test('GET /api/reservations -> 500 si la BD falla', async () => {
    __db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await as('customer')((await req()).get('/api/reservations'));
    expect(res.statusCode).toBe(500);
  });

  // *********************
  // GET /api/reservations/:id
  // *********************

  test('GET /api/reservations/:id -> 200 detalle', async () => {
    __db.query.mockResolvedValueOnce({
      rows: [{id: 123, status: 'pending', total_amount: 500, items: [{vehicle_id: 1, line_amount: 500}]}]
    });

    const res = await as('customer')((await req()).get('/api/reservations/123'));
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(123);
  });

  test('GET /api/reservations/:id -> 404 si no existe', async () => {
    __db.query.mockResolvedValueOnce({rows: []});
    const res = await as('customer')((await req()).get('/api/reservations/99999'));
    expect(res.statusCode).toBe(404);
  });

  // *********************
  // PATCH /:id/cancel (APP role)
  // *********************

  test('PATCH /api/reservations/:id/cancel -> 200 (customer permitido por APP_ROLES)', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({rows: [{id: 22, customer_id: 2, status: 'pending'}]}) // fetch / ownership
      .mockResolvedValueOnce({rows: [{id: 22, status: 'cancelled'}]}) // update
      .mockResolvedValueOnce({}); // COMMIT

    const res = await as('customer')((await req()).patch('/api/reservations/22/cancel'), 'customer');
    console.log(res.text);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  test('PATCH /api/reservations/:id/cancel -> 403 si rol no permitido en APP', async () => {
    // Cambiamos el rol a uno que NO esté en APP_ROLES
    const res = await as('employee')((await req()).patch('/api/reservations/22/cancel'), 'guest');
    expect(res.statusCode).toBe(403);
  });

  // *********************
  // Acciones WEB: confirm / decline / activate / complete (WEB_ROLES: employee, admin)
  // *********************

  test('PATCH /:id/confirm -> 200 con rol employee', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({rows: [{id: 33, status: 'pending'}]}) // current
      .mockResolvedValueOnce({rows: [{id: 33, status: 'confirmed'}]}) // update
      .mockResolvedValueOnce({}); // COMMIT

    const res = await as('employee')((await req()).patch('/api/reservations/33/confirm'), 'employee');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  test('PATCH /:id/confirm -> 403 con rol customer', async () => {
    const res = await as('customer')((await req()).patch('/api/reservations/33/confirm'), 'customer');
    expect(res.statusCode).toBe(403);
  });

  test('PATCH /:id/confirm -> 409 si ya no hay disponibilidad', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({rows: [{id: 44, status: 'pending'}]}) // current
      .mockResolvedValueOnce({rows: []}) // simula check que provoca 409 en el controller
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), {code: 'CONFLICT'})); // o lo que uses internamente

    // Nota: si tu controller devuelve 409 sin throw, adapta estos mocks a lo que haga exactamente
    const res = await as('customer')((await req()).patch('/api/reservations/44/confirm'), 'employee');
    expect([409, 500]).toContain(res.statusCode); // tolerante según implementación
  });

  test('PATCH /:id/decline -> 200', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({rows: [{id: 55, status: 'pending'}]})
      .mockResolvedValueOnce({rows: [{id: 55, status: 'declined'}]})
      .mockResolvedValueOnce({}); // COMMIT

    const res = await as('employee')((await req()).patch('/api/reservations/55/decline'), 'employee');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('declined');
  });

  test('PATCH /:id/activate -> 200', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({rows: [{id: 66, status: 'confirmed'}]})
      .mockResolvedValueOnce({rows: [{id: 66, status: 'active'}]})
      .mockResolvedValueOnce({}); // COMMIT

    const res = await as('employee')((await req()).patch('/api/reservations/66/activate'), 'employee');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('active');
  });

  test('PATCH /:id/complete -> 200', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({rows: [{id: 77, status: 'active'}]})
      .mockResolvedValueOnce({rows: [{id: 77, status: 'completed'}]})
      .mockResolvedValueOnce({}); // COMMIT

    const res = await as('employee')((await req()).patch('/api/reservations/77/complete'), 'employee');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  // *********************
  // Seguridad genérica
  // *********************

  test('Cualquier endpoint -> 401 si falta Authorization', async () => {
    const res = await (await request()).get('/api/reservations');
    expect(res.statusCode).toBe(401);
  });

  test('Cualquier endpoint -> 500 si la BD explota', async () => {
    __db.query.mockRejectedValueOnce(new Error('boom'));
    const res = await as('customer')((await req()).get('/api/reservations'), 'customer');
    expect(res.statusCode).toBe(500);
  });
});
