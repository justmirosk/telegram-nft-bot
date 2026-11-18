// Lumen Hunt: disabled unless LUMEN_HUNT_ENABLED=true.
// JSON state is persisted on Railway's /data volume; single bot instance only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DATA_FILE = process.env.LUMEN_HUNT_DATA_FILE || '/data/lumen-hunt.json';
const GROUP_ID = process.env.LUMEN_HUNT_GROUP_ID || '';
const ADMIN_IDS = new Set((process.env.LUMEN_HUNT_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const PATHS = {
  shrine: { title: '💎 Ancient Shrine', weights: [[0,10],[10,50],[25,30],[50,10]] },
  forest: { title: '🌲 Whispering Forest', weights: [[0,25],[10,25],[25,30],[50,15],[100,5]] },
  cave: { title: '🦇 Forgotten Cave', weights: [[0,50],[10,10],[25,10],[50,15],[100,15]] }
};
const STORIES = {
  shrine: {
    0: ["JokerBeany offered you a golden chest. It contained one potato. 🥔", "The altar sneezed glitter and went back to sleep."],
    10: ["A glowing mushroom told you a terrible joke. You laughed anyway.", "The shrine's caretaker rewarded you for dusting the altar."],
    25: ["Four crystals shimmered. One dropped a little gift into your pocket.", "The Weaver's light revealed a hidden stash beneath the stones."],
    50: ["A rare blessing lit up the entire shrine!", "An ancient scroll unfolded into a shower of Lumens."]
  },
  forest: {
    0: ["You argued with a tree. The tree won.", "JokerBeany replaced the treasure map with a lunch menu."],
    10: ["A friendly firefly led you to a tiny cache.", "You helped a lost MiniBeany find the path home."],
    25: ["A hollow log held a surprising stash.", "The forest spirits thanked you for being polite."],
    50: ["An enchanted grove revealed a secret vault.", "A rare green glow guided you to forgotten treasure."],
    100: ["The entire forest erupted in light: a legendary discovery!"]
  },
  cave: {
    0: ["A Beast chased you out. At least you kept your shoes.", "You found a chest. It was full of angry bats."],
    10: ["You escaped a cave-in with a handful of Lumens."],
    25: ["A glowing tunnel led you to a hidden cache."],
    50: ["You outsmarted a cave guardian and claimed its treasure."],
    100: ["You offered a hungry Beast your lunch. It let you keep the legendary treasure!"]
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
function records(state,week) {
  return Object.values(state.hunts).filter(h=>h.week===week).sort((a,b)=>a.at.localeCompare(b.at));
}
function leaderboard(state,week) {
  const users = new Map();
  for(const h of records(state,week)) {
    const u=users.get(h.userId)||{userId:h.userId,name:h.name,lumens:0,firstReached:''};
    u.name=h.name; u.lumens+=h.lumens; u.firstReached=h.at; users.set(h.userId,u);
  }
  return [...users.values()].sort((a,b)=>b.lumens-a.lumens || a.firstReached.localeCompare(b.firstReached) || a.userId.localeCompare(b.userId));
}
function bonuses(ranks) { return ranks.map((r,i)=>({...r,bonus:[100,60,40][i]||0,total:r.lumens+([100,60,40][i]||0)})); }
function register(bot) {
  if(process.env.LUMEN_HUNT_ENABLED !== 'true') return;
  const inGroup = msg => ['group','supergroup'].includes(msg.chat.type) && (!GROUP_ID || String(msg.chat.id)===GROUP_ID);
  bot.onText(/^\/bwhunt(?:@\w+)?\s*$/,async msg=>{
    if(!inGroup(msg)) return;
    const today=dateKey(new Date()), state=load();
    if(state.hunts[msg.from.id+':'+today]) return bot.sendMessage(msg.chat.id,'🌙 Your hunt is complete for today. Return tomorrow (UTC)!');
    await bot.sendMessage(msg.chat.id,'🗺️ '+displayName(msg.from)+', choose your daily adventure:',{
      reply_markup:{inline_keyboard:Object.entries(PATHS).map(([key,p])=>[{text:p.title,callback_data:'lh:'+today+':'+msg.from.id+':'+key}])}
    });
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
    save(state);
    const weekly=leaderboard(state,weekKey(new Date())).find(x=>x.userId===userId).lumens;
    try { await bot.answerCallbackQuery(q.id,{text:'Adventure complete!'}); } catch(e) { console.error('Hunt callback acknowledgement:',e.message); }
    await bot.editMessageText('⚔️ '+displayName(q.from)+' entered '+PATHS[choice].title+'!\n\n'+story+'\n\n✨ +'+lumens+' Lumens discovered!\n📊 Weekly total: '+weekly+' Lumens (pending credit)',{chat_id:q.message.chat.id,message_id:q.message.message_id});
  });
  bot.onText(/^\/(?:lboard|myscore|huntstats)(?:@\w+)?\s*$/,async msg=>{
    if(!inGroup(msg)) return;
    const command=msg.text.split('@')[0].trim().split(/\s/)[0], week=weekKey(new Date()), ranks=leaderboard(load(),week);
    if(command==='/myscore') {
      const mine=ranks.find(r=>r.userId===String(msg.from.id));
      return bot.sendMessage(msg.chat.id,'💎 '+displayName(msg.from)+': '+(mine?.lumens||0)+' Lumens discovered this week.');
    }
    if(command==='/bwhuntstats') return bot.sendMessage(msg.chat.id,'🌍 Lumen Hunt · '+week+'\nHunters: '+ranks.length+'\nLumens discovered: '+ranks.reduce((s,r)=>s+r.lumens,0));
    return bot.sendMessage(msg.chat.id,'🏆 Lumen Hunt · week of '+week+'\n'+(ranks.slice(0,10).map((r,i)=>(i+1)+'. '+r.name+' — '+r.lumens+' Lumens').join('\n')||'No hunts yet!'));
  });
  bot.onText(/^\/bwhuntadmin(?:@\w+)?(?:\s+(\d{4}-\d{2}-\d{2}))?\s*$/,async(msg,match)=>{
    if(!ADMIN_IDS.has(String(msg.from.id))) return;
    if(msg.chat.type!=='private') return bot.sendMessage(msg.chat.id,'For privacy, use /bwhuntadmin in a private chat with the bot.');
    const week=match[1]||weekKey(new Date()), state=load(), ranks=bonuses(leaderboard(state,week));
    const lines=ranks.map((r,i)=>[(i+1),r.userId,r.name,r.lumens,r.bonus,r.total,state.payouts[week+':'+r.userId]||'PENDING'].join(' | '));
    const report='Week '+week+'\nRank | Telegram ID | Name | Found | Bonus | Total | Status\n'+(lines.join('\n')||'No hunts');
    for(let i=0;i<report.length;i+=3500) await bot.sendMessage(msg.chat.id,report.slice(i,i+3500));
  });
  bot.onText(/^\/bwhuntpaid(?:@\w+)?\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\s*$/,async(msg,match)=>{
    if(msg.chat.type!=='private'||!ADMIN_IDS.has(String(msg.from.id))) return;
    const [_,week,userId]=match;
    if(week>=weekKey(new Date())) return bot.sendMessage(msg.chat.id,'Only closed weeks can be marked credited.');
    const state=load();
    if(!leaderboard(state,week).some(r=>r.userId===userId)) return bot.sendMessage(msg.chat.id,'No hunter found in that week.');
    const key=week+':'+userId;
    if(state.payouts[key]) return bot.sendMessage(msg.chat.id,'Already marked credited.');
    state.payouts[key]='CREDITED';save(state);
    return bot.sendMessage(msg.chat.id,'Marked credited for '+userId+' in week '+week+'. This does not transfer Lumens.');
  });
}
module.exports={register,PATHS,weekKey,leaderboard,bonuses,roll};
