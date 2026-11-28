const { createHash, randomUUID } = require('node:crypto')
const { dirname, join } = require('node:path')
const { existsSync, mkdirSync, writeFileSync, renameSync } = require('node:fs')
const { CHUNK_SIZE, createImageUploads } = require('./imageUploads')
const NFTService = require('./nftService')
const { openBossRaid, raidCooldownMs } = require('./bossRaid')
const { openRaidSchedule } = require('./raidSchedule')
const { createRaidEvidence } = require('./raidEvidence')

const tokenNumber = token => '#' + String(Number(token) + 1).padStart(3, '0')
const phase = raid => raid.hp === 0 ? 'defeated' : raid.hp <= raid.max_hp / 2 ? 'wounded' : 'attacking'
const command = name => new RegExp('^/' + name + '(?:@\\w+)?\\s*$', 'i')
const retryText = 'Raid verification is temporarily unavailable. Please try again.'
const tribeNames = { avira: 'Avirai', polaris: 'Polarim', binara: 'Binarai', solara: 'Solarim' }

function retainUploadedArtwork(template, dbFile, publisherDir) {
  const dir = join(dirname(dbFile), 'boss-raid-artwork')
  const artwork = { ...template }
  for (const stage of ['attacking', 'wounded', 'defeated']) {
    const match = /^upload:([a-zA-Z0-9_-]{8,100})$/.exec(artwork[stage])
    if (!match) continue
    const id = match[1]
    const file = join(dir, id + '.png')
    if (!existsSync(file)) {
      const image = createImageUploads(publisherDir).read(id)
      if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error('Raid artwork upload must be a PNG')
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const temporary = join(dir, randomUUID() + '.tmp')
      writeFileSync(temporary, image, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, file)
    }
    artwork[stage] = file
  }
  return artwork
}

function photoSource(photo, edit = false) {
  if (photo.startsWith('/')) return edit ? 'attach://' + photo : photo
  const cindermaw = /^asset:cindermaw-(live|defeated)$/.exec(photo)
  if (cindermaw) {
    const path = join(__dirname, 'assets', 'cindermaw-' + cindermaw[1] + '.jpg')
    return edit ? 'attach://' + path : path
  }
  const asset = /^asset:(attacking|wounded|defeated)$/.exec(photo)
  if (!asset) return photo
  const path = join(__dirname, 'assets', 'raid-' + asset[1] + '.png')
  return edit ? 'attach://' + path : path
}

function registerRaidCommands(bot, { engine, evidence, settings, now = Date.now, onError = console.error }) {
  const { chat, topic, admin, template, live = false, steppedDamage = false } = settings
  const target = topic ? { message_thread_id: Number(topic) } : {}
  const inTopic = msg => String(msg.chat.id) === chat && String(msg.message_thread_id ?? '') === topic
  const inPrivate = msg => msg.chat.type === 'private'
  const linkHelp = evidence.usesSharedAccounts
    ? 'Link Telegram in BeaniScrolls → Profile → Connected Accounts and send /link CODE to me privately. Then reply to the boss post again.'
    : 'Generate a Telegram link code in BeaniScrolls Preview. Send /raidlink CODE to me privately, then reply to the boss post again.'
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

  const attackButton = active => ({
    inline_keyboard: active ? [[{ text: '⚔️ Attack', callback_data: 'raid-hit' }]] : [],
  })

  function caption(raid, display) {
    const filled = raid.hp === raid.max_hp ? 10 : raid.hp === 0 ? 0
      : Math.max(1, Math.min(9, Math.round(10 * raid.hp / raid.max_hp)))
    const bar = '🟥'.repeat(filled) + '⬛'.repeat(10 - filled)
    const lines = [display.name, `Boss HP ${raid.hp}/${raid.max_hp}`, bar]
    if (raid.state === 'active') {
      const stage = phase(raid)
      lines.push(
        stage === 'wounded' ? 'Wounded · 0 armor' : 'Attacking · 10 armor',
        `Closes ${new Date(raid.closes).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
        live ? `Prize · Beast #${raid.beast} and ${raid.lumens} Tribe Lumens` : `Rehearsal prize · Beast #${raid.beast} and ${raid.lumens} Tribe Lumens (mock)`,
        'Tap ⚔️ Attack or reply to this post with /attack.',
        live ? 'First hit · 25 Lumens once per Beast.' : 'First hit · 25 mock Lumens once per Beast.',
      )
    } else if (raid.state === 'defeated') {
      const result = JSON.parse(engine.winner(raid.id).result)
      const tribe = engine.prizes(raid.id).find(prize => prize.kind === 'tribe-lumens')
      lines.push(`Defeated by MiniBeany ${tokenNumber(result.token)}.`)
      lines.push(tribe.recipient ? `${raid.lumens}${live ? '' : ' mock'} Lumens for ${tribeNames[tribe.recipient] || tribe.recipient}.`
        : 'The winner has no active Tribe.')
    } else {
      lines.push(raid.state === 'expired' ? 'Raid expired.' : 'Raid cancelled.')
    }
    const [name, hp, ...details] = lines.map(line => line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
    return [`<b>${name}</b>`, `<i>${hp}</i>`, ...details].join('\n')
  }

  function updatePost(raidId) {
    const update = rendering.then(async () => {
      const raid = engine.getRaid(raidId)
      const display = engine.display(raidId)
      if (!raid || !display) return
      try {
        await bot.editMessageMedia({ type: 'photo', media: photoSource(display[phase(raid)], true), caption: caption(raid, display), parse_mode: 'HTML' }, {
          chat_id: chat, message_id: Number(raid.post), reply_markup: attackButton(raid.state === 'active'),
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
    return respond(msg, caption(raid, display), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Open boss post', url }]] } })
  })

  function waitMessage(nextAt) {
    const seconds = Math.max(1, Math.ceil((nextAt - now()) / 1000))
    return `Next attack in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
  }

  function attackResponse(result) {
    switch (result.status) {
      case 'accepted':
        return [
          `<b>MiniBeany ${tokenNumber(result.token)} dealt ${result.damage} damage.</b>`,
          `<i>Boss HP ${result.hp}/${result.maxHp}</i>`,
          result.nextAt ? `Next attack in ${raidCooldownMs(live) / 60_000} minutes.` : 'You used all six attacks.',
          ...(result.participationAwarded ? [live ? 'You earned 25 participation Lumens.' : 'You earned 25 mock participation Lumens.'] : []),
        ].join('\n')
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

  async function announceVictory(raid, player, result, reply) {
    const entrant = engine.entrant(raid.id, player)
    const tribe = tribeNames[entrant?.tribe]
    const beast = engine.display(raid.id)?.name || 'the Beast'
    const fighter = evidence.victoryFighter
      ? await evidence.victoryFighter(result.token, entrant?.wallet).catch(() => ({})) : {}
    const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const name = escape(fighter.nickname || 'MiniBeany ' + tokenNumber(result.token))
    const caption = [
      `<b>${tribe ? 'Victory for ' + tribe + '!' : 'Beast defeated!'}</b>`,
      `<b>${name} dealt ${result.damage} damage.</b>`,
      `<i>Boss HP 0/${raid.max_hp}</i>`,
      `${name} landed the final blow on ${escape(beast)}.`,
      ...(tribe ? [`<b>${raid.lumens} ${live ? '' : 'mock '}Lumens for ${tribe}.</b>`] : []),
    ].join('\n')
    if (fighter.image) {
      try {
        await bot.sendPhoto(chat, fighter.image, { ...target, caption, parse_mode: 'HTML',
          reply_parameters: { message_id: Number(raid.post) } })
        return
      } catch (error) {
        if (error?.response?.statusCode !== 400) throw error
      }
    }
    return reply(caption, { parse_mode: 'HTML' })
  }

  async function strike(raid, player, message, reply) {
    if (processing.has(player)) return reply('Your previous attack is still being checked.')
    processing.add(player)
    try {
      const request = { chat, topic, post: raid.post, message, player }
      let result = engine.attack(request)
      if (result.status === 'retry') {
        const wallet = await evidence.linkedWallet(player)
        if (!wallet) return await reply(linkHelp)
        const entrant = engine.entrant(raid.id, player)
        if (entrant && entrant.wallet !== wallet) return await reply(attackResponse({ status: 'ineligible' }))
        let token = entrant?.token
        if (evidence.profileSelection) {
          const selection = await evidence.profileSelection(wallet)
          if (!entrant && selection.token === null) return await reply('Choose your Raid MiniBeany in BeaniScrolls → Profile.')
          token = entrant?.token ?? selection.token
          if (!selection.eligible.includes(token)) return await reply(attackResponse({ status: 'ineligible' }))
          if (entrant && entrant.tribe !== selection.tribe) return await reply(attackResponse({ status: 'ineligible' }))
          const verified = await evidence.verify(player, token, raid.opening_block, wallet, !entrant, selection)
          result = engine.attack({ ...request, evidence: verified })
        } else {
          if (!entrant) {
            const entry = await eligible(raid, player, wallet)
            if (!entry) return await reply('This raid has closed.')
            if (!entry.tokens.length) return await reply('Your linked wallet has no eligible MiniBeany for this raid.')
            token = entry.choice ?? (entry.tokens.length === 1 ? entry.tokens[0] : undefined)
            if (token === undefined) return await reply('Open a private chat with me and use /raidme to choose your MiniBeany. Then reply here with /attack.')
          }
          const verified = await evidence.verify(player, token, raid.opening_block, wallet, !entrant)
          result = engine.attack({ ...request, evidence: verified })
        }
      }
      try {
        if (result.status === 'accepted' && result.stage === 'defeated') await announceVictory(raid, player, result, reply)
        else await reply(attackResponse({ ...result, maxHp: raid.max_hp }), result.status === 'accepted' ? { parse_mode: 'HTML' } : undefined)
      } finally {
        if (result.status === 'accepted' || result.status === 'expired') await updatePost(raid.id)
      }
    } finally {
      processing.delete(player)
    }
  }

  handle(command('attack'), inTopic, async (msg, match, player) => {
    const raid = engine.latest(chat, topic)
    if (!raid || String(msg.reply_to_message?.message_id) !== raid.post) {
      return respond(msg, 'Reply directly to the current boss post with /attack.')
    }
    return strike(raid, player, String(msg.message_id), (text, options) => respond(msg, text, options))
  })

  async function attackFromButton(query) {
    const msg = query.message
    if (!msg || !inTopic(msg)) return
    await bot.answerCallbackQuery(query.id).catch(() => {})
    const reply = (text, options) => respond(msg, text, options)
    const raid = engine.latest(chat, topic)
    if (!raid || String(msg.message_id) !== raid.post) return reply('This boss post is no longer current.')
    try {
      await strike(raid, String(query.from.id), 'callback:' + query.id, reply)
    } catch (error) {
      onError('Raid button attack failed:', error?.name || 'Error')
      await reply(retryText).catch(() => {})
    }
  }

  handle(command(live ? 'raidmelive' : 'raidme'), inPrivate, async (msg, match, player) => {
    const raid = engine.latest(chat, topic)
    if (!raid || raid.state !== 'active') return respond(msg, 'There is no open rehearsal raid.')
    const entrant = engine.entrant(raid.id, player)
    const wallet = live && entrant ? entrant.wallet : await evidence.linkedWallet(player)
    if (!wallet) return respond(msg, linkHelp)
    if (entrant) {
      if (entrant.wallet !== wallet) return respond(msg, attackResponse({ status: 'ineligible' }))
      const wait = Math.max(0, Math.ceil((entrant.last_hit + raidCooldownMs(live) - now()) / 1000))
      const timing = !live && entrant.hits === 6 ? '' : wait ? ' ' + waitMessage(entrant.last_hit + raidCooldownMs(live)) : ' Attack ready.'
      return respond(msg, `MiniBeany ${tokenNumber(entrant.token)} · ${entrant.hits}${live ? ' hits' : '/6 hits used'} · ${engine.damageDealt(raid.id, player)} damage dealt.${timing}`)
    }
    if (evidence.profileSelection) {
      const { token } = await evidence.profileSelection(wallet)
      return respond(msg, token === null ? 'Choose your Raid MiniBeany in BeaniScrolls → Profile.'
        : `MiniBeany ${tokenNumber(token)} is selected. Tap ⚔️ Attack on the boss post.`)
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
    if (query.data === 'raid-hit') return attackFromButton(query)
    if (evidence.profileSelection || !query.data?.startsWith('raid:')) return
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
    if (live) return
    if (evidence.usesSharedAccounts) {
      const wallet = await evidence.linkedWallet(player)
      return respond(msg, wallet ? 'Your existing BeaniScrolls Telegram link is ready for Boss Raid.' : linkHelp)
    }
    const code = match[1] || ''
    if (!/^[A-Za-z0-9_-]{24}$/.test(code)) {
      return respond(msg, 'Generate a new code in BeaniScrolls Preview → Profile → Connected Accounts, then send /raidlink CODE here.')
    }
    const linked = await evidence.link(player, msg.from.username || '', code)
    return respond(msg, linked ? 'Telegram is linked to your BeaniScrolls Preview profile.'
      : 'That Preview link code is invalid, expired, or already used.')
  })

  async function postRaid(openingBlock, draftTemplate = template) {
    const template = draftTemplate
    const closes = now() + template.durationMinutes * 60_000
    const draft = { state: 'active', hp: template.hp, max_hp: template.hp, beast: template.beast, lumens: template.lumens, closes }
    const post = await bot.sendPhoto(chat, photoSource(template.attacking), { ...target, caption: caption(draft, template), parse_mode: 'HTML', reply_markup: attackButton(true) })
    try {
      engine.launch({ id: randomUUID(), chat, topic, post: String(post.message_id), openingBlock, closes,
        hp: template.hp, beast: template.beast, lumens: template.lumens, display: template, steppedDamage })
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
    msg => !live && inPrivate(msg) && String(msg.from.id) === admin,
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

  async function launchOnce(launchId, draftTemplate = template) {
    if (!launchId || engine.hasLaunch(launchId)) return { status: 'already-attempted' }
    if (adminBusy) return { status: 'busy' }
    adminBusy = true
    try {
      if (live && engine.beastAwarded(draftTemplate.beast)) return { status: 'beast-awarded' }
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
      const post = await postRaid(openingBlock, draftTemplate)
      return { status: 'posted', post, adminLinked: Boolean(wallet) }
    } finally {
      adminBusy = false
    }
  }
  return launchOnce
}

function startRewardDelivery(engine, key) {
  let running = false
  async function deliver() {
    if (running) return
    running = true
    try {
      for (const { id, ...reward } of engine.rewardBatch()) {
        try {
          const response = await fetch('https://www.beaniscrolls.com/api/connected-accounts/telegram/boss-raid-rewards', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(reward),
          })
          if (!response.ok) continue
          const { status } = await response.json()
          if (status === 'credited' || status === 'already_paid') engine.markRewardPaid(id)
        } catch { /* Keep pending for the next delivery attempt. */ }
      }
    } finally {
      running = false
    }
  }
  setInterval(() => void deliver().catch(() => {}), 15_000).unref()
}

function register(bot, nftService, env = process.env, live = false) {
  if (env.BOSS_RAID_REHEARSAL_ENABLED !== 'true') return
  const chat = env.BOSS_RAID_TEST_CHAT_ID
  const topic = env.BOSS_RAID_TEST_TOPIC_ID?.trim() || ''
  const admin = env.BOSS_RAID_ADMIN_ID
  const secret = env.BOSS_RAID_PREVIEW_LINK_SECRET
  const filename = env.BOSS_RAID_DB_FILE
  const template = JSON.parse(env.BOSS_RAID_TEST_TEMPLATE || '{}')
  if (template && template.wounded === undefined) template.wounded = template.attacking
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
  const useProfile = env.BOSS_RAID_USE_PROFILE === 'true'
  if (useProfile && (!env.BOSS_RAID_BNB_RPC_URL || !/^0x[0-9a-f]{40}$/i.test(env.BOSS_RAID_MINIBEANY_CONTRACT)
      || !/^(56|97)$/.test(env.BOSS_RAID_BNB_CHAIN_ID) || (env.PUBLISH_API_KEY || '').length < 32)) {
    throw new Error('Invalid Boss Raid Profile configuration')
  }
  const raidNftService = env.BOSS_RAID_BNB_RPC_URL
    ? new NFTService(env.BOSS_RAID_BNB_RPC_URL, useProfile ? env.BOSS_RAID_MINIBEANY_CONTRACT : nftService.contractAddress, useProfile ? BigInt(env.BOSS_RAID_BNB_CHAIN_ID) : 56n)
    : nftService
  const accountLookup = (live || !useProfile) && env.BEANISCROLLS_TELEGRAM_LINK_URL && env.TELEGRAM_LINK_API_SECRET
    ? { url: env.BEANISCROLLS_TELEGRAM_LINK_URL, secret: env.TELEGRAM_LINK_API_SECRET }
    : undefined
  if (live && (!accountLookup || !useProfile || !env.PUBLISH_STATE_DIR)) throw new Error('Invalid live raid account configuration')
  const engine = openBossRaid(filename, { live })
  const evidence = createRaidEvidence({
    nftService: raidNftService, secret, accountLookup,
    profile: useProfile ? { key: env.PUBLISH_API_KEY, readToken: engine.profileToken, live } : undefined,
  })
  const launchOnce = registerRaidCommands(bot, {
    engine,
    evidence,
    settings: { chat, topic, admin, live, steppedDamage: true, template: retainUploadedArtwork(template, filename, env.PUBLISH_STATE_DIR) },
  })
  console.log('Boss Raid rehearsal configured:', JSON.stringify({ name: template.name, hp: template.hp }))
  if (launchId) {
    launchOnce(launchId).then(async result => {
      if (result.status === 'already-attempted') {
        const wallet = await evidence.linkedWallet(admin)
        console.log('Boss Raid account verification:', JSON.stringify({ adminLinked: Boolean(wallet), sharedAccounts: evidence.usesSharedAccounts }))
      }
      console.log('Boss Raid rehearsal launch:', JSON.stringify(result))
    }).catch(error => {
        const message = error?.message || ''
        const known = /^(BeaniScrolls lookup HTTP [0-9]{3}|Telegram test group mismatch|MiniBeany bot is not in the test group)$/.test(message)
        console.error('Boss Raid rehearsal preflight or send failed:', known ? message : error?.name || 'Error')
      })
  }
  if (!useProfile) return
  if (live) {
    startRewardDelivery(engine, env.PUBLISH_API_KEY)
    Promise.all([bot.getMe(), bot.getChat(chat), evidence.openingBlock()]).then(async ([identity, group]) => {
      const member = await bot.getChatMember(chat, identity.id)
      if (String(group.id) !== chat || group.type !== 'supergroup' || !['administrator', 'member', 'creator'].includes(member.status)) {
        throw new Error('Live raid group unavailable')
      }
      console.log('Boss Raid live preflight passed')
    }).catch(error => console.error('Boss Raid live preflight failed:', error?.name || 'Error'))
  }
  evidence.linkedWallet(admin).then(wallet => {
    console.log(live ? 'Boss Raid live account lookup ready:' : 'Boss Raid Preview account lookup ready:', Boolean(wallet) ? 'admin linked' : 'admin not linked')
  }).catch(error => {
    const status = /^BeaniScrolls lookup HTTP (\d{3})$/.exec(error?.message || '')?.[1]
    console.error('Boss Raid Preview account lookup unavailable:', status || error?.name || 'Error')
  })
  // Preview only until scheduling has passed rehearsal tests.
  const schedule = !live ? openRaidSchedule(filename) : null
  if (schedule) {
    schedule.recover()
    let dispatching = false
    const tick = async () => {
      if (dispatching) return
      dispatching = true
      try {
        for (const job of schedule.list()) {
          if (job.cancelled) continue
          const draft = JSON.parse(job.template)
          if (schedule.claim(job.id, 'announcement')) {
            try {
              await bot.sendPhoto(chat, photoSource(draft.attacking), {
                ...(topic ? { message_thread_id: Number(topic) } : {}),
                caption: ['UPCOMING BOSS RAID — REHEARSAL', draft.name, 'Starts: '+new Date(job.starts).toISOString(), 'HP: '+draft.hp, 'Duration: '+draft.durationMinutes+' minutes', 'Mock prizes only'].join('\n')
              })
              schedule.finish(job.id, 'announcement', true)
            } catch { schedule.finish(job.id, 'announcement', false) }
          }
          if (engine.latest(chat, topic)?.state === 'active') continue
          if (schedule.claim(job.id, 'launch')) {
            try {
              const result = await launchOnce('scheduled-'+job.id, draft)
              schedule.finish(job.id, 'launch', result.status === 'posted')
            } catch { schedule.finish(job.id, 'launch', false) }
          }
        }
      } finally { dispatching = false }
    }
    setInterval(() => void tick().catch(error => console.error('Raid scheduler:', error.name)), 15000).unref()
  }
  return async function handleWebRequest(input, reply) {
    const { action, wallet, token } = input ?? {}
    if (action === 'read-selection' || action === 'save-selection') {
      if (typeof wallet !== 'string' || !/^0x[0-9a-f]{40}$/.test(wallet)) return reply(400, { error: 'Invalid wallet.' })
      if (action === 'save-selection') {
        if (typeof token !== 'string' || !/^(0|[1-9][0-9]?|100)$/.test(token)) return reply(400, { error: 'Invalid MiniBeany.' })
        engine.saveProfileToken(wallet, token)
      }
      return reply(200, { token: engine.profileToken(wallet) })
    }
    if (action === 'stage-artwork') {
      const encoded = input.image
      if (typeof encoded !== 'string' || encoded.length > 5_600_000) return reply(400, { error: 'Invalid artwork size.' })
      const image = Buffer.from(encoded, 'base64')
      if (image.toString('base64') !== encoded || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        return reply(400, { error: 'Use a PNG image.' })
      }
      const uploads = createImageUploads(env.PUBLISH_STATE_DIR)
      const upload_id = randomUUID()
      const sha256 = createHash('sha256').update(image).digest('hex')
      const chunk_count = Math.ceil(encoded.length / CHUNK_SIZE)
      for (let chunk_index = 0; chunk_index < chunk_count; chunk_index++) {
        uploads.stage({ upload_id, sha256, chunk_count, chunk_index,
          chunk_base64: encoded.slice(chunk_index * CHUNK_SIZE, (chunk_index + 1) * CHUNK_SIZE) })
      }
      return reply(200, { upload_id })
    }
    if (live && (action === 'status' || action === 'cancel')) {
      const raid = engine.latest(chat, topic)
      if (action === 'cancel' && raid?.state === 'active') {
        const state = engine.cancel(raid.id)
        await bot.editMessageCaption('Raid cancelled.', { chat_id: chat, message_id: Number(raid.post),
          reply_markup: { inline_keyboard: [] } }).catch(() => {})
        return reply(200, { status: state })
      }
      const winnerWallet = raid?.state === 'defeated' ? engine.prizes(raid.id).find(prize => prize.kind === 'beast')?.recipient : undefined
      return reply(200, { status: raid?.state ?? 'none', post: raid?.post, winnerWallet })
    }
    if (schedule && action === 'list-scheduled') return reply(200, { jobs: schedule.list().map(({template,...job}) => ({...job, name: JSON.parse(template).name, beast: JSON.parse(template).beast})) })
    if (schedule && action === 'cancel-scheduled') return reply(schedule.cancel(input.id) ? 200 : 409, { status: 'cancel-requested' })
    if (action !== 'launch' && !(schedule && action === 'schedule')) return reply(400, { error: 'Invalid raid action.' })
    const { id, name, beast, hp, durationMinutes, live, defeated } = input
    const stage = (value, fallback) => value === undefined ? fallback
      : typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value) ? 'upload:' + value : null
    const attacking = stage(live, 'asset:cindermaw-live')
    const ending = stage(defeated, 'asset:cindermaw-defeated')
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)
      || typeof beast !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(beast)
      || typeof name !== 'string' || !name.trim() || name.length > 90 || !attacking || !ending
      || (beast !== '8' && (live === undefined || defeated === undefined))
      || !Number.isSafeInteger(hp) || hp <= 0 || hp > 1_000_000
      || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      return reply(400, { error: 'Invalid raid setup.' })
    }
    let artwork
    try {
      artwork = retainUploadedArtwork({ name: name.trim(), beast, hp, durationMinutes, lumens: 200,
        attacking, wounded: attacking, defeated: ending }, filename, env.PUBLISH_STATE_DIR)
    } catch {
      return reply(400, { error: 'Both artwork uploads must be available PNG files.' })
    }
    if (action === 'schedule') {
      try {
        const job = schedule.save(id, artwork, input.starts, input.announcementHours ?? null)
        return reply(200, { status: 'scheduled', id: job.id, starts: job.starts, announces: job.announces })
      } catch { return reply(400, { error: 'Invalid or duplicate schedule.' }) }
    }
    const result = await launchOnce('web-' + id, artwork)
    return reply(result.status === 'posted' ? 200 : 409, result)
  }
}

module.exports = { register, registerRaidCommands, retainUploadedArtwork }
