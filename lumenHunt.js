// Lumen Hunt: disabled unless LUMEN_HUNT_ENABLED=true.
// JSON state is persisted on Railway's /data volume; single bot instance only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DATA_FILE = process.env.LUMEN_HUNT_DATA_FILE || '/data/lumen-hunt.json';
const GROUP_IDS = new Set((process.env.LUMEN_HUNT_GROUP_ID || '').split(',').map(id => id.trim()).filter(Boolean));
const ADMIN_IDS = new Set((process.env.LUMEN_HUNT_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const REWARD_OWNER_ID = (process.env.BW_REWARD_OWNER_ID || '').trim();
const PATHS = {
  shrine: { title: '💎 Ancient Shrine', weights: [[0,10],[10,50],[25,30],[50,10]] },
  forest: { title: '🌲 Whispering Forest', weights: [[0,25],[10,25],[25,30],[50,15],[100,5]] },
  cave: { title: '🦇 Forgotten Cave', weights: [[0,50],[10,10],[25,10],[50,15],[100,15]] }
};
const STORIES = {
  "shrine": {
    "0": [
      "JokerBeany offered you a golden chest. It contained one potato. 🥔",
      "The altar sneezed glitter and went back to sleep.",
      "You prayed for wealth. The shrine sent an invoice for spiritual maintenance.",
      "A golden door opened onto a broom cupboard. The broom was also disappointed.",
      "JokerBeany sold you a sacred key. It unlocks absolutely nothing.",
      "The altar accepted your offering and immediately went on holiday.",
      "You found a prophecy: 'Better luck tomorrow.' It was notarised.",
      "A ghost offered you eternal wisdom. You asked for Lumens. It left.",
      "The sacred chest contained a single sock. Not even a matching pair.",
      "The Weaver's statue winked. Your wallet remained aggressively empty."
    ],
    "10": [
      "A glowing mushroom told you a terrible joke. You laughed anyway.",
      "The shrine's caretaker rewarded you for dusting the altar.",
      "A monk paid you to stop singing the ancient hymn.",
      "You rescued a candle from a dramatic puddle. The shrine applauded politely.",
      "A tiny guardian demanded a password. 'Potato' somehow worked.",
      "JokerBeany's fake donation box had a real coin stuck inside.",
      "A spirit rewarded you for not touching the suspicious red button.",
      "You found ten Lumens behind a sign reading 'Definitely No Lumens'.",
      "The shrine's accountant made a rounding error in your favour.",
      "A dusty scroll said 'Congratulations, mediocre hero.'",
      "Gravetread stepped on a grave beside the shrine, and a voice underneath said, “Again? I work nights.” The Beast tiptoed away. You gathered the Lumens it had shaken loose and whispered, “Sorry about the noise.” The voice said, “You can be sorry on your own grave.”"
    ],
    "25": [
      "Four crystals shimmered. One dropped a little gift into your pocket.",
      "The Weaver's light revealed a hidden stash beneath the stones.",
      "The altar's vending machine dispensed Lumens instead of stale biscuits.",
      "A stone gargoyle lost a bet against you and paid up.",
      "You returned a haunted sandal. Its owner was surprisingly generous.",
      "The shrine's tax collector mistook you for a refund recipient.",
      "A choir of ghosts sang your name. One dropped a purse.",
      "JokerBeany tried to pick your pocket and accidentally filled it.",
      "The Weaver's lantern lit a secret compartment marked 'Emergency Snacks'.",
      "A sleepy oracle predicted 25 Lumens. For once, the oracle was useful.",
      "Hushstitch offered to mend your cloak at the shrine. You found Lumens sewn into the lining and a note in the pocket that read: Try to die in this one. I’m entering it in a competition."
    ],
    "50": [
      "A rare blessing lit up the entire shrine!",
      "An ancient scroll unfolded into a shower of Lumens.",
      "You discovered the shrine's emergency treasure fund. Nobody asked questions.",
      "The altar declared you spiritually wealthy and, unusually, meant it.",
      "A guardian challenged you to a staring contest. It blinked after 800 years.",
      "JokerBeany attempted a dramatic heist and dropped the entire loot.",
      "The Weaver's blessing arrived with a receipt and fifty Lumens.",
      "A cursed crown turned out to be a very generous tip jar.",
      "You opened the holy vault using the ancient password: 'password'.",
      "A ghost tried to haunt you but paid rent instead."
    ]
  },
  "forest": {
    "0": [
      "You argued with a tree. The tree won.",
      "JokerBeany replaced the treasure map with a lunch menu.",
      "You argued with a tree. Its lawyer also won.",
      "A mushroom offered investment advice. It has since disappeared.",
      "You followed glowing footprints into a very judgmental swamp.",
      "A squirrel stole your map and sold it back as an NFT.",
      "The forest voted unanimously to keep its treasure.",
      "You found a skeleton clutching directions to another skeleton.",
      "A wolf invited you to dinner. You were listed as the special.",
      "A talking stump promised riches. It was lying through its bark."
    ],
    "10": [
      "A friendly firefly led you to a tiny cache.",
      "You helped a lost MiniBeany find the path home.",
      "A suspicious mushroom paid you to forget its name.",
      "A fox returned your stolen lunch, minus the sandwich, plus ten Lumens.",
      "You helped a ghost find its grave. It gave you a tip.",
      "A tree charged you a toll but forgot to collect the full amount.",
      "A sleepy sprite rewarded you for not waking its boss.",
      "You found a tiny treasure chest inside a larger, emptier chest.",
      "A forest spirit traded Lumens for your worst joke.",
      "A raven dropped ten Lumens and demanded a five-star review.",
      "Reedreaper cut the ferry rope to stop you escaping. You were on the bank. You pocketed the Lumens from the ticket booth and watched it drift away on the last ferry.",
      "Wickwing blew out the candles at a memorial. The mourners gasped. You gathered the Lumens that fell from the wicks while a voice from inside the coffin said, “Thank you. I was trying to sleep.”"
    ],
    "25": [
      "A hollow log held a surprising stash.",
      "The forest spirits thanked you for being polite.",
      "You won a dance contest against three deeply embarrassed mushrooms.",
      "A haunted picnic basket contained treasure and a strongly worded note.",
      "You rescued a squirrel from a tree. It was its own tree.",
      "A green wisp led you to a stash hidden beneath a sarcastic root.",
      "You beat JokerBeany at hide-and-seek. He was behind the only tree.",
      "A fox offered you a mysterious contract. The fine print was surprisingly fair.",
      "The forest council awarded you Lumens for outstanding nonsense.",
      "You found a forgotten druid's purse. It was labelled 'Definitely Not Thornvail'.",
      "You tossed a coin into the wishing well and asked for Lumens. Ashquill dropped a burning feather down after it. The bucket came back full of glowing shards and a note from the well keeper that read: Please wish for rain.",
      "You picked up a glowing egg, and it called you Dad. You put it back. Broodfang slid you a pile of Lumens and handed you another egg. Apparently you’d just passed the babysitting interview."
    ],
    "50": [
      "An enchanted grove revealed a secret vault.",
      "A rare green glow guided you to forgotten treasure.",
      "You convinced an ancient oak that acorns are not legal currency.",
      "A ghostly lumberjack paid you to keep his embarrassing secret.",
      "You stumbled into a forest bank during its annual giveaway.",
      "A giant spider offered treasure instead of an awkward conversation.",
      "JokerBeany's treasure trap worked perfectly—on JokerBeany.",
      "You won fifty Lumens in a raffle organised by suspicious frogs.",
      "A moonlit grove revealed a chest and an unpaid parking ticket.",
      "A wolf challenged you to chess. It was terrible at chess."
    ],
    "100": [
      "The entire forest erupted in light: a legendary discovery!",
      "The forest crowned you King of Mushrooms. The salary is excellent.",
      "A thousand fireflies formed the words 'JACKPOT' before requesting overtime.",
      "You found a legendary vault guarded by a squirrel with terrible eyesight.",
      "Thornvail's ancient grove blessed you. Even the trees looked jealous.",
      "A forest Beast surrendered its hoard after hearing your singing.",
      "The spirits threw a victory parade. The parade was mostly confused deer.",
      "You uncovered a royal treasure under a sign reading 'Do Not Dig'.",
      "JokerBeany accidentally gave you the winning treasure map."
    ]
  },
  "cave": {
    "0": [
      "A Beast chased you out. At least you kept your shoes.",
      "You found a chest. It was full of angry bats.",
      "A Beast offered treasure or your soul. You chose treasure. It chose neither.",
      "You found a skeleton clutching a map to another skeleton.",
      "The cave monster ate your torch. It said the lighting was better this way.",
      "A chest opened to reveal a smaller chest containing a tax bill.",
      "You disturbed an ancient curse. It asked you to come back during office hours.",
      "A ghost whispered 'run'. You asked 'why?' and immediately found out.",
      "The cave's exit sign pointed deeper inside. Very reassuring.",
      "You heard ominous footsteps. They were yours, echoing badly."
    ],
    "10": [
      "You escaped a cave-in with a handful of Lumens.",
      "You escaped a hungry Beast by offering it your least favourite sandwich.",
      "A skeleton paid you ten Lumens to stop rearranging its bones.",
      "You found treasure in a boot. The previous owner was still wearing it.",
      "A cave goblin lost a bet on whether you would survive.",
      "You negotiated a refund from a cursed vending machine.",
      "A bat dropped ten Lumens. It refuses to discuss where they came from.",
      "A stone guardian charged a toll, then gave you change.",
      "You discovered a tiny vault behind an enormous warning sign.",
      "Marrowcoil tried to sneak up behind you. Its knees cracked. Yours cracked when you turned around. You nodded at each other and split the Lumens.",
      "Kilnwarden handed you a clay urn with your name on it. “Bit early,” you said. It turned the urn around. The other side said Tip Jar. You dropped in a coin, and it paid you your change in Lumens."
    ],
    "25": [
      "A glowing tunnel led you to a hidden cache.",
      "You bribed a cave guardian with a drawing of a potato.",
      "A ghost tried to scare you but accidentally revealed its savings.",
      "You followed a trail of bones to a surprisingly cheerful treasure room.",
      "A Beast challenged you to rock-paper-scissors. It only knew rock.",
      "A cursed helmet whispered winning lottery numbers from last week.",
      "You found twenty-five Lumens in a monster's emergency lunchbox.",
      "The cave accountant had been dead for centuries. The books still balanced.",
      "JokerBeany set a trap and forgot which side he was standing on.",
      "Veilmaw called from the dark in your voice. “I know a shortcut.” You recognised the tone you use just before getting everyone lost, went the other way, and found Lumens by the exit.",
      "Drownwake drained the pool, revealing Lumens, six boots and a sign that read: Please swim in pairs. You took the Lumens. All six boots were left ones."
    ],
    "50": [
      "You outsmarted a cave guardian and claimed its treasure.",
      "A dragon sneezed, revealing a hidden pile of Lumens.",
      "You survived a monster's cooking. It paid you for your silence.",
      "A haunted knight surrendered after you complimented its rusty armour.",
      "You found a secret vault labelled 'Definitely Not A Secret Vault'.",
      "A Beast hired you as a consultant, then immediately regretted it.",
      "A skeleton pointed toward treasure. It had been pointing for 400 years.",
      "You stole a treasure chest from a trap that was on its lunch break.",
      "The cave's ancient guardian accepted your extremely fake royal credentials."
    ],
    "100": [
      "You offered a hungry Beast your lunch. It let you keep the legendary treasure!",
      "A Beast offered treasure or your soul. You negotiated for both. It hired a lawyer.",
      "You discovered a dragon's retirement fund. The dragon retired yesterday.",
      "The cave crowned you its ruler. Your subjects are bats and one rude skeleton.",
      "A legendary monster surrendered its hoard to avoid your terrible jokes.",
      "You opened the forbidden vault and found a hundred Lumens and a complaint form.",
      "A ghost declared you its heir. It had excellent financial planning.",
      "JokerBeany's master plan accidentally made you very rich.",
      "You survived the Cave of Certain Doom. The sign was apparently outdated."
    ]
  }
};
const dateKey = d => d.toISOString().slice(0,10);
function weekKey(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay()+6)%7));
  return dateKey(x);
}
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); }
  catch(e) { if(e.code === 'ENOENT') return { hunts: {}, payouts: {} }; throw e; }
}
function save(state) {
  fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600});
  fs.renameSync(tmp,DATA_FILE);
}
function roll(weights) {
  const n = crypto.randomInt(100);
  let total=0;
  for(const [reward,chance] of weights) { total+=chance; if(n<total) return reward; }
  throw Error('Invalid encounter weights');
}
function displayName(user) {
  return user.username ? '@'+user.username : [user.first_name,user.last_name].filter(Boolean).join(' ') || 'Hunter';
}
function leaderboard(state, week, includeTournamentRewards = false) {
  const events = Object.values(state.hunts);
  if (includeTournamentRewards) events.push(...Object.values(state.tournamentRewards || {}));
  const weeklyEvents = events.filter(event => event.week === week).sort((a, b) => a.at.localeCompare(b.at));
  const users = new Map();
  for(const h of weeklyEvents) {
    const id=String(h.userId);
    const u=users.get(id)||{userId:id,name:h.name,lumens:0,firstReached:''};
    u.name=h.name; u.lumens+=h.lumens; u.firstReached=h.at; users.set(id,u);
  }
  return [...users.values()].sort((a,b)=>b.lumens-a.lumens || a.firstReached.localeCompare(b.firstReached) || a.userId.localeCompare(b.userId));
}
function tournamentTotal(state, week, userId) {
  return Object.values(state.tournamentRewards || {})
    .filter(reward => reward.week === week && reward.userId === userId)
    .reduce((sum, reward) => sum + reward.lumens, 0);
}
function payoutRows(state, week) {
  const rows = bonuses(leaderboard(state, week)).map((row, index) => ({ ...row, rank: index + 1, tournament: 0 }));
  const byUser = new Map(rows.map(row => [row.userId, row]));
  for (const reward of Object.values(state.tournamentRewards || {})) {
    if (reward.week !== week) continue;
    let row = byUser.get(reward.userId);
    if (!row) {
      row = { userId: reward.userId, name: reward.name, lumens: 0, bonus: 0, tournament: 0, total: 0 };
      byUser.set(reward.userId, row);
    }
    row.tournament += reward.lumens;
    row.total += reward.lumens;
  }
  return [...byUser.values()];
}
function bonuses(ranks) { return ranks.map((r,i)=>({...r,bonus:[100,60,40][i]||0,total:r.lumens+([100,60,40][i]||0)})); }
function startRewardSync() {
  const origin = process.env.LUMEN_HUNT_SYNC_ORIGIN;
  const secret = process.env.LUMEN_HUNT_SYNC_SECRET;
  if (!origin && !secret) return () => {};
  if (!secret || secret.length < 32 || ![
    'https://gems-testnet.beaniscrolls.site',
    'https://www.beaniscrolls.com',
  ].includes(origin)) {
    console.error('Lumen Hunt reward sync configuration is incomplete or invalid.');
    return () => {};
  }

  const endpoint = origin + '/api/connected-accounts/telegram/lumen-hunt';
  let running = false;

  async function flushRewards() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const pending = Object.entries(load().hunts)
        .filter(([, hunt]) => hunt.sync?.status === 'pending' && hunt.sync.nextAttempt <= now)
        .slice(0, 10);
      for (const [key, hunt] of pending) {
        let status;
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              telegramUserId: String(hunt.userId),
              rewardId: hunt.sync.rewardId,
              amount: hunt.lumens,
            }),
            signal: AbortSignal.timeout(65000),
          });
          if (response.ok) ({ status } = await response.json());
          else console.error('Lumen Hunt reward sync HTTP status:', response.status);
        } catch {
          console.error('Lumen Hunt reward sync request failed.');
        }
        const state = load();
        const sync = state.hunts[key]?.sync;
        if (sync?.rewardId !== hunt.sync.rewardId) continue;
        if (status === 'credited') sync.status = 'credited';
        else sync.nextAttempt = Date.now() + (status === 'unlinked' ? 15 : 1) * 60_000;
        save(state);
      }
    } catch {
      console.error('Lumen Hunt reward sync could not read or save its delivery state.');
    } finally {
      running = false;
    }
  }

  setInterval(() => void flushRewards(), 60_000).unref();
  void flushRewards();
  return () => void flushRewards();
}

function register(bot) {
  // Temporary rollout diagnostic: reports the chat ID without exposing secrets.
  bot.onText(/^\/huntcheck(?:@\w+)?\s*$/, async msg => {
    if (!['group','supergroup'].includes(msg.chat.type)) return;
    const matches = GROUP_IDS.has(String(msg.chat.id));
    await bot.sendMessage(msg.chat.id, '🔎 Lumen Hunt check\nChat ID: '+msg.chat.id+'\nConfigured group: '+(matches ? 'MATCH' : 'DIFFERENT')+'\nFeature: '+(process.env.LUMEN_HUNT_ENABLED === 'true' ? 'enabled' : 'disabled'));
  });
  if(process.env.LUMEN_HUNT_ENABLED !== 'true') return;
  const syncRewards = startRewardSync();
  const inGroup = msg => ['group','supergroup'].includes(msg.chat.type) && GROUP_IDS.has(String(msg.chat.id));
  bot.onText(/^\/bwhunt(?:@\w+)?\s*$/,async msg=>{
    if(!inGroup(msg)) return;
    const today=dateKey(new Date()), state=load();
    if(state.hunts[msg.from.id+':'+today]) return bot.sendMessage(msg.chat.id,'🌙 Your hunt is complete for today. Return tomorrow (UTC)!');
    await bot.sendMessage(msg.chat.id,'🗺️ '+displayName(msg.from)+', choose your daily adventure:',{
      reply_markup:{inline_keyboard:Object.entries(PATHS).map(([key,p])=>[{text:p.title,callback_data:'lh:'+today+':'+msg.from.id+':'+key}])}
    });
  });
  bot.onText(/^\/bwreward(?:@\w+)?(?:[ \t]+(.*))?$/, async (msg, match) => {
    if (!/^[1-9]\d*$/.test(REWARD_OWNER_ID) || String(msg.from?.id) !== REWARD_OWNER_ID || msg.sender_chat) return;
    if (!inGroup(msg) && msg.chat.type !== 'private') return;

    const reply = msg.reply_to_message;
    const args = match[1]?.trim() || '';
    const recipient = reply?.from;
    const replyAmount = /^([1-9]\d*)$/.exec(args);
    const direct = /^([1-9]\d*)[ \t]+([1-9]\d*)$/.exec(args);
    const userId = reply ? String(recipient?.id) : direct?.[1];
    const amount = Number(reply ? replyAmount?.[1] : direct?.[2]);
    if (!/^[1-9]\d*$/.test(userId || '') || !Number.isSafeInteger(Number(userId)) ||
        !Number.isSafeInteger(amount) || amount <= 0 || recipient?.is_bot || reply?.sender_chat ||
        (!reply && msg.chat.type !== 'private')) {
      return bot.sendMessage(msg.chat.id, 'Reply to a player’s message with /bwreward 25, or use /bwreward TELEGRAM_ID 25 in a private chat.');
    }

    const now = new Date(), week = weekKey(now), key = msg.chat.id + ':' + msg.message_id;
    const state = load();
    state.tournamentRewards ||= {};
    if (Object.hasOwn(state.tournamentRewards, key)) {
      return bot.sendMessage(msg.chat.id, 'This tournament reward was already recorded.');
    }
    const name = recipient ? displayName(recipient) : leaderboard(state, week).find(row => row.userId === userId)?.name || 'Telegram user ' + userId;
    const total = tournamentTotal(state, week, userId) + amount;
    const payout = payoutRows(state, week).find(row => row.userId === userId)?.total || 0;
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(payout + amount)) {
      return bot.sendMessage(msg.chat.id, 'That amount is too large.');
    }
    state.tournamentRewards[key] = { userId, name, week, lumens: amount, at: now.toISOString() };
    save(state);
    return bot.sendMessage(msg.chat.id, '🏆 Recorded ' + amount + ' tournament Lumens for ' + name + '. Weekly tournament total: ' + total + ' Lumens (pending BeaniScrolls credit).');
  });
  // Serialize callbacks within the single Node.js process before any await.
  bot.on('callback_query',async q=>{
    if(!q.data?.startsWith('lh:')) return;
    const [prefix,day,userId,choice]=q.data.split(':');
    if(!PATHS[choice] || String(q.from.id)!==userId) return bot.answerCallbackQuery(q.id,{text:'This adventure belongs to another hunter.',show_alert:true});
    if(!q.message || !inGroup(q.message)) return bot.answerCallbackQuery(q.id,{text:'Use /bwhunt in the group.'});
    if(day!==dateKey(new Date())) return bot.answerCallbackQuery(q.id,{text:'This adventure has expired. Use /bwhunt again.'});
    const state=load(), key=userId+':'+day;
    if(state.hunts[key]) return bot.answerCallbackQuery(q.id,{text:'You have already hunted today!'});
    const lumens=roll(PATHS[choice].weights), lines=STORIES[choice][lumens];
    const story=lines[crypto.randomInt(lines.length)];
    state.hunts[key]={userId,name:displayName(q.from),day,week:weekKey(new Date()),path:choice,lumens,at:new Date().toISOString()};
    if (lumens > 0) state.hunts[key].sync = { rewardId: crypto.randomUUID(), status: 'pending', nextAttempt: 0 };
    save(state);
    syncRewards();
    const weekly=leaderboard(state,weekKey(new Date())).find(x=>x.userId===String(userId)).lumens;
    try { await bot.answerCallbackQuery(q.id,{text:'Adventure complete!'}); } catch(e) { console.error('Hunt callback acknowledgement:',e.message); }
    await bot.editMessageText('⚔️ '+displayName(q.from)+' entered '+PATHS[choice].title+'!\n\n'+story+'\n\n✨ +'+lumens+' Lumens discovered!\n📊 Weekly total: '+weekly+' Lumens (pending credit)',{chat_id:q.message.chat.id,message_id:q.message.message_id});
  });
  bot.onText(/^\/(?:lboard|myscore|huntstats)(?:@\w+)?\s*$/,async msg=>{
    if(!inGroup(msg)) return;
    const command=msg.text.split('@')[0].trim().split(/\s/)[0], week=weekKey(new Date()), state=load(), ranks=leaderboard(state,week);
    if(command==='/myscore') {
      const mine=ranks.find(r=>r.userId===String(msg.from.id));
      const rewards = tournamentTotal(state, week, String(msg.from.id));
      return bot.sendMessage(msg.chat.id,'💎 '+displayName(msg.from)+': '+(mine?.lumens||0)+' Lumens discovered this week.' + (rewards ? '\n🏆 Tournament rewards: '+rewards+' Lumens (pending credit).' : ''));
    }
    if(command==='/huntstats') return bot.sendMessage(msg.chat.id,'🌍 Lumen Hunt · '+week+'\nHunters: '+ranks.length+'\nLumens discovered: '+ranks.reduce((s,r)=>s+r.lumens,0));
    const weeklyTotals = leaderboard(state, week, true);
    return bot.sendMessage(msg.chat.id,'🏆 Weekly Lumens · week of '+week+'\nHunts + tournament rewards · Hunt bonuses based on hunts\n'+(weeklyTotals.slice(0,10).map((r,i)=>(i+1)+'. '+r.name+' — '+r.lumens+' Lumens').join('\n')||'No Lumens recorded yet!'));
  });
  bot.onText(/^\/huntadmin(?:@\w+)?(?:\s+(\d{4}-\d{2}-\d{2}))?\s*$/,async(msg,match)=>{
    if(!ADMIN_IDS.has(String(msg.from.id))) return;
    if(msg.chat.type!=='private') return bot.sendMessage(msg.chat.id,'For privacy, use /huntadmin in a private chat with the bot.');
    const week=match[1]||weekKey(new Date()), state=load(), ranks=payoutRows(state,week);
    const lines=ranks.map(r=>[r.rank ?? '—',r.userId,r.name,r.lumens,r.bonus,r.tournament,r.total,state.payouts[week+':'+r.userId]||'PENDING'].join(' | '));
    const report='Week '+week+'\nRank | Telegram ID | Name | Found | Bonus | Tournament | Total | Status\n'+(lines.join('\n')||'No hunts');
    for(let i=0;i<report.length;i+=3500) await bot.sendMessage(msg.chat.id,report.slice(i,i+3500));
  });
  bot.onText(/^\/huntpaid(?:@\w+)?\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\s*$/,async(msg,match)=>{
    if(msg.chat.type!=='private'||!ADMIN_IDS.has(String(msg.from.id))) return;
    const [_,week,userId]=match;
    if(week>=weekKey(new Date())) return bot.sendMessage(msg.chat.id,'Only closed weeks can be marked credited.');
    const state=load();
    if(!payoutRows(state,week).some(r=>r.userId===userId)) return bot.sendMessage(msg.chat.id,'No hunter found in that week.');
    const key=week+':'+userId;
    if(state.payouts[key]) return bot.sendMessage(msg.chat.id,'Already marked credited.');
    state.payouts[key]='CREDITED';save(state);
    return bot.sendMessage(msg.chat.id,'Marked credited for '+userId+' in week '+week+'. This does not transfer Lumens.');
  });
}
module.exports={register,PATHS,weekKey,leaderboard,bonuses,roll};
