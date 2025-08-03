import express from 'express';
import {login, refresh, logout, register} from '../controllers/authController.js';
import {upload} from "../config/multerConfig.js";

const authRoutes = express.Router();

authRoutes.post('/login', login);
authRoutes.post('/refresh', refresh);
authRoutes.post('/logout', logout);
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

