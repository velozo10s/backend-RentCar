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
      if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
        return res.status(401).json({error: 'Unauthorized', localKey: 'backendRes.unauthorized'});
      } else {
        return res.status(403).json({error: 'Invalid token', localKey: 'backendRes.invalidToken'});
      }
    }
    req.user = user;
    next();
  });
};

