import pool from '../config/db.js';
import fs from 'fs';
import logger from "../utils/logger.js";

const logLabel = 'userService';

export const findPersonByCodUser = async (codUser) => {
  logger.info(`🔍 Buscando datos del usuario con id: ${codUser}.`, {label: logLabel});
  try {
    const query = `
        select dt.code           as               "documentType",
               p.document_number as               "documentNumber",
               p.first_name || ' ' || p.last_name name,
               p.birth_date      as               "birthDate",
               p.phone_number    as               "phoneNumber",
               u.is_active       as               "isActive"
        from person.persons p
                 left join "user".users u on p.id = u.person_id
                 left join person.document_types dt on p.document_type_id = dt.id
        where u.id = $1
    `;

    const values = [codUser];
    const res = await pool.query(query, values);

    logger.info(`${res.rows.length > 0 ? `✅ Usuario encontrado: ${JSON.stringify(res.rows)}` : `⚠️ No se ha encontrado el usuario.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows[0] : [];

  } catch (error) {
    logger.error(`❌ Error en el findPersonByCodUser: ${error.message}`, {label: logLabel});
    throw error;
  }
}

export const findDocumentsByUserId = async (codUser) => {
  logger.info(`🔍 Buscando documentos del usuario con id: ${codUser}.`, {label: logLabel});
  try {
    const query = `
        SELECT d.type,
               d.front_file_path as "frontFilePath",
               d.back_file_path  as "backFilePath",
               d.expiration_date as "expirationDate",
               d.entry_date      as "entryDate"
        FROM person.documents d
                 JOIN person.persons p ON p.id = d.person_id
                 JOIN "user".users u ON u.person_id = p.id
        WHERE u.id = $1
    `;

    const values = [codUser];
    const res = await pool.query(query, values);

    logger.info(`${res.rows.length > 0 ? `✅ Documentos encontrados: ${JSON.stringify(res.rows)}` : `⚠️ No se ha encontrado los documentos.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows : []

  } catch (error) {
    logger.error(`❌ Error en el findDocumentsByUserId: ${error.message}`, {label: logLabel});
    throw error;
  }
}

export const findDocumentTypeById = async (document_type_id) => {
  logger.info(`🔍 Buscando tipo de documento con id: ${document_type_id}`, {label: logLabel});
  try {
    const query = `
        SELECT code, description
        FROM person.document_types
        WHERE id = $1
    `;
    const values = [document_type_id];
    const res = await pool.query(query, values);

    logger.info(`${res.rows.length > 0 ? `✅ Tipo de documento encontrado: ${JSON.stringify(res.rows[0])}` : `⚠️ No se ha encontrado el tipo de documento.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows : []

  } catch (error) {
    logger.error(`❌ Error en findDocumentTypeById: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const findUserByUsernameOrEmailAndContext = async (client, username, email, roleCodes) => {
  logger.info(`🔍 Buscando usuario por username/email en contexto de roles`, {label: logLabel});
  try {
    const res = await client.query(
      `SELECT u.id,
              u.username           as "username",
              u.email,
              u.is_email_validated as "isEmailValidated",
              u.password           as "userPassword",
              r.code                  role
       FROM "user".users u
                JOIN "user".user_roles ur ON u.id = ur.user_id
                JOIN "user".roles r ON r.id = ur.role_id
       WHERE u.is_active = true
         AND (u.username = $1 OR u.email = $2)
         AND r.code = ANY ($3::text[])`,
      [username, email, roleCodes]
    );
    logger.info(`${res.rows.length > 0 ? `✅ Usuario encontrado: ${JSON.stringify(res.rows[0])}` : `⚠️ No se ha encontrado el usuario.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows[0] : [];
  } catch (error) {
    logger.error(`❌ Error en findUserByUsernameOrEmailAndContext: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const findExistingPerson = async (documentNumber, documentTypeId) => {
  logger.info(`🔍 Buscando persona con doc ${documentNumber}`, {label: logLabel});
  try {
    const res = await pool.query(
      `SELECT id
       FROM person.persons p
       WHERE p.document_number = $1
         AND p.document_type_id = $2`,
      [documentNumber, documentTypeId]
    );

    logger.info(`${res.rows.length > 0 ? `✅ Persona: ${JSON.stringify(res.rows[0])}` : `⚠️ No se ha encontrado la persona.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows[0] : [];

  } catch (error) {
    logger.error(`❌ Error en findExistingPerson: ${error.message}`, {label: logLabel});
    throw error;
  }
};

export const findDocumentTypeByCode = async (documentType) => {
  logger.info(`🔍 Buscando id del tipo de documento ${documentType}.`, {label: logLabel});
  try {
    const res = await pool.query(
      `SELECT id
       FROM person.document_types dt
       WHERE dt.code = $1`,
      [documentType]
    );

    logger.info(`${res.rows.length > 0 ? `✅ Tipo de documento: ${JSON.stringify(res.rows[0])}` : `⚠️ No se ha encontrado el tipo de documento.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows[0] : [];
  } catch (error) {
    logger.error(`❌ Error en findExistingPerson: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const insertPerson = async (client, personData) => {
  logger.info(`➕ Insertando persona`, {label: logLabel});
  try {
    const {
      documentTypeId,
      documentNumber,
      firstName,
      lastName,
      phoneNumber,
      nationalityCode,
      birthDate
    } = personData;

    const result = await client.query(
      `INSERT INTO person.persons (document_type_id, document_number, first_name, last_name, phone_number, nationality,
                                   birth_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [documentTypeId, documentNumber, firstName, lastName, phoneNumber, nationalityCode, birthDate]
    );

    logger.info(`✅ Persona insertada con ID: ${result.rows[0].id}`, {label: logLabel});
    return result.rows[0].id;
  } catch (error) {
    logger.error(`❌ Error en insertPerson: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const insertDocument = async (client, document) => {
  const {
    person_id,
    type,
    front_file_path,
    back_file_path,
    expiration_date = null,
    entry_date = null,
    observations = null
  } = document;

  logger.info(`📤 Insertando documento para persona ${person_id}, tipo ${type}`, {label: logLabel});

  try {
    const existing = await client.query(
      `SELECT front_file_path, back_file_path
       FROM person.documents
       WHERE person_id = $1
         AND type = $2`,
      [person_id, type]
    );

    if (existing.rows.length > 0) {
      const {front_file_path: oldFront, back_file_path: oldBack} = existing.rows[0];

      [oldFront, oldBack].forEach(path => {
        try {
          if (fs.existsSync(path)) {
            fs.unlinkSync(path);
            logger.info(`🧹 Archivo eliminado: ${path}`, {label: logLabel});
          }
        } catch (e) {
          logger.warn(`⚠️ No se pudo eliminar ${path}. ${e.message}`, {label: logLabel});
        }
      });
    }

    await client.query(
      `INSERT INTO person.documents (person_id, type, front_file_path, back_file_path,
                                     expiration_date, entry_date, observations,
                                     uploaded_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
       ON CONFLICT (person_id, type) DO UPDATE SET front_file_path = EXCLUDED.front_file_path,
                                                   back_file_path  = EXCLUDED.back_file_path,
                                                   expiration_date = EXCLUDED.expiration_date,
                                                   entry_date      = EXCLUDED.entry_date,
                                                   observations    = EXCLUDED.observations,
                                                   updated_at      = NOW()`,
      [
        person_id,
        type,
        front_file_path,
        back_file_path,
        expiration_date,
        entry_date,
        observations
      ]
    );

    logger.info(`✅ Documento insertado/actualizado correctamente`, {label: logLabel});
  } catch (error) {
    logger.error(`❌ Error en insertDocument: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const findExistingUser = async (username, email) => {
  logger.info(`🔍 Buscando usuario con username/email`, {label: logLabel});
  try {
    const res = await pool.query(
      `SELECT id
       FROM "user".users
       WHERE is_active = true
         AND (username = $1 OR email = $2)`,
      [username, email]
    );

    logger.info(`${res.rows.length > 0 ? `✅ Usuario encontrado: ${JSON.stringify(res.rows[0])}` : `⚠️ No se ha encontrado el usuario.`}`, {label: logLabel});

    return res.rows.length > 0 ? res.rows[0] : [];

  } catch (error) {
    logger.error(`❌ Error en findExistingUser: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const insertUser = async (client, userData) => {
  const {personId, username, email, hashedPassword} = userData;
  logger.info(`➕ Insertando usuario para persona ${personId}`, {label: logLabel});

  try {
    const result = await client.query(
      `INSERT INTO "user".users (person_id, username, email, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [personId, username, email, hashedPassword]
    );

    logger.info(`✅ Usuario insertado con ID: ${result.rows[0].id}`, {label: logLabel});
    return result.rows[0].id;
  } catch (error) {
    logger.error(`❌ Error en insertUser: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const getRoleIdByCode = async (client, roleCode) => {
  logger.info(`🔍 Obteniendo role_id para el código: ${roleCode}`, {label: logLabel});
  try {
    const result = await client.query(
      `SELECT id
       FROM "user".roles
       WHERE code = $1`,
      [roleCode]
    );
    logger.info(`✅ Role ID obtenido: ${result.rows[0].id}`, {label: logLabel});
    return result.rows[0].id;
  } catch (error) {
    logger.error(`❌ Error en getRoleIdByCode: ${error.message}`, {label: logLabel});
    throw error;
  }
};


export const assignRoleToUser = async (client, userId, roleId) => {
  logger.info(`🎭 Asignando role ${roleId} al usuario ${userId}`, {label: logLabel});
  try {
    await client.query(
      `INSERT INTO "user".user_roles (user_id, role_id)
       VALUES ($1, $2)`,
      [userId, roleId]
    );
    logger.info(`✅ Rol asignado exitosamente`, {label: logLabel});
  } catch (error) {
    logger.error(`❌ Error en assignRoleToUser: ${error.message}`, {label: logLabel});
    throw error;
  }
};

