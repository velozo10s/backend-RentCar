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

/** Check if a vehicle can be soft-inactivated.
 *  Not allowed if there is a reservation in statuses (confirmed, active)
 *  whose time window is:
 *   - current:   now ∈ [start_at, end_at)
 *   - upcoming:  end_at > now()
 */
export async function canSoftInactivateVehicleQuery(vehicleId) {
  const client = await pool.connect();
  try {
    const sql = `
        SELECT r.id
        FROM reservation.reservation_items ri
                 JOIN reservation.reservations r ON r.id = ri.reservation_id
        WHERE ri.vehicle_id = $1
          AND r.status = ANY ($2::text[])
          AND r.end_at > NOW()::timestamptz
        ORDER BY r.start_at
        LIMIT 1
    `;
    const statuses = ['confirmed', 'active'];
    const {rows} = await client.query(sql, [vehicleId, statuses]);
    return {allowed: rows.length === 0, nextBlockingReservationId: rows[0]?.id || null};
  } catch (err) {
    logger.error(`canSoftInactivateVehicleQuery error: ${err.message}`, {label: logLabel, vehicleId});
    throw err;
  } finally {
    client.release();
  }
}

export async function softInactivateVehicleCommand(vehicleId) {
  const sql = `UPDATE vehicle.vehicles
               SET is_active  = false,
                   updated_at = NOW()
               WHERE id = $1`;
  const {rowCount} = await pool.query(sql, [vehicleId]);
  return rowCount > 0;
}

/** Update vehicle + image operations in one transaction. */
export async function updateVehicleWithImagesCommand(
  vehicleId,
  patch = {},
  imageOps = {newImageUrls: [], makePrimary: false, deleteImageIds: [], primaryImageId: null},
  ctx = {}
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Update fields (partial)
    if (Object.keys(patch).length) {
      const sets = [];
      const vals = [];
      let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        sets.push(`"${k}" = $${i++}`);
        vals.push(v);
      }
      vals.push(vehicleId);
      const updateSql = `
          UPDATE vehicle.vehicles
          SET ${sets.join(', ')},
              updated_at = NOW()
          WHERE id = $${vals.length}
        RETURNING *
      `;
      const upd = await client.query(updateSql, vals);
      if (!upd.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
    } else {
      // ensure the vehicle exists
      const {rowCount} = await client.query(`SELECT 1
                                             FROM vehicle.vehicles
                                             WHERE id = $1`, [vehicleId]);
      if (!rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
    }

    // 2) Delete images if requested
    if (Array.isArray(imageOps.deleteImageIds) && imageOps.deleteImageIds.length) {
      await client.query(
        `DELETE
         FROM vehicle.vehicle_images
         WHERE vehicle_id = $1
           AND id = ANY ($2::int[])`,
        [vehicleId, imageOps.deleteImageIds]
      );
    }

    // 3) Insert new images
    if (Array.isArray(imageOps.newImageUrls) && imageOps.newImageUrls.length) {
      if (imageOps.makePrimary) {
        await client.query(`UPDATE vehicle.vehicle_images
                            SET is_primary = false
                            WHERE vehicle_id = $1`, [vehicleId]);
      }
      for (let idx = 0; idx < imageOps.newImageUrls.length; idx++) {
        const url = imageOps.newImageUrls[idx];
        const isPrimary = imageOps.primaryImageId ? false : (imageOps.makePrimary && idx === 0);
        await client.query(
          `INSERT INTO vehicle.vehicle_images (vehicle_id, url, is_primary)
           VALUES ($1, $2, $3)`,
          [vehicleId, url, isPrimary]
        );
      }
    }

    // 4) Explicitly set a primary image id if provided (overrides)
    if (imageOps.primaryImageId) {
      const {rowCount} = await client.query(
        `SELECT 1
         FROM vehicle.vehicle_images
         WHERE id = $1
           AND vehicle_id = $2`,
        [imageOps.primaryImageId, vehicleId]
      );
      if (rowCount) {
        await client.query(`UPDATE vehicle.vehicle_images
                            SET is_primary = false
                            WHERE vehicle_id = $1`, [vehicleId]);
        await client.query(`UPDATE vehicle.vehicle_images
                            SET is_primary = true
                            WHERE id = $1`, [imageOps.primaryImageId]);
      }
    }

    // 5) Return current snapshot
    const {rows} = await client.query(
      `
          SELECT v.*,
                 COALESCE(
                         (SELECT jsonb_agg(jsonb_build_object('id', vi.id, 'url', vi.url, 'is_primary', vi.is_primary)
                                           ORDER BY vi.is_primary DESC, vi.id)
                          FROM vehicle.vehicle_images vi
                          WHERE vi.vehicle_id = v.id), '[]'
                 ) AS images
          FROM vehicle.vehicles v
          WHERE v.id = $1
      `,
      [vehicleId]
    );

    await client.query('COMMIT');
    logger.info('Vehicle updated', {label: logLabel, vehicleId, userId: ctx.userId});
    return rows[0] || null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    logger.error(`updateVehicleWithImagesCommand error: ${err.message}`, {label: logLabel, vehicleId});
    throw err;
  } finally {
    client.release();
  }
}

export async function createVehicleWithImages(payload, imageUrls = [], makePrimary = false, ctx = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    logger.info(`🛠 Construyendo insert the vehiculos: ${JSON.stringify(payload)} y ${JSON.stringify(imageUrls)}`, {
      label: logLabel
    });


    // build INSERT (parameterized)
    const fields = [
      'brand_id', 'type_id', 'model', 'year', 'license_plate', 'vin', 'color', 'transmission',
      'seats', 'fuel_type', 'fuel_capacity', 'price_per_hour', 'price_per_day', 'insurance_fee', 'maintenance_mileage',
      'mileage'
    ];
    const cols = [];
    const ph = [];
    const vals = [];
    let i = 1;

    for (const f of fields) {
      if (typeof payload[f] !== 'undefined' && payload[f] !== null) {
        cols.push(`"${f}"`);
        ph.push(`$${i++}`);
        vals.push(payload[f]);
      }
    }

    const insertSql = `
        INSERT INTO vehicle.vehicles (${cols.join(', ')})
        VALUES (${ph.join(', ')})
        RETURNING *
    `;

    logger.info('Inserting vehicle', {label: logLabel, userId: ctx.userId});
    const {rows} = await client.query(insertSql, vals);
    const vehicle = rows[0];

    // insert images (if any)
    let images = [];
    if (Array.isArray(imageUrls) && imageUrls.length) {
      if (makePrimary) {
        await client.query(`UPDATE vehicle.vehicle_images
                            SET is_primary = false
                            WHERE vehicle_id = $1`, [vehicle.id]);
      }

      for (let idx = 0; idx < imageUrls.length; idx++) {
        const url = imageUrls[idx];
        const isPrimary = makePrimary ? idx === 0 : false;
        const {rows: imgRows} = await client.query(
          `INSERT INTO vehicle.vehicle_images (vehicle_id, url, is_primary)
           VALUES ($1, $2, $3)
           RETURNING id, url, is_primary`,
          [vehicle.id, url, isPrimary]
        );
        images.push(imgRows[0]);
      }
    }

    await client.query('COMMIT');

    return {
      ...vehicle,
      images
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listVehiclesByParams(opts = {}) {
  const {
    q,
    brand_id,
    type_id,
    seats_min,
    price_max,
    status = 'available',        // este default lo podés sobreescribir en el controller para staff
    active = 'true',
    sort = 'created_at',
    order = 'desc',
    page = 1,
    per_page = 12,
    startAt,
    endAt,
    blockStatuses = ['confirmed', 'active'],

    // 🔽 NUEVO: para staff (empleado/admin) poder ignorar solapamiento de reservas
    ignoreReservationOverlap = false
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

  // 🔒 Mantener is_active = true siempre (a menos que explícitamente lo cambies)
  const activeBool = sqlBool(active);
  if (activeBool !== null && activeBool === true) {
    params.push(activeBool);
    where.push(`v.is_active = $${params.length}`);
  }

  // 🎯 status: si viene 'all' se ignora; si viene otro, se filtra
  if (status && status !== 'all') {
    params.push(status);
    where.push(`v.status = $${params.length}`);
  }

  // 📅 Filtro de disponibilidad por reservas:
  // - cliente con fechas: aplicar
  // - cliente sin fechas: NO aplica (ya estaba así porque requiere startAt & endAt)
  // - staff (empleado/admin): NO aplica incluso con fechas
  if (startAt && endAt && !ignoreReservationOverlap) {
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

    const res = await client.query(pageSql, pageParams);

    logger.info(`${res.rows.length > 0 ? `✅ Vehiculos encontrados: ${JSON.stringify(res.rows)}` : `⚠️ No se han encontrado los vehiculos.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows : [];

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
               vt.id                                                      AS type_id,
               vt.name                                                    AS vehicle_type,
               vb.id                                                      AS brand_id,
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
                                'id', vi.id,
                                'url', vi.url,
                                'is_primary', vi.is_primary
                        )
                                ) FILTER (WHERE vi.id IS NOT NULL), '[]') AS images

        FROM vehicle.vehicles v
                 JOIN vehicle.vehicle_brands vb ON v.brand_id = vb.id
                 LEFT JOIN countries c ON vb.country_code = c.code
                 JOIN vehicle.vehicle_types vt ON v.type_id = vt.id
                 LEFT JOIN vehicle.vehicle_images vi ON vi.vehicle_id = v.id

        WHERE v.id = $1

        GROUP BY v.id, vb.id, vb.name, c.name, vt.id, vt.name, vt.description
    `;

    const values = [vehicleId];
    const res = await pool.query(query, values);

    logger.info(`${res.rows.length > 0 ? `✅ Vehiculo encontrado: ${JSON.stringify(res.rows[0])}` : `⚠️ No se ha encontrado el vehiculo.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows[0] : []

  } catch (error) {
    logger.error(`❌ Error en el findVehicleById: ${error.message}`, {label: logLabel});
    throw error;
  }
}

export const findBrands = async () => {
  logger.info(`🔍 Buscando marca de vehiculos.`, {label: logLabel});
  try {
    const query = `
        select vb.id, vb.name, vb.country_code
        from vehicle.vehicle_brands vb
    `;

    const res = await pool.query(query);

    logger.info(`${res.rows.length > 0 ? `✅ Marcas encontradas: ${JSON.stringify(res.rows)}` : `⚠️ No se han encontrado las marcas de vehiculos.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows : []

  } catch (error) {
    logger.error(`❌ Error en el findBrands: ${error.message}`, {label: logLabel});
    throw error;
  }
}

export const findTypes = async () => {
  logger.info(`🔍 Buscando tipos de vehiculos.`, {label: logLabel});
  try {
    const query = `
        select vt.id, vt.name, vt.description
        from vehicle.vehicle_types vt
    `;

    const res = await pool.query(query);

    logger.info(`${res.rows.length > 0 ? `✅ Tipos de vehiculos encontrados: ${JSON.stringify(res.rows)}` : `⚠️ No se han encontrado los tipos de vehiculos.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows : []

  } catch (error) {
    logger.error(`❌ Error en el findTypes: ${error.message}`, {label: logLabel});
    throw error;
  }
}

export async function fetchVehiclesByIds(clientOrPool, vehicleIds) {
  logger.info(`🚗 Buscando vehículos por IDs: ${vehicleIds.join(', ')}`, {label: logLabel, total: vehicleIds.length});
  try {
    const res = await clientOrPool.query(
      `SELECT id, price_per_hour, price_per_day, is_active, status
       FROM vehicle.vehicles
       WHERE id = ANY ($1::int[])`,
      [vehicleIds]
    );

    logger.info(`${res.rows.length > 0 ? `✅ Vehiculos encontrados: ${JSON.stringify(res.rows)}` : `⚠️ Vehiculos no encontrados`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows : [];

  } catch (error) {
    logger.error(`❌ Error en el fetchVehiclesByIds: ${error.message}`, {label: logLabel});
    throw error;
  }
}
