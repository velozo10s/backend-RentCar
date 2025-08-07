import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {getVehicle} from "../controllers/vehicleController.js";

const vehicleRoutes = express.Router();

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get a vehicle by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the user to retrieve
 *     responses:
 *       200:
 *         description: Vehicle data retrieved successfully
 *       404:
 *         description: Vehicle not found
 */
vehicleRoutes.get('/:vehicleId', authMiddleware, getVehicle);

export default vehicleRoutes;
