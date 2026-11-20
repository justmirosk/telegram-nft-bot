const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('../citizenCard')

function setup({ chatType = 'private', linked = true, imageOk = true, imageBytes = Buffer.from('png'), lookupOk = true } = {}) {
  const sent = []
  let handler
  const bot = {
    onText(regex, fn) { assert.match('/citizen', regex); handler = fn },
    async sendMessage(id, text, options) { sent.push({ type: 'message', id, text, options }) },
    async sendPhoto(id, photo, options) { sent.push({ type: 'photo', id, photo, options }) },
  }
  const calls = []
  const originalFetch = global.fetch
  const oldBase = process.env.BEANISCROLLS_TELEGRAM_LINK_URL
  const oldSecret = process.env.TELEGRAM_LINK_API_SECRET
  process.env.BEANISCROLLS_TELEGRAM_LINK_URL = 'https://www.beaniscrolls.com/api/connected-accounts/telegram'
  process.env.TELEGRAM_LINK_API_SECRET = 'test-secret-not-real'
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('/citizen?')) return {
      ok: lookupOk,
      async json() { return { linked, wallet: '0x' + 'a'.repeat(40), name: 'Test Citizen' } },
    }
    return {
      ok: imageOk,
      headers: { get(name) { return name === 'content-type' ? 'image/png' : null } },
      async arrayBuffer() { return imageBytes },
    }
  }
  const captures = []
  register(bot, async (base, wallet) => {
    captures.push({ base, wallet })
    if (!imageOk) throw new Error('Screenshot unavailable')
    return imageBytes
  })
  return {
    calls, sent, captures,
    run() { return handler({ chat: { id: 88, type: chatType }, from: { id: 123456 } }) },
    cleanup() {
      global.fetch = originalFetch
      if (oldBase === undefined) delete process.env.BEANISCROLLS_TELEGRAM_LINK_URL
      else process.env.BEANISCROLLS_TELEGRAM_LINK_URL = oldBase
      if (oldSecret === undefined) delete process.env.TELEGRAM_LINK_API_SECRET
      else process.env.TELEGRAM_LINK_API_SECRET = oldSecret
    },
  }
}
test('linked citizen receives fresh PNG and public profile button', async () => {
  const t = setup()
  try {
    await t.run()
    assert.equal(t.calls.length, 1)
    assert.match(t.calls[0].url, /telegram\/citizen\?telegramUserId=123456/)
    assert.equal(t.captures.length, 1)
    assert.equal(t.captures[0].wallet, '0x' + 'a'.repeat(40))
    assert.equal(t.calls[0].options.headers.Authorization, 'Bearer test-secret-not-real')
    assert.equal(t.sent[0].type, 'photo')
    assert.match(t.sent[0].options.reply_markup.inline_keyboard[0][0].url, /^https:\/\/www\.beaniscrolls\.com\/citizens\/0x/)
  } finally { t.cleanup() }
})
test('unlinked account is directed to link, without image request', async () => {
  const t = setup({ linked: false })
  try {
    await t.run()
    assert.equal(t.calls.length, 1)
    assert.match(t.sent[0].text, /not linked/)
  } finally { t.cleanup() }
})
test('group command publishes only requesting linked citizen public card', async () => {
  const t = setup({ chatType: 'group' })
  try {
    await t.run()
    assert.equal(t.calls.length, 1)
    assert.match(t.calls[0].url, /telegramUserId=123456/)
    assert.equal(t.sent[0].type, 'photo')
    assert.equal(t.sent[0].id, 88)
    assert.ok(t.sent[0].options.reply_markup.inline_keyboard[0][0].url.includes('beaniscrolls.com/citizens/'))
  } finally { t.cleanup() }
})
test('image failure falls back to profile link', async () => {
  const t = setup({ imageOk: false })
  try {
    await t.run()
    assert.equal(t.sent[0].type, 'message')
    assert.match(t.sent[0].text, /could not be generated/)
    assert.equal(t.sent[0].options.reply_markup.inline_keyboard.length, 1)
  } finally { t.cleanup() }
})
test('lookup failure does not expose a profile', async () => {
  const t = setup({ lookupOk: false })
  try {
    await t.run()
    assert.equal(t.calls.length, 1)
    assert.match(t.sent[0].text, /Could not load/)
  } finally { t.cleanup() }
})
