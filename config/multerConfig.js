import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

/** ---------- DOCS (signup) ---------- **/
const docsDir = './uploads/docs';
ensureDir(docsDir);

const docsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, docsDir),
  filename: (req, file, cb) => {
    const {documentType, documentNumber} = req.body;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname || '');
    cb(null, `${documentNumber || 'unknown'}-${documentType || 'doc'}-${file.fieldname}-${timestamp}${ext}`);
  }
});
export const uploadDocs = multer({storage: docsStorage});

/** ---------- VEHICLES ---------- **/
const vehiclesDir = './uploads/vehicles';
ensureDir(vehiclesDir);

const vehiclesStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, vehiclesDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname || '');
    // keep it simple & safe: <ts>-<originalname>
    const base = path.basename((file.originalname || 'image').replace(/\s+/g, '_'), ext);
    cb(null, `${timestamp}-${base}${ext}`);
  }
});
export const uploadVehicles = multer({storage: vehiclesStorage});

/** ---------- Utility to build absolute URL ---------- **/
export function buildPublicUrl(req, relPath) {
  // Prefer explicit base (use it behind proxies/containers)
  const base = process.env.PUBLIC_BASE_URL
    || `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
  // relPath like: 'uploads/vehicles/xxx.png'
  return `${base}/${relPath.replace(/^\/+/, '')}`;
}
