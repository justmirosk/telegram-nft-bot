const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startArenaDelivery } = require('./arenaDelivery');
test('disabled publisher never polls', () => assert.equal(startArenaDelivery({}, () => { throw Error('unexpected'); }), null));
test('does not publish or poll at startup; polls only fixed authenticated app endpoints', async () => {
  const calls = [];
  const worker = startArenaDelivery({ PUBLISH_ENABLED: 'true', PUBLISH_API_KEY: 'a'.repeat(40) }, async (...args) => { calls.push(args); });
  assert.equal(calls.length, 0);
  await worker.poll(); worker.stop();
  assert.deepEqual(calls.map(x => x[0]), ['https://beaniscrolls.site/api/beast-arena/notifications', 'https://gems-testnet.beaniscrolls.site/api/beast-arena/notifications']);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer ' + 'a'.repeat(40));
});
test('Arena main destination uses the existing BeaniWorld group without a raid topic', async () => {
  const { once } = require('node:events'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { startPublisher } = require('./publisher'); const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-destination-'));
  const server = startPublisher({ sendMessage: async (...args) => { calls.push(args); return { chat: { id: -123 }, message_id: 12 }; } }, { PORT:'0', PUBLISH_ENABLED:'true', PUBLISH_API_KEY:'a'.repeat(40), PUBLISH_STATE_DIR:dir, BOSS_RAID_LIVE_CHAT_ID:'-123', PUBLISH_DESTINATIONS:JSON.stringify({ 'beaniscrolls-test':{chat_id:'-456',message_thread_id:99} }) });
  try {
    if (!server.listening) await once(server,'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/publish`, {method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(40),'Content-Type':'application/json'},body:JSON.stringify({request_id:'arena-test-main-001',destination:'beasts-arena-main',text:'Arena test fixture'})});
    assert.equal(response.status,200); assert.equal(calls[0][0],'-123');assert.equal(calls[0][2].message_thread_id,undefined);
  } finally { await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true}); }
});
