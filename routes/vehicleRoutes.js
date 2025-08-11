import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {getVehicleById} from '../controllers/vehicleController.js';

const vehicleRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Vehicles
 *   description: Vehicle catalog
 */

/**
 * @swagger
 * /api/vehicles/{vehicleId}:
 *   get:
 *     summary: Get a vehicle by ID
 *     tags: [Vehicles]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: vehicleId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the vehicle to retrieve
 *     responses:
 *       200:
 *         description: Vehicle data retrieved successfully
 *       404:
 *         description: Vehicle not found
 */
vehicleRoutes.get('/:vehicleId', authMiddleware, getVehicleById);

export default vehicleRoutes;
