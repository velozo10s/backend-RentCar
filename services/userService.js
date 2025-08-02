import pool from '../config/db.js';
import fs from 'fs';
import logger from "../utils/logger.js";

export const findUserByCredentials = async (user, email, roles) => {
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

      return {codUser: foundUser.id, userName: foundUser.username, password: foundUser.password, role: foundUser.role};
    } else {
      return {error: 'No existe el usuario para las credenciales proveidas.', details: {user: user}};
    }

  } catch (error) {
    console.error('❌ Error al conectarse a la base de datos:', error.message);
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export const findPersonByCodUser = async (codUser) => {
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
      console.log('✅ Conexión exitosa. Datos del usuario encontrados.');

      const foundData = userResult.rows[0];

      const documents = await findDocumentsByUserId(codUser);

      return {...foundData, codUser, documents};
    } else {
      return {error: 'No existe el usuario con el id enviado.', details: {codUser: codUser}};
    }
  } catch (error) {
    console.error('❌ Error al conectarse a la base de datos:', error.message);
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export const findDocumentsByUserId = async (codUser) => {
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
      console.log('✅ Conexión exitosa. Documentos encontrados.');

      return documentResult.rows;
    } else {
      return {error: 'No se encontraron documentos para el id enviado.', details: {codUser: codUser}};
    }
  } catch (error) {
    console.error('❌ Error al conectarse a la base de datos:', error.message);
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export const findDocumentTypeById = async (document_type_id) => {
  try {
    const query = `
        select code, description
        from document_types
        where id = $1
    `;

    const values = [document_type_id];
    const userResult = await pool.query(query, values);

    if (userResult.rows.length > 0) {

      const foundData = userResult.rows[0];

      return {code: foundData.code, description: foundData.description};
    } else {
      return {error: 'No existe el tipo de documento con el id enviado.', details: {codDocumentType: document_type_id}};
    }
  } catch (error) {
    console.error('❌ Error al conectarse a la base de datos:', error.message);
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export const findUserByUsernameOrEmailAndContext = async (client, username, email, roleCodes) => {
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
  return result.rows;
};

export const findExistingPerson = async (documentNumber, documentTypeId) => {
  const result = await pool.query(
    `SELECT id as "codPerson"
     FROM persons
     WHERE document_number = $1
       AND document_type_id = $2`,
    [documentNumber, documentTypeId]
  );
  return result.rows[0] || {};
};

export const insertUpdateDocuments = async (documentData) => {
  const {
    personId,
    type,
    front_file_path,
    back_file_path,
    expiration_date,
    entry_date,
    observations
  } = documentData;

  const result = await pool.query(
    `INSERT INTO documents (person_id, type, front_file_path, back_file_path,
                            expiration_date, entry_date, observations, uploaded_at, updated_at)
     VALUES ($1, $2, $3, $4,
             $5, $6, $7, NOW(), null) ON CONFLICT (person_id, type) DO
    UPDATE
        SET front_file_path = EXCLUDED.front_file_path,
        back_file_path = EXCLUDED.back_file_path,
        expiration_date = EXCLUDED.expiration_date,
        entry_date = EXCLUDED.entry_date,
        observations = EXCLUDED.observations,
        updated_at = NOW()`,
    [personId, type, front_file_path, back_file_path, expiration_date, entry_date, observations]
  );
  return result.rows[0] || {};
};

export const insertPerson = async (client, personData) => {
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

  return result.rows[0].id;
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

  // 🔍 Buscar documento previo para ese person_id + type
  const existing = await client.query(
    `SELECT front_file_path, back_file_path
     FROM documents
     WHERE person_id = $1
       AND type = $2`,
    [person_id, type]
  );

  // 🔥 Borrar los archivos anteriores si existen
  if (existing.rows.length > 0) {
    const oldFront = existing.rows[0].front_file_path;
    const oldBack = existing.rows[0].back_file_path;

    [oldFront, oldBack].forEach(path => {
      try {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
          logger.info(`🧹 Archivo eliminado: ${path}`);
        }
      } catch (e) {
        //console.warn(`⚠️ No se pudo eliminar ${path}:`, e.message);
        logger.warn(`⚠️ No se pudo eliminar ${path}. ${e.message}`);
      }
    });
  }

  // 📝 Insertar o actualizar el documento
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
        updated_at = NOW()
    `,
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
};


export const findExistingUser = async (username, email) => {
  const result = await pool.query(
    `SELECT id as "codUser"
     FROM users
     WHERE is_active = true
       and (username = $1
         OR email = $2)`,
    [username, email]
  );
  return result.rows[0] || {};
};

export const insertUser = async (client, userData) => {
  const {personId, username, email, hashedPassword} = userData;

  const result = await client.query(
    `INSERT INTO users (person_id, username, email, password)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [personId, username, email, hashedPassword]
  );

  return result.rows[0].id;
};

export const getRoleIdByCode = async (client, roleCode) => {
  const result = await client.query(
    `SELECT id
     FROM roles
     WHERE code = $1`,
    [roleCode]
  );
  return result.rows[0].id;
};

export const assignRoleToUser = async (client, userId, roleId) => {
  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [userId, roleId]
  );
};
