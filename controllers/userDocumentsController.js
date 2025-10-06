import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import {buildPublicUrl} from '../config/multerConfig.js';
import {findPersonByCodUser} from '../services/userService.js';
import {
  selectDocumentsForPersonQuery,
  updateDocumentSidesCommand,
  upsertDocumentPairCommand
} from '../services/userDocumentsService.js';

const LOG_LABEL = 'UserDocuments';
const VALID_TYPES = ['document', 'license'];
const UPLOAD_DIR = 'uploads/docs'; // ajusta si tu multer guarda en otra carpeta

// Helper: renombra el archivo físico y devuelve la URL pública
async function renameUploadedFile(req, file, newBaseName) {
  const oldFileName = file.filename;                       // ej: unknown-doc-document_front-...jpg
  const ext = path.extname(oldFileName) || path.extname(file.originalname || '');
  const newFileName = `${newBaseName}${ext || ''}`;        // ej: 1111111-CI-document_front-<ts>.jpg

  // Rutas absolutas
  const oldAbsPath = file.path || path.join(process.cwd(), UPLOAD_DIR, oldFileName);
  const newAbsPath = path.join(path.dirname(oldAbsPath), newFileName);

  if (oldAbsPath !== newAbsPath) {
    await fs.rename(oldAbsPath, newAbsPath);
  }

  return buildPublicUrl(req, path.join(UPLOAD_DIR, newFileName));
}

// Helper: arma nombre "bonito": <docNumber>-<docType>-<field>-<timestamp>
function buildNiceBaseName(docNumber, docType, field) {
  const safeDoc = String(docNumber || 'unknown').replace(/\s+/g, '');
  const safeType = String(docType || 'NA').replace(/\s+/g, '');
  const ts = Date.now();
  return `${safeDoc}-${safeType}-${field}-${ts}`;
}

export async function upsertMyDocuments(req, res) {
  const start = process.hrtime.bigint();
  const logBase = {label: LOG_LABEL, route: 'upsertMyDocuments'};

  try {
    logger.info('IN route', {...logBase, userId: req.user?.id});

    const userId = req.user?.id;
    if (!userId) {
      logger.warn('Unauthorized: no user id on request', logBase);
      return res.status(401).json({localKey: 'auth.unauthorized', message: 'Unauthorized'});
    }

    // Persona (para docNumber/docType)
    const personRow = await findPersonByCodUser(userId);
    const personId = personRow?.personId;
    const docNumber = personRow?.documentNumber;
    const docType = personRow?.documentType;

    logger.info('Person lookup', {...logBase, userId, personId, hasDocNumber: !!docNumber, docType});

    if (!personId) {
      logger.warn('Person not found for user', {...logBase, userId});
      return res.status(404).json({localKey: 'users.person_not_found', message: 'Person not found for this user'});
    }

    // Normalizamos inputs: los fields que recibís en el form
    const rawIdentityFront = req.files?.['document_front']?.[0] || null;
    const rawIdentityBack = req.files?.['document_back']?.[0] || null;
    const rawLicenseFront = req.files?.['license_front']?.[0] || null;
    const rawLicenseBack = req.files?.['license_back']?.[0] || null;

    logger.debug('Incoming files (raw)', {
      ...logBase,
      personId,
      fields: {
        document_front: !!rawIdentityFront,
        document_back: !!rawIdentityBack,
        license_front: !!rawLicenseFront,
        license_back: !!rawLicenseBack
      }
    });

    if (!rawIdentityFront && !rawIdentityBack && !rawLicenseFront && !rawLicenseBack) {
      logger.warn('No files received', {...logBase, personId});
      return res.status(400).json({localKey: 'documents.nofiles', message: 'No files received'});
    }

    // Si hay archivos, renombramos con la info del usuario
    const identityFront = rawIdentityFront
      ? await renameUploadedFile(req, rawIdentityFront, buildNiceBaseName(docNumber, docType, 'document_front'))
      : null;
    const identityBack = rawIdentityBack
      ? await renameUploadedFile(req, rawIdentityBack, buildNiceBaseName(docNumber, docType, 'document_back'))
      : null;
    const licenseFront = rawLicenseFront
      ? await renameUploadedFile(req, rawLicenseFront, buildNiceBaseName(docNumber, docType, 'license_front'))
      : null;
    const licenseBack = rawLicenseBack
      ? await renameUploadedFile(req, rawLicenseBack, buildNiceBaseName(docNumber, docType, 'license_back'))
      : null;

    logger.debug('Files normalized & renamed', {
      ...logBase,
      identity: {front: !!identityFront, back: !!identityBack},
      license: {front: !!licenseFront, back: !!licenseBack}
    });

    // --------- DOCUMENT (antes llamado "identity") ----------
    if (identityFront || identityBack) {
      const type = 'document';
      if (!VALID_TYPES.includes(type)) {
        logger.error('Invalid type for document', {...logBase, type});
        return res.status(400).json({localKey: 'documents.invalid_type', message: 'Invalid document type'});
      }

      logger.info('Processing document', {...logBase, personId, sides: {front: !!identityFront, back: !!identityBack}});

      const {exists: hasDoc} = await selectDocumentsForPersonQuery(personId, type);
      logger.debug('Document existence check', {...logBase, personId, hasDoc});

      if (!hasDoc) {
        if (!identityFront || !identityBack) {
          logger.warn('Document create requires both sides', {...logBase, personId});
          return res.status(400).json({
            localKey: 'documents.document.missing_side',
            message: 'Both front and back are required to create document'
          });
        }
        const inserted = await upsertDocumentPairCommand(personId, type, identityFront, identityBack);
        logger.info('Document inserted', {...logBase, personId, docId: inserted?.id});
      } else {
        const updated = await updateDocumentSidesCommand(personId, type, {
          front: identityFront || undefined,
          back: identityBack || undefined
        });
        logger.info('Document updated (partial allowed)', {...logBase, personId, docId: updated?.id});
      }
    }

    // --------- LICENSE (antes "driver_license") ----------
    if (licenseFront || licenseBack) {
      const type = 'license';
      if (!VALID_TYPES.includes(type)) {
        logger.error('Invalid type for license', {...logBase, type});
        return res.status(400).json({localKey: 'documents.invalid_type', message: 'Invalid document type'});
      }

      logger.info('Processing license', {...logBase, personId, sides: {front: !!licenseFront, back: !!licenseBack}});

      const {exists: hasLicense} = await selectDocumentsForPersonQuery(personId, type);
      logger.debug('License existence check', {...logBase, personId, hasLicense});

      if (!hasLicense) {
        if (!licenseFront || !licenseBack) {
          logger.warn('License create requires both sides', {...logBase, personId});
          return res.status(400).json({
            localKey: 'documents.license.missing_side',
            message: 'Both front and back are required to create license'
          });
        }
        const inserted = await upsertDocumentPairCommand(personId, type, licenseFront, licenseBack);
        logger.info('License inserted', {...logBase, personId, docId: inserted?.id});
      } else {
        const updated = await updateDocumentSidesCommand(personId, type, {
          front: licenseFront || undefined,
          back: licenseBack || undefined
        });
        logger.info('License updated (partial allowed)', {...logBase, personId, docId: updated?.id});
      }
    }

    // Snapshot actual
    const currentDocument = await selectDocumentsForPersonQuery(personId, 'document');
    const currentLicense = await selectDocumentsForPersonQuery(personId, 'license');

    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);
    logger.info('Documents upserted', {
      ...logBase,
      userId,
      personId,
      documentExists: currentDocument.exists,
      licenseExists: currentLicense.exists,
      elapsedMs
    });

    return res.status(201).json({
      localKey: 'documents.saved',
      message: 'Documents saved',
      document: currentDocument.row || null,
      license: currentLicense.row || null
    });
  } catch (err) {
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);
    logger.error(`upsertMyDocuments error: ${err.message}`, {
      ...logBase,
      by: req.user?.id,
      elapsedMs,
      stack: err.stack
    });
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}
