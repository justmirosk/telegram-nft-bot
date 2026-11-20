// Telegram account linking is independent of Lumen Hunt and all game rewards.
function register(bot) {
  bot.onText(/^\/link(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (msg.chat.type !== 'private') {
      await bot.sendMessage(msg.chat.id, 'For your security, send /link CODE to me in a private chat. Never post a linking code in a group.')
      return
    }
    const code = (match?.[1] || '').trim()
    if (!/^[A-Za-z0-9_-]{24}$/.test(code)) {
      await bot.sendMessage(msg.chat.id, 'Open BeaniScrolls → Profile → Connected Accounts, generate a code, then send /link CODE here.')
      return
    }
    const endpoint = process.env.BEANISCROLLS_TELEGRAM_LINK_URL
    const secret = process.env.TELEGRAM_LINK_API_SECRET
    if (!endpoint || !secret) {
      await bot.sendMessage(msg.chat.id, 'Account linking is not available yet. Please try again later.')
      return
    }
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
        body: JSON.stringify({ code, telegramUserId: String(msg.from.id), username: msg.from.username || '' }),
        signal: AbortSignal.timeout(12000),
      })
      await bot.sendMessage(msg.chat.id, response.ok
        ? '✅ Telegram is now connected to your BeaniScrolls Citizen Profile.'
        : 'That code is invalid, expired, or one of these accounts is already linked. Generate a new code on BeaniScrolls.')
    } catch {
      await bot.sendMessage(msg.chat.id, 'Could not reach BeaniScrolls. Please try again later.')
    }
  })
}
module.exports = { register }
