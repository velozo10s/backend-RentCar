import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {findDocumentTypeById} from "../services/userService.js";

// Crear carpeta si no existe
const uploadDir = './uploads/docs';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: async (req, file, cb) => {
        const {document_type_id, document_number} = req.body;
        const response = await findDocumentTypeById(document_type_id);
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `${document_number}-${response.code}-${file.fieldname}-${timestamp}${ext}`);
    }
});

export const upload = multer({ storage });
