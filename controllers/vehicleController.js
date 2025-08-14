import logger from "../utils/logger.js";
import {findBrands, findTypes, findVehicleById, listVehiclesByParams} from "../services/vehicleService.js";

export async function listVehicles(req, res) {
  logger.info(`Ingresa a listVehicles.`, {label: 'Controller'});
  try {
    const vehicles = await listVehiclesByParams(req.query);

    if (vehicles.error) {
      logger.error(`Error: ${vehicles.error}.`, {label: 'Controller'});
      return res.status(400).json(vehicles);
    }

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    logger.info(`Finaliza listVehicles.`, {label: 'Controller'});
  }
}

export const getVehicleById = async (req, res) => {
  logger.info(`Ingresa a getVehicleById.`, {label: 'Controller'});
  const {vehicleId} = req.params;

  try {
    const vehicle = await findVehicleById(vehicleId);

    if (vehicle.error) {
      logger.error(`Error: ${vehicle.error}.`, {label: 'Controller'});
      return res.status(400).json({error: vehicle.error});
    }

    res.json(vehicle);
  } catch (error) {
    console.error('Vehicle error: ', error);
    res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    logger.info(`Finaliza getVehicleById.`, {label: 'Controller'});
  }
};

export async function listBrands(req, res) {
  logger.info(`Ingresa a listBrands.`, {label: 'Controller'});
  try {
    const vehicles = await findBrands();

    if (vehicles.error) {
      logger.error(`Error: ${vehicles.error}.`, {label: 'Controller'});
      return res.status(400).json(vehicles);
    }

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    logger.info(`Finaliza listBrands.`, {label: 'Controller'});
  }
}

export async function listTypes(req, res) {
  logger.info(`Ingresa a listTypes.`, {label: 'Controller'});
  try {
    const vehicles = await findTypes();

    if (vehicles.error) {
      logger.error(`Error: ${vehicles.error}.`, {label: 'Controller'});
      return res.status(400).json(vehicles);
    }

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    logger.info(`Finaliza listTypes.`, {label: 'Controller'});
  }
}
