import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import tokenStore from '../utils/tokenStore.js';
import bcrypt from "bcrypt";
import {loginUser} from "../services/authService.js";
import pool from "../config/db.js";
import fs from "fs";

dotenv.config();

export const login = async (req, res) => {
  const {user, password, context} = req.body;

  const result = await loginUser(user, password, context);

  if (result.error)
    return res.status(401).json({error: result.error});

  return res.status(200).json(result);
};

export const refresh = (req, res) => {
  const {refreshToken} = req.body;

  if (!refreshToken) return res.status(401).json({error: 'Token requerido'});

  const data = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

  const storedToken = tokenStore.getRefresh(data.codUser);

  if (storedToken !== refreshToken) {
    return res.status(403).json({error: 'Refresh token inválido o vencido'});
  }

  jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, user) => {
    if (err) return res.status(403).json({error: 'Token inválido'});

    const {codUser, role} = user;
    const newAccessToken = jwt.sign({codUser, role}, process.env.JWT_SECRET, {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY
    });

    res.json({accessToken: newAccessToken});
  });
};

export const logout = (req, res) => {
  const authHeader = req.headers['authorization'];
  const accessToken = authHeader && authHeader.split(' ')[1];
  const {refreshToken} = req.body;

  if (accessToken) {
    tokenStore.blacklistAccess(accessToken);
  }

  const data = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

  tokenStore.removeRefresh(data.codUser);

  res.json({message: 'Sesión cerrada con éxito'});
};

export const register = async (req, res) => {
  const {
    document_type_id,
    document_number,
    first_name,
    last_name,
    phone_number,
    nationality,
    birth_date,
    username,
    email,
    password,
    context,
    expiration_document,
    expiration_license,
    passport_entry_date
  } = req.body;

  if (!username || !email || !password || !document_number || !first_name)
    return res.status(400).json({error: 'Todos los campos son obligatorios.'});

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingUser = await client.query(
      `SELECT id
       FROM users
       WHERE username = $1
          or email = $2`,
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({error: 'El usuario ingresado ya existe.'});
    }

    const personInsert = await client.query(
      `INSERT INTO persons
       (document_type_id, document_number, first_name, last_name, phone_number, nationality, birth_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        document_type_id || 1,
        document_number,
        first_name,
        last_name,
        phone_number,
        nationality || 'PY',
        birth_date
      ]
    );

    const personId = personInsert.rows[0].id;

    const files = req.files;
    const docPairs = [
      {
        type: 'document',
        front: files['document_front']?.[0],
        back: files['document_back']?.[0],
        expiration: expiration_document
      },
      {
        type: 'license',
        front: files['license_front']?.[0],
        back: files['license_back']?.[0],
        expiration: expiration_license
      }
    ];

    for (const doc of docPairs) {
      if (doc.front && doc.back) {
        await client.query(
          `INSERT INTO documents (person_id, type, front_file_path, back_file_path, expiration_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [personId, doc.type, doc.front.path, doc.back.path, doc.expiration || null]
        );
      }
    }

    // Agregar sello de entrada si es extranjero con pasaporte
    // if (nationality !== 'PY' && document_type_id === 2 && passport_entry_date) {
    //     const entryFront = files['passport_entry_front']?.[0];
    //     const entryBack = files['passport_entry_back']?.[0];
    //
    //     if (entryFront && entryBack) {
    //         await client.query(
    //             `INSERT INTO documents (person_id, type, front_file_path, back_file_path, expiration_date, entry_date)
    //              VALUES ($1, 'passport_stamp', $2, $3, null, $4)`,
    //             [personId, entryFront.path, entryBack.path, passport_entry_date]
    //         );
    //     }
    // }

    const hashedPassword = await bcrypt.hash(password, 12);

    const userInsert = await client.query(
      `INSERT INTO users
           (person_id, username, email, password, is_active, is_email_validated)
       VALUES ($1, $2, $3, $4, true, false) RETURNING id`,
      [personId, username, email, hashedPassword]
    );

    const userId = userInsert.rows[0].id;

    const parseRoles = (rolesStr = '') => {
      return rolesStr
        .split(',')
        .map(role => role.trim())
        .filter(role => role.length > 0);
    };

    const contextRoles = {
      APP: parseRoles(process.env.APP_ROLES),
      WEB: parseRoles(process.env.WEB_ROLES)
    };

    const conflictingUser = await client.query(
      `SELECT u.id, r.code as role
       FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON r.id = ur.role_id
       WHERE (u.username = $1 OR u.email = $2)
         AND r.code = ANY ($3)`,
      [username, email, contextRoles[context]]
    );

    if (conflictingUser.rows.length > 0) {
      return res.status(409).json({error: 'El usuario ya existe con un rol en este contexto'});
    }

    const roleCode = contextRoles[context][0];
    const rolesResult = await client.query(`SELECT id
                                            FROM roles
                                            WHERE code = $1`, [roleCode]);

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)`,
      [userId, rolesResult.rows[0].id]
    );

    await client.query('COMMIT');

    const result = await loginUser(username, password, context);

    if (result.error)
      return res.status(401).json({error: result.error});

    return res.status(201).json({message: 'Usuario registrado correctamente.', data: result});

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en el registro:', err.message);
    // Eliminar archivos subidos si existieran
    if (req.files) {
      Object.values(req.files).flat().forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          console.warn('No se pudo eliminar archivo:', file.path);
        }
      });
    }
    return res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    client.release();
  }
};
