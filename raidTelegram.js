const { randomUUID } = require('node:crypto')
const { join } = require('node:path')
const NFTService = require('./nftService')
const { openBossRaid } = require('./bossRaid')
const { createRaidEvidence } = require('./raidEvidence')

const tokenNumber = token => '#' + String(Number(token) + 1).padStart(3, '0')
const phase = raid => raid.hp === 0 ? 'defeated' : raid.hp <= raid.max_hp / 2 ? 'wounded' : 'attacking'
const command = name => new RegExp('^/' + name + '(?:@\\w+)?\\s*$', 'i')
const retryText = 'Raid verification is temporarily unavailable. Please try again.'
const tribeNames = { avira: 'Avarai', polaris: 'Polarim', binara: 'Binarai', solara: 'Solarim' }

function photoSource(photo, edit = false) {
  const asset = /^asset:(attacking|wounded|defeated)$/.exec(photo)
  if (!asset) return photo
  const path = join(__dirname, 'assets', 'raid-' + asset[1] + '.png')
  return edit ? 'attach://' + path : path
}

function registerRaidCommands(bot, { engine, evidence, settings, now = Date.now, onError = console.error }) {
  const { chat, topic, admin, template } = settings
  const target = topic ? { message_thread_id: Number(topic) } : {}
  const inTopic = msg => String(msg.chat.id) === chat && String(msg.message_thread_id ?? '') === topic
  const inPrivate = msg => msg.chat.type === 'private'
  const processing = new Set()
  const selections = new Map()
  let currentSelectionRaid
  let adminBusy = false
  let rendering = Promise.resolve()

  function selectionFor(raid) {
    if (currentSelectionRaid !== raid.id) {
      currentSelectionRaid = raid.id
      selections.clear()
    }
    return selections
  }

  const respond = (msg, text, extra) => bot.sendMessage(msg.chat.id, text, {
    ...(inTopic(msg) ? target : {}),
    ...(inTopic(msg) ? { reply_parameters: { message_id: msg.message_id } } : {}),
    ...extra,
  })

  function handle(pattern, scope, action) {
    bot.onText(pattern, async (msg, match) => {
      if (!msg.from || !scope(msg)) return
      try {
        await action(msg, match, String(msg.from.id))
      } catch (error) {
        onError('Raid command failed:', error?.name || 'Error')
        try { await respond(msg, retryText) } catch { /* Telegram is unavailable. */ }
      }
    })
  }

  function caption(raid, display) {
    const lines = [display.name, `Boss HP ${raid.hp}/${raid.max_hp}`]
    if (raid.state === 'active') {
      const stage = phase(raid)
      lines.push(
        stage === 'wounded' ? 'Wounded · 0 armor' : 'Attacking · 10 armor',
        `Closes ${new Date(raid.closes).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
        `Rehearsal prize · Beast #${raid.beast} and ${raid.lumens} Tribe Lumens (mock)`,
        'Reply to this post with /attack.',
      )
    } else if (raid.state === 'defeated') {
      const result = JSON.parse(engine.winner(raid.id).result)
      const tribe = engine.prizes(raid.id).find(prize => prize.kind === 'tribe-lumens')
      lines.push(`Defeated by MiniBeany ${tokenNumber(result.token)}.`)
      lines.push(tribe.recipient ? `${raid.lumens} mock Lumens for ${tribeNames[tribe.recipient] || tribe.recipient}.`
        : 'The winner has no active Tribe.')
    } else {
      lines.push(raid.state === 'expired' ? 'Raid expired.' : 'Raid cancelled.')
    }
    return lines.join('\n')
  }

  function updatePost(raidId) {
    const update = rendering.then(async () => {
      const raid = engine.getRaid(raidId)
      const display = engine.display(raidId)
      if (!raid || !display) return
      try {
        await bot.editMessageMedia({ type: 'photo', media: photoSource(display[phase(raid)], true), caption: caption(raid, display) }, {
          chat_id: chat, message_id: Number(raid.post),
        })
      } catch (error) {
        if (!String(error?.message).includes('message is not modified')) onError('Raid artwork update failed:', error?.message)
      }
    })
    rendering = update.catch(error => onError('Raid status update failed:', error?.message))
    return rendering
  }

  async function eligible(raid, player, wallet) {
    const cache = selectionFor(raid)
    const entry = cache.get(player)
    if (entry?.wallet === wallet && entry.until > now()) return entry
    const choice = entry?.wallet === wallet ? entry.choice : undefined
    const tokens = await evidence.eligibleTokens(wallet, raid.opening_block)
    if (engine.latest(chat, topic)?.id !== raid.id || engine.getRaid(raid.id)?.state !== 'active') return null
    const refreshed = { wallet, tokens, choice: tokens.includes(choice) ? choice : undefined, until: now() + 30_000 }
    cache.set(player, refreshed)
    return refreshed
  }

  handle(command('raid'), inTopic, async msg => {
    const raid = engine.latest(chat, topic)
    const display = raid && engine.display(raid.id)
    if (!display) return respond(msg, 'There is no raid in this topic.')
    await updatePost(raid.id)
    const path = [chat.slice(4), topic, raid.post].filter(Boolean).join('/')
    const url = 'https://t.me/c/' + path
    return respond(msg, caption(raid, display), { reply_markup: { inline_keyboard: [[{ text: 'Open boss post', url }]] } })
  })

  function waitMessage(nextAt) {
    const seconds = Math.max(1, Math.ceil((nextAt - now()) / 1000))
    return `Next attack in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
  }

  function attackResponse(result) {
    switch (result.status) {
      case 'accepted':
        return `MiniBeany ${tokenNumber(result.token)} dealt ${result.damage} damage. Boss HP ${result.hp}/${result.maxHp}.` +
          (result.stage === 'defeated' ? ' Final hit! The mock prizes are recorded.' : result.nextAt ? ' Next attack in 5 minutes.' : ' You used all six attacks.')
      case 'cooldown': return waitMessage(result.nextAt)
      case 'cap': return 'You used all six attacks for this raid.'
      case 'ineligible': return 'Your linked wallet and selected MiniBeany must still qualify for this raid.'
      case 'defeated': return 'The Beast is already defeated.'
      case 'expired': return 'This raid has expired.'
      case 'cancelled': return 'This raid was cancelled.'
      case 'retry': return retryText
      default: return 'Reply directly to the current boss post with /attack.'
    }
  }

  handle(command('attack'), inTopic, async (msg, match, player) => {
    if (processing.has(player)) return
    processing.add(player)
    try {
      const raid = engine.latest(chat, topic)
      if (!raid || String(msg.reply_to_message?.message_id) !== raid.post) {
        return await respond(msg, 'Reply directly to the current boss post with /attack.')
      }
      const request = { chat, topic, post: raid.post, message: String(msg.message_id), player }
      let result = engine.attack(request)
      if (result.status === 'retry') {
        const wallet = await evidence.linkedWallet(player)
        if (!wallet) return await respond(msg, 'Generate a Telegram link code in BeaniScrolls Preview. Send /raidlink CODE to me privately, then reply here again.')
        const entrant = engine.entrant(raid.id, player)
        if (entrant && entrant.wallet !== wallet) return await respond(msg, attackResponse({ status: 'ineligible' }))
        let token = entrant?.token
        if (!entrant) {
          const entry = await eligible(raid, player, wallet)
          if (!entry) return await respond(msg, 'This raid has closed.')
          if (!entry.tokens.length) return await respond(msg, 'Your linked wallet has no eligible MiniBeany for this raid.')
          token = entry.choice ?? (entry.tokens.length === 1 ? entry.tokens[0] : undefined)
          if (token === undefined) return await respond(msg, 'Open a private chat with me and use /raidme to choose your MiniBeany. Then reply here with /attack.')
        }
        const verified = await evidence.verify(player, token, raid.opening_block, wallet, !entrant)
        result = engine.attack({ ...request, evidence: verified })
      }
      try {
        await respond(msg, attackResponse({ ...result, maxHp: raid.max_hp }))
      } finally {
        if (result.status === 'accepted' || result.status === 'expired') await updatePost(raid.id)
      }
    } finally {
      processing.delete(player)
    }
  })

  handle(command('raidme'), inPrivate, async (msg, match, player) => {
    const raid = engine.latest(chat, topic)
    if (!raid || raid.state !== 'active') return respond(msg, 'There is no open rehearsal raid.')
    const wallet = await evidence.linkedWallet(player)
    if (!wallet) return respond(msg, 'Generate a link code in BeaniScrolls Preview, then send /raidlink CODE here.')
    const entrant = engine.entrant(raid.id, player)
    if (entrant) {
      if (entrant.wallet !== wallet) return respond(msg, attackResponse({ status: 'ineligible' }))
      const wait = Math.max(0, Math.ceil((entrant.last_hit + 300_000 - now()) / 1000))
      const timing = entrant.hits === 6 ? '' : wait ? ' ' + waitMessage(entrant.last_hit + 300_000) : ' Attack ready.'
      return respond(msg, `MiniBeany ${tokenNumber(entrant.token)} · ${entrant.hits}/6 hits used · ${engine.damageDealt(raid.id, player)} damage dealt.${timing}`)
    }
    const entry = await eligible(raid, player, wallet)
    if (!entry) return respond(msg, 'This raid has closed.')
    if (!entry.tokens.length) return respond(msg, 'Your linked wallet has no eligible MiniBeany for this raid.')
    if (entry.tokens.length === 1) return respond(msg, `MiniBeany ${tokenNumber(entry.tokens[0])} is ready. Reply to the boss post with /attack.`)
    const rows = []
    for (const token of entry.tokens) {
      if (!rows.length || rows.at(-1).length === 4) rows.push([])
      rows.at(-1).push({ text: tokenNumber(token), callback_data: `raid:${raid.id}:${token}` })
    }
    return respond(msg, 'Choose your MiniBeany for this raid.', { reply_markup: { inline_keyboard: rows } })
  })

  bot.on('callback_query', async query => {
    if (!query.data?.startsWith('raid:')) return
    const match = /^raid:([a-f0-9-]{36}):(\d{1,3})$/.exec(query.data)
    let text = 'Open /raidme for a fresh list.'
    try {
      if (match && query.message?.chat.type === 'private' && query.from.id === query.message.chat.id) {
        const raid = engine.latest(chat, topic)
        const player = String(query.from.id)
        if (raid?.state === 'active' && raid.id === match[1] && !engine.entrant(raid.id, player)) {
          const wallet = await evidence.linkedWallet(player)
          const entry = wallet && await eligible(raid, player, wallet)
          if (entry?.tokens.includes(match[2]) && engine.getRaid(raid.id)?.state === 'active'
            && !engine.entrant(raid.id, player)) {
            entry.choice = match[2]
            text = `${tokenNumber(entry.choice)} selected. Reply to the boss post with /attack.`
          }
        }
      }
    } catch {
      text = retryText
    }
    try { await bot.answerCallbackQuery(query.id, { text }) } catch (error) { onError('Raid picker reply failed:', error?.message) }
  })

  handle(/^\/raidlink(?:@\w+)?(?:\s+(\S+))?\s*$/i, inPrivate, async (msg, match, player) => {
    const code = match[1] || ''
    if (!/^[A-Za-z0-9_-]{24}$/.test(code)) {
      return respond(msg, 'Generate a new code in BeaniScrolls Preview → Profile → Connected Accounts, then send /raidlink CODE here.')
    }
    const linked = await evidence.link(player, msg.from.username || '', code)
    return respond(msg, linked ? 'Telegram is linked to your BeaniScrolls Preview profile.'
      : 'That Preview link code is invalid, expired, or already used.')
  })

  async function postRaid(openingBlock) {
    const closes = now() + template.durationMinutes * 60_000
    const draft = { state: 'active', hp: template.hp, max_hp: template.hp, beast: template.beast, lumens: template.lumens, closes }
    const post = await bot.sendPhoto(chat, photoSource(template.attacking), { ...target, caption: caption(draft, template) })
    try {
      engine.launch({ id: randomUUID(), chat, topic, post: String(post.message_id), openingBlock, closes,
        hp: template.hp, beast: template.beast, lumens: template.lumens, display: template })
    } catch (error) {
      try { await bot.deleteMessage(chat, post.message_id) } catch { /* The unregistered post cannot accept attacks. */ }
      throw error
    }
    try {
      await bot.pinChatMessage(chat, post.message_id, { disable_notification: true })
    } catch (error) {
      onError('Raid post could not be pinned:', error?.name || 'Error')
    }
    return post.message_id
  }

  handle(/^\/raidadmin(?:@\w+)?(?:\s+(status|launch|cancel))?\s*$/i,
    msg => inPrivate(msg) && String(msg.from.id) === admin,
    async (msg, match) => {
      if (adminBusy) return respond(msg, 'A raid admin action is already running.')
      adminBusy = true
      try {
        const raid = engine.latest(chat, topic)
        const action = match[1]?.toLowerCase() || 'status'
        if (action === 'status') {
          return await respond(msg, raid ? `Rehearsal raid ${raid.state}. HP ${raid.hp}/${raid.max_hp}.`
            : 'No rehearsal raid. Use /raidadmin launch to post the configured test Beast.')
        }
        if (action === 'cancel') {
          if (!raid || raid.state !== 'active') return await respond(msg, 'There is no open rehearsal raid.')
          const state = engine.cancel(raid.id)
          await updatePost(raid.id)
          return await respond(msg, `Rehearsal raid ${state}.`)
        }
        if (raid?.state === 'active') return await respond(msg, 'A raid is already open in the rehearsal topic.')
        await postRaid(await evidence.openingBlock())
        return await respond(msg, 'Rehearsal raid launched.')
      } finally {
        adminBusy = false
      }
    })

  return async function launchOnce(launchId) {
    if (!launchId || engine.hasLaunch(launchId)) return { status: 'already-attempted' }
    if (adminBusy) return { status: 'busy' }
    adminBusy = true
    try {
      if (engine.latest(chat, topic)?.state === 'active') return { status: 'already-open' }
      const group = await bot.getChat(chat)
      if (String(group.id) !== chat || group.type !== 'supergroup') throw new Error('Telegram test group mismatch')
      const identity = await bot.getMe()
      const membership = await bot.getChatMember(chat, identity.id)
      if (!['administrator', 'member', 'creator'].includes(membership.status)) {
        throw new Error('MiniBeany bot is not in the test group')
      }
      const wallet = await evidence.linkedWallet(admin)
      const openingBlock = await evidence.openingBlock()
      if (!engine.claimLaunch(launchId)) return { status: 'already-attempted' }
      const post = await postRaid(openingBlock)
      return { status: 'posted', post, adminLinked: Boolean(wallet) }
    } finally {
      adminBusy = false
    }
  }
}

function register(bot, nftService, env = process.env) {
  if (env.BOSS_RAID_REHEARSAL_ENABLED !== 'true') return
  const chat = env.BOSS_RAID_TEST_CHAT_ID
  const topic = env.BOSS_RAID_TEST_TOPIC_ID?.trim() || ''
  const admin = env.BOSS_RAID_ADMIN_ID
  const secret = env.BOSS_RAID_PREVIEW_LINK_SECRET
  const filename = env.BOSS_RAID_DB_FILE
  const template = JSON.parse(env.BOSS_RAID_TEST_TEMPLATE || '{}')
  if (!/^-100[0-9]+$/.test(chat) || (topic && (!/^[1-9][0-9]*$/.test(topic) || !Number.isSafeInteger(Number(topic))))
    || !/^[1-9][0-9]*$/.test(admin) || !secret || secret.length < 32 || !filename || template === null
    || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 90
    || !/^[0-9]+$/.test(template.beast) || !Number.isSafeInteger(template.hp) || template.hp <= 0
    || !Number.isSafeInteger(template.lumens) || template.lumens < 0
    || !Number.isInteger(template.durationMinutes) || template.durationMinutes < 1 || template.durationMinutes > 1440
    || ['attacking', 'wounded', 'defeated'].some(stage => typeof template[stage] !== 'string' || !template[stage])) {
    throw new Error('Invalid Boss Raid rehearsal configuration')
  }
  const launchId = env.BOSS_RAID_AUTO_LAUNCH_ID
  if (launchId && !/^[a-zA-Z0-9_-]{1,80}$/.test(launchId)) throw new Error('Invalid Boss Raid launch ID')
  const raidNftService = env.BOSS_RAID_BNB_RPC_URL
    ? new NFTService(env.BOSS_RAID_BNB_RPC_URL, nftService.contractAddress)
    : nftService
  const launchOnce = registerRaidCommands(bot, {
    engine: openBossRaid(filename),
    evidence: createRaidEvidence({ nftService: raidNftService, secret }),
    settings: { chat, topic, admin, template },
  })
  if (launchId) {
    launchOnce(launchId).then(result => console.log('Boss Raid rehearsal launch:', JSON.stringify(result)))
      .catch(error => {
        const message = error?.message || ''
        const known = /^(BeaniScrolls Preview lookup HTTP [0-9]{3}|Telegram test group mismatch|MiniBeany bot is not in the test group)$/.test(message)
        console.error('Boss Raid rehearsal preflight or send failed:', known ? message : error?.name || 'Error')
      })
  }
}

module.exports = { register, registerRaidCommands }
