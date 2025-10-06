// controllers/employeeController.js
import logger from "../utils/logger.js";
import {
  listEmployeesQuery,
  addEmployeeCommand,
  updateEmployeeCommand
} from '../services/employeeService.js';

const LOG_LABEL = 'Employees';

const maskEmail = (email) =>
  typeof email === 'string' ? email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.max(1, b.length)) + c) : email;
const safeBody = (body = {}) => {
  const {password, ...rest} = body || {};
  // enmascaramos email un poco por si cae en logs
  if (rest.email) rest.email = maskEmail(rest.email);
  return rest;
};

export async function listEmployees(req, res) {
  const started = Date.now();
  const userId = req.user?.id;
  try {
    const {q, active = 'all'} = req.query;
    logger.info('listEmployees: enter', {
      label: LOG_LABEL,
      userId,
      query: {q: q || null, active}
    });

    const rows = await listEmployeesQuery({q, active});

    logger.info('listEmployees: success', {
      label: LOG_LABEL,
      userId,
      count: rows?.length || 0,
      took_ms: Date.now() - started
    });

    return res.json(rows); // return [] cuando no hay
  } catch (err) {
    logger.error(`listEmployees failed: ${err.message}`, {
      label: LOG_LABEL,
      userId,
      took_ms: Date.now() - started,
      stack: err.stack
    });
    return res.status(500).json({
      localKey: 'snackBarMessages.generalError',
      message: 'Algo ha salido mal. Por favor reintente o contacte con soporte'
    });
  }
}

export async function addEmployee(req, res) {
  const started = Date.now();
  const userId = req.user?.id;
  try {
    const {person_id, first_name, last_name, username, email, password} = req.body || {};

    logger.info('addEmployee: enter', {
      label: LOG_LABEL,
      userId,
      body_keys: Object.keys(req.body || {}),
      body_preview: safeBody({person_id, first_name, last_name, username, email}) // sin password
    });

    if (!(person_id || (first_name && last_name)) || !username || !email || !password) {
      logger.warn('addEmployee: validation failed (missing required fields)', {
        label: LOG_LABEL,
        userId,
        body_preview: safeBody({person_id, first_name, last_name, username, email})
      });
      return res.status(400).json({
        localKey: 'backendRes.employees.required',
        message: 'Faltan campos obligatorios (person_id o nombres) y username/email/password.'
      });
    }

    const result = await addEmployeeCommand(req.body, {userId});

    logger.info('addEmployee: created', {
      label: LOG_LABEL,
      userId,
      createdUserId: result?.id,
      person_id: result?.person_id,
      role: result?.role,
      took_ms: Date.now() - started
    });

    return res.status(201).json(result);
  } catch (err) {
    const msg = (err?.message || '').toLowerCase();

    if (msg.includes('users_username_key') || msg.includes('users_email_key') || msg.includes('unique')) {
      logger.warn('addEmployee: conflict (unique)', {label: LOG_LABEL, userId});
      return res.status(409).json({
        localKey: 'backendRes.employees.alreadyExists',
        message: 'El usuario/correo no está disponible.'
      });
    }

    logger.error(`addEmployee failed: ${err.message}`, {
      label: LOG_LABEL,
      userId,
      took_ms: Date.now() - started,
      stack: err.stack
    });
    return res.status(500).json({
      localKey: 'snackBarMessages.generalError',
      message: 'Algo ha salido mal. Por favor reintente o contacte con soporte'
    });
  }
}

export async function updateEmployee(req, res) {
  const started = Date.now();
  const authUserId = req.user?.id;

  const userId = Number(req.params.userId);

  logger.info(`Parámetros recibidos: ${JSON.stringify({
    params: req.params,
    query: req.query,
    body: req.body,
  })}`, {label: LOG_LABEL});

  if (!Number.isInteger(userId)) {
    logger.warn('updateEmployee: invalid id', {label: LOG_LABEL, userId: authUserId, rawId: req.params.userId});
    return res.status(400).json({
      localKey: 'backendRes.employees.invalidId',
      message: 'Identificador inválido.'
    });
  }

  try {
    const result = await updateEmployeeCommand(userId, req.body || {}, {userId: authUserId});
    if (!result) {
      logger.warn('updateEmployee: not found', {
        label: LOG_LABEL,
        userId: authUserId,
        targetUserId: userId,
        took_ms: Date.now() - started
      });
      return res.status(404).json({
        localKey: 'backendRes.employees.notFound',
        message: 'Empleado no encontrado.'
      });
    }

    logger.info('updateEmployee: success', {
      label: LOG_LABEL,
      userId: authUserId,
      targetUserId: userId,
      fields_updated: Object.keys(req.body || {}).map(k => (k === 'password' ? 'password(***redacted***)' : k)),
      took_ms: Date.now() - started
    });

    return res.json(result);
  } catch (err) {
    const msg = (err?.message || '').toLowerCase();

    if (msg.includes('users_username_key') || msg.includes('users_email_key') || msg.includes('unique')) {
      logger.warn('updateEmployee: conflict (unique)', {label: LOG_LABEL, userId: authUserId, targetUserId: userId});
      return res.status(409).json({
        localKey: 'backendRes.employees.alreadyExists',
        message: 'El usuario/correo no está disponible.'
      });
    }

    logger.error(`updateEmployee failed: ${err.message}`, {
      label: LOG_LABEL,
      userId: authUserId,
      targetUserId: userId,
      took_ms: Date.now() - started,
      stack: err.stack
    });
    return res.status(500).json({
      localKey: 'snackBarMessages.generalError',
      message: 'Algo ha salido mal. Por favor reintente o contacte con soporte'
    });
  }
}
