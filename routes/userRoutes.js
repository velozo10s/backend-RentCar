import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { getUser } from '../controllers/userController.js';

const userRoutes = express.Router();

userRoutes.get('/:codUser', authMiddleware, getUser);

export default userRoutes;
