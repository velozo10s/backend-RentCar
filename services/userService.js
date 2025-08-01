import pool from '../config/db.js';
import bcrypt from "bcrypt";

export async function findUserByCredentials(user, password, roles) {
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
          AND (u.username = $1 OR u.email = $1)
          AND r.code = ANY ($2::text[])
    `;

    const values = [user, roles];
    const userResult = await pool.query(query, values);
    console.log('✅ Conexión exitosa. Usuarios encontrados:');

    if (userResult.rows.length > 0) {
      console.log('✅ Conexión exitosa. Usuarios encontrados:');

      const foundUser = userResult.rows[0];

      const valid = await bcrypt.compare(password, foundUser.password);

      if (!valid) return {error: 'Contraseña incorrecta'};

      return {codUser: foundUser.id, userName: foundUser.username, role: foundUser.role};
    } else {
      return {error: 'No existe el usuario para las credenciales proveidas.', details: {user: user}};
    }

  } catch (error) {
    console.error('❌ Error al conectarse a la base de datos:', error.message);
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function findPersonByCodUser(codUser) {
  try {
    const query = `
        select dt.description                     document_type,
               p.document_number,
               p.first_name || ' ' || p.last_name full_name,
               p.phone_number
        from persons p
                 left join users u on p.id = u.person_id
                 left join document_types dt on p.document_type_id = dt.id
        where u.id = $1
    `;

    const values = [codUser];
    const userResult = await pool.query(query, values);

    if (userResult.rows.length > 0) {
      console.log('✅ Conexión exitosa. Usuarios encontrados:');

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

export async function findDocumentsByUserId(codUser) {
  try {
    const query = `
        SELECT d.type, d.front_file_path, d.back_file_path, d.expiration_date, d.entry_date
        FROM documents d
                 JOIN persons p ON p.id = d.person_id
                 JOIN users u ON u.person_id = p.id
        WHERE u.id = $1
    `;

    const values = [codUser];
    const documentResult = await pool.query(query, values);

    if (documentResult.rows.length > 0) {
      console.log('✅ Conexión exitosa. Usuarios encontrados:');

      return documentResult.rows;
    } else {
      return {error: 'No se encontraron documentos para el id enviado.', details: {codUser: codUser}};
    }
  } catch (error) {
    console.error('❌ Error al conectarse a la base de datos:', error.message);
    return {error: 'Ha ocurrido un error, reintente.'};
  }
}

export async function findDocumentTypeById(document_type_id) {
  try {
    const query = `
        select code, description
        from document_types
        where id = $1
    `;

    const values = [document_type_id];
    const userResult = await pool.query(query, values);

    if (userResult.rows.length > 0) {
      console.log('✅ Conexión exitosa. Tipo de documento encontrado:');

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
