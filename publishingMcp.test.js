const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { startPublisher } = require('./publisher');

test('real MCP client discovers authenticated tools; explicit-send gate, receipts and duplicate protection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-mcp-'));
  let calls = 0;
  const bot = { sendMessage: async () => { calls++; return { chat: { id: -123 }, message_id: 42, date: 1 }; },
    sendPhoto: async () => { calls++; return { chat: { id: -123 }, message_id: 43, date: 1 }; } };
  const key = 'x'.repeat(32);
  const server = startPublisher(bot, { PUBLISH_ENABLED: 'true', PUBLISH_API_KEY: key, PUBLISH_STATE_DIR: dir,
    PUBLISH_DESTINATIONS: '{"frens":{"chat_id":"-123"}}', PORT: '0' });
  await once(server, 'listening');
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${key}` } } });
  const parse = response => JSON.parse(response.content[0].text);
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${key}`, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${key}` } })).status, 405);
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
    assert.equal(tools.find(t => t.name === 'publish_announcement').annotations.readOnlyHint, false);
    assert.deepEqual(parse(await client.callTool({ name: 'list_destinations', arguments: {} })), { destinations: ['frens'] });
    assert.equal(calls, 0);
    const args = { request_id: 'mcp-announcement-001', destination: 'frens', text: 'Approved announcement' };
    assert.equal((await client.callTool({ name: 'publish_announcement', arguments: args })).isError, true);
    assert.equal(calls, 0);
    assert.equal((await client.callTool({ name: 'publish_announcement', arguments: { ...args, destination: 'unknown', user_instructed_publish: true } })).isError, true);
    assert.equal(calls, 0);
    const receipt = parse(await client.callTool({ name: 'publish_announcement', arguments: { ...args, user_instructed_publish: true } }));
    assert.equal(receipt.status, 'sent');
    assert.equal(calls, 1);
    await client.callTool({ name: 'publish_announcement', arguments: { ...args, user_instructed_publish: true } });
    assert.equal(calls, 1);
    assert.equal(parse(await client.callTool({ name: 'get_publish_receipt', arguments: { request_id: args.request_id } })).message_id, 42);
    const photo = { ...args, request_id: 'mcp-photo-001', image_base64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64'), user_instructed_publish: true };
    assert.equal(parse(await client.callTool({ name: 'publish_announcement', arguments: photo })).message_id, 43);
    assert.equal(calls, 2);
    bot.sendMessage = async () => { calls++; throw Error('timeout'); };
    const uncertain = { ...args, request_id: 'mcp-uncertain-001', user_instructed_publish: true };
    assert.equal((await client.callTool({ name: 'publish_announcement', arguments: uncertain })).isError, true);
    assert.equal(parse(await client.callTool({ name: 'get_publish_receipt', arguments: { request_id: uncertain.request_id } })).status, 'pending');
    assert.equal((await client.callTool({ name: 'publish_announcement', arguments: uncertain })).isError, true);
    assert.equal(calls, 3);
    assert.equal((await client.callTool({ name: 'get_publish_receipt', arguments: { request_id: '../../secret' } })).isError, true);
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  }
});


test('large photo staged over MCP is byte-exact, consent-gated and duplicate-protected', async () => {
  const crypto = require('node:crypto');
  const { CHUNK_SIZE } = require('./imageUploads');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-chunks-'));
  const photo = process.env.DIAGNOSTIC_PHOTO_PATH ? fs.readFileSync(process.env.DIAGNOSTIC_PHOTO_PATH) : Buffer.alloc(4 * 1024 * 1024, 19);
  if (!process.env.DIAGNOSTIC_PHOTO_PATH) Buffer.from([137,80,78,71,13,10,26,10]).copy(photo);
  let calls = 0;
  const bot = { sendPhoto: async (chat, image, opts) => {
    calls++; assert.deepEqual(image, photo); assert.equal(opts.caption, 'Approved photo');
    return { chat: { id: chat }, message_id: 99 };
  } };
  const key = 'x'.repeat(32);
  const server = startPublisher(bot, { PUBLISH_ENABLED: 'true', PUBLISH_API_KEY: key, PUBLISH_STATE_DIR: dir,
    PUBLISH_DESTINATIONS: '{"frens":{"chat_id":"-123"}}', PORT: '0' });
  await once(server, 'listening');
  const client = new Client({ name: 'chunk-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } });
  const parse = r => JSON.parse(r.content[0].text);
  try {
    await client.connect(transport);
    const encoded = photo.toString('base64'), upload_id = 'large-photo-upload-001';
    const chunk_count = Math.ceil(encoded.length / CHUNK_SIZE), sha256 = crypto.createHash('sha256').update(photo).digest('hex');
    for (let chunk_index = 0; chunk_index < chunk_count; chunk_index++) {
      const reply = await client.callTool({ name: 'upload_image_chunk', arguments: { upload_id, chunk_index, chunk_count, sha256,
        chunk_base64: encoded.slice(chunk_index * CHUNK_SIZE, (chunk_index + 1) * CHUNK_SIZE) } });
      assert.notEqual(reply.isError, true);
      assert.equal(parse(reply).status, chunk_index === chunk_count - 1 ? 'ready' : 'uploading');
    }
    assert.equal(calls, 0);
    const args = { request_id: 'large-photo-send-001', destination: 'frens', text: 'Approved photo', image_upload_id: upload_id };
    assert.equal((await client.callTool({ name: 'publish_announcement', arguments: args })).isError, true);
    assert.equal(calls, 0);
    assert.equal(parse(await client.callTool({ name: 'publish_announcement', arguments: { ...args, user_instructed_publish: true } })).message_id, 99);
    await client.callTool({ name: 'publish_announcement', arguments: { ...args, user_instructed_publish: true } });
    assert.equal(calls, 1);
    const { image_upload_id, ...inline } = args;
    await client.callTool({ name: 'publish_announcement', arguments: { ...inline, image_base64: encoded, user_instructed_publish: true } });
    assert.equal(calls, 1);
    assert.equal((await client.callTool({ name: 'publish_announcement', arguments: { ...args, text: 'Changed', user_instructed_publish: true } })).isError, true);
    assert.equal(calls, 1);
  } finally {
    await client.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true });
  }
});
