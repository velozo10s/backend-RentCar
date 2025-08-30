import logger from "../utils/logger.js";
import {findBrands, findTypes, findVehicleById, listVehiclesByParams} from "../services/vehicleService.js";

export async function listVehicles(req, res) {
  logger.info(`Ingresa a listVehicles.`, {label: 'Controller'});
  try {
    const vehicles = await listVehiclesByParams(req.query);

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza listVehicles.`, {label: 'Controller'});
  }
}

export const getVehicleById = async (req, res) => {
  logger.info(`Ingresa a getVehicleById.`, {label: 'Controller'});
  const {vehicleId} = req.params;

  try {
    const vehicle = await findVehicleById(vehicleId);

    res.json(vehicle);
  } catch (error) {
    console.error('Vehicle error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza getVehicleById.`, {label: 'Controller'});
  }
};

export async function listBrands(req, res) {
  logger.info(`Ingresa a listBrands.`, {label: 'Controller'});
  try {
    const vehicles = await findBrands();

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza listBrands.`, {label: 'Controller'});
  }
}

export async function listTypes(req, res) {
  logger.info(`Ingresa a listTypes.`, {label: 'Controller'});
  try {
    const vehicles = await findTypes();

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza listTypes.`, {label: 'Controller'});
  }
}
