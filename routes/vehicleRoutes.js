import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {getVehicleById, listTypes, listVehicles, listBrands, createVehicle} from '../controllers/vehicleController.js';
import requireRole from "../middlewares/requireRole.js";
import {uploadVehicles} from "../config/multerConfig.js";

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

/**
 * @swagger
 * /api/vehicles:
 *   post:
 *     summary: Create a vehicle with optional images
 *     tags: [Vehicles]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [brand_id, type_id, model, year, license_plate, price_per_hour]
 *             properties:
 *               brand_id: { type: integer, example: 1 }
 *               type_id:  { type: integer, example: 1 }
 *               model:    { type: string,  example: "Corolla" }
 *               year:     { type: integer, example: 2024 }
 *               license_plate: { type: string, example: "ABC123" }
 *               price_per_hour: { type: number, format: float, example: 80 }
 *               price_per_day:  { type: number, format: float, example: 500 }
 *               transmission:   { type: string, enum: ['manual','automatic'] }
 *               seats:          { type: integer, example: 5 }
 *               color:          { type: string, example: "White" }
 *               fuel_type:      { type: string, example: "petrol" }
 *               fuel_capacity:  { type: number, format: float, example: 50 }
 *               insurance_fee:  { type: number, format: float, example: 50 }
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               make_primary:
 *                 type: boolean
 *                 description: If true, the first uploaded image becomes primary
 *     responses:
 *       201: { description: Vehicle created }
 *       400: { description: Validation error }
 *       409: { description: Conflict (e.g., duplicate license plate) }
 */
vehicleRoutes.post(
  '/',
  authMiddleware,
  requireRole(['employee', 'admin']),     // your middleware already supports dynamic env roles
  uploadVehicles.array('images', 10),    // images[] files
  createVehicle
);


export default vehicleRoutes;
