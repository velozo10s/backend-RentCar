// services/reservationService.js
import pool from '../config/db.js';
import logger from '../utils/logger.js';

const logLabel = 'ReservationService';

/* ------------------------- read helpers ------------------------- */

export async function fetchVehiclesByIds(clientOrPool, vehicleIds) {
  logger.info(`🚗 Buscando vehículos por IDs: ${vehicleIds.join(', ')}`, {label: logLabel, total: vehicleIds.length});
  try {
    const res = await clientOrPool.query(
      `SELECT id, price_per_hour, price_per_day, is_active, status
       FROM vehicle.vehicles
       WHERE id = ANY ($1::int[])`,
      [vehicleIds]
    );

    if (res.rows.length > 0) {

      logger.info(`✅ Vehículos encontrados: ${JSON.stringify(res.rows)}`, {label: logLabel});

      return res.rows;
    } else {
      logger.info(`⚠️ Uno o mas vehiculos no fueron encontrados.`, {label: logLabel});
      return {
        error: 'Uno o mas vehiculos no fueron encontrados.',
        details: {vehicleIds: vehicleIds}
      };
    }
  } catch (error) {
    logger.error(`❌ Error en el fetchVehiclesByIds: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function findConflictsQuery(clientOrPool, vehicleIds, startISO, endISO, blockingStatuses = ['confirmed', 'active'], {limitOne = false} = {}) {
  logger.info(`🔍 Verificando conflictos de reserva para vehículos: ${vehicleIds}`, {
    label: logLabel,
    rango: `${startISO} → ${endISO}`,
    estados: blockingStatuses
  });

  try {
    const limit = limitOne ? 'LIMIT 1' : '';
    const res = await clientOrPool.query(
      `
          SELECT r.id,
                 r.created_at,
                 COALESCE(
                                 jsonb_agg(
                                 jsonb_build_object(
                                         'vehicle_id', ri.vehicle_id
                                 )
                                          ) FILTER (WHERE ri.id IS NOT NULL),
                                 '[]'
                 ) AS items
          FROM reservation.reservations r
                   LEFT JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
          WHERE ri.vehicle_id = ANY ($1::int[])
            AND r.status = ANY ($4::text[])
            AND tstzrange(r.start_at, r.end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
          GROUP BY r.id,
                   r.created_at
                       ${limit}
      `,
      [vehicleIds, startISO, endISO, blockingStatuses]
    );

    if (res.rows.length > 0) {

      logger.info(`⚠️ Conflictos detectados: ${JSON.stringify(res.rows)}`, {label: logLabel});

      return {
        error: 'Ya existe una reserva aprobada para los vehiculos recibidos.',
        details: {reservation: res.rows},
      };
    } else {
      logger.info(`✅  No se han encontrado conflictos.`, {label: logLabel});
      return {};
    }
  } catch (error) {
    logger.error(`❌ Error en el findConflictsQuery: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function insertReservation(client, {customerUserId, startAt, endAt, note, total}) {
  logger.info(`📝 Insertando nueva reserva para usuario: ${customerUserId}`, {
    label: logLabel,
    periodo: `${startAt} → ${endAt}`,
    total
  });

  try {
    const res = await client.query(
      `INSERT INTO reservation.reservations
           (customer_user_id, start_at, end_at, status, note, total_amount)
       VALUES ($1, $2, $3, 'pending', $4, $5)
       RETURNING id`,
      [customerUserId, startAt, endAt, note ?? null, total]
    );

    if (res.rows.length > 0) {

      logger.info(`✅ Reserva creada con ID: ${res.rows[0].id}`, {label: logLabel});

      return res.rows[0].id;
    } else {
      logger.info(`⚠️ No se ha podido insertar la reserva, reintente.`, {label: logLabel});
      return {
        error: 'No se ha podido insertar la reserva, reintente.'
      };
    }
  } catch (error) {
    logger.error(`❌ Error en el insertReservation: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }

}

export async function insertReservationItems(client, reservationId, vehicleIds, lineAmounts) {
  logger.info(`📦 Insertando items para reserva ID: ${reservationId}`, {
    label: logLabel,
    totalVehiculos: vehicleIds.length
  });
  try {
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
  } catch (error) {
    logger.error(`❌ Error en el insertReservationItems: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function getReservationWithItems(clientOrPool, reservationId) {
  logger.info(`🔍 Obteniendo reserva con sus items. ID: ${reservationId}`, {label: logLabel});

  try {
    const res = await clientOrPool.query(
      `SELECT r.*, jsonb_agg(jsonb_build_object('vehicle_id', ri.vehicle_id, 'line_amount', ri.line_amount)) AS items
       FROM reservation.reservations r
                JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
       WHERE r.id = $1
       GROUP BY r.id`,
      [reservationId]
    );

    if (res.rows.length > 0) {

      logger.info(`✅ Reserva encontrada: ${!!res.rows[0]}`, {label: logLabel});

      return res.rows[0];
    } else {
      logger.info(`⚠️ No se ha podido encontrar la reserva generada.`, {label: logLabel});
      return {
        error: 'No se ha podido encontrar la reserva generada.'
      };
    }
  } catch (error) {
    logger.error(`❌ Error en el getReservationWithItems: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function listReservations(clientOrPool, {status, customerUserId, limit = 50, offset = 0}) {
  logger.info(`📋 Listando reservas (status=${status}, customer=${customerUserId ?? 'ALL'}, limit=${limit}, offset=${offset})`, {
    label: logLabel,
  });

  const params = [];
  const whereParts = [];

  if (typeof customerUserId === 'number') {
    params.push(customerUserId);
    whereParts.push(`r.customer_user_id = $${params.length}`);
  }

  if (status !== 'all') {
    params.push(status);
    whereParts.push(`r.status = $${params.length}`);
  }

  // armamos WHERE seguro
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  // paginación
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  try {
    const sql = `
        SELECT r.*,
               COALESCE(
                               jsonb_agg(
                               jsonb_build_object(
                                       'vehicle_id', ri.vehicle_id,
                                       'line_amount', ri.line_amount
                               )
                                        ) FILTER (WHERE ri.id IS NOT NULL),
                               '[]'
               ) AS items
        FROM reservation.reservations r
                 LEFT JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
            ${where}
        GROUP BY r.id, r.created_at
        ORDER BY r.created_at DESC
        LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const res = await clientOrPool.query(sql, params);

    if (res.rows.length > 0) {

      logger.info(`✅ Reservas encontradas: ${JSON.stringify(res.rows)}`, {label: logLabel});

      return res.rows;
    } else {
      logger.info(`⚠️ No se han encontrado reservas.`, {label: logLabel});
      return {
        error: 'No se han encontrado reservas.'
      };
    }

  } catch (error) {
    logger.error(`❌ Error en el listReservations: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function getReservationByIdWithUser(clientOrPool, id) {
  logger.info(`🔍 Obteniendo reserva con datos de usuario. ID: ${id}`, {label: logLabel});

  try {
    const res = await clientOrPool.query(
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

    if (res.rows.length > 0) {

      logger.info(`✅ Reserva encontrada: ${JSON.stringify(res.rows[0])}`, {label: logLabel});

      return res.rows[0];
    } else {
      logger.info(`⚠️ No se ha encontrado la reserva.`, {label: logLabel});
      return {
        error: 'No se ha encontrado la reserva.'
      };
    }

  } catch (error) {
    logger.error(`❌ Error en el getReservationByIdWithUser: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }

}

export async function lockReservationForUpdate(client, id) {
  logger.info(`🔒 Bloqueando reserva para actualización. ID: ${id}`, {label: logLabel});
  try {
    const res = await client.query(
      `SELECT *
       FROM reservation.reservations
       WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (res.rows.length > 0) {

      logger.info(`✅ Reserva encontrada: ${JSON.stringify(res.rows[0])}`, {label: logLabel});

      return res.rows[0];
    } else {
      logger.info(`⚠️ No se ha encontrado la reserva.`, {label: logLabel});
      return {
        error: 'No se ha encontrado la reserva.',
        details: {reservation_id: id}
      };
    }
  } catch (error) {
    logger.error(`❌ Error en el lockReservationForUpdate: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function getReservationItems(client, reservationId) {
  logger.info(`📦 Obteniendo items de la reserva ${reservationId}`, {label: logLabel});

  try {
    const res = await client.query(
      `SELECT vehicle_id, line_amount
       FROM reservation.reservation_items
       WHERE reservation_id = $1`,
      [reservationId]
    );

    if (res.rows.length > 0) {

      logger.info(`✅ Items encontrados: ${JSON.stringify(res.rows)}`, {label: logLabel});

      return res.rows;
    } else {
      logger.info(`⚠️ No se han encontrado los items de la reserva.`, {label: logLabel});
      return {
        error: 'No se han encontrado los items de la reserva.',
        details: {reservation_id: reservationId}
      };
    }
  } catch (error) {
    logger.error(`❌ Error en el getReservationItems: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function updateReservationStatus(client, id, nextStatus) {
  logger.info(`🔄 Actualizando estado de la reserva ${id} → ${nextStatus}`, {label: logLabel});

  try {
    const res = await client.query(
      `UPDATE reservation.reservations
       SET status     = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, nextStatus]
    );

    if (res.rows.length > 0) {

      logger.info(`✅ Estado actualizado correctamente.`, {label: logLabel});

      return res.rows[0];
    } else {
      logger.info(`⚠️ No se ha encontrado la reserva.`, {label: logLabel});
      return {
        error: 'No se ha encontrado la reserva.`',
        details: {reservation_id: id}
      };
    }
  } catch (error) {
    logger.error(`❌ Error en el updateReservationStatus: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function setVehiclesStatusByReservation(client, reservationId, newStatus) {
  logger.info(`🚗 Cambiando estado de vehículos asociados a reserva ${reservationId} → ${newStatus}`, {label: logLabel});

  try {

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

  } catch (error) {
    logger.error(`❌ Error en el setVehiclesStatusByReservation: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }

}

/* Convenience: non-tx access to pool */
export const db = {
  query: (...args) => pool.query(...args),
};
