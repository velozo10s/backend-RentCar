import logger from "../utils/logger.js";
import {
  findBrands,
  findTypes,
  findVehicleById,
  listVehiclesByParams,
  createVehicleWithImages, canSoftInactivateVehicleQuery, updateVehicleWithImagesCommand
} from "../services/vehicleService.js";
import {buildPublicUrl} from "../config/multerConfig.js";

const LOG_LABEL = "VehicleController";

export async function updateVehicle(req, res) {
  logger.info(`Ingresa a updateVehicle.`, {label: LOG_LABEL});

  const idRaw = req.params.vehicleId;
  const id = Number(idRaw);

  logger.info(`Parámetros recibidos: ${JSON.stringify({
    params: req.params,
    query: req.query,
    body: req.body,
    filesCount: (req.files || []).length
  })}`, {label: LOG_LABEL});

  if (!Number.isInteger(id)) {
    logger.warn(`ID inválido: ${idRaw}`, {label: LOG_LABEL});
    return res.status(400).json({localKey: 'backendRes.vehicles.invalidId', message: 'Identificador inválido.'});
  }

  try {
    // --- Normalización segura ---
    const patch = {};

    // 🔒 Campos que NO son columnas de vehicle.vehicles (ignóralos del patch)
    const nonColumnKeys = new Set([
      'make_primary',
      'primary_image_id',
      'delete_image_ids',
      'remove_images',
      'remove_images[]'
    ]);

    // Si querés ser aún más estricto, lista blanca de columnas válidas:
    const allowedColumns = new Set([
      'brand_id', 'type_id', 'model', 'year', 'license_plate', 'transmission', 'seats',
      'price_per_day', 'price_per_hour', 'vin', 'color', 'mileage', 'maintenance_mileage',
      'insurance_fee', 'fuel_capacity', 'fuel_type', 'is_active'
    ]);

    const numericFields = ['year', 'seats', 'fuel_capacity', 'price_per_hour', 'price_per_day', 'insurance_fee', 'mileage', 'maintenance_mileage'];

    for (const [kRaw, v] of Object.entries(req.body || {})) {
      const k = String(kRaw);
      if (v === '' || typeof v === 'undefined' || v === null) continue;
      if (nonColumnKeys.has(k)) continue; // 🚫 nunca al patch

      // Sólo columnas válidas
      if (!allowedColumns.has(k)) continue;

      if (numericFields.includes(k)) patch[k] = Number(v);
      else if (k === 'is_active') patch[k] = String(v).toLowerCase() === 'true';
      else patch[k] = v;
    }

    // Flags / parámetros de imágenes (no-columna)
    const makePrimary = String(req.body.make_primary || '').toLowerCase() === 'true';
    const primaryImageId = req.body.primary_image_id ? Number(req.body.primary_image_id) : null;

    // Aceptar ambas variantes de borrado
    let deleteImageIds;
    if (typeof req.body.delete_image_ids === 'string') {
      deleteImageIds = req.body.delete_image_ids
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter(Number.isInteger);
    } else {
      // FormData arrays: remove_images[] o remove_images
      const arrA = req.body['remove_images[]'];
      const arrB = req.body['remove_images'];
      const arr = Array.isArray(arrA) ? arrA : (Array.isArray(arrB) ? arrB : []);
      deleteImageIds = arr
        .map(s => Number(s))
        .filter(Number.isInteger);
    }

    const newImageUrls = (req.files || []).map(f => buildPublicUrl(req, `uploads/vehicles/${f.filename}`));

    const isActiveWasExplicitlyProvided = Object.prototype.hasOwnProperty.call(patch, 'is_active');

    logger.info(`Payload normalizado: ${JSON.stringify({
      vehicleId: id,
      patch,
      images: {newImageUrls, deleteImageIds, makePrimary, primaryImageId},
      flags: {isActiveWasExplicitlyProvided}
    })}`, {label: LOG_LABEL});

    // --- Reglas previas ---
    if (isActiveWasExplicitlyProvided) {
      logger.info(`Verificando canSoftInactivateVehicleQuery para vehicleId=${id}`, {label: LOG_LABEL});
      const {allowed, nextBlockingReservationId} = await canSoftInactivateVehicleQuery(id);
      logger.info(`Resultado canSoftInactivateVehicleQuery: ${JSON.stringify({
        allowed,
        nextBlockingReservationId
      })}`, {label: LOG_LABEL});
      if (!allowed) {
        logger.warn(`Inactivación bloqueada por reservas actuales/próximas`, {label: LOG_LABEL});
        return res.status(409).json({
          localKey: 'backendRes.vehicles.upcomingReservations',
          message: 'El vehículo tiene reservas actuales o próximas.',
          reservation_id: nextBlockingReservationId
        });
      }
    }

    // --- Command principal ---
    logger.info(`Ejecutando updateVehicleWithImagesCommand`, {label: LOG_LABEL});
    const result = await updateVehicleWithImagesCommand(
      id,
      patch,
      {newImageUrls, makePrimary, deleteImageIds, primaryImageId},
      {userId: req.user?.id}
    );

    logger.info(`Resultado DB updateVehicleWithImagesCommand: ${JSON.stringify({
      found: Boolean(result),
      id: result?.id,
      status: result?.status,
      is_active: result?.is_active,
      images_count: result?.images?.length
    })}`, {label: LOG_LABEL});

    if (!result) {
      logger.warn(`Vehicle no encontrado (id=${id})`, {label: LOG_LABEL});
      return res.status(404).json({localKey: 'backendRes.vehicles.notFound', message: 'Vehículo no encontrado.'});
    }

    return res.json(result);
  } catch (err) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('license_plate')) {
      logger.warn(`Conflicto de unicidad al actualizar vehículo: ${err.message}`, {label: LOG_LABEL});
      return res.status(409).json({
        localKey: 'backendRes.vehicles.duplicate',
        message: 'Ya existe un vehículo con los mismos datos (ej. matrícula).'
      });
    }
    logger.error(`Update vehicle failed: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({
      localKey: 'snackBarMessages.generalError',
      message: 'Algo ha salido mal. Por favor reintente o contacte con soporte'
    });
  } finally {
    logger.info(`Finaliza updateVehicle.`, {label: LOG_LABEL});
  }
}


export async function createVehicle(req, res) {
  logger.info(`Ingresa a createVehicle.`, {label: LOG_LABEL});

  // Log de parámetros crudos
  logger.info(`Parámetros recibidos: ${JSON.stringify({
    params: req.params,
    query: req.query,
    body: req.body,
    filesCount: (req.files || []).length
  })}`, {label: LOG_LABEL});

  try {
    // required fields
    const required = ['brand_id', 'type_id', 'model', 'year', 'license_plate', 'price_per_hour'];
    for (const k of required) {
      if (req.body[k] == null || req.body[k] === '') {
        logger.warn(`Falta campo requerido: ${k}`, {label: LOG_LABEL});
        return res.status(400).json({
          localKey: 'backendRes.vehicles.missingField',
          message: `Falta campo requerido: ${k}`,
          field: k
        });
      }
    }

    // numeric coercion donde corresponde
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
      maintenance_mileage: req.body.maintenance_mileage != null ? Number(req.body.maintenance_mileage) : null,
      price_per_hour: Number(req.body.price_per_hour),
      price_per_day: req.body.price_per_day != null ? Number(req.body.price_per_day) : null,
      insurance_fee: req.body.insurance_fee != null ? Number(req.body.insurance_fee) : null,
    };

    const makePrimary = String(req.body.make_primary || '').toLowerCase() === 'true';
    const fileUrls = (req.files || []).map(f => buildPublicUrl(req, `uploads/vehicles/${f.filename}`));

    logger.info(`Payload normalizado para create: ${JSON.stringify({
      payload,
      images: {fileUrls, makePrimary},
      userId: req.user?.id
    })}`, {label: LOG_LABEL});

    const result = await createVehicleWithImages(payload, fileUrls, makePrimary, {userId: req.user?.id});

    logger.info(`Resultado DB createVehicleWithImages: ${JSON.stringify({
      id: result?.id,
      status: result?.status,
      is_active: result?.is_active,
      images_count: result?.images?.length
    })}`, {label: LOG_LABEL});

    return res.status(201).json(result);
  } catch (err) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('license_plate')) {
      logger.warn(`Conflict creating vehicle: ${err.message}`, {label: LOG_LABEL});
      return res.status(409).json({
        localKey: 'backendRes.vehicles.duplicate',
        message: 'Ya existe un vehículo con los mismos datos (ej. matrícula).'
      });
    }
    logger.error(`Create vehicle failed: ${err.message}`, {label: LOG_LABEL});
    return res.status(500).json({
      localKey: 'snackBarMessages.generalError',
      message: 'Algo ha salido mal. Por favor reintente o contacte con soporte'
    });
  } finally {
    logger.info(`Finaliza createVehicle.`, {label: LOG_LABEL});
  }
}


export async function listVehicles(req, res) {
  logger.info(`Ingresa a listVehicles.`, {label: LOG_LABEL});

  const parseRoles = (rolesStr = '') =>
    rolesStr.split(',').map(r => r.trim()).filter(Boolean);

  const contextRoles = {
    APP: parseRoles(process.env.APP_ROLES),   // e.g. ['customer']
    WEB: parseRoles(process.env.WEB_ROLES)    // e.g. ['employee','admin']
  };

  try {
    const roles = Array.isArray(req.user?.role)
      ? req.user.role
      : (typeof req.user?.role === 'string'
        ? parseRoles(req.user.role)
        : []);

    const isStaff = roles.some(r => contextRoles.WEB.includes(r));
    // const isCustomer = roles.some(r => contextRoles.APP.includes(r)); // por si necesitás

    const query = {...req.query};

    // Para staff: si no mandaron 'status', default 'all'
    if (isStaff && (query.status == null || query.status === '')) {
      query.status = 'all';
      query.active = false;
    }

    // Para staff: ignorar solapamiento con reservas
    query.ignoreReservationOverlap = !!isStaff;

    // Mantener is_active = true por default (tu service ya lo hace con active='true')
    // Si querés FORZARLO siempre, descomentá la siguiente línea:
    // query.active = 'true';

    if (query.startAt && query.endAt && !Object.prototype.hasOwnProperty.call(query, 'status')) {
      query.status = 'all';
    }

    const vehicles = await listVehiclesByParams(query);
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
