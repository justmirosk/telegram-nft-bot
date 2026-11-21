const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Lumen Hunt retries the same reward after linking and credits only new weeks', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-sync-'));
  const file = path.join(dir, 'state.json');
  const env = {
    LUMEN_HUNT_ENABLED: 'true',
    LUMEN_HUNT_GROUP_ID: '-1001',
    LUMEN_HUNT_DATA_FILE: file,
    LUMEN_HUNT_SYNC_START_WEEK: '2026-11-23',
    LUMEN_HUNT_SYNC_ORIGIN: 'https://example.test',
    LUMEN_HUNT_SYNC_SECRET: 'test-secret-unused-outside-this-test',
  };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  fs.writeFileSync(file, JSON.stringify({
    hunts: { old: { userId: '99', name: 'Old', week: '2026-11-16', lumens: 25, at: '2026-11-22T12:00:00Z' } },
    payouts: {},
  }));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const requests = [];
  let status = 'unlinked';
  let tick;
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-23T12:00:00Z') });
  t.mock.method(globalThis, 'setInterval', fn => {
    tick = fn;
    return { unref() {} };
  });
  t.mock.method(require('node:crypto'), 'randomInt', max => max === 100 ? 11 : 0);
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url.pathname, '/api/connected-accounts/telegram/lumen-hunt');
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ status }) };
  });

  let callback;
  require('./lumenHunt').register({
    onText() {},
    on(name, handler) { if (name === 'callback_query') callback = handler; },
    async answerCallbackQuery() {},
    async editMessageText() {},
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const hunt = {
    id: 'first',
    data: 'lh:2026-11-23:123:shrine',
    from: { id: 123, first_name: 'Hunter' },
    message: { chat: { id: -1001, type: 'supergroup' }, message_id: 1 },
  };

  await callback(hunt);
  await callback({ ...hunt, id: 'repeat' });
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].amount, 10);
  assert.equal(read().hunts['123:2026-11-23'].sync.credited, undefined);

  status = 'credited';
  t.mock.timers.setTime(new Date('2026-11-23T12:06:00Z').getTime());
  tick();
  await settle();
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(read().hunts['123:2026-11-23'].sync.credited, true);

  t.mock.timers.setTime(new Date('2026-11-30T12:00:00Z').getTime());
  tick();
  await settle();
  tick();
  await settle();
  assert.deepEqual(requests.map(reward => reward.amount), [10, 10, 100]);
  assert.equal(read().syncBonuses['2026-11-23'][0].sync.credited, true);
  assert.equal(read().syncBonuses['2026-11-16'], undefined);
});
