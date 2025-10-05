// services/employeeService.js
import pool from '../config/db.js';
import logger from '../utils/logger.js';
import bcrypt from 'bcrypt';

const LOG_LABEL = 'EmployeeService';

const maskDoc = (doc) =>
  typeof doc === 'string' && doc.length > 4
    ? doc.slice(0, 2) + '*'.repeat(doc.length - 4) + doc.slice(-2)
    : doc;

export async function listEmployeesQuery({q, active = 'all'} = {}) {
  const started = Date.now();
  const params = [];
  const where = [`ur.role_id = (SELECT id FROM "user".roles WHERE code = 'employee')`];

  // Construcción de filtros (y logging de cómo quedaron)
  if (q) {
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    where.push(`(u.username ILIKE $${params.length - 3} OR u.email ILIKE $${params.length - 2} OR p.first_name ILIKE $${params.length - 1} OR p.last_name ILIKE $${params.length})`);
  }
  if (active !== 'all') {
    params.push(String(active) === 'true');
    where.push(`u.is_active = $${params.length}`);
  }

  const sql = `
      SELECT u.id,
             u.username,
             u.email,
             u.is_active,
             u.created_at,
             p.id AS person_id,
             p.first_name,
             p.last_name,
             p.document_number,
             p.phone_number
      FROM "user".users u
               JOIN "user".user_roles ur ON ur.user_id = u.id
               JOIN "person".persons p ON p.id = u.person_id
      WHERE ${where.join(' AND ')}
      ORDER BY u.created_at DESC
  `;

  logger.info('listEmployeesQuery: built filters', {
    label: LOG_LABEL,
    filters: {q: q || null, active},
    where_clauses: where,
    params_preview: params // contiene q e is_active; no hay secretos
  });

  const {rows} = await pool.query(sql, params);

  logger.info('listEmployeesQuery: result', {
    label: LOG_LABEL,
    took_ms: Date.now() - started,
    count: rows?.length || 0,
    sample_ids: rows?.slice(0, 5).map(r => r.id)
  });

  return rows; // [] if none
}

/** Create employee: create person (optional), user, and attach 'employee' role */
export async function addEmployeeCommand(body, ctx = {}) {
  const started = Date.now();
  const {
    person_id,
    first_name, last_name,
    document_type_id, document_number, phone_number, nationality, birth_date,
    username, email, password
  } = body;

  logger.info('addEmployeeCommand: enter', {
    label: LOG_LABEL,
    by: ctx.userId || null,
    using_existing_person: !!person_id,
    body_preview: {
      person_id: person_id || null,
      first_name,
      last_name,
      document_type_id: document_type_id ?? null,
      document_number: maskDoc(document_number ?? ''),
      phone_number: phone_number ?? null,
      nationality: nationality ?? null,
      birth_date: birth_date ?? null,
      username,
      email
      // password NO se loguea
    }
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let personId = person_id || null;

    if (!personId) {
      logger.info('addEmployeeCommand: creating new person', {
        label: LOG_LABEL,
        by: ctx.userId || null
      });

      const personSql = `
          INSERT INTO person.persons
          (document_type_id, document_number, first_name, last_name, phone_number, nationality, birth_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
      `;
      const {rows: prow} = await client.query(personSql, [
        document_type_id ?? null,
        document_number ?? null,
        first_name,
        last_name,
        phone_number ?? null,
        nationality ?? null,
        birth_date ?? null
      ]);

      personId = prow[0].id;
      logger.info('addEmployeeCommand: person created', {
        label: LOG_LABEL,
        person_id: personId
      });
    } else {
      logger.info('addEmployeeCommand: using existing person', {
        label: LOG_LABEL,
        person_id: personId
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const userSql = `
        INSERT INTO "user".users
            (person_id, username, email, password, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id, username, email, is_active, created_at
    `;
    const {rows: urow} = await client.query(userSql, [personId, username, email, hashed]);
    const user = urow[0];

    logger.info('addEmployeeCommand: user created', {
      label: LOG_LABEL,
      createdUserId: user?.id,
      person_id: personId
    });

    // attach role 'employee'
    const roleSql = `INSERT INTO "user".user_roles (user_id, role_id)
                     SELECT $1, r.id
                     FROM "user".roles r
                     WHERE r.code = 'employee'`;
    await client.query(roleSql, [user.id]);

    logger.info('addEmployeeCommand: role attached', {
      label: LOG_LABEL,
      user_id: user.id,
      role: 'employee'
    });

    await client.query('COMMIT');
    logger.info('addEmployeeCommand: success', {
      label: LOG_LABEL,
      by: ctx.userId || null,
      createdUserId: user.id,
      took_ms: Date.now() - started
    });

    return {...user, person_id: personId, role: 'employee'};
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    logger.error(`addEmployeeCommand error: ${err.message}`, {
      label: LOG_LABEL,
      took_ms: Date.now() - started,
      stack: err.stack
    });
    throw err;
  } finally {
    client.release();
  }
}

/** Update employee: supports is_active toggle and basic fields (username/email/password) */
export async function updateEmployeeCommand(userId, patch = {}, ctx = {}) {
  const started = Date.now();
  const client = await pool.connect();

  // nunca loguear password ni hash
  const patchKeys = Object.keys(patch || {}).map(k => (k === 'password' ? 'password(***redacted***)' : k));
  logger.info('updateEmployeeCommand: enter', {
    label: LOG_LABEL,
    by: ctx.userId || null,
    userId,
    patch_keys: patchKeys
  });

  try {
    await client.query('BEGIN');

    const sets = [];
    const vals = [];
    let i = 1;

    if (typeof patch.is_active !== 'undefined') {
      sets.push(`is_active = $${i++}`);
      vals.push(Boolean(patch.is_active));
    }
    if (patch.username) {
      sets.push(`username = $${i++}`);
      vals.push(patch.username);
    }
    if (patch.email) {
      sets.push(`email = $${i++}`);
      vals.push(patch.email);
    }
    if (patch.password) {
      const hashed = await bcrypt.hash(patch.password, 10);
      sets.push(`password = $${i++}`);
      vals.push(hashed);
    }

    if (!sets.length) {
      logger.info('updateEmployeeCommand: nothing to update, fetching current user', {
        label: LOG_LABEL,
        userId
      });
      const {rows} = await client.query(
        `SELECT id, username, email, is_active, created_at
         FROM "user".users
         WHERE id = $1`,
        [userId]
      );
      await client.query('COMMIT');
      const found = rows[0] || null;
      logger.info('updateEmployeeCommand: return current', {
        label: LOG_LABEL,
        user_found: !!found,
        took_ms: Date.now() - started
      });
      return found;
    }

    vals.push(userId);

    const updateSql = `
        UPDATE "user".users
        SET ${sets.join(', ')}
--             updated_at = NOW()
        WHERE id = $${vals.length}
      RETURNING id, username, email, is_active, created_at
    `;

    logger.info('updateEmployeeCommand: updating', {
      label: LOG_LABEL,
      userId,
      sets_count: sets.length
    });

    const {rows} = await client.query(updateSql, vals);
    await client.query('COMMIT');

    const out = rows[0] || null;

    logger.info('updateEmployeeCommand: success', {
      label: LOG_LABEL,
      by: ctx.userId || null,
      userId,
      updated: !!out,
      took_ms: Date.now() - started
    });

    if (out) {
      logger.debug?.('updateEmployeeCommand: output row preview', {
        label: LOG_LABEL,
        out_preview: {id: out.id, username: out.username, email: out.email, is_active: out.is_active}
      });
    }

    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    logger.error(`updateEmployeeCommand error: ${err.message}`, {
      label: LOG_LABEL,
      by: ctx.userId || null,
      userId,
      took_ms: Date.now() - started,
      stack: err.stack
    });
    throw err;
  } finally {
    client.release();
  }
}
