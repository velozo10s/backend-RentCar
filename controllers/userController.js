import {findDocumentsByUserId, findPersonByCodUser} from "../services/userService.js";
import logger from "../utils/logger.js";

export const getUser = async (req, res) => {
  logger.info(`Ingresa a getUser.`, {label: 'Controller'});
  const {codUser} = req.params;

  try {
    const person = await findPersonByCodUser(codUser);

    const documents = await findDocumentsByUserId(codUser);

    if (person.error) {
      logger.error(`Error: ${person.error}.`, {label: 'Controller'});
      return res.status(400).json({error: person.error});
    }

    res.json({...person, documents});
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    logger.info(`Finaliza getUser.`, {label: 'Controller'});
  }
};
