import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import requireRole from '../middlewares/requireRole.js';
import {
  reportReservationStatus,
  reportMonthlyRevenue,
  reportUpcomingMaintenance,
  reportFrequentCustomers,
  generateReservationContract
} from '../controllers/reportController.js';

const reportRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Business reporting & exports
 */

/**
 * @swagger
 * /api/reports/reservations/status:
 *   get:
 *     summary: Reporte de estados de reservas (agrupado + detalle)
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: statuses
 *         schema: { type: string }
 *         description: CSV de estados (ej: "pending,confirmed,active,completed")
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, xlsx, pdf] }
 *     responses:
 *       200: { description: OK }
 */
reportRoutes.get('/reservations/status',
  authMiddleware, requireRole(['employee', 'admin']), reportReservationStatus);

/**
 * @swagger
 * /api/reports/revenue/monthly:
 *   get:
 *     summary: Reporte de ingresos mensuales por alquileres
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *       - in: query
 *         name: statuses
 *         schema: { type: string }
 *         description: Defaults a "completed"
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, xlsx, pdf] }
 *     responses:
 *       200: { description: OK }
 */
reportRoutes.get('/revenue/monthly',
  authMiddleware, requireRole(['employee', 'admin']), reportMonthlyRevenue);

/**
 * @swagger
 * /api/reports/maintenance/upcoming:
 *   get:
 *     summary: Reporte de mantenimiento próximo
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: threshold_km
 *         schema: { type: integer, default: 1000 }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, xlsx, pdf] }
 *     responses:
 *       200: { description: OK }
 */
reportRoutes.get('/maintenance/upcoming',
  authMiddleware, requireRole(['employee', 'admin']), reportUpcomingMaintenance);

/**
 * @swagger
 * /api/reports/customers/frequent:
 *   get:
 *     summary: Reporte de clientes frecuentes
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: min_reservations
 *         schema: { type: integer, default: 3 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, xlsx, pdf] }
 *     responses:
 *       200: { description: OK }
 */
reportRoutes.get('/customers/frequent',
  authMiddleware, requireRole(['employee', 'admin']), reportFrequentCustomers);

/**
 * @swagger
 * /api/reports/contracts/{reservationId}:
 *   get:
 *     summary: Generar contrato PDF para una reserva
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reservationId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: PDF stream }
 */
reportRoutes.get('/contracts/:reservationId',
  authMiddleware, requireRole(['employee', 'admin']), generateReservationContract);

export default reportRoutes;
