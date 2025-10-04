import express from 'express';
import {login, refresh, logout, register} from '../controllers/authController.js';
import {uploadDocs} from '../config/multerConfig.js';

const authRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication & registration
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     # ----- Your reservation schemas (global) -----
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
 * /api/auth/login:
 *   post:
 *     summary: Login with username/email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user, password, context]
 *             properties:
 *               user:
 *                 type: string
 *                 example: "jdoe@example.com"
 *               password:
 *                 type: string
 *                 example: "secret123"
 *               context:
 *                 type: string
 *                 example: "web"
 *     responses:
 *       200:
 *         description: Login completed successfully
 *       400:
 *         description: Validation error
 */
authRoutes.post('/login', login);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh the access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token has been refreshed successfully
 *       400:
 *         description: Validation error
 */
authRoutes.post('/refresh', refresh);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout a session (invalidate refresh token)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token deleted successfully
 *       400:
 *         description: Validation error
 */
authRoutes.post('/logout', logout);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               username: { type: string }
 *               first_name: { type: string }
 *               last_name: { type: string }
 *               document_type: { type: string, example: "CI" }
 *               document_number: { type: string, example: "1234567" }
 *               document_front:
 *                 type: string
 *                 format: binary
 *               document_back:
 *                 type: string
 *                 format: binary
 *               license_front:
 *                 type: string
 *                 format: binary
 *               license_back:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 */
authRoutes.post(
  '/register',
  uploadDocs.fields([
    {name: 'document_front', maxCount: 1},
    {name: 'document_back', maxCount: 1},
    {name: 'license_front', maxCount: 1},
    {name: 'license_back', maxCount: 1}
  ]),
  register
);

export default authRoutes;
