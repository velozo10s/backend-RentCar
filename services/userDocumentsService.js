import pool from '../config/db.js';
import logger from '../utils/logger.js';

const LOG_LABEL = 'UserDocumentsService';
const VALID_TYPES = ['document', 'license'];

function ensureValidType(type) {
  if (!VALID_TYPES.includes(type)) {
    const err = new Error(`Invalid document type: ${type}`);
    err.code = 'INVALID_TYPE';
    throw err;
  }
}

/** Consulta si existe doc por (person_id, type) y devuelve la fila simplificada */
export async function selectDocumentsForPersonQuery(personId, type) {
  const start = process.hrtime.bigint();
  ensureValidType(type);
  const logBase = {label: LOG_LABEL, fn: 'selectDocumentsForPersonQuery', personId, type};

  logger.debug('IN fn', logBase);

  const sql = `
      SELECT id,
             person_id,
             type,
             front_file_path,
             back_file_path,
             expiration_date,
             entry_date,
             observations,
             uploaded_at,
             updated_at
      FROM person.documents
      WHERE person_id = $1
        AND type = $2
  `;

  try {
    const {rows} = await pool.query(sql, [personId, type]);
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);

    logger.debug('DB rows fetched', {...logBase, rowsCount: rows.length, elapsedMs});
    return {exists: rows.length > 0, row: rows[0] || null};
  } catch (err) {
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);
    logger.error('DB error on selectDocumentsForPersonQuery', {
      ...logBase,
      elapsedMs,
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

/** Inserta par de archivos (exige ambos por NOT NULL) */
export async function upsertDocumentPairCommand(personId, type, frontUrl, backUrl) {
  const start = process.hrtime.bigint();
  ensureValidType(type);
  const logBase = {label: LOG_LABEL, fn: 'upsertDocumentPairCommand', personId, type};

  logger.info('IN fn (upsert pair)', {...logBase, hasFront: !!frontUrl, hasBack: !!backUrl});

  const sql = `
      INSERT INTO person.documents
          (person_id, type, front_file_path, back_file_path)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (person_id, type) DO UPDATE
          SET front_file_path = EXCLUDED.front_file_path,
              back_file_path  = EXCLUDED.back_file_path,
              updated_at      = NOW()
      RETURNING id
  `;

  try {
    const {rows} = await pool.query(sql, [personId, type, frontUrl, backUrl]);
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);

    logger.info('UPSERT pair executed', {...logBase, returnedId: rows[0]?.id, elapsedMs});
    return rows[0];
  } catch (err) {
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);
    logger.error('DB error on upsertDocumentPairCommand', {
      ...logBase,
      elapsedMs,
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

/** Actualiza una o ambas caras (solo si ya existe) */
export async function updateDocumentSidesCommand(personId, type, {front, back}) {
  const start = process.hrtime.bigint();
  ensureValidType(type);
  const logBase = {label: LOG_LABEL, fn: 'updateDocumentSidesCommand', personId, type};

  logger.info('IN fn (update sides)', {
    ...logBase,
    willUpdate: {front: typeof front !== 'undefined', back: typeof back !== 'undefined'}
  });

  const sets = [];
  const vals = [];
  let i = 1;

  if (typeof front !== 'undefined') {
    sets.push(`front_file_path = $${i++}`);
    vals.push(front);
  }
  if (typeof back !== 'undefined') {
    sets.push(`back_file_path  = $${i++}`);
    vals.push(back);
  }

  if (!sets.length) {
    logger.warn('Nothing to update (no sides provided)', logBase);
    return null;
  }

  vals.push(personId);
  vals.push(type);

  const sql = `
      UPDATE person.documents
      SET ${sets.join(', ')},
          updated_at = NOW()
      WHERE person_id = $${vals.length - 1} AND type = $${vals.length}
    RETURNING id
  `;

  try {
    const {rows} = await pool.query(sql, vals);
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);

    logger.info('UPDATE sides executed', {...logBase, updatedId: rows[0]?.id || null, elapsedMs});
    return rows[0] || null;
  } catch (err) {
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);
    logger.error('DB error on updateDocumentSidesCommand', {
      ...logBase,
      elapsedMs,
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}
