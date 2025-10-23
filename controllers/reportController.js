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

function sendMaybeExport(req, res, payload, nameBase) {
  const format = (req.query.format || 'json').toLowerCase();
  if (format === 'xlsx') {
    return buildXlsxBuffer(payload).then(buf => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nameBase}.xlsx"`);
      return res.status(200).send(buf);
    });
  }
  if (format === 'pdf') {
    return buildSimplePdfBuffer(payload, nameBase).then(buf => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${nameBase}.pdf"`);
      return res.status(200).send(buf);
    });
  }
  return res.json(payload);
}

export async function reportReservationStatus(req, res) {
  try {
    const {from, to, statuses} = req.query;
    const statusesArr = (statuses ? String(statuses).split(',').map(s => s.trim()) : null);
    const data = await reservationStatusReportQuery({from, to, statuses: statusesArr});
    return sendMaybeExport(req, res, data, 'reservation_status');
  } catch (err) {
    logger.error(`reportReservationStatus: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}

export async function reportMonthlyRevenue(req, res) {
  try {
    const {year, statuses} = req.query;
    const statusesArr = (statuses ? String(statuses).split(',').map(s => s.trim()) : ['completed']);
    const data = await monthlyRevenueReportQuery({year: year ? Number(year) : undefined, statuses: statusesArr});
    return sendMaybeExport(req, res, data, 'monthly_revenue');
  } catch (err) {
    logger.error(`reportMonthlyRevenue: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}

export async function reportUpcomingMaintenance(req, res) {
  try {
    const threshold = req.query.threshold_km ? Number(req.query.threshold_km) : 1000;
    const data = await upcomingMaintenanceReportQuery({thresholdKm: threshold});
    return sendMaybeExport(req, res, data, 'upcoming_maintenance');
  } catch (err) {
    logger.error(`reportUpcomingMaintenance: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}

export async function reportFrequentCustomers(req, res) {
  try {
    const min = req.query.min_reservations ? Number(req.query.min_reservations) : 3;
    const {from, to} = req.query;
    const data = await frequentCustomersReportQuery({minReservations: min, from, to});
    return sendMaybeExport(req, res, data, 'frequent_customers');
  } catch (err) {
    logger.error(`reportFrequentCustomers: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}

export async function generateReservationContract(req, res) {
  try {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId)) {
      return res.status(400).json({localKey: 'reports.invalid_id', message: 'Invalid reservationId'});
    }
    const data = await reservationContractDataQuery(reservationId);
    if (!data) return res.status(404).json({localKey: 'reservations.not_found', message: 'Reservation not found'});

    const buf = await buildContractPdfBuffer(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="contract-${reservationId}.pdf"`);
    return res.status(200).send(buf);
  } catch (err) {
    logger.error(`generateReservationContract: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}
