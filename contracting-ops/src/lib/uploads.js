import { randomBytes } from 'node:crypto';
import { mkdirSync, createWriteStream, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { badRequest, HttpError } from './http.js';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

// Accepted types, keyed by what the first bytes of the file actually say.
// The client-supplied Content-Type is a hint, never the decision.
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/heic', ext: 'heic',
    test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp'
      && ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(b.subarray(8, 12).toString('latin1')) },
  { mime: 'image/webp', ext: 'webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function uploadsDir(dataDir) {
  const dir = join(dataDir, 'uploads');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Streams a raw request body to disk, refusing anything over the size cap or
 * whose leading bytes are not a type we accept. Returns file metadata.
 * Uploads are sent as a raw body rather than multipart: the only client is
 * ours, and a hand-rolled multipart parser is a liability, not a feature.
 */
export async function storeUpload(req, dir) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `File is larger than ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  }

  const head = [];
  let headLength = 0;
  let total = 0;
  let type = null;
  let stream = null;
  let storedName = null;
  let path = null;

  const cleanup = () => {
    if (stream) stream.destroy();
    if (path && existsSync(path)) unlinkSync(path);
  };

  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        throw new HttpError(413, `File is larger than ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
      }

      if (!type) {
        head.push(chunk);
        headLength += chunk.length;
        if (headLength < 16) continue;               // need enough bytes to identify it
        const prefix = Buffer.concat(head);
        type = SIGNATURES.find((s) => s.test(prefix));
        if (!type) throw badRequest('That file type is not accepted. Use a JPEG, PNG, HEIC, WebP or PDF.');

        storedName = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}.${type.ext}`;
        path = join(dir, storedName);
        stream = createWriteStream(path, { mode: 0o600 });
        await write(stream, prefix);
        continue;
      }
      await write(stream, chunk);
    }

    if (!type) throw badRequest('That file is empty or too small to be a receipt.');
    await new Promise((resolve, reject) => stream.end((err) => (err ? reject(err) : resolve())));
    return { storedName, mimeType: type.mime, byteSize: total };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function write(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

export function removeUpload(dir, storedName) {
  const path = join(dir, storedName);
  if (existsSync(path)) unlinkSync(path);
}
