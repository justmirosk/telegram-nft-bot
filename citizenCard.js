// Read-only Citizen Profile lookup for verified Telegram accounts.
// Does not grant privileges or expose wallet-private fields.
function register(bot) {
  bot.onText(/^\/citizen(?:@\w+)?\s*$/i, async (msg) => {
    const chatId = msg.chat.id
    if (msg.chat.type !== 'private') {
      await bot.sendMessage(chatId, 'For your privacy, send /citizen to me in a private chat.')
      return
    }
    const base = process.env.BEANISCROLLS_TELEGRAM_LINK_URL
    const secret = process.env.TELEGRAM_LINK_API_SECRET
    if (!base || !secret) {
      await bot.sendMessage(chatId, 'Citizen Cards are not available yet. Please try later.')
      return
    }
    try {
      const url = new URL(base)
      url.pathname = '/api/connected-accounts/telegram/citizen'
      url.search = new URLSearchParams({ telegramUserId: String(msg.from.id) }).toString()
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + secret },
        signal: AbortSignal.timeout(12000),
      })
      if (!response.ok) throw new Error('Citizen lookup failed')
      const citizen = await response.json()
      if (!citizen.linked) {
        await bot.sendMessage(chatId, 'Your Telegram account is not linked yet. Connect it in BeaniScrolls → Edit Profile → Connected Accounts, then try /citizen again.')
        return
      }
      const name = String(citizen.name || 'BeaniWorld Citizen').slice(0, 80)
      const wallet = String(citizen.wallet || '')
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) throw new Error('Invalid Citizen Profile')
      const profileUrl = 'https://www.beaniscrolls.com/citizens/' + wallet
      await bot.sendMessage(chatId, '🫘 BeaniWorld Citizen\n\n' + name + '\nWallet: ' + wallet.slice(0, 6) + '…' + wallet.slice(-4) + '\n\nOpen your Citizen Profile below.', {
        reply_markup: { inline_keyboard: [[{ text: 'View Citizen Profile', url: profileUrl }]] },
        disable_web_page_preview: true,
      })
    } catch (error) {
      console.error('Citizen lookup failed:', error?.message || 'unknown error')
      await bot.sendMessage(chatId, 'Could not load your Citizen Profile right now. Please try again later.')
    }
  })
}
module.exports = { register }
