import express from 'express';
import dotenv from 'dotenv';
import {fileURLToPath} from 'url';
import path from 'path';
import {swaggerDocs} from "./config/swagger.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from './routes/userRoutes.js';
import vehicleRoutes from "./routes/vehicleRoutes.js";
import logger from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

app.use(express.json());
app.use('/api/auth/', authRoutes);
app.use('/api/users/', userRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  swaggerDocs(app, PORT);
});
