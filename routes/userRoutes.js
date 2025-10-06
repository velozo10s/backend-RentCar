import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {getUser} from '../controllers/userController.js';
import {uploadDocs} from '../config/multerConfig.js';
import {upsertMyDocuments} from '../controllers/userDocumentsController.js';

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

/**
 * @swagger
 * /api/users/me/documents:
 *   post:
 *     summary: Subir/actualizar documentos del usuario autenticado
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document_front: { type: string, format: binary }
 *               document_back:  { type: string, format: binary }
 *               license_front:  { type: string, format: binary }
 *               license_back:   { type: string, format: binary }
 *     responses:
 *       201: { description: Documentos guardados/actualizados }
 *       400: { description: Sin archivos o falta una cara en inserción }
 */
userRoutes.post(
  '/me/documents',
  authMiddleware,
  uploadDocs.fields([
    {name: 'document_front', maxCount: 1},
    {name: 'document_back', maxCount: 1},
    {name: 'license_front', maxCount: 1},
    {name: 'license_back', maxCount: 1}
  ]),
  upsertMyDocuments
);

export default userRoutes;
