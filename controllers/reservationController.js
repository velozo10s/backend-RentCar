import pool from '../config/db.js'; // <- adjust to your pool export
import {DateTime} from 'luxon';

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

/**
 * Checks if any of the vehicles have an overlapping reservation
 * in blocking statuses.
 * Returns: array of { vehicle_id, conflicting_reservation_id } if conflicts exist.
 */
async function findConflicts(client, vehicleIds, startISO, endISO, {blockingStatuses = ['confirmed', 'active']} = {}) {
  if (vehicleIds.length === 0) return [];
  const query = `
      SELECT ri.vehicle_id, r.id AS conflicting_reservation_id
      FROM reservation.reservation_items ri
               JOIN reservation.reservations r ON r.id = ri.reservation_id
      WHERE ri.vehicle_id = ANY ($1::int[])
        AND r.status = ANY ($4::text[])
        AND tstzrange(r.start_at, r.end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      LIMIT 1; -- one is enough to fail
  `;
  const {rows} = await client.query(query, [vehicleIds, startISO, endISO, blockingStatuses]);
  return rows;
}

/* ------------------------- controllers ------------------------- */

/**
 * POST /api/reservations
 * Body: { startAt, endAt, vehicleIds: number[], note? }
 */
export async function createReservation(req, res) {
  const {startAt, endAt, vehicleIds, note} = req.body || {};
  const customerUserId = req.user?.id;

  if (!customerUserId) return res.status(401).json({message: 'Unauthorized'});
  if (!startAt || !endAt || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
    return res.status(400).json({message: 'startAt, endAt, vehicleIds are required'});
  }

  try {
    // Quick sanity check now; final check will happen on confirm/activate
    if (parseISO(endAt) <= parseISO(startAt)) {
      return res.status(400).json({message: 'endAt must be after startAt'});
    }

    await withTransaction(async (client) => {
      // fetch vehicles
      const {rows: vehicles} = await client.query(
        `SELECT id, price_per_hour, price_per_day, is_active, status
         FROM vehicle.vehicles
         WHERE id = ANY ($1::int[])`,
        [vehicleIds]
      );

      if (vehicles.length !== vehicleIds.length) {
        return res.status(404).json({message: 'One or more vehicles not found'});
      }
      const inactive = vehicles.find(v => !v.is_active);
      if (inactive) return res.status(409).json({message: `Vehicle ${inactive.id} is inactive`});

      // Optional: at creation time also avoid overlaps with confirmed/active for better UX
      const conflicts = await findConflicts(client, vehicleIds, startAt, endAt, {blockingStatuses: ['confirmed', 'active']});
      if (conflicts.length) {
        return res.status(409).json({
          message: 'One or more vehicles are not available',
          detail: conflicts[0]
        });
      }

      // compute pricing
      let total = 0;
      const lineAmounts = {};
      for (const v of vehicles) {
        const amount = computeLineAmount(v, startAt, endAt);
        lineAmounts[v.id] = amount;
        total += amount;
      }

      // insert reservation (status: pending)
      const insertRes = await client.query(
        `INSERT INTO reservation.reservations
             (customer_user_id, start_at, end_at, status, note, total_amount)
         VALUES ($1, $2, $3, 'pending', $4, $5)
         RETURNING id`,
        [customerUserId, startAt, endAt, note ?? null, total]
      );

      const reservationId = insertRes.rows[0].id;

      // insert items
      const vids = [];
      const amounts = [];
      for (const vid of vehicleIds) {
        vids.push(vid);
        amounts.push(lineAmounts[vid]);
      }
      await client.query(
        `
            INSERT INTO reservation.reservation_items (reservation_id, vehicle_id, line_amount)
            SELECT $1::int, vid, amt
            FROM UNNEST($2::int[], $3::numeric[]) AS t(vid, amt)
        `,
        [reservationId, vids, amounts]
      );

      const {rows: created} = await client.query(
        `SELECT r.*, jsonb_agg(jsonb_build_object('vehicle_id', ri.vehicle_id, 'line_amount', ri.line_amount)) AS items
         FROM reservation.reservations r
                  JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
         WHERE r.id = $1
         GROUP BY r.id`,
        [reservationId]
      );

      return res.status(201).json(created[0]);
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({message: 'Internal error'});
  }
}

/**
 * GET /api/reservations?status=...
 * Lists reservations of the authenticated customer.
 */
export async function listMyReservations(req, res) {
  const customerUserId = req.user?.id;
  if (!customerUserId) return res.status(401).json({message: 'Unauthorized'});

  const status = (req.query.status || 'all').toString();
  const allowed = ['pending', 'confirmed', 'active', 'completed', 'declined', 'cancelled', 'all'];
  if (!allowed.includes(status)) return res.status(400).json({message: 'Invalid status'});

  try {
    const params = [customerUserId];
    let where = `r.customer_user_id = $1`;
    if (status !== 'all') {
      params.push(status);
      where += ` AND r.status = $2`;
    }

    const {rows} = await pool.query(
      `SELECT r.*,
              COALESCE(jsonb_agg(
                       jsonb_build_object('vehicle_id', ri.vehicle_id, 'line_amount', ri.line_amount)
                                ) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items
       FROM reservation.reservations r
                LEFT JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
       WHERE ${where}
       GROUP BY r.id, r.created_at
       ORDER BY r.created_at DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({message: 'Internal error'});
  }
}

/**
 * GET /api/reservations/:id
 * Authenticated users can see their own reservation. Employees/admins can see all.
 */
export async function getReservationById(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({message: 'Invalid id'});

  try {
    const {rows} = await pool.query(
      `SELECT r.*,
              COALESCE(jsonb_agg(
                       jsonb_build_object('vehicle_id', ri.vehicle_id, 'line_amount', ri.line_amount)
                                ) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items,
              u.username                                                  AS customer_username,
              u.email                                                     AS customer_email
       FROM reservation.reservations r
                LEFT JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
                JOIN "user".users u ON u.id = r.customer_user_id
       WHERE r.id = $1
       GROUP BY r.id, u.username, u.email`,
      [id]
    );
    if (!rows.length) return res.status(404).json({message: 'Not found'});

    const r = rows[0];
    const isOwner = r.customer_user_id === req.user?.id;
    const isStaff = Array.isArray(req.user?.roles) && req.user.roles.some(r => r === 'employee' || r === 'admin');
    if (!isOwner && !isStaff) return res.status(403).json({message: 'Forbidden'});

    return res.json(r);
  } catch (err) {
    console.error(err);
    return res.status(500).json({message: 'Internal error'});
  }
}

/**
 * PATCH /api/reservations/:id/cancel
 * Only the owner can cancel, and only before start time.
 */
export async function cancelReservation(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({message: 'Invalid id'});

  try {
    await withTransaction(async (client) => {
      const {rows} = await client.query(`SELECT *
                                         FROM reservation.reservations
                                         WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows.length) return res.status(404).json({message: 'Not found'});

      const r = rows[0];
      if (r.customer_user_id !== req.user?.id) return res.status(403).json({message: 'Not your reservation'});

      if (['cancelled', 'declined', 'completed'].includes(r.status)) {
        return res.status(400).json({message: `Cannot cancel a ${r.status} reservation`});
      }

      if (DateTime.fromJSDate(r.start_at) <= DateTime.now()) {
        return res.status(400).json({message: 'Cannot cancel after start time'});
      }

      const {rows: updated} = await client.query(
        `UPDATE reservation.reservations
         SET status     = 'cancelled',
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      return res.json(updated[0]);
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({message: 'Internal error'});
  }
}

/**
 * Staff actions below: confirm / decline / activate / complete
 * All run inside transactions and re-check conflicts where relevant.
 */

export async function confirmReservation(req, res) {
  await staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'confirmed',
    checkAvailability: true,
    blockingStatuses: ['confirmed', 'active'] // block against these
  });
}

export async function declineReservation(req, res) {
  await staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'declined',
    checkAvailability: false
  });
}

export async function activateReservation(req, res) {
  await staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'active',
    checkAvailability: true,
    blockingStatuses: ['confirmed', 'active'] // at pick-up time, avoid double assignment
  });
}

export async function completeReservation(req, res) {
  await staffChangeStatusWithAvailability(req, res, {
    nextStatus: 'completed',
    checkAvailability: false
  });
}

/* ------------------------- shared staff helper ------------------------- */

async function staffChangeStatusWithAvailability(req, res, {nextStatus, checkAvailability, blockingStatuses = []}) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({message: 'Invalid id'});

  try {
    await withTransaction(async (client) => {
      // lock the reservation
      const {rows} = await client.query(
        `SELECT *
         FROM reservation.reservations
         WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!rows.length) return res.status(404).json({message: 'Not found'});
      const r = rows[0];

      // allowed transitions
      const allowedFrom = {
        confirmed: ['pending'],
        declined: ['pending'],
        active: ['confirmed'],
        completed: ['active']
      }[nextStatus] || [];

      if (!allowedFrom.includes(r.status)) {
        return res.status(400).json({message: `Cannot move from ${r.status} to ${nextStatus}`});
      }

      // fetch items
      const {rows: items} = await client.query(
        `SELECT vehicle_id, line_amount
         FROM reservation.reservation_items
         WHERE reservation_id = $1`,
        [id]
      );
      const vehicleIds = items.map(i => i.vehicle_id);

      if (checkAvailability) {
        const conflicts = await findConflicts(client, vehicleIds, r.start_at, r.end_at, {blockingStatuses});
        if (conflicts.length) {
          return res.status(409).json({
            message: 'Vehicle no longer available',
            detail: conflicts[0]
          });
        }
      }

      // status update
      const {rows: updated} = await client.query(
        `UPDATE reservation.reservations
         SET status     = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, nextStatus]
      );

      // Optional: when activating, you could also flip vehicle.status to 'in use'
      if (nextStatus === 'active') {
        await client.query(
          `UPDATE vehicle.vehicles v
           SET status     = 'in use',
               updated_at = NOW()
           FROM reservation.reservation_items ri
           WHERE ri.reservation_id = $1
             AND ri.vehicle_id = v.id`,
          [id]
        );
      }

      // Optional: when completed, flip vehicles back to 'available'
      if (nextStatus === 'completed') {
        await client.query(
          `UPDATE vehicle.vehicles v
           SET status     = 'available',
               updated_at = NOW()
           FROM reservation.reservation_items ri
           WHERE ri.reservation_id = $1
             AND ri.vehicle_id = v.id`,
          [id]
        );
      }

      return res.json({
        ...updated[0],
        items
      });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({message: 'Internal error'});
  }
}

/* ------------------------- tx helper ------------------------- */

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    // controller might have already sent a response; only commit if it didn't early-return
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    throw e;
  } finally {
    client.release();
  }
}
