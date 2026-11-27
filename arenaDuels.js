const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRaidEvidence } = require('./raidEvidence');
const ORIGINS = { preview: 'https://gems-testnet.beaniscrolls.site', live: 'https://beaniscrolls.site' };
function duelRequestKey(chat, message, environment = 'preview') {
  const bytes = createHash('sha256').update(`beasts-arena:${environment}:${chat}:${message}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function registerArenaDuels(bot, { env = process.env, fetcher = fetch, linkedWallet } = {}) {
  if (env.PUBLISH_ENABLED !== 'true' || !env.PUBLISH_STATE_DIR || !env.PUBLISH_API_KEY || env.PUBLISH_API_KEY.length < 32) return null;
  let target; try { target = JSON.parse(env.PUBLISH_DESTINATIONS || '{}')['beaniscrolls-test']; } catch { return null; }
  const previewTarget = target && /^-\d+$/.test(String(target.chat_id)) ? target : null;
  const liveChat = /^-\d+$/.test(env.BOSS_RAID_LIVE_CHAT_ID || '') ? env.BOSS_RAID_LIVE_CHAT_ID : null;
  if (!previewTarget && !liveChat) return null;
  if (!linkedWallet) {
    if (!env.BEANISCROLLS_TELEGRAM_LINK_URL || !env.TELEGRAM_LINK_API_SECRET) return null;
    linkedWallet = createRaidEvidence({ secret: env.TELEGRAM_LINK_API_SECRET, accountLookup: { url: env.BEANISCROLLS_TELEGRAM_LINK_URL, secret: env.TELEGRAM_LINK_API_SECRET } }).linkedWallet;
  }
  const busy = new Set(); let identity;
  const handler = async (msg, match) => {
    if (!['group', 'supergroup'].includes(msg.chat?.type)) return;
    const previewMatches = previewTarget && String(msg.chat.id) === String(previewTarget.chat_id) && (previewTarget.message_thread_id === undefined || msg.message_thread_id === previewTarget.message_thread_id);
    // A scoped test topic stays isolated. Otherwise the BeaniWorld main group uses production.
    const environment = previewMatches && previewTarget.message_thread_id !== undefined ? 'preview' : String(msg.chat.id) === liveChat ? 'live' : previewMatches ? 'preview' : null;
    if (!environment) return;
    const origin = ORIGINS[environment];
    const busyKey = `${environment}:${msg.chat.id}:${msg.message_id}`;
    if (match?.[1]) {
      try { identity ||= bot.getMe(); if ((await identity).username?.toLowerCase() !== match[1].toLowerCase()) return; } catch { identity = null; return; }
    }
    if (!Number.isSafeInteger(msg.message_id) || msg.message_id < 1 || busy.has(busyKey)) return;
    const requestKey = duelRequestKey(msg.chat.id, msg.message_id, environment);
    const receipt = path.join(env.PUBLISH_STATE_DIR, `arena-duel-${environment}-${requestKey}.json`);
    if (fs.existsSync(receipt)) return;
    busy.add(busyKey);
    const reply = async (text, battleId) => {
      const url = origin + '/sanctuary/arena' + (battleId ? '?battle=' + battleId : '');
      await bot.sendMessage(msg.chat.id, text, { reply_to_message_id: msg.message_id, ...(msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}), reply_markup: { inline_keyboard: [[{ text: battleId ? '▶️ Watch battle' : '🏟 Open Arena', url }]] } });
      fs.mkdirSync(env.PUBLISH_STATE_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(receipt, JSON.stringify({ status: 'sent' }), { mode: 0o600 });
    };
    try {
      const opponent = msg.reply_to_message;
      if (!opponent) return await reply('Reply to a player’s message with /bwduel.');
      if (msg.sender_chat || opponent.sender_chat || msg.from?.is_bot || opponent.from?.is_bot || !/^[1-9][0-9]{0,18}$/.test(String(msg.from?.id)) || !/^[1-9][0-9]{0,18}$/.test(String(opponent.from?.id))) return await reply('Reply to a player’s message to challenge their Beast.');
      if (msg.from.id === opponent.from.id) return await reply('Choose another player to challenge.');
      const [wallet, opponentWallet] = await Promise.all([linkedWallet(String(msg.from.id)), linkedWallet(String(opponent.from.id))]);
      if (!wallet) return await reply('Link your Telegram in BeaniScrolls to enter the Arena.');
      if (!opponentWallet) return await reply('This player hasn’t linked Telegram to BeaniScrolls yet.');
      const response = await fetcher(origin + '/api/beast-arena/telegram-duel', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { Authorization: 'Bearer ' + env.PUBLISH_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, opponentWallet, telegramUserId: String(msg.from.id), opponentTelegramUserId: String(opponent.from.id), requestKey }) });
      const data = await response.json();
      if (!response.ok) return await reply(data.error || 'The Arena is busy. Try again shortly.');
      if (data.status === 'pending') return await reply('⚔️ Challenge sent! Waiting for the other Beast’s owner.');
      if (data.status === 'accepted' && /^[0-9a-f-]{36}$/i.test(data.battleId)) return await reply('⚔️ Automatic battle complete. Watch the fight below.', data.battleId);
      throw new Error('Unexpected Arena response');
    } catch { await bot.sendMessage(msg.chat.id, 'The Arena is temporarily unavailable. Try /bwduel again shortly.', { reply_to_message_id: msg.message_id, ...(msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}) }).catch(() => {}); }
    finally { busy.delete(busyKey); }
  };
  bot.onText(/^\/bwduel(?:@([A-Za-z0-9_]+))?\s*$/i, handler);
  return { handler };
}
module.exports = { registerArenaDuels, duelRequestKey };
