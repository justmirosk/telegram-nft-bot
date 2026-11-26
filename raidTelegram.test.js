const assert = require('node:assert/strict')
const { test } = require('node:test')
const { openBossRaid } = require('./bossRaid')
const { createRaidEvidence } = require('./raidEvidence')
const { register, registerRaidCommands, retainUploadedArtwork } = require('./raidTelegram')

const chat = '-100123'
const topic = '41'
const admin = '1'
const walletOf = player => '0x' + Number(player).toString(16).padStart(40, '0')

function setup(t, { testChat = chat, testTopic = topic } = {}) {
  let clock = 0
  let roll = 0
  const actions = []
  const commands = []
  const events = new Map()
  const errors = []
  const bot = {
    onText: (pattern, handler) => commands.push({ pattern, handler }),
    on: (event, handler) => events.set(event, handler),
    sendMessage: async (chat, text, options) => actions.push({ type: 'message', chat, text, options }),
    sendPhoto: async (chat, media, options) => {
      actions.push({ type: 'photo', chat, media, options })
      return { message_id: 20 }
    },
    editMessageMedia: async (media, options) => actions.push({ type: 'edit', media, options }),
    getChat: async id => ({ id: Number(id), type: 'supergroup' }),
    getMe: async () => ({ id: 20 }),
    getChatMember: async () => ({ status: 'administrator' }),
    pinChatMessage: async (chat, post) => actions.push({ type: 'pin', chat, post }),
    answerCallbackQuery: async (id, options) => actions.push({ type: 'callback', id, options }),
  }
  const engine = openBossRaid(':memory:', { now: () => clock, roll: () => roll })
  t.after(() => engine.close())
  const evidence = {
    openingBlock: async () => '42',
    link: async (player, username, code) => {
      actions.push({ type: 'link', player, username, code })
      return true
    },
    linkedWallet: async player => player === '999' ? null : walletOf(player),
    eligibleTokens: async wallet => wallet === walletOf('52') ? ['10', '49']
      : wallet === walletOf('51') ? ['77'] : ['65'],
    verify: async (player, token, openingBlock, wallet) => ({
      token, openingBlock, confirmedBlock: '43', wallet, openingOwner: wallet, confirmedOwner: wallet, tribe: 'polaris',
    }),
  }
  const template = { name: 'Test Beast', beast: '1', hp: 600, lumens: 500, durationMinutes: 60,
    attacking: 'attacking-photo', wounded: 'wounded-photo', defeated: 'defeated-photo' }
  const launchOnce = registerRaidCommands(bot, { engine, evidence, settings: { chat: testChat, topic: testTopic, admin, template },
    now: () => clock, onError: (...error) => errors.push(error) })

  function message(text, msg) {
    const route = commands.find(({ pattern }) => pattern.test(text))
    assert.ok(route, text)
    return route.handler(msg, route.pattern.exec(text))
  }
  const privateMessage = (text, player = 1) =>
    message(text, { chat: { id: player, type: 'private' }, from: { id: player }, message_id: 5 })
  function groupMessage(text, { player = 51, id = 25, thread = testTopic ? Number(testTopic) : undefined, reply = 20, at = 0, damageRoll = 0, chatId = Number(testChat) } = {}) {
    clock = at
    roll = damageRoll
    return message(text, { chat: { id: chatId, type: 'supergroup' }, from: { id: player },
      message_id: id, message_thread_id: thread, reply_to_message: { message_id: reply } })
  }
  function pick(data, player = 52, chatId = player) {
    return events.get('callback_query')({ id: 'callback', data, from: { id: player },
      message: { chat: { id: chatId, type: 'private' } } })
  }
  function tap(id, player = 51, post = 20, thread = Number(testTopic)) {
    return events.get('callback_query')({ id, data: 'raid-hit', from: { id: player },
      message: { chat: { id: Number(testChat), type: 'supergroup' }, message_id: post, message_thread_id: thread } })
  }
  return { actions, errors, engine, evidence, privateMessage, groupMessage, pick, tap, launchOnce }
}

test('rehearsal launches in the test topic, selects a MiniBeany privately and changes artwork in place', async t => {
  const f = setup(t)
  await f.privateMessage('/raidadmin launch', 2)
  assert.equal(f.actions.length, 0)
  await f.privateMessage('/raidadmin launch')
  assert.equal(f.actions[0].options.message_thread_id, 41)
  assert.equal(f.actions[0].media, 'attacking-photo')
  assert.equal(f.actions[0].options.parse_mode, 'HTML')
  assert.ok(f.actions[0].options.caption.startsWith('<b>Test Beast</b>\n<i>Boss HP 600/600</i>\n' + '🟥'.repeat(10)))
  assert.equal(f.actions[1].post, 20)
  await f.groupMessage('/attack', { thread: 42 })
  assert.equal(f.actions.length, 3)
  await f.groupMessage('/attack', { reply: 21 })
  assert.match(f.actions.at(-1).text, /Reply directly/)
  await f.groupMessage('/attack', { player: 999, id: 24 })
  assert.match(f.actions.at(-1).text, /send \/raidlink/i)
  await f.groupMessage('/attack', { id: 25 })
  assert.ok(f.actions.at(-2).text.startsWith('<b>MiniBeany #078 dealt 100 damage.</b>\n<i>Boss HP 500/600</i>'))
  assert.equal(f.actions.at(-2).options.parse_mode, 'HTML')
  assert.deepEqual(f.actions.at(-2).options.reply_parameters, { message_id: 25 })
  await f.groupMessage('/attack', { player: 52, id: 26, at: 20_000, damageRoll: 5 })
  assert.match(f.actions.at(-1).text, /use \/raidme/)
  await f.privateMessage('/raidme', 52)
  const pick = f.actions.at(-1).options.reply_markup.inline_keyboard[0][1]
  assert.equal(pick.text, '#050')
  await f.pick(pick.callback_data, 53, 52)
  assert.match(f.actions.at(-1).options.text, /fresh list/)
  await f.pick(pick.callback_data)
  assert.match(f.actions.at(-1).options.text, /#050 selected/)
  await f.groupMessage('/attack', { player: 52, id: 27, at: 20_000, damageRoll: 5 })
  await f.groupMessage('/attack', { player: 53, id: 28, at: 60_000, damageRoll: -5 })
  assert.equal(f.actions.at(-1).media.media, 'wounded-photo')
  await f.groupMessage('/attack', { id: 29, at: 299_000 })
  assert.match(f.actions.at(-1).text, /1 second\./)
  await f.groupMessage('/attack', { id: 30, at: 300_000 })
  await f.groupMessage('/attack', { player: 52, id: 31, at: 320_000, damageRoll: -10 })
  await f.groupMessage('/attack', { player: 53, id: 32, at: 360_000, damageRoll: 5 })
  assert.equal(f.actions.at(-2).text, ['<b>MiniBeany #066 dealt 90 damage.</b>', '<i>Boss HP 0/600</i>', 'Beast defeated!', 'Congratulations to the hero.', '<i>All lumens are recorded.</i>'].join('\n'))
  assert.equal(f.actions.at(-1).media.media, 'defeated-photo')
  assert.ok(f.actions.at(-1).media.caption.includes('<i>Boss HP 0/600</i>\n' + '⬛'.repeat(10)))
  assert.match(f.actions.at(-1).media.caption, /500 mock Lumens for Polarim/)
  assert.deepEqual(f.actions.at(-1).options, { chat_id: chat, message_id: 20, reply_markup: { inline_keyboard: [] } })
  await f.groupMessage('/raid', { id: 33, at: 361_000 })
  assert.equal(f.actions.at(-1).options.reply_markup.inline_keyboard[0][0].url, 'https://t.me/c/123/41/20')
  assert.deepEqual(f.errors, [])
})

test('main group mode sends without a topic and accepts replies only in the configured group', async t => {
  const testChat = '-1002345678901'
  const f = setup(t, { testChat, testTopic: '' })
  await f.privateMessage('/raidadmin launch')
  assert.equal(f.actions[0].chat, testChat)
  assert.equal(f.actions[0].options.message_thread_id, undefined)
  await f.groupMessage('/attack', { chatId: -100123 })
  await f.groupMessage('/attack', { thread: 41 })
  assert.equal(f.engine.latest(testChat, '').hp, 600)
  await f.groupMessage('/attack')
  assert.equal(f.engine.latest(testChat, '').hp, 500)
  await f.groupMessage('/raid', { id: 26 })
  const options = f.actions.at(-1).options
  assert.equal(options.message_thread_id, undefined)
  assert.equal(options.reply_markup.inline_keyboard[0][0].url, 'https://t.me/c/2345678901/20')
})

test('a temporary verified-wallet failure leaves HP intact and the same message can retry', async t => {
  const f = setup(t)
  await f.privateMessage('/raidadmin launch')
  const verify = f.evidence.verify
  f.evidence.verify = async () => { throw new Error('Preview unavailable') }
  await f.groupMessage('/attack')
  assert.match(f.actions.at(-1).text, /temporarily unavailable/)
  assert.equal(f.engine.latest(chat, topic).hp, 600)
  f.evidence.verify = verify
  await f.groupMessage('/attack')
  assert.equal(f.engine.latest(chat, topic).hp, 500)
  await f.privateMessage('/raidme', 51)
  assert.match(f.actions.at(-1).text, /100 damage dealt/)
  await f.privateMessage('/raidadmin cancel')
  await f.groupMessage('/attack', { id: 26 })
  assert.match(f.actions.at(-1).text, /cancelled/)
})

test('authorized startup launch checks Preview before posting and consumes its ID once', async t => {
  const f = setup(t)
  const linkedWallet = f.evidence.linkedWallet
  f.evidence.linkedWallet = async () => { throw new Error('Preview unavailable') }
  await assert.rejects(() => f.launchOnce('rehearsal'), /Preview unavailable/)
  assert.equal(f.actions.length, 0)
  f.evidence.linkedWallet = linkedWallet
  assert.deepEqual(await f.launchOnce('rehearsal'), { status: 'posted', post: 20, adminLinked: true })
  assert.equal(await f.engine.cancel(f.engine.latest(chat, topic).id), 'cancelled')
  assert.deepEqual(await f.launchOnce('rehearsal'), { status: 'already-attempted' })
  assert.equal(f.actions.filter(action => action.type === 'photo').length, 1)
})

test('raid linking accepts a valid code only in the player’s private chat', async t => {
  const f = setup(t)
  const code = 'abcd'.repeat(6)
  await f.groupMessage('/raidlink ' + code)
  assert.equal(f.actions.length, 0)
  await f.privateMessage('/raidlink ' + code, 51)
  assert.deepEqual(f.actions[0], { type: 'link', code, player: '51', username: '' })
  assert.match(f.actions[1].text, /linked to your BeaniScrolls Preview/)
})

test('evidence is read from Preview and rejects wallet changes and stale BNB state', async () => {
  const wallet = walletOf('51')
  const requests = []
  let linked = wallet
  let finalized = '45'
  const adapter = createRaidEvidence({
    secret: 'test-secret',
    nftService: {
      getFinalizedMiniBeanyBlock: async () => finalized,
      getHolderAtBlock: async (token, block) => token === '77' || (token === '65' && block === '42') ? wallet : walletOf('2'),
    },
    fetcher: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => url.pathname.endsWith('citizen')
        ? { linked: true, wallet: linked } : { representedTribe: 'polaris' } }
    },
  })
  assert.deepEqual(await adapter.eligibleTokens(wallet, '42'), ['77'])
  assert.equal((await adapter.verify('51', '77', '42', wallet, true)).tribe, 'polaris')
  assert.ok(requests.every(r => r.url.origin === 'https://gems-testnet.beaniscrolls.site'))
  assert.equal(requests[0].options.headers.Authorization, undefined)
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-secret')
  linked = walletOf('2')
  assert.equal(await adapter.verify('51', '77', '42', wallet, false), null)
  finalized = '41'
  await assert.rejects(() => adapter.eligibleTokens(wallet, '42'), /stale/)
})

test('rehearsal is opt-in', () => {
  assert.doesNotThrow(() => register(null, null, {}))
})

test('the Telegram and Web3 clients send the expected rehearsal requests over HTTP', { timeout: 15_000 }, async t => {
  const { createServer } = require('node:http')
  const { once } = require('node:events')
  const TelegramBot = require('node-telegram-bot-api')
  const NFTService = require('./nftService')
  const calls = []
  const failures = []
  const owner = walletOf('51')
  let requestId = 0
  const contract = walletOf('100')
  const server = createServer(async (request, response) => {
    try {
      const parts = []
      for await (const part of request) parts.push(part)
      const body = Buffer.concat(parts).toString()
      let result
      if (request.url === '/rpc') {
        const rpc = JSON.parse(body)
        assert.ok(rpc.id !== undefined)
        calls.push({ rpc })
        const rpcResults = {
          eth_chainId: '0x38',
          eth_getBlockByNumber: { number: '0x2a' },
          eth_call: '0x' + owner.slice(2).padStart(64, '0'),
        }
        result = { jsonrpc: '2.0', id: rpc.id, result: rpcResults[rpc.method] }
      } else {
        const url = new URL(request.url, 'http://localhost')
        const method = url.pathname.split('/').at(-1)
        const form = url.searchParams
        if (body) {
          const fields = await new Response(body, { headers: { 'Content-Type': request.headers['content-type'] } }).formData()
          for (const [key, value] of fields) {
            form.set(key, typeof value === 'string' ? value : value.name)
          }
        }
        calls.push({ method, form })
        result = { ok: true, result: method === 'sendPhoto' ? { message_id: 20 } : true }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result))
    } catch (error) {
      failures.push(error)
      response.writeHead(500)
      response.end()
    }
  })
  t.after(() => server.close())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = 'http://127.0.0.1:' + server.address().port
  const bot = new TelegramBot('fixture', { baseApiUrl: origin, polling: false, request: { proxy: null, timeout: 3000 } })
  const nft = new NFTService(origin + '/rpc', contract)
  const engine = openBossRaid(':memory:', { roll: () => 0 })
  t.after(() => engine.close())
  const evidence = createRaidEvidence({
    nftService: nft,
    secret: 'fixture',
    fetcher: async url => ({ ok: true, json: async () => url.pathname.endsWith('citizen')
      ? { linked: true, wallet: owner } : { representedTribe: 'polaris' } }),
  })
  // Keep this transport test focused on verifying the selected token's on-chain reads.
  evidence.eligibleTokens = async () => ['77']
  const template = { name: 'Test Beast', beast: '1', hp: 100, lumens: 500, durationMinutes: 60,
    attacking: 'asset:attacking', wounded: 'asset:wounded', defeated: 'asset:defeated' }
  let onCommandComplete
  const onText = bot.onText.bind(bot)
  bot.onText = (pattern, handler) => onText(pattern, async (...args) => {
    await handler(...args)
    onCommandComplete()
  })
  registerRaidCommands(bot, { engine, evidence, settings: { chat, topic, admin, template },
    onError: (...error) => failures.push(error) })

  function processMessage(message) {
    return new Promise(resolve => {
      onCommandComplete = resolve
      bot.processUpdate({ update_id: ++requestId, message })
    })
  }
  await processMessage({
    message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/raidadmin launch',
  })
  await processMessage({
    message_id: 25, chat: { id: Number(chat), type: 'supergroup' }, from: { id: 51 },
    message_thread_id: 41, reply_to_message: { message_id: 20 }, text: '/attack',
  })
  assert.deepEqual(failures, [])
  const launch = calls.find(call => call.method === 'sendPhoto').form
  assert.equal(launch.get('message_thread_id'), '41')
  assert.equal(launch.get('photo'), 'raid-attacking.png')
  assert.equal(calls.find(call => call.rpc?.method === 'eth_getBlockByNumber').rpc.params[0], 'finalized')
  const ownership = calls.filter(call => call.rpc?.method === 'eth_call').at(-1).rpc.params
  assert.equal(ownership[0].to, contract)
  assert.equal(ownership[0].data, '0x6352211e' + '4d'.padStart(64, '0'))
  assert.equal(ownership[1], '0x2a')
  const reply = calls.find(call => call.method === 'sendMessage' && call.form.get('chat_id') === chat).form
  assert.deepEqual(JSON.parse(reply.get('reply_parameters')), { message_id: 25 })
  assert.match(reply.get('text'), /#078 dealt 100 damage/)
  const edit = calls.find(call => call.method === 'editMessageMedia').form
  assert.equal(edit.get('message_id'), '20')
  assert.equal(JSON.parse(edit.get('media')).media, 'attach://0')
  assert.equal(edit.get('0'), 'raid-defeated.png')
  assert.equal(engine.latest(chat, topic).state, 'defeated')
})

test('the shared bot reuses a production Telegram link and reads Tribe from Preview', async () => {
  const wallet = walletOf('51')
  const requests = []
  const adapter = createRaidEvidence({
    nftService: {
      getFinalizedMiniBeanyBlock: async () => '45',
      getHolderAtBlock: async () => wallet,
    },
    secret: 'preview-secret',
    accountLookup: { url: 'https://www.beaniscrolls.com/api/connected-accounts/telegram', secret: 'production-secret' },
    fetcher: async (url, options) => {
      requests.push([url.origin, url.pathname, options.headers.Authorization])
      return { ok: true, json: async () => url.pathname.endsWith('citizen')
        ? { linked: true, wallet } : { representedTribe: null } }
    },
  })
  assert.equal(adapter.usesSharedAccounts, true)
  assert.equal(await adapter.linkedWallet('51'), wallet)
  assert.equal((await adapter.verify('51', '77', '42', wallet, true)).tribe, null)
  assert.deepEqual(requests, [
    ['https://www.beaniscrolls.com', '/api/connected-accounts/telegram/citizen', 'Bearer production-secret'],
    ['https://gems-testnet.beaniscrolls.site', '/api/represented-tribe', undefined],
    ['https://www.beaniscrolls.com', '/api/connected-accounts/telegram/citizen', 'Bearer production-secret'],
  ])
})

test('shared account credentials can only go to an allowlisted BeaniScrolls origin', () => {
  assert.throws(() => createRaidEvidence({
    accountLookup: { url: 'https://gems-testnet.beaniscrolls.site/api/connected-accounts/telegram', secret: 'production-secret' },
  }), /Invalid shared BeaniScrolls account lookup/)
})

test('uploaded raid artwork is retained independently of staged files', t => {
  const fs = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const { createHash } = require('node:crypto')
  const { createImageUploads } = require('./imageUploads')
  const dir = fs.mkdtempSync(join(tmpdir(), 'raid-artwork-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const publisher = join(dir, 'publisher')
  const image = fs.readFileSync(join(__dirname, 'assets', 'raid-attacking.png'))
  const id = 'example-artwork'
  createImageUploads(publisher).stage({
    upload_id: id, chunk_index: 0, chunk_count: 1,
    sha256: createHash('sha256').update(image).digest('hex'), chunk_base64: image.toString('base64'),
  })
  const ref = 'upload:' + id
  const template = { attacking: ref, wounded: ref, defeated: ref }
  const file = join(dir, 'raid.sqlite')
  const retained = retainUploadedArtwork(template, file, publisher)
  assert.equal(retained.attacking, retained.wounded)
  assert.equal(retained.attacking, retained.defeated)
  assert.deepEqual(fs.readFileSync(retained.attacking), image)
  fs.rmSync(publisher, { recursive: true })
  assert.deepEqual(retainUploadedArtwork(template, file, publisher), retained)
})

test('attack button is scoped to the boss post and records one participation reward', async t => {
  const f = setup(t)
  await f.privateMessage('/raidadmin launch')
  const raid = f.engine.latest(chat, topic)
  assert.equal(f.actions[0].options.reply_markup.inline_keyboard[0][0].text, '⚔️ Attack')
  await f.tap('other-post', 51, 21)
  assert.match(f.actions.at(-1).text, /no longer current/)
  const feedbackCount = f.actions.length
  await f.tap('other-topic', 51, 20, 42)
  assert.equal(f.actions.length, feedbackCount)
  assert.equal(f.engine.getRaid(raid.id).hp, 600)
  await f.tap('first-hit')
  const hit = f.actions.find(action => action.type === 'message' && action.text.includes('dealt 100 damage'))
  assert.equal(hit.chat, Number(chat))
  assert.equal(hit.text.split('\n')[2], 'Next attack in 5 minutes.')
  assert.ok(f.actions.at(-1).media.caption.includes('🟥'.repeat(8) + '⬛'.repeat(2)))
  assert.equal(hit.options.message_thread_id, 41)
  assert.deepEqual(hit.options.reply_parameters, { message_id: 20 })
  await f.tap('first-hit')
  assert.equal(f.engine.getRaid(raid.id).hp, 500)
  assert.equal(f.engine.participationPrizes(raid.id)[0].amount, 25)
  await f.tap('cooldown')
  const cooldown = f.actions.at(-1)
  assert.equal(cooldown.type, 'message')
  assert.match(cooldown.text, /Next attack in 300 seconds/)
  assert.deepEqual(cooldown.options.reply_parameters, { message_id: 20 })
  await f.groupMessage('/attack', { at: 300_000 })
  assert.equal(f.engine.getRaid(raid.id).hp, 400)
  assert.equal(f.engine.participationPrizes(raid.id).length, 1)
})

test('Profile selection admits only a MiniBeany in the represented Tribe', async t => {
  const f = setup(t)
  f.evidence.profileSelection = async () => ({ token: null, eligible: ['77'], tribe: 'polaris' })
  await f.privateMessage('/raidadmin launch')
  const raid = f.engine.latest(chat, topic)
  await f.tap('no-selection')
  assert.match(f.actions.at(-1).text, /Choose your Raid MiniBeany/)
  assert.equal(f.engine.getRaid(raid.id).hp, 600)

  f.evidence.profileSelection = async () => ({ token: '65', eligible: ['77'], tribe: 'polaris' })
  await f.tap('wrong-tribe')
  assert.match(f.actions.at(-1).text, /still qualify/)
  assert.equal(f.engine.getRaid(raid.id).hp, 600)

  f.evidence.profileSelection = async () => ({ token: '77', eligible: ['77'], tribe: 'polaris' })
  await f.tap('eligible')
  assert.equal(f.engine.getRaid(raid.id).hp, 500)
  assert.equal(f.engine.entrant(raid.id, '51').token, '77')
})

test('participation is credited only once across separate raids of the same Beast', () => {
  const engine = openBossRaid(':memory:', { now: () => 0, roll: () => 0 })
  const wallet = walletOf('51')
  const evidence = { token: '77', openingBlock: '42', confirmedBlock: '43',
    wallet, openingOwner: wallet, confirmedOwner: wallet, tribe: 'polaris' }
  try {
    const strike = (id, beast, post, player = '51') => {
      engine.launch({ id, chat, topic, post, closes: 60_000, openingBlock: '42', hp: 1, beast, lumens: 200 })
      return engine.attack({ chat, topic, post, message: 'hit-' + post, player, evidence })
    }
    assert.equal(strike('first', '8', '1').participationAwarded, true)
    assert.equal(strike('repeat', '8', '2').participationAwarded, false)
    assert.equal(strike('relink', '8', '3', '100').participationAwarded, false)
    assert.equal(strike('different', '9', '4').participationAwarded, true)
    assert.equal(engine.prizes('first').find(prize => prize.kind === 'tribe-lumens').amount, 200)
  } finally {
    engine.close()
  }
})

test('live final hit enqueues one participation credit and one winner credit', () => {
  const engine = openBossRaid(':memory:', { live: true, now: () => 0, roll: () => 0 })
  try {
    const wallet = walletOf('51')
    const evidence = { token: '77', openingBlock: '42', confirmedBlock: '43',
      wallet, openingOwner: wallet, confirmedOwner: wallet, tribe: 'polaris' }
    engine.launch({ id: 'live', chat, topic, post: '20', closes: 60000, openingBlock: '42', hp: 10, beast: '8', lumens: 200 })
    const hit = { chat, topic, post: '20', message: '1', player: '51', evidence }
    engine.attack(hit)
    engine.attack(hit)
    assert.deepEqual(engine.rewardBatch().map(row => [row.kind, row.wallet, row.tribe]), [
      ['participation', wallet, null], ['winner', wallet, 'polaris'],
    ])
    assert.equal(engine.beastAwarded('8'), true)
    engine.markRewardPaid(engine.rewardBatch()[0].id)
    assert.deepEqual(engine.rewardBatch().map(row => row.kind), ['winner'])
  } finally {
    engine.close()
  }
})

test('live raid locks the verified fighter and Tribe after the first hit', () => {
  let clock = 0
  const engine = openBossRaid(':memory:', { live: true, now: () => clock, roll: () => 0 })
  try {
    const wallet = walletOf('51')
    engine.launch({ id: 'live', chat, topic, post: '20', closes: 600000, openingBlock: '42', hp: 150, beast: '8', lumens: 200 })
    const attack = { chat, topic, post: '20', player: '51' }
    assert.equal(engine.attack({ ...attack, message: '1' }).status, 'retry')
    const proof = { token: '77', wallet, confirmedOwner: wallet, openingOwner: null,
      openingBlock: '42', confirmedBlock: '43', tribe: 'polaris' }
    assert.equal(engine.attack({ ...attack, message: '1', evidence: proof }).status, 'accepted')
    assert.equal(engine.attack({ ...attack, message: '2' }).status, 'cooldown')
    clock = 119999
    assert.equal(engine.attack({ ...attack, message: 'before-ready' }).status, 'cooldown')
    clock = 120000
    const finish = engine.attack({ ...attack, message: '3' })
    assert.equal(finish.stage, 'defeated')
    assert.equal(finish.token, '77')
    assert.equal(engine.rewardBatch().find(row => row.kind === 'winner').tribe, 'polaris')
  } finally {
    engine.close()
  }
})

test('new stepped raids apply armor to the four damage rolls and keep existing raids on legacy damage', () => {
  let clock = 0
  const rolls = [15, 25, 35, 55]
  const engine = openBossRaid(':memory:', { now: () => clock, roll: () => 0, pickDamage: () => rolls.shift() })
  try {
    const launch = (id, post, steppedDamage) => engine.launch({ id, chat, topic, post,
      closes: 3_600_000, openingBlock: '42', hp: 170, beast: '8', lumens: 200, steppedDamage })
    const hit = (post, message, player) => {
      const wallet = walletOf(player)
      return engine.attack({ chat, topic, post, message, player, evidence: {
        token: player, wallet, openingOwner: wallet, confirmedOwner: wallet, openingBlock: '42', confirmedBlock: '43', tribe: 'polaris',
      } }).damage
    }
    launch('legacy', '1', false)
    assert.equal(hit('1', '1', '51'), 100)
    engine.cancel('legacy')
    launch('stepped', '2', true)
    assert.deepEqual(['51', '52', '53', '54'].map((p, j) => hit('2', String(j + 2), p)), [5, 15, 25, 45])
    assert.equal(engine.getRaid('stepped').hp, 80)
    clock = 300000
    rolls.push(35)
    assert.equal(hit('2', '6', '51'), 35)
  } finally {
    engine.close()
  }
})

test('live raids keep accepting hits after six, with a cooldown after the sixth hit', () => {
  let clock = 0
  const engine = openBossRaid(':memory:', { live: true, now: () => clock, roll: () => 0 })
  try {
    const wallet = walletOf('51')
    engine.launch({ id: 'live-unlimited', chat, topic, post: '20', closes: 3600000, openingBlock: '42', hp: 2400, beast: '8', lumens: 200 })
    const attack = { chat, topic, post: '20', player: '51' }
    const proof = { token: '77', wallet, confirmedOwner: wallet, openingBlock: '42', confirmedBlock: '43', tribe: 'polaris' }
    assert.equal(engine.attack({ ...attack, message: '1', evidence: proof }).status, 'accepted')
    for (let hit = 2; hit <= 6; hit++) {
      clock += 120000
      const result = engine.attack({ ...attack, message: String(hit) })
      assert.equal(result.status, 'accepted')
      assert.equal(result.nextAt, clock + 120000)
    }
    assert.equal(engine.attack({ ...attack, message: 'early' }).status, 'cooldown')
    clock += 120000
    assert.equal(engine.attack({ ...attack, message: '7' }).status, 'accepted')
    assert.equal(engine.entrant('live-unlimited', '51').hits, 7)
  } finally {
    engine.close()
  }
})
