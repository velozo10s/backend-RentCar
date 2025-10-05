import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import requireRole from '../middlewares/requireRole.js';
import {
  listEmployees,
  addEmployee,
  updateEmployee
} from '../controllers/employeeController.js';

const employeeRoutes = express.Router();

/**
 * @swagger
 * tags:
 *   name: Employees
 *   description: Admin-only employee management
 */

/**
 * @swagger
 * /api/employees:
 *   get:
 *     summary: List employees
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema: { type: string, enum: ['true','false','all'] }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Search by username, email, first_name or last_name
 *     responses:
 *       200: { description: List of employees }
 */
employeeRoutes.get('/', authMiddleware, requireRole(['admin']), listEmployees);

/**
 * @swagger
 * /api/employees:
 *   post:
 *     summary: Add a new employee
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             oneOf:
 *               - required: [person_id, username, email, password]
 *               - required: [first_name, last_name, username, email, password]
 *             properties:
 *               # Use this if you already have a person:
 *               person_id: { type: integer, example: 10 }
 *               # Or provide minimal person info to create one:
 *               first_name: { type: string, example: "Ana" }
 *               last_name:  { type: string, example: "Gómez" }
 *               document_type_id: { type: integer, example: 1 }
 *               document_number:  { type: string, example: "1234567" }
 *               phone_number: { type: string, example: "+59598111111" }
 *               nationality:  { type: string, example: "PY" }
 *               birth_date:   { type: string, example: "1995-03-02" }
 *               # user fields
 *               username: { type: string, example: "ana.gomez" }
 *               email:    { type: string, example: "ana@example.com" }
 *               password: { type: string, example: "SuperSecret123!" }
 *     responses:
 *       201: { description: Employee created }
 *       400: { description: Validation error }
 *       409: { description: Conflict (username/email already in use) }
 */
employeeRoutes.post('/', authMiddleware, requireRole(['admin']), addEmployee);

/**
 * @swagger
 * /api/employees/{userId}:
 *   patch:
 *     summary: Update an employee (activate/deactivate and basic fields)
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               is_active: { type: boolean }
 *               username:  { type: string }
 *               email:     { type: string }
 *               password:  { type: string, description: "Plain text; backend will hash" }
 *     responses:
 *       200: { description: Employee updated }
 *       404: { description: Employee not found }
 *       409: { description: Conflict (username/email already in use) }
 */
employeeRoutes.patch('/:userId', authMiddleware, requireRole(['admin']), updateEmployee);

export default employeeRoutes;
