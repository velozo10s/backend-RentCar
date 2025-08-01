import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import tokenStore from "../utils/tokenStore.js";

dotenv.config();

export default (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({error: 'Token no proporcionado'});
  }

  if (tokenStore.isBlacklistedAccess(token)) {
    return res.status(401).json({error: 'Token eliminado por logout'});
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({error: 'Token inválido o expirado'});
    }

    req.user = user;
    next();
  });
};

