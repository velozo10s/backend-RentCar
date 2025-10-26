import pool from '../config/db.js';
import logger from '../utils/logger.js';

const LOG_LABEL = 'ReportService';

function safePreview(obj, maxLen = 1500) {
  try {
    const s = JSON.stringify(obj);
    return s.length > maxLen ? `${s.slice(0, maxLen)}… (truncado)` : s;
  } catch {
    return '[unserializable]';
  }
}

/** Reporte de estados: groups = [{status, count, reservations:[...]}], aggregates = {byStatus:{...}} */
export async function reservationStatusReportQuery({from, to, statuses}) {
  logger.info('➡️ Ingresa a reservationStatusReportQuery', {label: LOG_LABEL});
  logger.info(`📝 Parámetros | from: ${from} | to: ${to} | statuses: ${safePreview(statuses)}`, {label: LOG_LABEL});

  const params = [];
  const where = [];
  if (from) {
    params.push(from);
    where.push(`r.start_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`r.end_at   <= $${params.length}`);
  }
  if (Array.isArray(statuses) && statuses.length) {
    params.push(statuses);
    where.push(`r.status = ANY($${params.length}::text[])`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
      SELECT r.id,
             r.customer_user_id,
             r.status,
             r.start_at,
             r.end_at,
             r.total_amount,
             r.note,
             p.first_name || ' ' || p.last_name                           AS customer_name,
             COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', ri.vehicle_id, 'line_amount', ri.line_amount))
                      FILTER (WHERE ri.reservation_id IS NOT NULL), '[]') AS items
      FROM reservation.reservations r
               LEFT JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
               LEFT JOIN "user".users u ON u.id = r.customer_user_id
               LEFT JOIN person.persons p ON p.id = u.person_id
          ${whereSql}
      GROUP BY r.id, customer_name, r.start_at
      ORDER BY r.start_at DESC
  `;

  logger.info(`🧮 Ejecutando query reservationStatusReportQuery | params: ${safePreview(params)}`, {label: LOG_LABEL});
  const {rows} = await pool.query(sql, params);
  logger.info(`✅ Filas obtenidas: ${rows.length}`, {label: LOG_LABEL});

  // Agrupar por status
  const groupsMap = new Map();
  for (const r of rows) {
    if (!groupsMap.has(r.status)) groupsMap.set(r.status, []);
    groupsMap.get(r.status).push(r);
  }
  const groups = Array.from(groupsMap.entries()).map(([status, reservations]) => ({
    status, count: reservations.length, reservations
  }));
  const aggregates = {
    byStatus: Object.fromEntries(groups.map(g => [g.status, g.count])),
    totalReservations: rows.length
  };
  logger.info(`📊 Aggregates: ${safePreview(aggregates)}`, {label: LOG_LABEL});
  return {aggregates, groups};
}

/** Reporte de ingresos mensuales: aggregates (serie 12 meses) + groups por mes con reservas completas */
export async function monthlyRevenueReportQuery({year, statuses = ['completed']}) {
  logger.info('➡️ Ingresa a monthlyRevenueReportQuery', {label: LOG_LABEL});
  logger.info(`📝 Parámetros | year: ${year} | statuses: ${safePreview(statuses)}`, {label: LOG_LABEL});

  const params = [];
  const where = [];
  if (year) {
    params.push(`${year}-01-01`, `${year}-12-31`);
    where.push(`r.start_at >= $${params.length - 1}::date`, `r.end_at <= $${params.length}::date + INTERVAL '1 day'`);
  }
  if (Array.isArray(statuses) && statuses.length) {
    params.push(statuses);
    where.push(`r.status = ANY($${params.length}::text[])`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
      SELECT DATE_TRUNC('month', r.end_at)::date AS month,
             SUM(r.total_amount)::numeric(12, 2) AS revenue,
             jsonb_agg(jsonb_build_object(
                               'id', r.id, 'customer_user_id', r.customer_user_id, 'status', r.status,
                               'start_at', r.start_at, 'end_at', r.end_at, 'total_amount', r.total_amount
                       ) ORDER BY r.end_at)      AS reservations
      FROM reservation.reservations r
          ${whereSql}
      GROUP BY month
      ORDER BY month ASC
  `;

  logger.info(`🧮 Ejecutando query monthlyRevenueReportQuery | params: ${safePreview(params)}`, {label: LOG_LABEL});
  const {rows} = await pool.query(sql, params);
  logger.info(`✅ Meses obtenidos: ${rows.length}`, {label: LOG_LABEL});

  const series = rows.map(r => ({
    month: r.month, revenue: Number(r.revenue)
  }));
  const totalRevenue = rows.reduce((acc, r) => acc + Number(r.revenue || 0), 0);

  const result = {aggregates: {series, totalRevenue}, groups: rows};
  logger.info(`📊 Aggregates: ${safePreview(result.aggregates)}`, {label: LOG_LABEL});
  return result;
}

/** Mantenimiento próximo: vehículos cuyo (maintenance_mileage - mileage) <= thresholdKm */
export async function upcomingMaintenanceReportQuery({thresholdKm = 1000}) {
  logger.info('➡️ Ingresa a upcomingMaintenanceReportQuery', {label: LOG_LABEL});
  logger.info(`📝 Parámetros | thresholdKm: ${thresholdKm}`, {label: LOG_LABEL});

  const sql = `
      SELECT v.id,
             b.name                              AS brand,
             v.model,
             v.year,
             v.license_plate,
             v.mileage,
             v.maintenance_mileage,
             (v.maintenance_mileage - v.mileage) AS km_remaining,
             v.status,
             v.is_active
      FROM vehicle.vehicles v
               JOIN vehicle.vehicle_brands b ON b.id = v.brand_id
      WHERE v.maintenance_mileage IS NOT NULL
        AND v.mileage IS NOT NULL
        AND (v.maintenance_mileage - v.mileage) <= $1
      ORDER BY km_remaining NULLS LAST, v.updated_at DESC
  `;
  const params = [thresholdKm];

  logger.info(`🧮 Ejecutando query upcomingMaintenanceReportQuery | params: ${safePreview(params)}`, {label: LOG_LABEL});
  const {rows} = await pool.query(sql, params);
  logger.info(`✅ Vehículos obtenidos: ${rows.length}`, {label: LOG_LABEL});

  const buckets = {overdue: 0, lt_500: 0, gte_500_lt_1000: 0};
  for (const r of rows) {
    if (r.km_remaining <= 0) buckets.overdue++;
    else if (r.km_remaining < 500) buckets.lt_500++;
    else buckets.gte_500_lt_1000++;
  }
  const result = {aggregates: {buckets, total: rows.length}, items: rows};
  logger.info(`📊 Aggregates: ${safePreview(result.aggregates)}`, {label: LOG_LABEL});
  return result;
}

/** Clientes frecuentes: usuarios con >= N reservas completadas en rango */
export async function frequentCustomersReportQuery({minReservations = 3, from, to}) {
  logger.info('➡️ Ingresa a frequentCustomersReportQuery', {label: LOG_LABEL});
  logger.info(`📝 Parámetros | minReservations: ${minReservations} | from: ${from} | to: ${to}`, {label: LOG_LABEL});

  const params = [minReservations];
  const where = [`r.status = 'completed'`];

  if (from) {
    params.push(from);
    where.push(`r.start_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`r.end_at   <= $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const sql = `
      WITH base AS (SELECT r.customer_user_id,
                           COUNT(*)                              AS cnt,
                           jsonb_agg(jsonb_build_object(
                                             'id', r.id, 'start_at', r.start_at, 'end_at', r.end_at, 'total_amount',
                                             r.total_amount
                                     ) ORDER BY r.start_at DESC) AS reservations
                    FROM reservation.reservations r
                        ${whereSql}
                    GROUP BY r.customer_user_id)
      SELECT u.id                               AS user_id,
             p.first_name || ' ' || p.last_name AS customer_name,
             p.document_number,
             b.cnt                              AS reservation_count,
             b.reservations
      FROM base b
               JOIN "user".users u ON u.id = b.customer_user_id
               JOIN person.persons p ON p.id = u.person_id
      WHERE b.cnt >= $1
      ORDER BY b.cnt DESC, customer_name
  `;

  logger.info(`🧮 Ejecutando query frequentCustomersReportQuery | params: ${safePreview(params)}`, {label: LOG_LABEL});
  const {rows} = await pool.query(sql, params);
  logger.info(`✅ Clientes obtenidos: ${rows.length}`, {label: LOG_LABEL});

  const series = rows.map(r => ({user_id: r.user_id, count: Number(r.reservation_count)}));
  const totalCustomers = rows.length;
  const totalReservations = rows.reduce((acc, r) => acc + Number(r.reservation_count), 0);

  const result = {aggregates: {series, totalCustomers, totalReservations}, items: rows};
  logger.info(`📊 Aggregates: ${safePreview(result.aggregates)}`, {label: LOG_LABEL});
  return result;
}

/** Datos para contrato */
export async function reservationContractDataQuery(reservationId) {
  logger.info('➡️ Ingresa a reservationContractDataQuery', {label: LOG_LABEL});
  logger.info(`📝 Parámetros | reservationId: ${reservationId}`, {label: LOG_LABEL});

  const sql = `
      SELECT r.id,
             r.status,
             r.start_at,
             r.end_at,
             r.total_amount,
             r.note,
             u.id                                                        AS customer_user_id,
             p.first_name,
             p.last_name,
             p.document_number,
             COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', ri.vehicle_id, 'line_amount', ri.line_amount)
                               ) FILTER (WHERE ri.id IS NOT NULL), '[]') as items
      FROM reservation.reservations r
               LEFT JOIN reservation.reservation_items ri ON ri.reservation_id = r.id
               JOIN "user".users u ON u.id = r.customer_user_id
               JOIN person.persons p ON p.id = u.person_id
      WHERE r.id = $1
      GROUP BY r.id, u.id, p.first_name, p.last_name, p.document_number
  `;

  const params = [reservationId];
  logger.info(`🧮 Ejecutando query reservationContractDataQuery | params: ${safePreview(params)}`, {label: LOG_LABEL});
  const {rows} = await pool.query(sql, params);

  logger.info(`${rows.length > 0
    ? `✅ Datos de contrato encontrados: ${safePreview(rows[0])}`
    : '⚠️ No se encontraron datos de contrato para la reserva.'}`, {label: LOG_LABEL});

  return rows[0] || null;
}
