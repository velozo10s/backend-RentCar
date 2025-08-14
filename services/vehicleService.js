import pool from '../config/db.js';
import logger from '../utils/logger.js';

const logLabel = 'VehicleService';

function sanitizeSort(sort, allowed) {
  return allowed.includes(String(sort)) ? String(sort) : allowed[0];
}

function sanitizeOrder(order) {
  const o = String(order || '').toLowerCase();
  return o === 'asc' || o === 'desc' ? o : 'desc';
}

function sqlBool(val) {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return null;
}

export async function listVehiclesByParams(opts = {}) {
  const {
    q,
    brand_id,
    type_id,
    seats_min,
    price_max,
    status = 'available',
    active = 'true',
    sort = 'created_at',
    order = 'desc',
    page = 1,
    per_page = 12,
    startAt,
    endAt,
    blockStatuses = ['confirmed', 'active']
  } = opts;

  logger.info(`🔍 Iniciando búsqueda de vehículos con filtros: ${JSON.stringify(opts)}`, {label: logLabel});

  const allowedSort = ['created_at', 'price_per_hour', 'price_per_day', 'year'];
  const sortCol = sanitizeSort(sort, allowedSort);
  const sortDir = sanitizeOrder(order);

  const limit = Math.min(Math.max(parseInt(per_page || 12, 10), 1), 100);
  const offset = (Math.max(parseInt(page || 1, 10), 1) - 1) * limit;

  const where = [];
  const params = [];
  const push = (val) => {
    params.push(val);
    return `$${params.length}`;
  };

  if (q) {
    params.push(q, q, q);
    where.push(`(b.name ILIKE '%' || $${params.length - 2} || '%' OR v.model ILIKE '%' || $${params.length - 1} || '%' OR v.license_plate ILIKE '%' || $${params.length} || '%')`);
  }
  if (brand_id) {
    params.push(Number(brand_id));
    where.push(`v.brand_id = $${params.length}`);
  }
  if (type_id) {
    params.push(Number(type_id));
    where.push(`v.type_id = $${params.length}`);
  }
  if (seats_min) {
    params.push(Number(seats_min));
    where.push(`v.seats >= $${params.length}`);
  }
  if (price_max) {
    params.push(Number(price_max), Number(price_max));
    where.push(`((v.price_per_day IS NOT NULL AND v.price_per_day <= $${params.length - 1})
                 OR (v.price_per_day IS NULL AND v.price_per_hour <= $${params.length}))`);
  }
  if (status && status !== 'all') {
    params.push(status);
    where.push(`v.status = $${params.length}`);
  }
  const activeBool = sqlBool(active);
  if (activeBool !== null) {
    params.push(activeBool);
    where.push(`v.is_active = $${params.length}`);
  }

  if (startAt && endAt) {
    const pStart = push(startAt);
    const pEnd = push(endAt);
    const pBlock = push(blockStatuses);

    where.push(`
      NOT EXISTS (
        SELECT 1
        FROM reservation.reservation_items ri
        JOIN reservation.reservations r ON r.id = ri.reservation_id
        WHERE ri.vehicle_id = v.id
          AND r.status = ANY(${pBlock}::text[])
          AND tstzrange(r.start_at, r.end_at, '[)') && tstzrange(${pStart}::timestamptz, ${pEnd}::timestamptz, '[)')
      )
    `);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  logger.info(`🛠 Construyendo consulta de listado de vehículos. Filtros aplicados: ${whereSql}`, {
    label: logLabel,
    params
  });

  const client = await pool.connect();
  try {
    const pageSql = `
        SELECT v.*,
               b.name    AS brand_name,
               t.name    AS type_name,
               (SELECT vi.url
                FROM vehicle.vehicle_images vi
                WHERE vi.vehicle_id = v.id
                ORDER BY vi.is_primary DESC, vi.id
                LIMIT 1) AS primary_image
        FROM vehicle.vehicles v
                 JOIN vehicle.vehicle_brands b ON b.id = v.brand_id
                 JOIN vehicle.vehicle_types t ON t.id = v.type_id
            ${whereSql}
        ORDER BY v.${sortCol} ${sortDir}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const pageParams = [...params, limit, offset];

    logger.info(`📄 Ejecutando consulta de vehículos (página ${page}, límite ${limit})`, {label: logLabel});

    const pageRes = await client.query(pageSql, pageParams);

    if (pageRes.rows.length > 0) {
      logger.info(`✅ Consulta completada. Vehículos encontrados: ${pageRes.rows.length}`, {label: logLabel});

      return pageRes.rows;
    } else {
      logger.info(`⚠️ No se han encontrado vehiculos disponibles para el filtro aplicado.`, {label: logLabel});
      return {error: 'No se han encontrado vehiculos disponibles para el filtro aplicado.'};
    }

  } catch (err) {
    logger.error(`❌ Error listando vehículos: ${err.message}`, {label: logLabel});
    throw err;
  } finally {
    logger.info(`🔚 Liberando conexión a la base de datos`, {label: logLabel});
    client.release();
  }
}


export const findVehicleById = async (vehicleId) => {
  logger.info(`🔍 Buscando datos del vehiculo con id: ${vehicleId}.`, {label: logLabel});
  try {
    const query = `
        SELECT v.id,
               vt.name                                                    AS vehicle_type,
               vb.name                                                    AS brand_name,
               v.model,
               v.year,
               c.name                                                     AS brand_country,
               v.license_plate,
               v.vin,
               v.color,
               v.transmission,
               v.seats,
               v.fuel_type,
               v.fuel_capacity,
               v.price_per_hour,
               v.price_per_day,
               v.insurance_fee,
               v.mileage,
               v.maintenance_mileage,
               v.status,
               v.is_active,
               v.created_at,
               v.updated_at,
               vt.name                                                    AS type_name,
               vt.description                                             AS vehicle_type_description,

               COALESCE(json_agg(
                        json_build_object(
                                'url', vi.url,
                                'is_primary', vi.is_primary
                        )
                                ) FILTER (WHERE vi.id IS NOT NULL), '[]') AS images

        FROM vehicle.vehicles v
                 JOIN vehicle.vehicle_brands vb ON v.brand_id = vb.id
                 LEFT JOIN countries c ON vb.country_code = c.code
                 JOIN vehicle.vehicle_types vt ON v.type_id = vt.id
                 LEFT JOIN vehicle.vehicle_images vi ON vi.vehicle_id = v.id

        WHERE v.id = $1 -- Replace with actual ID or use parameter in code

        GROUP BY v.id, vb.name, c.name, vt.name, vt.description
    `;

    const values = [vehicleId];
    const vehicleResult = await pool.query(query, values);

    if (vehicleResult.rows.length > 0) {

      const vehicle = vehicleResult.rows[0];

      logger.info(`✅ Datos del vehiculo con id ${vehicleId}: ${JSON.stringify(vehicle)}`, {label: logLabel});

      return vehicle;
    } else {
      logger.info(`⚠️ No se ha encontrado un vehiculo asociado al id: ${vehicleId}.`, {label: logLabel});
      return {error: 'No existe el vehiculo con el id enviado.', details: {vehicleId: vehicleId}};
    }
  } catch (error) {
    logger.error(`❌ Error en el findVehicleById: ${error.message}`, {label: logLabel});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}
