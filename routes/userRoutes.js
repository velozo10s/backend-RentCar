import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {getUser} from '../controllers/userController.js';

const userRoutes = express.Router();

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get a user by ID
 *     parameters:
 *       - in: path
 *         name: id
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
