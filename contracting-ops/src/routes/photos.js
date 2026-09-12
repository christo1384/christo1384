import { sendJson, readJson, notFound, badRequest } from '../lib/http.js';
import { optionalText, optionalEnum, pathId } from '../lib/validate.js';
import { storeUpload, removeUpload } from '../lib/uploads.js';

// A contractor's photo record is worth most when it says when in the job it was
// taken, so every photo carries a stage.
export const PHOTO_STAGES = ['before', 'progress', 'after', 'issue'];

export function registerPhotoRoutes(router, db, { uploadDir }) {
  router.get('/api/jobs/:id/photos', (req, res, { params, query }) => {
    const jobId = pathId(params);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) throw notFound('Job not found');

    const stage = query.get('stage');
    if (stage && !PHOTO_STAGES.includes(stage)) throw badRequest(`Unknown stage: ${stage}`);

    const rows = db.prepare(
      `SELECT a.*, u.display_name AS uploaded_by
         FROM attachments a LEFT JOIN users u ON u.id = a.created_by
        WHERE a.owner_type = 'job' AND a.owner_id = ?
        ORDER BY a.created_at DESC, a.id DESC`,
    ).all(jobId).map(decorate).filter((p) => !stage || p.stage === stage);

    sendJson(res, 200, {
      counts: PHOTO_STAGES.reduce((acc, s) => ({ ...acc, [s]: rows.filter((p) => p.stage === s).length }), {}),
      photos: rows,
    });
  });

  router.post('/api/jobs/:id/photos', async (req, res, { params, query, user }) => {
    const jobId = pathId(params);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) throw notFound('Job not found');

    const stage = query.get('stage') ?? 'progress';
    if (!PHOTO_STAGES.includes(stage)) throw badRequest(`Unknown stage: ${stage}`);
    const caption = (query.get('caption') ?? '').slice(0, 300);

    const file = await storeUpload(req, uploadDir);
    if (file.mimeType === 'application/pdf') {
      removeUpload(uploadDir, file.storedName);
      throw badRequest('Job photos must be images, not PDFs');
    }

    // The stage is stored as a prefix on the caption so phase 3 needs no
    // schema change to the phase 2 attachments table.
    const info = db.prepare(
      `INSERT INTO attachments (owner_type, owner_id, stored_name, original_name, mime_type, byte_size, caption, created_by)
       VALUES ('job', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jobId, file.storedName,
      (query.get('filename') ?? '').slice(0, 200) || null,
      file.mimeType, file.byteSize, `${stage}:${caption}`, user?.id ?? null,
    );

    db.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").run(jobId);
    sendJson(res, 201, decorate(db.prepare('SELECT * FROM attachments WHERE id = ?')
      .get(Number(info.lastInsertRowid))));
  });

  router.patch('/api/photos/:id', async (req, res, { params }) => {
    const photo = mustBePhoto(db, pathId(params));
    const body = await readJson(req);

    const stage = optionalEnum(body, 'stage', PHOTO_STAGES) ?? photo.stage;
    const caption = 'caption' in body ? (optionalText(body, 'caption', { max: 300 }) ?? '') : photo.caption;
    db.prepare('UPDATE attachments SET caption = ? WHERE id = ?').run(`${stage}:${caption}`, photo.id);

    sendJson(res, 200, decorate(db.prepare('SELECT * FROM attachments WHERE id = ?').get(photo.id)));
  });

  router.delete('/api/photos/:id', (req, res, { params }) => {
    const photo = mustBePhoto(db, pathId(params));
    removeUpload(uploadDir, photo.stored_name);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(photo.id);
    sendJson(res, 200, { deleted: photo.id });
  });
}

function mustBePhoto(db, id) {
  const row = db.prepare("SELECT * FROM attachments WHERE id = ? AND owner_type = 'job'").get(id);
  if (!row) throw notFound('Photo not found');
  return decorate(row);
}

function decorate(row) {
  const [stage, ...rest] = (row.caption ?? '').split(':');
  const known = PHOTO_STAGES.includes(stage);
  return {
    ...row,
    stage: known ? stage : 'progress',
    caption: known ? rest.join(':') : (row.caption ?? ''),
  };
}
