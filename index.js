require('dotenv').config();
const { join } = require('node:path');
const TelegramBot = require('node-telegram-bot-api');
const NFTService = require('./nftService');
const { getTribeLine, detailUrl } = require('./tribeService');

const tribeFlagsPath = join(__dirname, 'assets', 'tribe-lumen-flags.jpg');

const token = process.env.TELEGRAM_BOT_TOKEN;
const contractAddress = process.env.NFT_CONTRACT_ADDRESS;
const rpcUrl = process.env.BNB_RPC_URL;
const maxSupply = parseInt(process.env.NFT_TOTAL_SUPPLY) || 10000;

if (!token || token === 'your_telegram_bot_token_here') {
  console.error('ERROR: Please set your TELEGRAM_BOT_TOKEN in the .env file');
  process.exit(1);
}

if (!contractAddress || contractAddress === '0x_your_nft_contract_address_here') {
  console.error('ERROR: Please set your NFT_CONTRACT_ADDRESS in the .env file');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true, request: { timeout: 30000 } });
const nftService = new NFTService(rpcUrl, contractAddress);

// Optional publisher shares the existing bot and polling process.
require('./publisher').startPublisher(bot);
// Opt-in community game; disabled by default.
require('./lumenHunt').register(bot);
require('./telegramLink').register(bot);
require('./citizenCard').register(bot);
try {
  require('./raidTelegram').register(bot, nftService);
} catch (error) {
  console.error('Boss Raid rehearsal initialization failed:', error.name);
}

console.log('Telegram NFT Bot is running...');

bot.onText(/^\/tribelumens(?:@\w+)?\s*$/i, async (msg) => {
  const tribes = [
    ['avira', '🔴 Avarai'],
    ['polaris', '🟣 Polarim'],
    ['binara', '🟡 Binarai'],
    ['solara', '🟢 Solarim'],
  ];
  const baseUrl = process.env.BEANISCROLLS_URL || 'https://beaniscrolls.com';
  let message;

  try {
    const response = await fetch(new URL('/api/tribes/lumens', baseUrl), {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Tribe Lumens request failed');

    const { totals } = await response.json();
    const balances = tribes.map(([id, name]) => {
      const total = totals?.[id];
      if (!Number.isSafeInteger(total)) throw new Error('Invalid Tribe Lumen total');
      return name + ' · ' + total.toLocaleString('en-IE');
    });
    message = ['✨ Tribe Lumen Balances', 'All-time totals on BeaniScrolls', '', ...balances].join('\n');
  } catch {
    message = 'Tribe Lumen balances are temporarily unavailable. Please try again later.';
  }

  try {
    await bot.sendPhoto(msg.chat.id, tribeFlagsPath, { caption: message });
    return;
  } catch (error) {
    console.error('Error attaching Tribe flags:', error.message);
  }

  try {
    await bot.sendMessage(msg.chat.id, message);
  } catch (error) {
    console.error('Error replying to /tribelumens:', error.message);
  }
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const collectionName = await nftService.getCollectionName();

    bot.sendMessage(
      chatId,
      `Welcome to the ${collectionName} NFT Bot!\n\n` +
      `Available commands:\n` +
      `/tribelumens - Show all four Tribe Lumen balances\n` +
      `/random - Show a random NFT from the collection\n` +
      `/showID <number> - Show a specific NFT by ID\n\n` +
      `Contract: ${contractAddress}`
    );
  } catch (error) {
    console.error('Error in /start command:', error);
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
});

bot.onText(/\/random/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, 'Fetching a random NFT...');

    const nft = await nftService.getRandomNFT(maxSupply);
    const explorerUrl = nftService.getExplorerUrl(nft.tokenId);
    const displayNumber = nft.tokenId + 1;
    const holder = await nftService.getHolderAddress(nft.tokenId);
    const shortHolder = holder ? nftService.getShortAddress(holder) : 'Unknown';

    let message = `*${nft.name}*\n\n`;
    if (nft.description) {
      message += `${nft.description}\n\n`;
    }
    message += `NFT #${displayNumber}\n`;
    message += `Token ID: ${nft.tokenId}\n`;
    message += `Holder: ${shortHolder}\n`;
    message += `${await getTribeLine(nft.tokenId)}\n\n`;

    const publicTraits = nft.attributes.filter(attr => !/^(?:(?:gem\s+)?affinity|tribe|allegiance)$/i.test(String(attr.trait_type || attr.name || '').trim()));
    const traits = nftService.formatTraits(publicTraits);
    if (traits !== 'Not available') {
      message += `*Properties:*\n${traits}\n\n`;
    }

    message += `[View on BscScan](${explorerUrl})`;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'View on BeaniScrolls', url: detailUrl(nft.tokenId) }],
          [
            {
              text: 'OKX',
              url: 'https://web3.okx.com/nft/collection/bsc/minibeanys'
            },
            {
              text: 'Bit5',
              url: 'https://bit5.com/collection/0x38/minibeanys'
            }
          ]
        ]
      }
    };

    if (nft.image) {
      try {
        await bot.sendPhoto(chatId, nft.image, {
          caption: message,
          parse_mode: 'Markdown',
          reply_markup: options.reply_markup
        });
      } catch (photoError) {
        console.error('Error sending photo, falling back to text:', photoError.message);
        await bot.sendMessage(chatId, message, options);
      }
    } else {
      await bot.sendMessage(chatId, message, options);
    }
  } catch (error) {
    console.error('Error in /random command:', error);
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
});

bot.onText(/\/showID (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const nftNumber = match[1].trim();

  if (!/^\d+$/.test(nftNumber)) {
    return bot.sendMessage(chatId, 'Please provide a valid numeric NFT number.\nExample: /showID 123');
  }

  try {
    const userInput = parseInt(nftNumber);
    const tokenId = userInput - 1;

    if (tokenId < 0) {
      return bot.sendMessage(chatId, 'NFT numbers start from 1. Please provide a number >= 1.\nExample: /showID 1');
    }

    await bot.sendMessage(chatId, `Fetching NFT #${userInput}...`);

    const nft = await nftService.getNFTById(tokenId);
    const explorerUrl = nftService.getExplorerUrl(nft.tokenId);
    const holder = await nftService.getHolderAddress(nft.tokenId);
    const shortHolder = holder ? nftService.getShortAddress(holder) : 'Unknown';

    let message = `*${nft.name}*\n\n`;
    if (nft.description) {
      message += `${nft.description}\n\n`;
    }
    message += `NFT #${userInput}\n`;
    message += `Token ID: ${nft.tokenId}\n`;
    message += `Holder: ${shortHolder}\n`;
    message += `${await getTribeLine(nft.tokenId)}\n\n`;

    const publicTraits = nft.attributes.filter(attr => !/^(?:(?:gem\s+)?affinity|tribe|allegiance)$/i.test(String(attr.trait_type || attr.name || '').trim()));
    const traits = nftService.formatTraits(publicTraits);
    if (traits !== 'Not available') {
      message += `*Properties:*\n${traits}\n\n`;
    }

    message += `[View on BscScan](${explorerUrl})`;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'View on BeaniScrolls', url: detailUrl(nft.tokenId) }],
          [
            {
              text: 'OKX',
              url: 'https://web3.okx.com/nft/collection/bsc/minibeanys'
            },
            {
              text: 'Bit5',
              url: 'https://bit5.com/collection/0x38/minibeanys'
            }
          ]
        ]
      }
    };

    if (nft.image) {
      try {
        await bot.sendPhoto(chatId, nft.image, {
          caption: message,
          parse_mode: 'Markdown',
          reply_markup: options.reply_markup
        });
      } catch (photoError) {
        console.error('Error sending photo, falling back to text:', photoError.message);
        await bot.sendMessage(chatId, message, options);
      }
    } else {
      await bot.sendMessage(chatId, message, options);
    }
  } catch (error) {
    console.error(`Error in /showID command for NFT ${nftNumber}:`, error);
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
