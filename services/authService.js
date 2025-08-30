import {findPersonByCodUser, findUserByUsernameOrEmailAndContext} from "./userService.js";
import jwt from "jsonwebtoken";
import tokenStore from "../utils/tokenStore.js";
import bcrypt from "bcrypt";
import logger from "../utils/logger.js";
import pool from "../config/db.js";

export async function loginUser(user, password, context) {
  logger.info(`Ingresa al loginUser.`, {label: 'Service'});
  if (!user || !password || !context) {
    return {error: 'Credenciales no ingresadas.', localKey: 'backendRes.noCredentials'};
  }

  const parseRoles = (rolesStr = '') => {
    return rolesStr
      .split(',')
      .map(role => role.trim())
      .filter(role => role.length > 0);
  };

  const roleMap = {
    APP: parseRoles(process.env.APP_ROLES),
    WEB: parseRoles(process.env.WEB_ROLES)
  };

  const roles = roleMap[context];

  const client = await pool.connect();

  try {

    logger.info(`Obteniendo datos del usuario: ${user}`, {label: 'Service'});
    const userData = await findUserByUsernameOrEmailAndContext(client, user, user, roles);

    if (!userData?.id) {
      return {
        error: 'No se ha encontrado el usuario.',
        localKey: 'backendRes.userNotFound'
      };
    }

    const {userPassword, ...data} = userData;

    logger.info(`Verificando si la contraseña coincide.`, {label: 'Service'});

    const valid = await bcrypt.compare(password, userPassword);

    if (!valid) return {error: 'Contraseña incorrecta', localKey: 'backendRes.incorrectPassword'};

    const personData = await findPersonByCodUser(userData.id);

    const {id, role} = data;
    logger.info(`Generando token de acceso.`, {label: 'Service'});
    const accessToken = jwt.sign({id, role}, process.env.JWT_SECRET, {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY
    });

    const refreshToken = jwt.sign({id, role}, process.env.JWT_REFRESH_SECRET, {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY
    });

    tokenStore.setRefresh(data.id, refreshToken);

    return {access: accessToken, refresh: refreshToken, user: {...data, ...personData}};
  } catch (error) {
    logger.error(`Error al iniciar sesion. ${error}`, {label: 'Service'});
    throw error;
  } finally {
    client.release();
  }
}
