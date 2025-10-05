// routes/reservationRoutes.js
import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import requireRole from '../middlewares/requireRole.js'; // simple middlewares: (roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.sendStatus(403)
import {
  createReservation,
  listMyReservations,
  getReservationById,
  cancelReservation,
  confirmReservation,
  declineReservation,
  activateReservation,
  completeReservation,
} from '../controllers/reservationController.js';
import {createRating, getReservationRatings} from "../controllers/ratingController.js";

const parseRoles = (rolesStr = '') =>
  rolesStr.split(',').map(role => role.trim()).filter(Boolean);

const roleMap = {
  APP: parseRoles(process.env.APP_ROLES),
  WEB: parseRoles(process.env.WEB_ROLES)
};

const reservationRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Reservations
 *   description: Customer reservations and employee actions
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     ReservationCreate:
 *       type: object
 *       required: [startAt, endAt, vehicleIds]
 *       properties:
 *         startAt: { type: string, format: date-time, example: "2025-08-20T10:00:00-04:00" }
 *         endAt:   { type: string, format: date-time, example: "2025-08-23T10:00:00-04:00" }
 *         vehicleIds:
 *           type: array
 *           items: { type: integer }
 *           example: [12, 18]
 *         note: { type: string, example: "Necesito silla para niños" }
 *     Reservation:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         customer_id: { type: integer }
 *         start_at: { type: string, format: date-time }
 *         end_at: { type: string, format: date-time }
 *         status: { type: string, enum: ['pending','confirmed','active','completed','declined','cancelled'] }
 *         total_amount: { type: number, format: float }
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               vehicle_id: { type: integer }
 *               line_amount: { type: number, format: float }
 */

/**
 * @swagger
 * /api/reservations:
 *   post:
 *     summary: Create a reservation (one or more vehicles)
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ReservationCreate' }
 *     responses:
 *       201:
 *         description: Reservation created
 *       400:
 *         description: Validation error
 *       409:
 *         description: One or more vehicles are not available
 */
reservationRoutes.post('/', authMiddleware, requireRole(roleMap['APP']), createReservation);


/**
 * @swagger
 * tags:
 *   name: Ratings
 *   description: Calificaciones de reservas
 */

/**
 * @swagger
 * /api/reservations/{reservationId}/ratings:
 *   post:
 *     summary: Crear calificación para una reserva
 *     tags: [Ratings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reservationId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [direction, score]
 *             properties:
 *               direction:
 *                 type: string
 *                 enum: [customer_to_company, employee_to_customer]
 *               score:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               comment:
 *                 type: string
 *     responses:
 *       201: { description: Calificación creada }
 *       400: { description: Validación / reserva no elegible }
 *       403: { description: No autorizado para esta dirección }
 *       404: { description: Reserva no encontrada }
 *       409: { description: Ya existe calificación para esta dirección en la reserva }
 */
reservationRoutes.post(
  '/:reservationId/ratings',
  authMiddleware,
  createRating // el controller valida roles según direction
);

/**
 * @swagger
 * /api/reservations/{reservationId}/ratings:
 *   get:
 *     summary: Obtener calificación(es) de una reserva
 *     tags: [Ratings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reservationId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Lista de calificaciones (0, 1 o 2 direcciones) }
 *       404: { description: Reserva no encontrada }
 */
reservationRoutes.get(
  '/:reservationId/ratings',
  authMiddleware,
  getReservationRatings
);

/**
 * @swagger
 * /api/reservations:
 *   get:
 *     summary: List my reservations (customer)
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ['pending','confirmed','active','completed','declined','cancelled','all'] }
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of reservations
 */
reservationRoutes.get('/', authMiddleware, listMyReservations);

/**
 * @swagger
 * /api/reservations/{id}:
 *   get:
 *     summary: Get reservation by ID
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Reservation detail
 *       404:
 *         description: Not found
 */
reservationRoutes.get('/:id', authMiddleware, getReservationById);

/**
 * @swagger
 * /api/reservations/{id}/cancel:
 *   patch:
 *     summary: Cancel my reservation (before start time)
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Reservation cancelled
 *       400:
 *         description: Cannot cancel after start time
 *       403:
 *         description: Not your reservation
 *       404:
 *         description: Not found
 */
reservationRoutes.patch('/:id/cancel', authMiddleware, requireRole(roleMap['APP']), cancelReservation);

/**
 * @swagger
 * /api/reservations/{id}/confirm:
 *   patch:
 *     summary: Confirm reservation (employee/admin)
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Reservation confirmed
 *       409:
 *         description: Vehicle no longer available
 */
reservationRoutes.patch('/:id/confirm', authMiddleware, requireRole(roleMap['WEB']), confirmReservation);

/**
 * @swagger
 * /api/reservations/{id}/decline:
 *   patch:
 *     summary: Decline reservation (employee/admin)
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 */
reservationRoutes.patch('/:id/decline', authMiddleware, requireRole(roleMap['WEB']), declineReservation);

/**
 * @swagger
 * /api/reservations/{id}/activate:
 *   patch:
 *     summary: Mark reservation as active at pick-up (employee/admin)
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 */
reservationRoutes.patch('/:id/activate', authMiddleware, requireRole(roleMap['WEB']), activateReservation);

/**
 * @swagger
 * /api/reservations/{id}/complete:
 *   patch:
 *     summary: Complete reservation at return (employee/admin)
 *     tags: [Reservations]
 *     security: [{ bearerAuth: [] }]
 */
reservationRoutes.patch('/:id/complete', authMiddleware, requireRole(roleMap['WEB']), completeReservation);

export default reservationRoutes;
