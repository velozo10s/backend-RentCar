import logger from "../utils/logger.js";
import {findVehicleById} from "../services/vehicleService.js";

export const getVehicle = async (req, res) => {
  logger.info(`Ingresa a getVehicle.`, {label: 'Controller'});
  const {vehicleId} = req.params;

  try {
    const vehicle = await findVehicleById(vehicleId);

    if (vehicle.error) {
      logger.error(`Error: ${vehicle.error}.`, {label: 'Controller'});
      return res.status(400).json({error: vehicle.error});
    }

    res.json(vehicle);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    logger.info(`Finaliza getUser.`, {label: 'Controller'});
  }
};
