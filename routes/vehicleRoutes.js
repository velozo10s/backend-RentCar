import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {getVehicleById, listTypes, listVehicles, listBrands} from '../controllers/vehicleController.js';

const vehicleRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Vehicles
 *   description: Vehicle catalog
 */

/**
 * @swagger
 * /api/vehicles:
 *   get:
 *     summary: List vehicles
 *     tags: [Vehicles]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ['available','in use','in maintenance','all'] }
 *         description: Filter by status
 *       - in: query
 *         name: brand_id
 *         schema: { type: integer }
 *       - in: query
 *         name: type_id
 *         schema: { type: integer }
 *       - in: query
 *         name: active
 *         schema: { type: string, enum: ['true','false','all'] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: ['created_at','price_per_hour','price_per_day','year'] }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: ['asc','desc'] }
 *     responses:
 *       200:
 *         description: List of vehicles
 */
vehicleRoutes.get('/', authMiddleware, listVehicles);

/**
 * @swagger
 * /api/vehicles/brands:
 *   get:
 *     summary: List vehicles brands
 *     tags: [Vehicles]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of vehicle brands
 */
vehicleRoutes.get('/brands/', authMiddleware, listBrands);

/**
 * @swagger
 * /api/vehicles/types:
 *   get:
 *     summary: List vehicles types
 *     tags: [Vehicles]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of vehicle types
 */
vehicleRoutes.get('/types/', authMiddleware, listTypes);

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
vehicleRoutes.get('/:vehicleId', authMiddleware, getVehicleById)


export default vehicleRoutes;
