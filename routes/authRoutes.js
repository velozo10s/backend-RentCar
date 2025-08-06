import express from 'express';
import {login, refresh, logout, register} from '../controllers/authController.js';
import {upload} from "../config/multerConfig.js";

const authRoutes = express.Router();


/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user with credentials
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user
 *               - password
 *               - context
 *             properties:
 *               user:
 *                 type: string
 *               password:
 *                 type: string
 *               context:
 *                 type: string
 *     responses:
 *       201:
 *         description: Login completed successfully
 *       400:
 *         description: Validation error
 */
authRoutes.post('/login', login);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh the user token access
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       201:
 *         description: Token has been refreshed successfully
 *       400:
 *         description: Validation error
 */
authRoutes.post('/refresh', refresh);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Logout a session
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       201:
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
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 */
authRoutes.post(
  '/register',
  upload.fields([
    {name: 'document_front', maxCount: 1},
    {name: 'document_back', maxCount: 1},
    {name: 'license_front', maxCount: 1},
    {name: 'license_back', maxCount: 1}
  ]),
  register
);

export default authRoutes;

