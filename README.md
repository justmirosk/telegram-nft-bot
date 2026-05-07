# Telegram NFT Bot for BNB Blockchain

A Telegram bot that displays NFTs from a specific collection on the BNB Smart Chain (BSC).

## Features

- `/random` - Shows a random NFT from the collection
- `/showID <number>` - Shows a specific NFT by token ID
- Displays NFT images, names, descriptions, and metadata
- Links to BscScan for more details

## Setup Instructions

### 1. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the bot token provided by BotFather

### 2. Configure Environment Variables

Edit the `.env` file and set the following values:

```env
TELEGRAM_BOT_TOKEN=your_actual_bot_token
NFT_CONTRACT_ADDRESS=0xYourNFTContractAddress
BNB_RPC_URL=https://bsc-dataseed1.binance.org/
NFT_TOTAL_SUPPLY=10000
```

**Required Configuration:**
- `TELEGRAM_BOT_TOKEN`: Your bot token from BotFather
- `NFT_CONTRACT_ADDRESS`: The smart contract address of the NFT collection on BSC
- `BNB_RPC_URL`: BNB Chain RPC endpoint (default provided)
- `NFT_TOTAL_SUPPLY`: Maximum number of NFTs in the collection

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Bot

```bash
node index.js
```

You should see: `Telegram NFT Bot is running...`

## Usage

1. Open Telegram and search for your bot
2. Start a chat with `/start`
3. Use the commands:
   - `/random` - Get a random NFT
   - `/showID 123` - Get NFT with token ID 123

## File Structure

- `index.js` - Main bot file with command handlers
- `nftService.js` - Service for interacting with NFT smart contract
- `.env` - Configuration file (you need to edit this)
- `.env.example` - Example configuration template

## How It Works

1. The bot connects to the BNB Smart Chain using Web3
2. When a command is received, it queries the NFT smart contract
3. It fetches metadata from the token URI (supports IPFS)
4. Displays the NFT image and information in Telegram

## Troubleshooting

- **Bot not responding**: Check your `TELEGRAM_BOT_TOKEN` is correct
- **NFT not found**: Verify the `NFT_CONTRACT_ADDRESS` and token ID exist
- **Metadata errors**: Some NFTs may have invalid or unreachable metadata URLs
- **IPFS timeout**: IPFS gateways can be slow, the bot will retry

## Notes

- The bot uses standard ERC-721 interface
- Works with any ERC-721 compliant NFT contract on BSC
- Images are fetched from IPFS via public gateways
- Free BNB RPC endpoint is used (may have rate limits)
