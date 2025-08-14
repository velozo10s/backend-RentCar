import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import tokenStore from '../utils/tokenStore.js';
import bcrypt from "bcrypt";
import {loginUser} from "../services/authService.js";
import pool from "../config/db.js";
import fs from "fs";
import {
  assignRoleToUser, findDocumentTypeByCode,
  findExistingPerson,
  findExistingUser,
  findUserByUsernameOrEmailAndContext, getRoleIdByCode, insertDocument, insertPerson, insertUser
} from "../services/userService.js";
import logger from "../utils/logger.js";

dotenv.config();

export const login = async (req, res) => {
  logger.info(`Ingresa a login.`, {label: 'Controller'});
  const {user, password, context} = req.body;

  const result = await loginUser(user, password, context);

  if (result.error) {
    logger.error(`Error: ${result.error}`, {label: 'Controller'});
    return res.status(401).json(result);
  }

  logger.info(`Finaliza login.`, {label: 'Controller'});
  return res.status(200).json(result);
};

export const refresh = (req, res) => {
  logger.info(`Ingresa a refresh.`, {label: 'Controller'});

  const {refreshToken} = req.body;

  if (!refreshToken) return res.status(401).json({error: 'Token requerido'});

  jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
        return res.status(401).json({error: 'Unauthorized'});
      } else {
        return res.status(403).json({error: 'Invalid token'});
      }
    }

    const {id, role} = user;

    const storedToken = tokenStore.getRefresh(id);

    logger.info(`Verifica validez del token.`, {label: 'Controller'});
    if (storedToken !== refreshToken) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    logger.info(`Genera un nuevo token.`, {label: 'Controller'});
    const newAccessToken = jwt.sign({id, role}, process.env.JWT_SECRET, {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY
    });

    res.json({access: newAccessToken});
  });
};

export const logout = (req, res) => {
  logger.info(`Ingresa a logout.`, {label: 'Controller'});
  const authHeader = req.headers['authorization'];
  const accessToken = authHeader && authHeader.split(' ')[1];
  const {refreshToken} = req.body;

  if (accessToken) {
    tokenStore.blacklistAccess(accessToken);
  }

  logger.info(`Valida el token recibido.`, {label: 'Controller'});
  try {
    const data = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    tokenStore.removeRefresh(data.codUser);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      logger.warn(`Refresh token already expired.`, {label: 'Controller'});
    } else {
      logger.error(`Invalid refresh token.`, {label: 'Controller'});
    }
  }

  logger.info(`Sesión cerrada con éxito.`, {label: 'Controller'});
  res.json({message: 'Sesión cerrada con éxito'});
};

export const register = async (req, res) => {
  const {
    documentType,
    documentNumber,
    firstName,
    lastName,
    phoneNumber,
    nationalityCode,
    birthDate,
    username,
    email,
    password,
    context,
    expiration_document,
    expiration_license,
    //passport_entry_date
  } = req.body;
  logger.info(`Ingresa a register.`, {label: 'Controller'});

  let personId = null;
  let userId = null;

  logger.info(`Verifica campos obligatorios.`, {label: 'Controller'});
  if (!username || !email || !password || !documentNumber || !firstName) {
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

    if (conflictingUsers?.id) {
      cleanUploadedFiles(req);
      return res.status(409).json({error: 'El usuario ya existe con un rol en este contexto'});
    }

    const documentTypeData = await findDocumentTypeByCode(documentType);

    const existingPerson = await findExistingPerson(documentNumber, documentTypeData.id);

    if (!existingPerson.id) {

      personId = await insertPerson(client, {
        documentTypeId: documentTypeData.id || 1,
        documentNumber,
        firstName,
        lastName,
        phoneNumber,
        nationalityCode: nationalityCode || 'PY',
        birthDate
      });
    } else {
      personId = existingPerson.id;
    }

    const files = req.files;
    if (files) {
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
    }
    const existingUser = await findExistingUser(username, email);

    if (!existingUser.id) {
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
    return res.status(201).json(result);

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
  logger.info(`Elimina los archivos del servidor.`, {label: 'Controller'});
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
