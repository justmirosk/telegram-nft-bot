const publicCommands = [
  { command: 'random', description: 'Show a random MiniBeany' },
  { command: 'showid', description: 'Look up a MiniBeany by number' },
  { command: 'citizen', description: 'Show your BeaniScrolls Citizen Card' },
  { command: 'tribelumens', description: 'Show all four Tribe Lumen balances' },
];

const huntCommands = [
  { command: 'bwhunt', description: 'Start your daily Lumen Hunt' },
  { command: 'myscore', description: 'View your weekly Lumen score' },
  { command: 'lboard', description: 'View the weekly Lumen leaderboard' },
];

async function registerCommandMenu(bot, huntGroupIds) {
  const huntEnabled = process.env.LUMEN_HUNT_ENABLED === 'true';
  const menus = [
    { scope: { type: 'default' }, commands: publicCommands },
    {
      scope: { type: 'all_private_chats' },
      commands: [
        ...publicCommands,
        { command: 'link', description: 'Connect Telegram to your BeaniScrolls profile' },
      ],
    },
    ...Array.from(huntGroupIds, chat_id => ({
      scope: { type: 'chat', chat_id },
      commands: huntEnabled ? [...huntCommands, ...publicCommands] : publicCommands,
    })),
  ];

  await Promise.all(menus.map(async ({ scope, commands }) => {
    try {
      await bot.setMyCommands(commands, { scope });
    } catch {
      console.error('Could not register Telegram commands for scope:', scope.type);
    }
  }));
}

module.exports = { registerCommandMenu };
