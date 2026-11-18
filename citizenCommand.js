'use strict';

const BASE_URL = (process.env.BEANISCROLLS_URL || 'https://beaniscrolls.com').replace(/\/$/, '');
const CARD_IMAGE_ENDPOINT = (process.env.CITIZEN_CARD_IMAGE_ENDPOINT || '').trim();
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function publicProfile(wallet) {
  if (!ADDRESS.test(wallet)) throw new Error('Invalid wallet address');
  return `${BASE_URL}/citizens/${wallet}`;
}

function cardImageUrl(wallet) {
  if (!CARD_IMAGE_ENDPOINT) return null;
  const endpoint = new URL(CARD_IMAGE_ENDPOINT);
  if (endpoint.protocol !== 'https:') throw new Error('Citizen image endpoint must use HTTPS');
  endpoint.searchParams.set('wallet', wallet);
  return endpoint.toString();
}

function registerCitizenCommand(bot) {
  // Do not associate Telegram usernames with wallets without a signed wallet-link flow.
  bot.onText(/^\/citizen(?:@\w+)?(?:\s+([^\s]+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const wallet = (match[1] || '').trim();
    if (!wallet) {
      await bot.sendMessage(chatId, 'To view a public Citizen Card, use /citizen 0xYourWalletAddress. Automatic /citizen lookup requires verified Telegram-to-wallet linking and is not enabled yet.', { reply_to_message_id: msg.message_id });
      return;
    }
    if (!ADDRESS.test(wallet)) {
      await bot.sendMessage(chatId, 'Please enter a valid Ethereum-style wallet address (0x followed by 40 hexadecimal characters).', { reply_to_message_id: msg.message_id });
      return;
    }
    const reply_markup = { inline_keyboard: [[{ text: 'View Public Profile', url: publicProfile(wallet) }]] };
    try {
      const imageUrl = cardImageUrl(wallet);
      if (imageUrl) {
        await bot.sendPhoto(chatId, imageUrl, { caption: 'BeaniWorld Citizen Card', reply_markup, reply_to_message_id: msg.message_id });
      } else {
        await bot.sendMessage(chatId, 'Citizen public profile (card image integration is not configured yet).', { reply_markup, reply_to_message_id: msg.message_id });
      }
    } catch (error) {
      console.error('Citizen card delivery failed:', error);
      await bot.sendMessage(chatId, 'The Citizen Card image is temporarily unavailable. You can still view the public profile.', { reply_markup, reply_to_message_id: msg.message_id });
    }
  });
}

module.exports = { registerCitizenCommand, publicProfile, cardImageUrl };
