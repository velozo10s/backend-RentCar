import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import requireRole from '../middlewares/requireRole.js';
import {
  getCompanyStats,
  getCustomerStats
} from '../controllers/ratingController.js';

const ratingRoutes = express.Router();


/**
 * @swagger
 * /api/ratings/company-stats:
 *   get:
 *     summary: Estadísticas globales de experiencia de empresa (cliente -> empresa)
 *     tags: [Ratings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stats globales }
 */
ratingRoutes.get(
  '/company-stats',
  authMiddleware,
  getCompanyStats
);

/**
 * @swagger
 * /api/ratings/customers/{userId}/stats:
 *   get:
 *     summary: Estadísticas de calificaciones de un cliente (empleado/admin)
 *     tags: [Ratings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Stats del cliente }
 *       403: { description: Solo backoffice }
 */
ratingRoutes.get(
  '/customers/:userId/stats',
  authMiddleware,
  requireRole(['employee', 'admin']),
  getCustomerStats
);

export default ratingRoutes;
