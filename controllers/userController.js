import {findPersonByCodUser} from "../services/userService.js";

export const getUser = async (req, res) => {
    const { codUser } = req.params;

    try {
        const response = await findPersonByCodUser(codUser);

        if (response.error) {
            return res.status(400).json({ error: response.error });
        }

        res.json(response);
    } catch (error) {
        console.error('User error: ', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};
