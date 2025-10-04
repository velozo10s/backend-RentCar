import logger from "../utils/logger.js";
import {
  findBrands,
  findTypes,
  findVehicleById,
  listVehiclesByParams,
  createVehicleWithImages
} from "../services/vehicleService.js";
import {buildPublicUrl} from "../config/multerConfig.js";

const LOG_LABEL = "VehicleController";

export async function createVehicle(req, res) {
  try {
    // required fields
    const required = ['brand_id', 'type_id', 'model', 'year', 'license_plate', 'price_per_hour'];
    for (const k of required) {
      if (req.body[k] == null || req.body[k] === '') {
        return res.status(400).json({
          localKey: 'vehicles.validation.missing_field',
          message: `Missing field: ${k}`,
          field: k
        });
      }
    }

    // numeric coercion where relevant
    const payload = {
      brand_id: Number(req.body.brand_id),
      type_id: Number(req.body.type_id),
      model: String(req.body.model),
      year: Number(req.body.year),
      license_plate: String(req.body.license_plate),
      vin: req.body.vin || null,
      color: req.body.color || null,
      transmission: req.body.transmission || null,
      seats: req.body.seats != null ? Number(req.body.seats) : null,
      fuel_type: req.body.fuel_type || null,
      fuel_capacity: req.body.fuel_capacity != null ? Number(req.body.fuel_capacity) : null,
      mileage: req.body.mileage != null ? Number(req.body.mileage) : null,
      maintenance_mileage: req.body.maintenance_mileage != null ? Number(req.body.mileage) : null,
      price_per_hour: Number(req.body.price_per_hour),
      price_per_day: req.body.price_per_day != null ? Number(req.body.price_per_day) : null,
      insurance_fee: req.body.insurance_fee != null ? Number(req.body.insurance_fee) : null,
    };

    // files to full public URLs
    const makePrimary = String(req.body.make_primary || '').toLowerCase() === 'true';
    const fileUrls = (req.files || []).map(f => {
      // f.path like 'uploads/vehicles/xxx'; express mounts at /uploads
      const rel = `uploads/vehicles/${f.filename}`;
      return buildPublicUrl(req, rel);
    });

    const result = await createVehicleWithImages(payload, fileUrls, makePrimary, {userId: req.user?.id});

    return res.status(201).json(result);
  } catch (err) {
    // duplicate license plate or constraint violations should map to 409
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('license_plate')) {
      logger.warn(`Conflict creating vehicle: ${err.message}`, {label: LOG_LABEL});
      return res.status(409).json({
        localKey: 'vehicles.conflict.duplicate',
        message: 'Vehicle already exists or unique constraint failed'
      });
    }
    logger.error(`Create vehicle failed: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}

export async function listVehicles(req, res) {
  logger.info(`Ingresa a listVehicles.`, {label: LOG_LABEL});
  try {
    const vehicles = await listVehiclesByParams(req.query);

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza listVehicles.`, {label: LOG_LABEL});
  }
}

export const getVehicleById = async (req, res) => {
  logger.info(`Ingresa a getVehicleById.`, {label: LOG_LABEL});
  const {vehicleId} = req.params;

  try {
    const vehicle = await findVehicleById(vehicleId);

    res.json(vehicle);
  } catch (error) {
    console.error('Vehicle error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza getVehicleById.`, {label: LOG_LABEL});
  }
};

export async function listBrands(req, res) {
  logger.info(`Ingresa a listBrands.`, {label: LOG_LABEL});
  try {
    const vehicles = await findBrands();

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza listBrands.`, {label: LOG_LABEL});
  }
}

export async function listTypes(req, res) {
  logger.info(`Ingresa a listTypes.`, {label: LOG_LABEL});
  try {
    const vehicles = await findTypes();

    res.json(vehicles);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza listTypes.`, {label: LOG_LABEL});
  }
}
