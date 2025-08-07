import pool from '../config/db.js';
import logger from "../utils/logger.js";

export const findVehicleById = async (vehicleId) => {
  logger.info(`🔍 Buscando datos del vehiculo con id: ${vehicleId}.`, {label: 'Service'});
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
    const userResult = await pool.query(query, values);

    if (userResult.rows.length > 0) {

      const vehicle = userResult.rows[0];

      logger.info(`✅ Datos del vehiculo con id ${vehicleId}: ${JSON.stringify(vehicle)}`, {label: 'Service'});

      return vehicle;
    } else {
      logger.info(`⚠️ No se ha encontrado un vehiculo asociado al id: ${vehicleId}.`, {label: 'Service'});
      return {error: 'No existe el vehiculo con el id enviado.', details: {codUser: vehicleId}};
    }
  } catch (error) {
    logger.error(`❌ Error en el findVehicleById: ${error.message}`, {label: 'Service'});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}
