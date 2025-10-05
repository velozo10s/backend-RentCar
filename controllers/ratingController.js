// controllers/ratingController.js
import logger from '../utils/logger.js';
import {
  ensureReservationEligibleForRatingQuery,
  findExistingRatingQuery,
  insertRatingCommand,
  getReservationRatingsQuery,
  getCompanyStatsQuery,
  getCustomerStatsQuery
} from '../services/ratingService.js';

const LOG_LABEL = 'RatingsController';

export async function createRating(req, res) {
  logger.info(`Ingresa a createRating.`, {label: LOG_LABEL});

  // Log de parámetros crudos
  logger.info(`Parámetros recibidos: ${JSON.stringify({
    params: req.params,
    query: req.query,
    body: req.body,
    user: {id: req.user?.id, role: req.user?.role}
  })}`, {label: LOG_LABEL});

  const reservationIdRaw = req.params.reservationId;
  const reservationId = Number(reservationIdRaw);
  if (!Number.isInteger(reservationId)) {
    logger.warn(`reservationId inválido: ${reservationIdRaw}`, {label: LOG_LABEL});
    return res.status(400).json({localKey: 'ratings.validation.invalid_id', message: 'Invalid reservationId'});
  }

  const {direction, score, comment} = req.body || {};
  const userId = req.user?.id;
  const role = req.user?.role;

  // Validación básica
  if (!direction || !['customer_to_company', 'employee_to_customer'].includes(direction)) {
    logger.warn(`Dirección inválida: ${direction}`, {label: LOG_LABEL});
    return res.status(400).json({localKey: 'ratings.validation.direction', message: 'Invalid direction'});
  }
  if (!(Number.isInteger(score) && score >= 1 && score <= 5)) {
    logger.warn(`Score inválido: ${score}`, {label: LOG_LABEL});
    return res.status(400).json({localKey: 'ratings.validation.score', message: 'Invalid score (1..5)'});
  }

  // Payload normalizado (para trazabilidad)
  logger.info(`Payload normalizado: ${JSON.stringify({
    reservationId,
    direction,
    score,
    commentLen: typeof comment === 'string' ? comment.length : null,
    rater_user_id: userId
  })}`, {label: LOG_LABEL});

  try {
    // 1) Info esencial de reserva
    logger.info(`Consultando ensureReservationEligibleForRatingQuery(reservationId=${reservationId})`, {label: LOG_LABEL});
    const reservation = await ensureReservationEligibleForRatingQuery(reservationId);
    logger.info(`Resultado reserva: ${JSON.stringify({
      found: Boolean(reservation),
      status: reservation?.status,
      end_at: reservation?.end_at,
      customer_user_id: reservation?.customer_user_id
    })}`, {label: LOG_LABEL});

    if (!reservation) {
      logger.warn(`Reserva no encontrada (id=${reservationId})`, {label: LOG_LABEL});
      return res.status(404).json({localKey: 'reservations.not_found', message: 'Reservation not found'});
    }
    if (!(reservation.status === 'completed' && reservation.end_at <= new Date())) {
      logger.warn(`Reserva no elegible para calificación`, {
        label: LOG_LABEL,
        status: reservation.status,
        end_at: reservation.end_at
      });
      return res.status(400).json({
        localKey: 'ratings.validation.not_eligible',
        message: 'Reservation is not eligible for rating (must be completed and ended).'
      });
    }

    // 2) Autorización por dirección
    if (direction === 'customer_to_company') {
      const isOwner = reservation.customer_user_id === userId;
      logger.info(`Auth customer_to_company: isOwner=${isOwner}`, {label: LOG_LABEL});
      if (!isOwner) {
        return res.status(403).json({localKey: 'ratings.forbidden.customer', message: 'Not your reservation'});
      }
    } else {
      // employee_to_customer
      const isStaff = role === 'employee' || role === 'admin'; // (log sólo; no cambia tu contrato)
      logger.info(`Auth employee_to_customer: role=${role}, isStaff=${isStaff}`, {label: LOG_LABEL});
      if (!isStaff) {
        return res.status(403).json({localKey: 'ratings.forbidden.staff', message: 'Backoffice only'});
      }
    }

    // 3) Verificar existencia previa
    logger.info(`Buscando rating existente (reservationId=${reservationId}, direction=${direction})`, {label: LOG_LABEL});
    const already = await findExistingRatingQuery(reservationId, direction);
    logger.info(`Rating existente: ${JSON.stringify({
      found: Boolean(already),
      id: already?.id
    })}`, {label: LOG_LABEL});

    if (already) {
      return res.status(409).json({
        localKey: 'ratings.conflict.already_exists',
        message: 'A rating for this reservation and direction already exists.'
      });
    }

    // 4) ratee_user_id por dirección
    let rateeUserId = null;
    if (direction === 'employee_to_customer') rateeUserId = reservation.customer_user_id;

    // 5) Insertar calificación
    logger.info(`Insertando rating...`, {
      label: LOG_LABEL,
      payload: {reservation_id: reservationId, direction, rater_user_id: userId, ratee_user_id: rateeUserId, score}
    });
    const created = await insertRatingCommand({
      reservation_id: reservationId,
      direction,
      rater_user_id: userId,
      ratee_user_id: rateeUserId,
      score,
      comment: comment ?? null
    });

    logger.info(`✅ Rating creado: ${JSON.stringify({
      id: created.id,
      reservation_id: created.reservation_id,
      direction: created.direction,
      score: created.score
    })}`, {label: LOG_LABEL});

    return res.status(201).json(created);
  } catch (err) {
    const code = err?.code || '';
    if (code === '409' || (err?.message || '').toLowerCase().includes('unique')) {
      logger.warn(`Conflicto de unicidad al crear rating: ${err.message}`, {label: LOG_LABEL});
      return res.status(409).json({
        localKey: 'ratings.conflict.already_exists',
        message: 'A rating for this reservation and direction already exists.'
      });
    }
    logger.error(`createRating error: ${err.message}`, {label: LOG_LABEL, by: req.user?.id});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  } finally {
    logger.info(`Finaliza createRating.`, {label: LOG_LABEL});
  }
}

export async function getReservationRatings(req, res) {
  const LOG_LABEL = 'RatingsController';
  logger.info(`Ingresa a getReservationRatings.`, {label: LOG_LABEL});

  const reservationIdRaw = req.params.reservationId;
  const reservationId = Number(reservationIdRaw);

  // Log de parámetros crudos (incluye query.direction)
  logger.info(`Parámetros recibidos: ${JSON.stringify({
    params: req.params,
    query: req.query,
    user: {id: req.user?.id, role: req.user?.role}
  })}`, {label: LOG_LABEL});

  if (!Number.isInteger(reservationId)) {
    logger.warn(`reservationId inválido: ${reservationIdRaw}`, {label: LOG_LABEL});
    return res.status(400).json({localKey: 'ratings.validation.invalid_id', message: 'Invalid reservationId'});
  }

  // ✅ Validar y normalizar direction (opcional)
  let direction = req.query?.direction;
  if (direction != null) {
    direction = String(direction);
    const allowed = ['customer_to_company', 'employee_to_customer'];
    if (!allowed.includes(direction)) {
      logger.warn(`direction inválido en query: ${direction}`, {label: LOG_LABEL});
      return res.status(400).json({localKey: 'ratings.validation.direction', message: 'Invalid direction'});
    }
  } else {
    direction = null; // sin filtro → devuelve todas
  }

  try {
    logger.info(`Ejecutando getReservationRatingsQuery(reservationId=${reservationId}, direction=${direction || 'ALL'})`, {label: LOG_LABEL});
    const rows = await getReservationRatingsQuery(reservationId, {direction});
    logger.info(`${rows.length ? 'Ratings encontrados' : 'Sin ratings'}: count=${rows.length}`, {label: LOG_LABEL});
    return res.json(rows); // [] si no hay
  } catch (err) {
    logger.error(`getReservationRatings error: ${err.message}`, {label: LOG_LABEL, by: req.user?.id});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  } finally {
    logger.info(`Finaliza getReservationRatings.`, {label: LOG_LABEL});
  }
}

export async function getCompanyStats(_req, res) {
  logger.info(`Ingresa a getCompanyStats.`, {label: LOG_LABEL});
  try {
    const stats = await getCompanyStatsQuery();
    logger.info(`Stats compañía: ${JSON.stringify(stats)}`, {label: LOG_LABEL});
    return res.json(stats);
  } catch (err) {
    logger.error(`getCompanyStats error: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  } finally {
    logger.info(`Finaliza getCompanyStats.`, {label: LOG_LABEL});
  }
}

export async function getCustomerStats(req, res) {
  logger.info(`Ingresa a getCustomerStats.`, {label: LOG_LABEL});
  logger.info(`Parámetros recibidos: ${JSON.stringify({params: req.params})}`, {label: LOG_LABEL});

  const userIdRaw = req.params.userId;
  const userId = Number(userIdRaw);
  if (!Number.isInteger(userId)) {
    logger.warn(`userId inválido: ${userIdRaw}`, {label: LOG_LABEL});
    return res.status(400).json({localKey: 'ratings.validation.invalid_user', message: 'Invalid userId'});
  }
  try {
    const stats = await getCustomerStatsQuery(userId);
    logger.info(`Stats cliente(${userId}): ${JSON.stringify(stats)}`, {label: LOG_LABEL});
    return res.json(stats);
  } catch (err) {
    logger.error(`getCustomerStats error: ${err.message}`, {label: LOG_LABEL, for: userId});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  } finally {
    logger.info(`Finaliza getCustomerStats.`, {label: LOG_LABEL});
  }
}
