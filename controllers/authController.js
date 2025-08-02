import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import tokenStore from '../utils/tokenStore.js';
import bcrypt from "bcrypt";
import {loginUser} from "../services/authService.js";
import pool from "../config/db.js";
import fs from "fs";
import {
  assignRoleToUser,
  findExistingPerson,
  findExistingUser,
  findUserByUsernameOrEmailAndContext, getRoleIdByCode, insertDocument, insertPerson, insertUser
} from "../services/userService.js";

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

  let personId = null;
  let userId = null;

  if (!username || !email || !password || !document_number || !first_name) {
    cleanUploadedFiles(req);
    return res.status(400).json({error: 'Todos los campos son obligatorios.'});
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const parseRoles = (rolesStr = '') =>
      rolesStr.split(',').map(role => role.trim()).filter(Boolean);

    const contextRoles = {
      APP: parseRoles(process.env.APP_ROLES),
      WEB: parseRoles(process.env.WEB_ROLES)
    };

    const conflictingUsers = await findUserByUsernameOrEmailAndContext(
      client,
      username,
      email,
      contextRoles[context]
    );

    if (conflictingUsers.length > 0) {
      cleanUploadedFiles(req);
      return res.status(409).json({error: 'El usuario ya existe con un rol en este contexto'});
    }

    const existingPerson = await findExistingPerson(document_number, document_type_id);

    if (!existingPerson.codPerson) {
      personId = await insertPerson(client, {
        document_type_id: document_type_id || 1,
        document_number,
        first_name,
        last_name,
        phone_number,
        nationality: nationality || 'PY',
        birth_date
      });
    } else {
      personId = existingPerson.codPerson;
    }

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
        await insertDocument(client, {
          person_id: personId,
          type: doc.type,
          front_file_path: doc.front.path,
          back_file_path: doc.back.path,
          expiration_date: doc.expiration
        });
      }
    }

    const existingUser = await findExistingUser(username, email);

    if (!existingUser.codUser) {
      const hashedPassword = await bcrypt.hash(password, 12);

      userId = await insertUser(client, {
        personId,
        username,
        email,
        hashedPassword
      });
    } else {
      userId = existingUser.codUser;
    }

    const roleId = await getRoleIdByCode(client, contextRoles[context][0]);

    await assignRoleToUser(client, userId, roleId);

    await client.query('COMMIT');

    const result = await loginUser(username, password, context);

    if (result.error) {
      cleanUploadedFiles(req);
      return res.status(401).json({error: result.error});
    }
    return res.status(201).json({message: 'Usuario registrado correctamente.', data: result});

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en el registro:', err.message);

    cleanUploadedFiles(req);

    return res.status(500).json({error: 'Error interno del servidor.'});

  } finally {
    client.release();
  }
};

function cleanUploadedFiles(req) {
  if (req.files) {
    Object.values(req.files).flat().forEach(file => {
      try {
        fs.unlinkSync(file.path);
      } catch (e) {
        console.warn('No se pudo eliminar archivo:', file.path);
      }
    });
  }
}
