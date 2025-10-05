import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {fileURLToPath} from 'url';
import path from 'path';
import {swaggerDocs} from "./config/swagger.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from './routes/userRoutes.js';
import vehicleRoutes from "./routes/vehicleRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import logger from "./utils/logger.js";
import reservationRoutes from "./routes/reservationRoutes.js";
import ratingRoutes from "./routes/ratingRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://192.168.100.208:5173'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // <- solo si usas cookies; con Bearer no es necesario
}));

app.use(express.json());

app.use('/api/auth/', authRoutes);
app.use('/api/users/', userRoutes);
app.use('/api/vehicles/', vehicleRoutes);
app.use('/api/reservations/', reservationRoutes);
app.use('/api/employees/', employeeRoutes);
app.use('/api/ratings/', ratingRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  swaggerDocs(app, PORT);
});
