import {findPersonByCodUser} from "../services/userService.js";
import logger from "../utils/logger.js";

export const getUser = async (req, res) => {
  logger.info(`Ingresa a getUser.`, {label: 'Controller'});
  const {codUser} = req.params;

  try {
    const response = await findPersonByCodUser(codUser);

    if (response.error) {
      logger.error(`Error: ${response.error}.`, {label: 'Controller'});
      return res.status(400).json({error: response.error});
    }

    res.json(response);
  } catch (error) {
    console.error('User error: ', error);
    res.status(500).json({error: 'Error interno del servidor.'});
  } finally {
    logger.info(`Finaliza getUser.`, {label: 'Controller'});
  }
};
