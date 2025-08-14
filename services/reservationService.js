// services/reservationService.js
import pool from '../config/db.js';
import logger from '../utils/logger.js';

const logLabel = 'ReservationService';

/* ------------------------- read helpers ------------------------- */

export async function fetchVehiclesByIds(clientOrPool, vehicleIds) {
  logger.info(`🚗 Buscando vehículos por IDs: ${vehicleIds.join(', ')}`, {label: logLabel, total: vehicleIds.length});
  const {rows} = await clientOrPool.query(
    `SELECT id, price_per_hour, price_per_day, is_active, status
     FROM vehicle.vehicles
     WHERE id = ANY ($1::int[])`,
    [vehicleIds]
  );
  logger.info(`✅ Vehículos encontrados: ${rows.length}`, {label: logLabel});
  return rows;
}

export async function findConflictsQuery(clientOrPool, vehicleIds, startISO, endISO, blockingStatuses = ['confirmed', 'active'], {limitOne = false} = {}) {
  logger.info(`🔍 Verificando conflictos de reserva para vehículos: ${vehicleIds.join(', ')}`, {
    label: logLabel,
    rango: `${startISO} → ${endISO}`,
    estados: blockingStatuses
  });
  const limit = limitOne ? 'LIMIT 1' : '';
  const {rows} = await clientOrPool.query(
    `
        SELECT ri.vehicle_id, r.id AS conflicting_reservation_id
        FROM reservation.reservation_items ri
                 JOIN reservation.reservations r ON r.id = ri.reservation_id
        WHERE ri.vehicle_id = ANY ($1::int[])
          AND r.status = ANY ($4::text[])
          AND tstzrange(r.start_at, r.end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
            ${limit};
    `,
    [vehicleIds, startISO, endISO, blockingStatuses]
  );
  logger.info(`⚠️ Conflictos detectados: ${rows.length}`, {label: logLabel});
  return rows;
}

export async function insertReservation(client, {customerUserId, startAt, endAt, note, total}) {
  logger.info(`📝 Insertando nueva reserva para usuario: ${customerUserId}`, {
    label: logLabel,
    periodo: `${startAt} → ${endAt}`,
    total
  });
  const {rows} = await client.query(
    `INSERT INTO reservation.reservations
         (customer_user_id, start_at, end_at, status, note, total_amount)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING id`,
    [customerUserId, startAt, endAt, note ?? null, total]
  );
  logger.info(`✅ Reserva creada con ID: ${rows[0].id}`, {label: logLabel});
  return rows[0].id;
}

export async function insertReservationItems(client, reservationId, vehicleIds, lineAmounts) {
  logger.info(`📦 Insertando items para reserva ID: ${reservationId}`, {
    label: logLabel,
    totalVehiculos: vehicleIds.length
  });
  const vids = [];
  const amts = [];
  for (const vid of vehicleIds) {
    vids.push(vid);
    amts.push(lineAmounts[vid]);
  }
  await client.query(
    `
        INSERT INTO reservation.reservation_items (reservation_id, vehicle_id, line_amount)
        SELECT $1::int, vid, amt
        FROM UNNEST($2::int[], $3::numeric[]) AS t(vid, amt)
    `,
    [reservationId, vids, amts]
  );
  logger.info(`✅ Items insertados correctamente para la reserva ${reservationId}`, {label: logLabel});
}

export async function getReservationWithItems(clientOrPool, reservationId) {
  logger.info(`🔍 Obteniendo reserva con sus items. ID: ${reservationId}`, {label: logLabel});
  const {rows} = await clientOrPool.query(
    `SELECT r.*, jsonb_agg(jsonb_build_object('vehicle_id', ri.vehicle_id, 'line_amount', ri.line_amount)) AS items
     FROM reservation.reservations r
              JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
     WHERE r.id = $1
     GROUP BY r.id`,
    [reservationId]
  );
  logger.info(`✅ Reserva encontrada: ${!!rows[0]}`, {label: logLabel});
  return rows[0];
}

export async function listReservationsByCustomer(clientOrPool, customerUserId, status) {
  logger.info(`📋 Listando reservas para usuario ${customerUserId} con estado: ${status}`, {label: logLabel});
  const params = [customerUserId];
  let where = `r.customer_user_id = $1`;
  if (status !== 'all') {
    params.push(status);
    where += ` AND r.status = $2`;
  }

  const {rows} = await clientOrPool.query(
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
  logger.info(`✅ Total reservas encontradas: ${rows.length}`, {label: logLabel});
  return rows;
}

export async function getReservationByIdWithUser(clientOrPool, id) {
  logger.info(`🔍 Obteniendo reserva con datos de usuario. ID: ${id}`, {label: logLabel});
  const {rows} = await clientOrPool.query(
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
  logger.info(`✅ Reserva obtenida con datos de usuario: ${rows.length > 0}`, {label: logLabel});
  return rows;
}

export async function lockReservationForUpdate(client, id) {
  logger.info(`🔒 Bloqueando reserva para actualización. ID: ${id}`, {label: logLabel});
  const {rows} = await client.query(
    `SELECT *
     FROM reservation.reservations
     WHERE id = $1 FOR UPDATE`,
    [id]
  );
  logger.info(`✅ Reserva bloqueada`, {label: logLabel});
  return rows;
}

export async function getReservationItems(client, reservationId) {
  logger.info(`📦 Obteniendo items de la reserva ${reservationId}`, {label: logLabel});
  const {rows} = await client.query(
    `SELECT vehicle_id, line_amount
     FROM reservation.reservation_items
     WHERE reservation_id = $1`,
    [reservationId]
  );
  logger.info(`✅ Items encontrados: ${rows.length}`, {label: logLabel});
  return rows;
}

export async function updateReservationStatus(client, id, nextStatus) {
  logger.info(`🔄 Actualizando estado de la reserva ${id} → ${nextStatus}`, {label: logLabel});
  const {rows} = await client.query(
    `UPDATE reservation.reservations
     SET status     = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, nextStatus]
  );
  logger.info(`✅ Estado actualizado correctamente`, {label: logLabel});
  return rows[0];
}

export async function setVehiclesStatusByReservation(client, reservationId, newStatus) {
  logger.info(`🚗 Cambiando estado de vehículos asociados a reserva ${reservationId} → ${newStatus}`, {label: logLabel});
  await client.query(
    `UPDATE vehicle.vehicles v
     SET status     = $2,
         updated_at = NOW()
     FROM reservation.reservation_items ri
     WHERE ri.reservation_id = $1
       AND ri.vehicle_id = v.id`,
    [reservationId, newStatus]
  );
  logger.info(`✅ Estado de vehículos actualizado`, {label: logLabel});
}

/* Convenience: non-tx access to pool */
export const db = {
  query: (...args) => pool.query(...args),
};
