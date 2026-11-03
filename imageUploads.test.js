const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createImageUploads, CHUNK_SIZE } = require('./imageUploads');

test('chunk uploads preserve exact bytes, allow identical retries and reject corruption and traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-uploads-'));
  try {
    const uploads = createImageUploads(dir);
    const bytes = Buffer.alloc(400000, 27); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    const encoded = bytes.toString('base64');
    const meta = { upload_id: 'test-upload-001', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), chunk_count: Math.ceil(encoded.length / CHUNK_SIZE) };
    assert.throws(() => uploads.read('../escape'));
    for (let i = 0; i < meta.chunk_count; i++) {
      const args = { ...meta, chunk_index: i, chunk_base64: encoded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) };
      const result = uploads.stage(args);
      assert.equal(result.status, i === meta.chunk_count - 1 ? 'ready' : 'uploading');
      assert.deepEqual(uploads.stage(args), result);
      if (i === 0) assert.throws(() => uploads.read(meta.upload_id));
    }
    assert.deepEqual(uploads.read(meta.upload_id), bytes);
    assert.throws(() => uploads.stage({ ...meta, chunk_index: 0, chunk_base64: 'AAAA'.repeat(CHUNK_SIZE / 4) }));
    assert.throws(() => uploads.stage({ ...meta, upload_id: 'bad-hash-001', chunk_count: 1, chunk_index: 0, chunk_base64: 'AAAA' }));
    assert.throws(() => uploads.stage({ ...meta, chunk_count: 28, chunk_index: 0, chunk_base64: 'AAAA' }));
    assert.throws(() => uploads.stage({ ...meta, chunk_index: 0, chunk_base64: '====' }));
    assert.throws(() => uploads.stage({ ...meta, chunk_index: 0, chunk_base64: 'AAAA' }));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
