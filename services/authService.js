import {findUserByCredentials} from "./userService.js";
import jwt from "jsonwebtoken";
import tokenStore from "../utils/tokenStore.js";
import bcrypt from "bcrypt";

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
    const foundUser = await findUserByCredentials(user, user, roles);

    if (foundUser.error) {
      return {error: foundUser.error};
    }

    const valid = await bcrypt.compare(password, foundUser.password);

    if (!valid) return {error: 'Contraseña incorrecta'};

    const accessToken = jwt.sign(foundUser, process.env.JWT_SECRET, {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY
    });

    const refreshToken = jwt.sign(foundUser, process.env.JWT_REFRESH_SECRET, {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY
    });

    tokenStore.setRefresh(foundUser.codUser, refreshToken);

    return {accessToken, refreshToken};
  } catch (error) {
    console.error('Login error: ', error);
    return {error: 'Error interno del servidor.'};
  }
}
