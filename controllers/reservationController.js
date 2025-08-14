// controllers/reservationsController.js
import {DateTime} from 'luxon';
import logger from '../utils/logger.js';
import pool from '../config/db.js';
import {
  db,
  fetchVehiclesByIds,
  findConflictsQuery,
  getReservationByIdWithUser,
  getReservationItems,
  getReservationWithItems,
  insertReservation,
  insertReservationItems,
  lockReservationForUpdate,
  setVehiclesStatusByReservation,
  updateReservationStatus,
  listReservations
} from '../services/reservationService.js';

/* ------------------------- helpers ------------------------- */

function parseISO(dt) {
  const d = DateTime.fromISO(dt, {setZone: true});
  if (!d.isValid) throw new Error('Invalid date-time: ' + dt);
  return d;
}

function durationHours(startISO, endISO) {
  const s = parseISO(startISO);
  const e = parseISO(endISO);
  return e.diff(s, 'hours').hours;
}

/**
 * computeLineAmount:
 * - Calculates the cheaper of:
 *   a) per-hour * hours (rounded up)
 *   b) per-day * days (rounded up)
 * - If price_per_day is null, uses per-hour only.
 */
function computeLineAmount(vehicle, startISO, endISO) {
  const hours = Math.ceil(durationHours(startISO, endISO));
  if (hours <= 0) throw new Error('endAt must be after startAt');

  const perHourTotal = Number(vehicle.price_per_hour) * hours;

  if (vehicle.price_per_day != null) {
    const days = Math.ceil(hours / 24);
    const perDayTotal = Number(vehicle.price_per_day) * days;
    return Math.min(perHourTotal, perDayTotal);
  }
  return perHourTotal;
}

/* ------------------------- controllers ------------------------- */

/**
 * POST /api/reservations
 * Body: { startAt, endAt, vehicleIds: number[], note? }
 */
export async function createReservation(req, res) {
  logger.info('Ingresando a createReservation', {
    label: 'Controller',
    userId: req.user?.id ?? null,
  });

  const {startAt, endAt, vehicleIds, note} = req.body || {};
  const customerUserId = req.user?.id;

  if (!customerUserId) {
    logger.warn('Intento no autorizado de crear una reserva.', {label: 'Controller'});
    return res.status(401).json({message: 'Unauthorized', localKey: 'backendRes.unauthorized'});
  }
  if (!startAt || !endAt || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
    logger.warn('Error de validacion: Parametros obligatorios no recibidos.', {
      label: 'Controller',
      startAt,
      endAt,
      vehicleCount: vehicleIds?.length ?? 0
    });
    return res.status(400).json({error: 'Datos obligatorios no recibidos.'});
  }

  try {
    if (parseISO(endAt) <= parseISO(startAt)) {
      logger.warn('Error de validacion: endAt <= startAt', {label: 'Controller', startAt, endAt});
      return res.status(400).json({error: 'Fecha fin debe ser posterior a la fecha de inicio.'});
    }

    return await withTransaction(async (client) => {
      logger.debug('Transaccion iniciada para createReservation.', {label: 'Controller'});

      // fetch vehicles
      const vehicles = await fetchVehiclesByIds(client, vehicleIds);

      if (vehicles.error) {
        logger.error(`Error: ${vehicles.error}.`, {label: 'Controller'});
        return res.status(400).json(vehicles);
      }

      // if (vehicles.length !== vehicleIds.length) {
      //   logger.warn('No se encontraron todos los vehiculos.', {
      //     label: 'Controller',
      //     requested: vehicleIds.length,
      //     found: vehicles.length
      //   });
      //   return res.status(404).json({error: 'Uno o mas vehiculos no fueron encontrados.'});
      // }

      const inactive = vehicles.find(v => !v.is_active);
      if (inactive) {
        logger.warn('Vehiculo inactivo', {label: 'Controller', vehicleId: inactive.id});
        return res.status(409).json({error: `Vehiculo ${inactive.id} se encuentra en esatado inactivo.`});
      }

      const maintenance = vehicles.find(v => v.status === 'in maintenance');
      if (maintenance) {
        logger.warn(`El vehiculo ${maintenance.id} se encuentra en mantenimiento`, {
          label: 'Controller',
          vehicleId: maintenance.id
        });
        // not returning, but you could decide to fail here
      }

      // Optional: avoid overlaps at creation
      const conflicts = await findConflictsQuery(client, vehicleIds, startAt, endAt, ['confirmed', 'active'], {limitOne: false});
      if (conflicts.error) {
        logger.error(`Error: ${conflicts.error}.`, {label: 'Controller'});
        return res.status(400).json(conflicts);
      }
      // if (conflicts.length) {
      //   logger.info('Conflict found at creation', {label: 'Controller', conflict: conflicts[0]});
      //   return res.status(409).json({
      //     error: 'One or more vehicles are not available',
      //     detail: conflicts[0],
      //   });
      // }

      // compute pricing
      let total = 0;
      const lineAmounts = {};
      for (const v of vehicles) {
        const amount = computeLineAmount(v, startAt, endAt);
        lineAmounts[v.id] = amount;
        total += amount;
      }
      logger.debug('Computed pricing', {label: 'Controller', total, vehicles: vehicles.length});

      // insert reservation + items
      const reservationId = await insertReservation(client, {
        customerUserId, startAt, endAt, note, total,
      });
      await insertReservationItems(client, reservationId, vehicleIds, lineAmounts);

      const created = await getReservationWithItems(client, reservationId);
      logger.info(`Reservation created: ${created}`, {label: 'Controller', reservationId});

      return res.status(201).json(created);
    });
  } catch (err) {
    logger.error('createReservation error', {label: 'Controller', err: err?.message, stack: err?.stack});
    return res.status(500).json({error: 'Internal error'});
  } finally {
    logger.info('Finaliza createReservation', {label: 'Controller'});
  }
}

/**
 * GET /api/reservations?status=...
 * Lists reservations of the authenticated customer.
 */
export async function listMyReservations(req, res) {
  logger.info('Ingresa a listMyReservations', {
    label: 'Controller',
    userId: req.user?.id ?? null,
    role: req.user?.role ?? null,
  });

  const userId = req.user?.id;
  const role = (req.user?.role || '').toLowerCase();
  if (!userId || !role) return res.status(401).json({message: 'Unauthorized'});

  // validación de status
  const status = (req.query.status || 'all').toString();
  const allowedStatus = ['pending', 'confirmed', 'active', 'completed', 'declined', 'cancelled', 'all'];
  if (!allowedStatus.includes(status)) {
    logger.warn('Filtro de estado invalido.', {label: 'Controller', status});
    return res.status(400).json({message: 'Invalid status'});
  }

  // paginación segura
  const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);

  // filtro opcional por customer_user_id (solo admin/employee)
  let customerUserId = null;
  const isPrivileged = role === 'admin' || role === 'employee';

  if (isPrivileged) {
    // si lo pasan en query, filtramos por ese usuario; si no, vemos todas
    if (req.query.customer_user_id) {
      const parsed = parseInt(String(req.query.customer_user_id), 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({message: 'Invalid customer_user_id'});
      }
      customerUserId = parsed;
    }
  } else {
    // customers siempre quedan restringidos a su propio userId
    customerUserId = userId;
  }

  try {
    const reservations = await listReservations(db, {
      status,
      customerUserId, // null => todas (solo si es privileged)
      limit,
      offset,
    });

    if (reservations.error) {
      logger.error(`Error: ${reservations.error}.`, {label: 'Controller'});
      return res.status(400).json(reservations);
    }

    return res.json(reservations);
  } catch (err) {
    logger.error('listMyReservations error', {
      label: 'Controller',
      err: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({message: 'Internal error'});
  } finally {
    logger.info('Finaliza listMyReservations', {label: 'Controller'});
  }
}

/**
 * GET /api/reservations/:id
 * Authenticated users can see their own reservation. Employees/admins can see all.
 */
export async function getReservationById(req, res) {
  logger.info('Ingresa a getReservationById', {label: 'Controller', id: req.params?.id});

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    logger.warn('Campo id invalido en getReservationById.', {label: 'Controller', id: req.params?.id});
    return res.status(400).json({message: 'Invalid id'});
  }

  try {
    const rows = await getReservationByIdWithUser(db, id);
    // if (!rows.length) {
    //   logger.info('Reservation not found', {label: 'Controller', id});
    //   return res.status(404).json({message: 'Not found'});
    // }

    const isOwner = rows.customer_user_id === req.user?.id;
    const isStaff = req.user.role === 'admin' || req.user.role === 'employee';
    if (!isOwner && !isStaff) {
      logger.warn('Acceso no autorizado a getReservation', {label: 'Controller', id, requester: req.user?.id ?? null});
      return res.status(403).json({message: 'Forbidden: insufficient permissions'});
    }

    return res.json(rows);
  } catch (err) {
    logger.error('Error en getReservationById.', {label: 'Controller', err: err?.message, stack: err?.stack});
    return res.status(500).json({message: 'Internal error'});
  } finally {
    logger.info('Finaliza getReservationById', {label: 'Controller'});
  }
}

/**
 * PATCH /api/reservations/:id/cancel
 * Only the owner can cancel, and only before start time.
 */
export async function cancelReservation(req, res) {
  logger.info('Ingresa a cancelReservation', {label: 'Controller', id: req.params?.id});

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    logger.warn('El id recibido es invalido.', {label: 'Controller', id: req.params?.id});
    return res.status(400).json({message: 'Invalid id'});
  }

  try {
    return await withTransaction(async (client) => {
      logger.debug('Transaccion iniciada en cancelReservation', {label: 'Controller', id});

      const rows = await lockReservationForUpdate(client, id);
      if (!rows.length) return res.status(404).json({message: 'Not found'});

      const r = rows[0];
      if (r.customer_user_id !== req.user?.id) {
        logger.warn('Cancel not owner', {label: 'Controller', id, requester: req.user?.id ?? null});
        return res.status(403).json({message: 'Not your reservation'});
      }

      if (['cancelled', 'declined', 'completed'].includes(r.status)) {
        logger.warn('Cancel invalid status', {label: 'Controller', id, status: r.status});
        return res.status(400).json({message: `Cannot cancel a ${r.status} reservation`});
      }

      if (DateTime.fromJSDate(r.start_at) <= DateTime.now()) {
        logger.warn('Cancel after start time blocked', {label: 'Controller', id});
        return res.status(400).json({message: 'Cannot cancel after start time'});
      }

      const updated = await updateReservationStatus(client, id, 'cancelled');
      logger.info('Reservation cancelled', {label: 'Controller', id});

      return res.json(updated);
    });

  } catch (err) {
    logger.error('cancelReservation error', {label: 'Controller', err: err?.message, stack: err?.stack});
    return res.status(500).json({message: 'Internal error'});
  } finally {
    logger.info('Finaliza cancelReservation', {label: 'Controller'});
  }
}

/* ------------------------- staff actions ------------------------- */

export async function confirmReservation(req, res) {
  return staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'confirmed',
    checkAvailability: true,
    blockingStatuses: ['confirmed', 'active'],
  });
}

export async function declineReservation(req, res) {
  return staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'declined',
    checkAvailability: false,
  });
}

export async function activateReservation(req, res) {
  return staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'active',
    checkAvailability: true,
    blockingStatuses: ['confirmed', 'active'],
  });
}

export async function completeReservation(req, res) {
  return staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'completed',
    checkAvailability: false,
  });
}

/* ------------------------- shared staff helper ------------------------- */

async function staffChangeStatusWithAvailability(req, res, {nextStatus, checkAvailability, blockingStatuses = []}) {
  logger.info('Ingresa a staffChangeStatusWithAvailability', {
    label: 'Controller',
    id: req.params?.id,
    nextStatus, checkAvailability, blockingStatuses,
  });

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    logger.warn('Parametro id invalido en staffChangeStatusWithAvailability', {
      label: 'Controller',
      id: req.params?.id
    });
    return res.status(400).json({message: 'Invalid id'});
  }

  try {
    return await withTransaction(async (client) => {
      logger.debug('Transaccion iniciada para staffChangeStatusWithAvailability', {
        label: 'Controller',
        id,
        nextStatus
      });

      // lock reservation
      const reservations = await lockReservationForUpdate(client, id);

      if (reservations.error) {
        logger.error(`Error: ${reservations.error}.`, {label: 'Controller'});
        return res.status(400).json(reservations);
      }

      // allowed transitions
      const allowedFrom = {
        confirmed: ['pending'],
        declined: ['pending'],
        active: ['confirmed'],
        completed: ['active'],
      }[nextStatus] || [];

      if (!allowedFrom.includes(reservations.status)) {
        logger.warn('Cambio de estado no permitido.', {
          label: 'Controller',
          from: reservations.status,
          to: nextStatus,
          id
        });
        return res.status(400).json({message: `Cannot move from ${reservations.status} to ${nextStatus}`});
      }

      // fetch items
      const items = await getReservationItems(client, id);

      if (items.error) {
        logger.error(`Error: ${items.error}.`, {label: 'Controller'});
        return res.status(400).json(items);
      }

      const vehicleIds = items.map(i => i.vehicle_id);

      if (checkAvailability) {
        const conflicts = await findConflictsQuery(client, vehicleIds, reservations.start_at, reservations.end_at, blockingStatuses, {limitOne: true});
        // if (conflicts.length) {
        //   logger.info('Conflict at status change', {label: 'Controller', id, conflict: conflicts[0]});
        //   return res.status(409).json({
        //     message: 'Vehicle no longer available',
        //     detail: conflicts[0],
        //   });
        // }
        if (conflicts.error) {
          logger.error(`Error: ${conflicts.error}.`, {label: 'Controller'});
          return res.status(400).json(conflicts);
        }
      }

      const updated = await updateReservationStatus(client, id, nextStatus);

      if (nextStatus === 'active') {
        await setVehiclesStatusByReservation(client, id, 'in use');
      }
      if (nextStatus === 'completed') {
        await setVehiclesStatusByReservation(client, id, 'available');
      }

      logger.info('Estado actualizado exitosamente.', {label: 'Controller', id, nextStatus});

      return res.json({
        ...updated,
        items,
      });
    });

  } catch (err) {
    logger.error(`staffChangeStatus error ${err}`, {label: 'Controller', err: err?.message, stack: err?.stack});
    return res.status(500).json({message: 'Internal error'});
  } finally {
    logger.info('Finaliza staffChangeStatusWithAvailability', {label: 'Controller'});
  }
}

/* ------------------------- tx helper ------------------------- */

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    logger.debug('BEGIN', {label: 'DB'});

    const result = await fn(client);

    await client.query('COMMIT');
    logger.debug('COMMIT', {label: 'DB'});
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
      logger.debug('ROLLBACK', {label: 'DB'});
    } catch (rollErr) {
      logger.error('ROLLBACK failed', {label: 'DB', err: rollErr?.message, stack: rollErr?.stack});
    }
    throw e;
  } finally {
    client.release();
  }
}
