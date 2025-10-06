import pool from '../config/db.js';
import logger from '../utils/logger.js';

const LOG_LABEL = 'CustomerService';

export async function listCustomersQuery({q, active = 'all'}) {
  const params = [];
  const where = ['r.code = \'customer\'']; // only customer role users

  if (q) {
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    where.push(`(p.first_name ILIKE $${params.length - 3} OR p.last_name ILIKE $${params.length - 2} OR p.document_number ILIKE $${params.length - 1} OR p.phone_number ILIKE $${params.length})`);
  }

  if (active !== 'all') {
    params.push(String(active) === 'true');
    where.push(`u.is_active = $${params.length}`);
  }

  const sql = `
      SELECT p.id                               AS "personId",
             dt.code                            AS "documentType",
             p.document_number                  AS "documentNumber",
             p.first_name || ' ' || p.last_name AS "name",
             p.birth_date                       AS "birthDate",
             p.phone_number                     AS "phoneNumber",
             u.is_active                        AS "isActive"
      FROM person.persons p
               JOIN "user".users u ON u.person_id = p.id
               JOIN "user".user_roles ur ON ur.user_id = u.id
               JOIN "user".roles r ON r.id = ur.role_id
               LEFT JOIN person.document_types dt ON dt.id = p.document_type_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.first_name
  `;

  const {rows} = await pool.query(sql, params);
  logger.info(`Listed ${rows.length} customers`, {label: LOG_LABEL});
  return rows;
}

export async function getCustomerDetailQuery(personId) {
  const client = await pool.connect();
  try {
    const personSql = `
        SELECT p.id                               AS "personId",
               dt.code                            AS "documentType",
               p.document_number                  AS "documentNumber",
               p.first_name || ' ' || p.last_name AS "name",
               p.birth_date                       AS "birthDate",
               p.phone_number                     AS "phoneNumber",
               u.is_active                        AS "isActive"
        FROM person.persons p
                 JOIN "user".users u ON u.person_id = p.id
                 LEFT JOIN person.document_types dt ON dt.id = p.document_type_id
        WHERE p.id = $1
    `;
    const {rows: personRows} = await client.query(personSql, [personId]);
    if (!personRows.length) return null;

    const docsSql = `
        SELECT type,
               front_file_path AS "frontFilePath",
               back_file_path  AS "backFilePath",
               expiration_date AS "expirationDate",
               entry_date      AS "entryDate"
        FROM person.documents
        WHERE person_id = $1
        ORDER BY type
    `;
    const {rows: docs} = await client.query(docsSql, [personId]);

    return {...personRows[0], documents: docs};
  } catch (err) {
    logger.error(`getCustomerDetailQuery error: ${err.message}`, {label: LOG_LABEL});
    throw err;
  } finally {
    client.release();
  }
}
