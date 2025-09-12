import {jest, describe, test, expect, beforeEach} from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()}
}));
const {__db} = await import('./__mocks__/db.js');
jest.unstable_mockModule('../config/db.js', () => ({default: __db, query: __db.query, connect: __db.connect}));

const {createReservation} = await import('../controllers/reservationController.js');

import express from 'express';

// App “normal” con auth (la que ya tenías)
const app = express();
app.use(express.json());

function fakeAuth(req, _res, next) {
  req.user = {id: 8, role: 'customer'};
  next();
}

app.post('/api/reservations', fakeAuth, (req, res) => createReservation(req, res));

// App “sin auth” para testear 401
const appNoAuth = express();
appNoAuth.use(express.json());
appNoAuth.post('/api/reservations', (req, res) => createReservation(req, res));

describe('createReservation', () => {
  beforeEach(() => {
    __db.query.mockReset();
    __db.connect.mockReset().mockResolvedValue({query: __db.query, release: __db.release});
  });

  test('validation: endAt before startAt -> 400', async () => {
    const res = await request(app)
      .post('/api/reservations')
      .send({
        startAt: '2025-08-20T10:00:00-04:00',
        endAt: '2025-08-19T10:00:00-04:00',
        vehicleIds: [1]
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.localKey).toMatch('vehicles.filters.dateError');
  });

  test('conflict: overlapping reservation -> 409', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          is_active: true,
          status: 'available',
          price_per_hour: 80,
          price_per_day: 500
        }]
      }) // vehicles
      .mockResolvedValueOnce({rows: [{vehicle_id: 1, conflicting_reservation_id: 555}]}); // conflicts

    const res = await request(app)
      .post('/api/reservations')
      .send({
        startAt: '2025-09-01T10:00:00-04:00',
        endAt: '2025-09-03T10:00:00-04:00',
        vehicleIds: [1]
      });

    const result = res.body.detail;
    const vehicleIds = result.map(c => c.vehicle_id);
    const conflicts = vehicleIds.filter(id => [1].includes(id));

    expect(res.statusCode).toBe(409);
    expect(conflicts).toEqual([1]);
  });

  test('happy path: inserts reservation + items -> 201', async () => {
    __db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          is_active: true,
          status: 'available',
          price_per_hour: 80,
          price_per_day: 500
        }]
      }) // vehicles
      .mockResolvedValueOnce({rows: []}) // conflicts: none
      .mockResolvedValueOnce({rows: [{id: 777}]}) // insert reservation
      .mockResolvedValueOnce({}) // insert items
      .mockResolvedValueOnce({
        rows: [{id: 777, status: 'pending', total_amount: 500, items: [{vehicle_id: 1, line_amount: 500}]}]
      }) // fetch created
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(app)
      .post('/api/reservations')
      .send({
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

  // 👇 Nuevo test: sin autenticación -> 401
  test('unauthenticated: missing req.user -> 401 Unauthorized', async () => {
    const res = await request(appNoAuth)
      .post('/api/reservations')
      .send({
        startAt: '2025-09-01T10:00:00-04:00',
        endAt: '2025-09-03T10:00:00-04:00',
        vehicleIds: [1]
      });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({message: 'Unauthorized', localKey: 'backendRes.unauthorized'});

  });
});
