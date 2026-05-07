require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const NFTService = require('./nftService');

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

const bot = new TelegramBot(token, { polling: true });
const nftService = new NFTService(rpcUrl, contractAddress);

console.log('Telegram NFT Bot is running...');

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const collectionName = await nftService.getCollectionName();

    bot.sendMessage(
      chatId,
      `Welcome to the ${collectionName} NFT Bot!\n\n` +
      `Available commands:\n` +
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
    message += `Holder: ${shortHolder}\n\n`;

    const traits = nftService.formatTraits(nft.attributes);
    if (traits !== 'Not available') {
      message += `*Properties:*\n${traits}\n\n`;
    }

    message += `[View on BscScan](${explorerUrl})`;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
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
    message += `Holder: ${shortHolder}\n\n`;

    const traits = nftService.formatTraits(nft.attributes);
    if (traits !== 'Not available') {
      message += `*Properties:*\n${traits}\n\n`;
    }

    message += `[View on BscScan](${explorerUrl})`;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
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
    console.error(`Error in /showID command for token ${tokenId}:`, error);
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
