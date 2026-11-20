const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Telegram flow: group isolation, public hunt, other-player block, replay protection, personal score and persistence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-hunt-'));
  process.env.LUMEN_HUNT_ENABLED = 'true';
  process.env.LUMEN_HUNT_GROUP_ID = '-100250140138';
  process.env.LUMEN_HUNT_DATA_FILE = path.join(dir, 'state.json');
  const modulePath = require.resolve('./lumenHunt');
  delete require.cache[modulePath];
  const { register } = require('./lumenHunt');
  const handlers = [];
  const callbacks = {};
  const sent = [];
  const acknowledgements = [];
  const bot = {
    onText(regex, fn) { handlers.push({ regex, fn }); },
    on(name, fn) { callbacks[name] = fn; },
    async sendMessage(chatId, text, options) { sent.push({ chatId, text, options }); },
    async editMessageText(text, options) { sent.push({ text, options, edited: true }); },
    async answerCallbackQuery(id, options) { acknowledgements.push({ id, options }); }
  };
  const invoke = (command, msg) => {
    const handler = handlers.find(h => h.regex.test(command));
    assert.ok(handler, 'handler registered for ' + command);
    return handler.fn({ ...msg, text: command }, command.match(handler.regex));
  };
  try {
    register(bot);
    const group = { id: -100250140138, type: 'supergroup' };
    const outsiderGroup = { id: -100999, type: 'supergroup' };
    const user = { id: 123, username: 'Hunter' };
    const other = { id: 456, username: 'Other' };
    await invoke('/bwhunt', { chat: group, from: user });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].options.reply_markup.inline_keyboard.length, 3);
    await invoke('/bwhunt', { chat: outsiderGroup, from: user });
    assert.equal(sent.length, 1, 'other group receives no message');
    const day = new Date().toISOString().slice(0, 10);
    const q = { id: 'q1', data: 'lh:' + day + ':123:shrine', from: user, message: { chat: group, message_id: 1 } };
    await callbacks.callback_query({ ...q, id: 'wrong', from: other });
    assert.equal(acknowledgements.at(-1).options.show_alert, true);
    assert.equal(sent.length, 1);
    await callbacks.callback_query(q);
    assert.equal(sent.length, 2);
    assert.match(sent.at(-1).text, /Lumens discovered/);
    const saved = JSON.parse(fs.readFileSync(process.env.LUMEN_HUNT_DATA_FILE, 'utf8'));
    assert.equal(Object.keys(saved.hunts).length, 1);
    const discovered = Object.values(saved.hunts)[0].lumens;
    await callbacks.callback_query({ ...q, id: 'again' });
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(process.env.LUMEN_HUNT_DATA_FILE, 'utf8')).hunts).length, 1);
    await invoke('/myscore', { chat: group, from: user });
    assert.match(sent.at(-1).text, new RegExp(discovered + ' Lumens discovered this week'));
    await invoke('/bwhunt', { chat: group, from: user });
    assert.match(sent.at(-1).text, /complete for today/);
    await invoke('/lboard', { chat: group, from: user });
    assert.match(sent.at(-1).text, /@Hunter/);
    assert.equal(JSON.parse(fs.readFileSync(process.env.LUMEN_HUNT_DATA_FILE, 'utf8')).hunts['123:' + day].lumens, discovered);
  } finally {
    delete require.cache[modulePath];
    delete process.env.LUMEN_HUNT_ENABLED;
    delete process.env.LUMEN_HUNT_GROUP_ID;
    delete process.env.LUMEN_HUNT_DATA_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
