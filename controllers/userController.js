import {findDocumentsByUserId, findPersonByCodUser} from "../services/userService.js";
import logger from "../utils/logger.js";

export const getUser = async (req, res) => {
  logger.info(`Ingresa a getUser.`, {label: 'Controller'});
  const {codUser} = req.params;

  try {
    const person = await findPersonByCodUser(codUser);

    const documents = await findDocumentsByUserId(codUser);

    res.json({...person, documents});
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.', localKey: 'snackBarMessages.generalError'});
  } finally {
    logger.info(`Finaliza getUser.`, {label: 'Controller'});
  }
};
