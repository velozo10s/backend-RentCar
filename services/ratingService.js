// services/ratingService.js
import pool from '../config/db.js';
import logger from "../utils/logger.js";

const LOG_LABEL = 'RatingService';

export async function ensureReservationEligibleForRatingQuery(reservationId) {
  const sql = `
      SELECT id, customer_user_id, status, end_at
      FROM reservation.reservations
      WHERE id = $1
  `;
  const params = [reservationId];

  logger.info(`🛠 ensureReservationEligibleForRatingQuery WHERE: id = $1`, {
    label: LOG_LABEL, params
  });

  try {
    const {rows} = await pool.query(sql, params);
    logger.info(`${rows[0] ? '✅ Reserva encontrada' : '⚠️ Reserva no encontrada'}`, {
      label: LOG_LABEL, reservationId, row: rows[0] || null
    });
    return rows[0] || null;
  } catch (err) {
    logger.error(`❌ ensureReservationEligibleForRatingQuery error: ${err.message}`, {label: LOG_LABEL, reservationId});
    throw err;
  }
}

/** Devuelve rating existente para (reservation, direction) o null */
export async function findExistingRatingQuery(reservationId, direction) {
  const sql = `
      SELECT id, reservation_id, direction
      FROM reservation.ratings
      WHERE reservation_id = $1
        AND direction = $2
      LIMIT 1
  `;
  const params = [reservationId, direction];

  logger.info(`🛠 findExistingRatingQuery WHERE: reservation_id=$1 AND direction=$2`, {
    label: LOG_LABEL, params
  });

  try {
    const {rows} = await pool.query(sql, params);
    logger.info(`${rows[0] ? '✅ Rating existente' : 'ℹ️ No existe rating previo'}`, {
      label: LOG_LABEL, found: Boolean(rows[0]), id: rows[0]?.id || null
    });
    return rows[0] || null;
  } catch (err) {
    logger.error(`❌ findExistingRatingQuery error: ${err.message}`, {label: LOG_LABEL, reservationId, direction});
    throw err;
  }
}

export async function insertRatingCommand({reservation_id, direction, rater_user_id, ratee_user_id, score, comment}) {
  const sql = `
      INSERT INTO reservation.ratings
      (reservation_id, direction, rater_user_id, ratee_user_id, score, comment)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, reservation_id, direction, rater_user_id, ratee_user_id, score, comment, created_at, updated_at
  `;
  const params = [reservation_id, direction, rater_user_id, ratee_user_id, score, comment];

  logger.info(`🛠 insertRatingCommand PARAMS: ${JSON.stringify({
    reservation_id, direction, rater_user_id, ratee_user_id, score, hasComment: comment != null
  })}`, {label: LOG_LABEL});

  try {
    const {rows} = await pool.query(sql, params);
    logger.info(`✅ Rating insertado: ${JSON.stringify({id: rows[0]?.id})}`, {label: LOG_LABEL});
    return rows[0];
  } catch (err) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('unique')) {
      logger.warn(`⚠️ Violación de unicidad en insertRatingCommand`, {
        label: LOG_LABEL, reservation_id, direction
      });
      const e = new Error('ratings_unique_violation');
      e.code = '409';
      throw e;
    }
    logger.error(`❌ insertRatingCommand error: ${err.message}`, {
      label: LOG_LABEL, reservation_id, direction
    });
    throw err;
  }
}

export async function getReservationRatingsQuery(reservationId, opts = {}) {
  const LOG_LABEL = 'RatingService';
  const {direction = null} = opts;

  const where = ['r.reservation_id = $1'];
  const params = [reservationId];

  if (direction) {
    where.push('r.direction = $2');
    params.push(direction);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const sql = `
      SELECT r.id,
             r.reservation_id,
             r.direction,
             r.rater_user_id,
             r.ratee_user_id,
             r.score,
             r.comment,
             r.created_at,
             r.updated_at
      FROM reservation.ratings r
          ${whereSql}
      ORDER BY r.created_at ASC
  `;

  logger.info(`🛠 getReservationRatingsQuery WHERE: ${whereSql}`, {label: LOG_LABEL, params});

  try {
    const {rows} = await pool.query(sql, params);
    logger.info(`${rows.length ? '✅ Ratings encontrados' : 'ℹ️ Sin ratings'} (count=${rows.length})`, {
      label: LOG_LABEL, reservationId, direction: direction || 'ALL'
    });
    return rows;
  } catch (err) {
    logger.error(`❌ getReservationRatingsQuery error: ${err.message}`, {label: LOG_LABEL, reservationId, direction});
    throw err;
  }
}

/** Stats globales (vista) */
export async function getCompanyStatsQuery() {
  const sql = `
      SELECT COALESCE(ratings_count, 0)             AS ratings_count,
             COALESCE(rating_avg, 0)::numeric(3, 2) AS rating_avg
      FROM reservation.company_experience_stats
  `;

  logger.info(`🛠 getCompanyStatsQuery (vista: company_experience_stats)`, {label: LOG_LABEL});

  try {
    const {rows} = await pool.query(sql);
    const out = rows[0] || {ratings_count: 0, rating_avg: 0};
    logger.info(`📊 Stats compañía: ${JSON.stringify(out)}`, {label: LOG_LABEL});
    return out;
  } catch (err) {
    logger.error(`❌ getCompanyStatsQuery error: ${err.message}`, {label: LOG_LABEL});
    throw err;
  }
}

/** Stats por cliente (vista) */
export async function getCustomerStatsQuery(customerUserId) {
  const sql = `
      SELECT COALESCE(ratings_count, 0)             AS ratings_count,
             COALESCE(rating_avg, 0)::numeric(3, 2) AS rating_avg
      FROM reservation.customer_rating_stats
      WHERE customer_user_id = $1
  `;
  const params = [customerUserId];

  logger.info(`🛠 getCustomerStatsQuery WHERE: customer_user_id=$1`, {
    label: LOG_LABEL, params
  });

  try {
    const {rows} = await pool.query(sql, params);
    const out = rows[0] || {ratings_count: 0, rating_avg: 0};
    logger.info(`📊 Stats cliente(${customerUserId}): ${JSON.stringify(out)}`, {label: LOG_LABEL});
    return out;
  } catch (err) {
    logger.error(`❌ getCustomerStatsQuery error: ${err.message}`, {label: LOG_LABEL, customerUserId});
    throw err;
  }
}
