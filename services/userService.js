import pool from '../config/db.js';
import fs from 'fs';
import logger from "../utils/logger.js";

export const findUserByCredentials = async (user, email, roles) => {
  logger.info(`Ingresa a findUserByCredentials.`, {label: 'Service'});
  try {
    const query = `
        SELECT u.id       codUser,
               u.username userName,
               u.email,
               u.is_email_validated,
               u.password,
               r.code     role
        FROM users u
                 LEFT JOIN user_roles ur ON u.id = ur.user_id
                 LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.is_active = true
          AND (u.username = $1 OR u.email = $2)
          AND r.code = ANY ($3::text[])
    `;

    const values = [user, email, roles];
    const userResult = await pool.query(query, values);

    if (userResult.rows.length > 0) {

      const foundUser = userResult.rows[0];

      logger.info(`Se ha encontrado un usuario para las credenciales proveidas.`, {label: 'Service'});

      return {codUser: foundUser.id, userName: foundUser.username, password: foundUser.password, role: foundUser.role};
    } else {
      logger.info(`No existe el usuario para las credenciales proveidas.`, {label: 'Service'});
      return {error: 'No existe el usuario para las credenciales proveidas.', details: {user: user}};
    }

  } catch (error) {
    logger.error(`Error en el findUserByCredentials: ${error.message}`, {label: 'Service'});
    return {error: 'Ha ocurrido un error intentando obtener los datos del usuario, reintente.'};
  }
}

export const findPersonByCodUser = async (codUser) => {
  logger.info(`Obteniendo datos del usuario con id: ${codUser}.`, {label: 'Service'});
  try {
    const query = `
        select dt.code                            document_type,
               p.document_number,
               p.first_name || ' ' || p.last_name full_name,
               p.phone_number,
               u.is_active
        from persons p
                 left join users u on p.id = u.person_id
                 left join document_types dt on p.document_type_id = dt.id
        where u.id = $1
    `;

    const values = [codUser];
    const userResult = await pool.query(query, values);

    if (userResult.rows.length > 0) {

      const foundData = userResult.rows[0];

      logger.info(`Datos del usuario con id ${codUser}: ${JSON.stringify(foundData)}`, {label: 'Service'});

      const documents = await findDocumentsByUserId(codUser);

      return {...foundData, codUser, documents};
    } else {
      logger.info(`No se ha encontrado una persona asociada al codUser: ${codUser}.`, {label: 'Service'});
      return {error: 'No existe el usuario con el id enviado.', details: {codUser: codUser}};
    }
  } catch (error) {
    logger.error(`Error en el findPersonByCodUser: ${error.message}`, {label: 'Service'});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export const findDocumentsByUserId = async (codUser) => {
  logger.info(`Obteniendo documentos del usuario con id: ${codUser}.`, {label: 'Service'});
  try {
    const query = `
        SELECT d.type,
               d.front_file_path,
               d.back_file_path,
               to_char(d.expiration_date, 'yyyy-mm-dd') as "expiration_date",
               d.entry_date
        FROM documents d
                 JOIN persons p ON p.id = d.person_id
                 JOIN users u ON u.person_id = p.id
        WHERE u.id = $1
    `;

    const values = [codUser];
    const documentResult = await pool.query(query, values);

    if (documentResult.rows.length > 0) {
      logger.info(`Documentos asociados al usuario: ${codUser}: ${JSON.stringify(documentResult.rows)}`, {label: 'Service'});

      return documentResult.rows;
    } else {
      logger.info(`No se han encontrado documentos asociados al usuario: ${codUser}.`, {label: 'Service'});
      return {error: 'No se encontraron documentos para el id enviado.', details: {codUser: codUser}};
    }
  } catch (error) {
    logger.error(`Error en el findDocumentsByUserId: ${error.message}`, {label: 'Service'});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export const findDocumentTypeById = async (document_type_id) => {
  logger.info(`🔍 Buscando tipo de documento con id: ${document_type_id}`, {label: 'Service'});
  try {
    const query = `
        SELECT code, description
        FROM document_types
        WHERE id = $1
    `;
    const values = [document_type_id];
    const result = await pool.query(query, values);

    if (result.rows.length > 0) {
      const foundData = result.rows[0];
      logger.info(`✅ Tipo de documento encontrado: ${foundData.code}`, {label: 'Service'});
      return {code: foundData.code, description: foundData.description};
    } else {
      logger.info(`⚠️ No se encontró tipo de documento con id: ${document_type_id}`, {label: 'Service'});
      return {error: 'No existe el tipo de documento con el id enviado.', details: {codDocumentType: document_type_id}};
    }
  } catch (error) {
    logger.error(`❌ Error en findDocumentTypeById: ${error.message}`, {label: 'Service'});
    return {error: 'Ha ocurrido un error, reintente.'};
  }
};


export const findUserByUsernameOrEmailAndContext = async (client, username, email, roleCodes) => {
  logger.info(`🔍 Buscando usuario por username/email en contexto de roles`, {label: 'Service'});
  try {
    const result = await client.query(
      `SELECT u.id, r.code as role
       FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON r.id = ur.role_id
       WHERE u.is_active = true
         AND (u.username = $1 OR u.email = $2)
         AND r.code = ANY ($3)`,
      [username, email, roleCodes]
    );
    logger.info(`✅ Resultado: ${result.rows.length} usuario(s) encontrados`, {label: 'Service'});
    return result.rows;
  } catch (error) {
    logger.error(`❌ Error en findUserByUsernameOrEmailAndContext: ${error.message}`, {label: 'Service'});
    return [];
  }
};


export const findExistingPerson = async (documentNumber, documentTypeId) => {
  logger.info(`🔍 Buscando persona con doc ${documentNumber} y tipo ${documentTypeId}`, {label: 'Service'});
  try {
    const result = await pool.query(
      `SELECT id as "codPerson"
       FROM persons
       WHERE document_number = $1
         AND document_type_id = $2`,
      [documentNumber, documentTypeId]
    );
    const found = result.rows[0] || {};
    logger.info(`📄 Persona ${found.codPerson ? 'encontrada' : 'no encontrada'}`, {label: 'Service'});
    return found;
  } catch (error) {
    logger.error(`❌ Error en findExistingPerson: ${error.message}`, {label: 'Service'});
    return {};
  }
};


export const insertPerson = async (client, personData) => {
  logger.info(`➕ Insertando persona`, {label: 'Service'});
  try {
    const {
      document_type_id,
      document_number,
      first_name,
      last_name,
      phone_number,
      nationality,
      birth_date
    } = personData;

    const result = await client.query(
      `INSERT INTO persons (document_type_id, document_number, first_name, last_name, phone_number, nationality,
                            birth_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [document_type_id, document_number, first_name, last_name, phone_number, nationality, birth_date]
    );

    logger.info(`✅ Persona insertada con ID: ${result.rows[0].id}`, {label: 'Service'});
    return result.rows[0].id;
  } catch (error) {
    logger.error(`❌ Error en insertPerson: ${error.message}`, {label: 'Service'});
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

  logger.info(`📤 Insertando documento para persona ${person_id}, tipo ${type}`, {label: 'Service'});

  try {
    const existing = await client.query(
      `SELECT front_file_path, back_file_path
       FROM documents
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
            logger.info(`🧹 Archivo eliminado: ${path}`, {label: 'Service'});
          }
        } catch (e) {
          logger.warn(`⚠️ No se pudo eliminar ${path}. ${e.message}`, {label: 'Service'});
        }
      });
    }

    await client.query(
      `INSERT INTO documents (person_id, type, front_file_path, back_file_path,
                              expiration_date, entry_date, observations,
                              uploaded_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL) ON CONFLICT (person_id, type) DO
      UPDATE SET
          front_file_path = EXCLUDED.front_file_path,
          back_file_path = EXCLUDED.back_file_path,
          expiration_date = EXCLUDED.expiration_date,
          entry_date = EXCLUDED.entry_date,
          observations = EXCLUDED.observations,
          updated_at = NOW()`,
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

    logger.info(`✅ Documento insertado/actualizado correctamente`, {label: 'Service'});
  } catch (error) {
    logger.error(`❌ Error en insertDocument: ${error.message}`, {label: 'Service'});
    throw error;
  }
};


export const findExistingUser = async (username, email) => {
  logger.info(`🔍 Buscando usuario con username/email`, {label: 'Service'});
  try {
    const result = await pool.query(
      `SELECT id as "codUser"
       FROM users
       WHERE is_active = true
         AND (username = $1 OR email = $2)`,
      [username, email]
    );
    const found = result.rows[0] || {};
    logger.info(`📄 Usuario ${found.codUser ? 'encontrado' : 'no encontrado'}`, {label: 'Service'});
    return found;
  } catch (error) {
    logger.error(`❌ Error en findExistingUser: ${error.message}`, {label: 'Service'});
    return {};
  }
};


export const insertUser = async (client, userData) => {
  const {personId, username, email, hashedPassword} = userData;
  logger.info(`➕ Insertando usuario para persona ${personId}`, {label: 'Service'});

  try {
    const result = await client.query(
      `INSERT INTO users (person_id, username, email, password)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [personId, username, email, hashedPassword]
    );

    logger.info(`✅ Usuario insertado con ID: ${result.rows[0].id}`, {label: 'Service'});
    return result.rows[0].id;
  } catch (error) {
    logger.error(`❌ Error en insertUser: ${error.message}`, {label: 'Service'});
    throw error;
  }
};


export const getRoleIdByCode = async (client, roleCode) => {
  logger.info(`🔍 Obteniendo role_id para el código: ${roleCode}`, {label: 'Service'});
  try {
    const result = await client.query(
      `SELECT id
       FROM roles
       WHERE code = $1`,
      [roleCode]
    );
    logger.info(`✅ Role ID obtenido: ${result.rows[0].id}`, {label: 'Service'});
    return result.rows[0].id;
  } catch (error) {
    logger.error(`❌ Error en getRoleIdByCode: ${error.message}`, {label: 'Service'});
    throw error;
  }
};


export const assignRoleToUser = async (client, userId, roleId) => {
  logger.info(`🎭 Asignando role ${roleId} al usuario ${userId}`, {label: 'Service'});
  try {
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)`,
      [userId, roleId]
    );
    logger.info(`✅ Rol asignado exitosamente`, {label: 'Service'});
  } catch (error) {
    logger.error(`❌ Error en assignRoleToUser: ${error.message}`, {label: 'Service'});
    throw error;
  }
};

