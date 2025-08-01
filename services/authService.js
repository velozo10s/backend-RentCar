import {findUserByCredentials} from "./userService.js";
import jwt from "jsonwebtoken";
import tokenStore from "../utils/tokenStore.js";

export async function loginUser(user, password, context) {

  if (!user || !password || !context) {
    return {error: 'Credenciales no ingresadas.'};
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

  try {
    const response = await findUserByCredentials(user, password, roles);

    if (response.error) {
      return {error: response.error};
    }

    const accessToken = jwt.sign(response, process.env.JWT_SECRET, {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY
    });

    const refreshToken = jwt.sign(response, process.env.JWT_REFRESH_SECRET, {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY
    });

    tokenStore.setRefresh(response.codUser, refreshToken);

    return {accessToken, refreshToken};
  } catch (error) {
    console.error('Login error: ', error);
    return {error: 'Error interno del servidor.'};
  }
}
