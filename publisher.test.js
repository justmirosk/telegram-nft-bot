const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startPublisher } = require('./publisher');

test('publisher authenticates, restricts destinations, sends images and persists duplicate protection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-'));
  let calls = 0;
  const bot = { sendMessage: async () => { calls++; return { chat: { id: -123 }, message_id: 42, date: 1 }; },
    sendPhoto: async (chat, image, opts) => { assert(Buffer.isBuffer(image)); assert.equal(opts.caption, 'Hello'); calls++; return { chat: { id: chat }, message_id: 43 }; } };
  const env = { PUBLISH_ENABLED: 'true', PUBLISH_API_KEY: 'x'.repeat(32), PUBLISH_STATE_DIR: dir, PUBLISH_DESTINATIONS: '{"frens":{"chat_id":"-123"}}', PORT: '0' };
  let server = startPublisher(bot, env); await once(server, 'listening');
  const post = (data, auth = true) => fetch(`http://127.0.0.1:${server.address().port}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${env.PUBLISH_API_KEY}` } : {}) }, body: JSON.stringify(data) });
  const data = { request_id: 'test-post-001', destination: 'frens', text: 'Hello' };
  try {
    assert.equal((await post(data, false)).status, 401);
    assert.equal((await post({ ...data, destination: '__proto__' })).status, 400);
    assert.equal((await post({ ...data, text: 'a'.repeat(4097) })).status, 400);
    assert.equal((await post(data)).status, 200);
    assert.equal((await post(data)).status, 200); assert.equal(calls, 1);
    assert.equal((await post({ ...data, text: 'Changed' })).status, 409);
    await new Promise(r => server.close(r));
    server = startPublisher(bot, env); await once(server, 'listening');
    assert.equal((await post(data)).status, 200); assert.equal(calls, 1);
    const image = Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
    assert.equal((await post({ ...data, request_id: 'test-photo-001', image_base64: image })).status, 200);
    bot.sendMessage = async () => { calls++; throw Error('timeout'); };
    const uncertain = { ...data, request_id: 'test-timeout-001' };
    assert.equal((await post(uncertain)).status, 502);
    assert.equal((await post(uncertain)).status, 409); assert.equal(calls, 3);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true }); }
});
test('disabled by default and rejects incomplete configuration', () => {
  assert.equal(startPublisher({}, {}), null);
  assert.throws(() => startPublisher({}, { PUBLISH_ENABLED: 'true' }));
});
