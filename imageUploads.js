const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_IMAGE = 5 * 1024 * 1024;
const CHUNK_SIZE = 256 * 1024; // base64 characters; divisible by four
const MAX_CHUNKS = Math.ceil(Math.ceil(MAX_IMAGE / 3) * 4 / CHUNK_SIZE);
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);
function createImageUploads(dir) {
  const root = path.join(dir, 'image-uploads');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const folder = id => { if (!validId(id)) throw Error('Invalid image upload ID'); return path.join(root, id); };
  function stage({ upload_id, chunk_index, chunk_count, sha256, chunk_base64 }) {
    if (!Number.isInteger(chunk_count) || chunk_count < 1 || chunk_count > MAX_CHUNKS ||
        !Number.isInteger(chunk_index) || chunk_index < 0 || chunk_index >= chunk_count ||
        !/^[a-f0-9]{64}$/.test(sha256 || '') || typeof chunk_base64 !== 'string' ||
        !chunk_base64.length || chunk_base64.length > CHUNK_SIZE || chunk_base64.length % 4 ||
        Buffer.from(chunk_base64, 'base64').toString('base64') !== chunk_base64 ||
        (chunk_index < chunk_count - 1 && chunk_base64.length !== CHUNK_SIZE)) throw Error('Invalid image chunk');
    // Staging never invokes Telegram. Stale uploads can be safely discarded.
    for (const entry of fs.readdirSync(root)) {
      const p = path.join(root, entry);
      if (validId(entry) && fs.statSync(p).mtimeMs < Date.now() - 86400000) fs.rmSync(p, { recursive: true, force: true });
    }
    const dest = folder(upload_id); fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    const meta = JSON.stringify({ chunk_count, sha256 });
    const immutable = (file, value) => {
      try { fs.writeFileSync(file, value, { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code !== 'EEXIST' || fs.readFileSync(file, 'utf8') !== value) throw Error('Upload ID already used for different image data'); }
    };
    immutable(path.join(dest, 'meta.json'), meta);
    immutable(path.join(dest, `${chunk_index}.txt`), chunk_base64);
    fs.utimesSync(dest, new Date(), new Date());
    const ready = Array.from({ length: chunk_count }, (_, i) => fs.existsSync(path.join(dest, `${i}.txt`))).every(Boolean);
    if (!ready) return { upload_id, status: 'uploading', chunk_index };
    const image = read(upload_id);
    return { upload_id, status: 'ready', sha256, size_bytes: image.length };
  }
  function read(id) {
    const dest = folder(id);
    try {
      if (fs.statSync(dest).mtimeMs < Date.now() - 86400000) throw Error();
      const { chunk_count, sha256 } = JSON.parse(fs.readFileSync(path.join(dest, 'meta.json'), 'utf8'));
      const encoded = Array.from({ length: chunk_count }, (_, i) => fs.readFileSync(path.join(dest, `${i}.txt`), 'utf8')).join('');
      const image = Buffer.from(encoded, 'base64');
      if (!image.length || image.length > MAX_IMAGE || image.toString('base64') !== encoded ||
          crypto.createHash('sha256').update(image).digest('hex') !== sha256) throw Error();
      const png = image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpg = image[0] === 255 && image[1] === 216 && image[2] === 255;
      if (!png && !jpg) throw Error();
      return image;
    } catch { throw Error('Image upload is incomplete, expired, or invalid'); }
  }
  return { stage, read };
}
module.exports = { createImageUploads, CHUNK_SIZE, MAX_CHUNKS };
