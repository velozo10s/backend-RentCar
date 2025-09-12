import {describe, test, expect} from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Example dynamic middleware builder
function requireRoleFromEnv() {
  //const list = (process.env.WEB_ROLES || '').split(',').map(s => s.trim()).filter(Boolean);
  //const allowed = new Set(list);
  return (req, res, next) => {
    const role = req.user?.role || null;

    const parseRoles = (rolesStr = '') =>
      rolesStr.split(',').map(role => role.trim()).filter(Boolean);

    const roleMap = {
      APP: parseRoles(process.env.APP_ROLES),
      WEB: parseRoles(process.env.WEB_ROLES)
    };

    // Middleware o función para chequear si es staff
    const ok = roleMap.WEB.includes(role);

    //const ok = role.some(r => allowed.has(r));
    return ok ? next() : res.status(403).json({localKey: 'auth.forbidden', message: 'Forbidden'});
  };
}

const app = express();
const guard = requireRoleFromEnv();

app.get('/protected', (req, res, next) => {
  // fake auth injection
  req.user = {id: 99, role: 'employee'};
  next();
}, guard, (req, res) => res.json({ok: true}));

describe('requireRoleFromEnv', () => {
  test('allows when role in env', async () => {
    process.env.WEB_ROLES = 'employee,admin';
    const res = await request(app).get('/protected');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('denies when role not in env', async () => {
    process.env.WEB_ROLES = 'customer'; // employee not allowed now
    const res = await request(app).get('/protected');
    expect(res.statusCode).toBe(403);
    expect(res.body.localKey).toBe('auth.forbidden');
  });
});
