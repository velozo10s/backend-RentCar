import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import requireRole from '../middlewares/requireRole.js';
import {listCustomers, getCustomerDetail} from '../controllers/customerController.js';

const customerRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Customers
 *   description: Customer listing and detail (backoffice only)
 */

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: List customers
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Search by name, document number, or phone
 *       - in: query
 *         name: active
 *         schema: { type: string, enum: ['true', 'false', 'all'] }
 *         description: Filter by active status
 *     responses:
 *       200: { description: List of customers }
 */
customerRoutes.get('/', authMiddleware, requireRole(['employee', 'admin']), listCustomers);

/**
 * @swagger
 * /api/customers/{personId}:
 *   get:
 *     summary: Get customer detail with documents
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: personId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Customer detail with documents }
 *       404: { description: Not found }
 */
customerRoutes.get('/:personId', authMiddleware, requireRole(['employee', 'admin']), getCustomerDetail);

export default customerRoutes;
