import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {getUser} from '../controllers/userController.js';

const userRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User profiles
 */

/**
 * @swagger
 * /api/users/{codUser}:
 *   get:
 *     summary: Get a user by ID
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: codUser
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the user to retrieve
 *     responses:
 *       200:
 *         description: User data retrieved successfully
 *       404:
 *         description: User not found
 */
userRoutes.get('/:codUser', authMiddleware, getUser);

export default userRoutes;
