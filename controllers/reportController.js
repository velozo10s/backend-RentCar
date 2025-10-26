import logger from '../utils/logger.js';
import {
  reservationStatusReportQuery,
  monthlyRevenueReportQuery,
  upcomingMaintenanceReportQuery,
  frequentCustomersReportQuery,
  reservationContractDataQuery
} from '../services/reportService.js';
import {buildXlsxBuffer, buildSimplePdfBuffer, buildContractPdfBuffer} from '../utils/reportExports.js';

const LOG_LABEL = 'Reports';

/** Evita logs gigantes: serializa con límite de longitud */
function safePreview(obj, maxLen = 2000) {
  try {
    const s = JSON.stringify(obj);
    return s.length > maxLen ? `${s.slice(0, maxLen)}… (truncado)` : s;
  } catch {
    return '[unserializable]';
  }
}

function sendMaybeExport(req, res, payload, nameBase) {
  const format = (req.query.format || 'json').toLowerCase();
  logger.info(`🧾 Formato solicitado: ${format} | nombre base: ${nameBase}`, {label: LOG_LABEL});

  const pdfOptions = {
    orientation: (req.query.orientation || 'portrait').toLowerCase(), // 'portrait' | 'landscape'
    compact: String(req.query.compact || 'false').toLowerCase() === 'true',
    fontSize: Number(req.query.fontSize || 9) // opcional, por si querés forzar tamaño
  };

  if (format === 'xlsx') {
    logger.info(`📦 Generando XLSX (payload preview): ${safePreview(payload)}`, {label: LOG_LABEL});
    return buildXlsxBuffer(payload, nameBase).then(buf => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nameBase}.xlsx"`);
      logger.info(`✅ XLSX generado (${buf?.length || 0} bytes)`, {label: LOG_LABEL});
      return res.status(200).send(buf);
    });
  }
  if (format === 'pdf') {
    logger.info(`📄 Generando PDF (${pdfOptions.orientation}, compact=${pdfOptions.compact})`, {label: LOG_LABEL});
    return buildSimplePdfBuffer(payload, nameBase, pdfOptions).then(buf => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${nameBase}.pdf"`);
      return res.status(200).send(buf);
    });
  }

  logger.info(`🔁 Respondiendo en JSON (payload preview): ${safePreview(payload)}`, {label: LOG_LABEL});
  return res.json(payload);
}

export async function reportReservationStatus(req, res) {
  logger.info('➡️ Ingresa a reportReservationStatus', {label: LOG_LABEL});
  try {
    const {from, to, statuses} = req.query;
    logger.info(`📝 Parámetros recibidos | from: ${from} | to: ${to} | statuses: ${statuses}`, {label: LOG_LABEL});

    const statusesArr = (statuses ? String(statuses).split(',').map(s => s.trim()) : null);
    const data = await reservationStatusReportQuery({from, to, statuses: statusesArr});

    logger.info(`📊 Datos obtenidos de BD (resumen): ${safePreview({
      totalReservations: data?.aggregates?.totalReservations,
      byStatus: data?.aggregates?.byStatus
    })}`, {label: LOG_LABEL});

    return sendMaybeExport(req, res, data, 'reservation_status');
  } catch (err) {
    logger.error(`❌ reportReservationStatus: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'snackBarMessages.generalError', message: 'Internal error'});
  }
}

export async function reportMonthlyRevenue(req, res) {
  logger.info('➡️ Ingresa a reportMonthlyRevenue', {label: LOG_LABEL});
  try {
    const {year, statuses} = req.query;
    logger.info(`📝 Parámetros recibidos | year: ${year} | statuses: ${statuses}`, {label: LOG_LABEL});

    const statusesArr = (statuses ? String(statuses).split(',').map(s => s.trim()) : ['completed']);
    const data = await monthlyRevenueReportQuery({year: year ? Number(year) : undefined, statuses: statusesArr});

    logger.info(`📊 Datos obtenidos de BD (resumen): ${safePreview({
      months: data?.aggregates?.series?.length,
      totalRevenue: data?.aggregates?.totalRevenue
    })}`, {label: LOG_LABEL});

    return sendMaybeExport(req, res, data, 'monthly_revenue');
  } catch (err) {
    logger.error(`❌ reportMonthlyRevenue: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'snackBarMessages.generalError', message: 'Internal error'});
  }
}

export async function reportUpcomingMaintenance(req, res) {
  logger.info('➡️ Ingresa a reportUpcomingMaintenance', {label: LOG_LABEL});
  try {
    const threshold = req.query.threshold_km ? Number(req.query.threshold_km) : 1000;
    logger.info(`📝 Parámetros recibidos | threshold_km: ${threshold}`, {label: LOG_LABEL});

    const data = await upcomingMaintenanceReportQuery({thresholdKm: threshold});

    logger.info(`📊 Datos obtenidos de BD (resumen): ${safePreview({
      total: data?.aggregates?.total,
      buckets: data?.aggregates?.buckets
    })}`, {label: LOG_LABEL});

    return sendMaybeExport(req, res, data, 'upcoming_maintenance');
  } catch (err) {
    logger.error(`❌ reportUpcomingMaintenance: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'snackBarMessages.generalError', message: 'Internal error'});
  }
}

export async function reportFrequentCustomers(req, res) {
  logger.info('➡️ Ingresa a reportFrequentCustomers', {label: LOG_LABEL});
  try {
    const min = req.query.min_reservations ? Number(req.query.min_reservations) : 3;
    const {from, to} = req.query;
    logger.info(`📝 Parámetros recibidos | min_reservations: ${min} | from: ${from} | to: ${to}`, {label: LOG_LABEL});

    const data = await frequentCustomersReportQuery({minReservations: min, from, to});

    logger.info(`📊 Datos obtenidos de BD (resumen): ${safePreview({
      totalCustomers: data?.aggregates?.totalCustomers,
      totalReservations: data?.aggregates?.totalReservations
    })}`, {label: LOG_LABEL});

    return sendMaybeExport(req, res, data, 'frequent_customers');
  } catch (err) {
    logger.error(`❌ reportFrequentCustomers: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'snackBarMessages.generalError', message: 'Internal error'});
  }
}

export async function generateReservationContract(req, res) {
  logger.info('➡️ Ingresa a generateReservationContract', {label: LOG_LABEL});
  try {
    const reservationId = Number(req.params.reservationId);
    logger.info(`📝 Parámetros recibidos | reservationId: ${reservationId}`, {label: LOG_LABEL});

    if (!Number.isInteger(reservationId)) {
      logger.warn('⚠️ reservationId inválido', {label: LOG_LABEL});
      return res.status(400).json({localKey: 'reports.invalid_id', message: 'Invalid reservationId'});
    }
    const data = await reservationContractDataQuery(reservationId);

    if (!data) {
      logger.warn('⚠️ Reserva no encontrada', {label: LOG_LABEL});
      return res.status(404).json({localKey: 'reservations.not_found', message: 'Reservation not found'});
    }

    logger.info(`📄 Datos del contrato encontrados (preview): ${safePreview({
      id: data.id, customer_user_id: data.customer_user_id, items: data.items?.length
    })}`, {label: LOG_LABEL});

    const buf = await buildContractPdfBuffer(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="contrato-reserva-${reservationId}.pdf"`);
    logger.info(`✅ Contrato PDF generado (${buf?.length || 0} bytes)`, {label: LOG_LABEL});
    return res.status(200).send(buf);
  } catch (err) {
    logger.error(`❌ generateReservationContract: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'snackBarMessages.generalError', message: 'Internal error'});
  }
}
