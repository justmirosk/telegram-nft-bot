const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRaidEvidence } = require('./raidEvidence');
const ORIGINS = { preview:'https://gems-testnet.beaniscrolls.site', live:'https://beaniscrolls.site' };
function registerArenaCallbacks(bot, { env=process.env, fetcher=fetch, linkedWallet } = {}) {
  if (env.PUBLISH_ENABLED!=='true' || !env.PUBLISH_STATE_DIR || !env.PUBLISH_API_KEY || env.PUBLISH_API_KEY.length<32) return null;
  if (!linkedWallet) {
    if (!env.BEANISCROLLS_TELEGRAM_LINK_URL || !env.TELEGRAM_LINK_API_SECRET) return null;
    linkedWallet = createRaidEvidence({ secret:env.TELEGRAM_LINK_API_SECRET, accountLookup:{url:env.BEANISCROLLS_TELEGRAM_LINK_URL,secret:env.TELEGRAM_LINK_API_SECRET} }).linkedWallet;
  }
  const fileFor = (environment,id) => path.join(env.PUBLISH_STATE_DIR,`arena-challenge-${environment}-${id}.json`);
  async function call(record, action, extra={}) {
    const response = await fetcher(ORIGINS[record.environment]+'/api/beast-arena/telegram', {method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+env.PUBLISH_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({challengeId:record.id,action,...extra})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Arena unavailable. Please try on BeaniScrolls.');return data;
  }
  async function update(record, state) {
    if (!['accepted','refused','expired'].includes(state.status)) return;
    const url = ORIGINS[record.environment]+'/sanctuary/arena'+(state.battleId?'?battle='+state.battleId:'');
    await bot.editMessageCaption(record.text+'\n\nStatus: '+state.status.toUpperCase(),{chat_id:record.chat_id,message_id:record.message_id,reply_markup:{inline_keyboard:state.battleId?[[{text:'▶️ Watch battle',url}]]:[]}}).catch(error=>{if (!String(error.message).includes('message is not modified')) throw error;});
    const file=fileFor(record.environment,record.id);const temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify({...record,status:state.status}),{mode:0o600});fs.renameSync(temp,file);
  }
  bot.on('callback_query', async query => {
    const match = /^arena:([pl]):([ar]):([0-9a-f-]{36})$/i.exec(query.data || '');if (!match) return;
    const answer = text => bot.answerCallbackQuery(query.id,{text,show_alert:true}).catch(()=>{});
    try {
      const environment=match[1]==='l'?'live':'preview';const file=fileFor(environment,match[3]);
      if (!fs.existsSync(file)) return answer('This challenge is unavailable. Open BeaniScrolls.');
      const record=JSON.parse(fs.readFileSync(file,'utf8'));
      if (String(query.message?.chat?.id)!==String(record.chat_id) || query.message?.message_id!==record.message_id) return answer('Use the original challenge message.');
      const player=String(query.from?.id || '');if (!/^[1-9][0-9]{0,18}$/.test(player)) return answer('Telegram identity unavailable.');
      const wallet=await linkedWallet(player);if (!wallet) return answer('Link your Telegram in BeaniScrolls Profile → Connected Accounts, or respond on BeaniScrolls.');
      // The wallet is freshly resolved from query.from.id, never from callback data.
      const state=await call(record,match[2]==='a'?'accept':'refuse',{telegramUserId:player,wallet});
      await update(record,state);await answer(state.status==='accepted'?'Battle accepted. Result saved; watch it on BeaniScrolls.':state.status==='refused'?'Battle refused. No rewards awarded.':'This challenge has expired.');
    } catch(error) {await answer(String(error.message || 'Arena unavailable. Please try on BeaniScrolls.').slice(0,190));}
  });
  let busy=false;
  const refresh=async()=>{if(busy)return;busy=true;try{
    const files=fs.readdirSync(env.PUBLISH_STATE_DIR).filter(f=>/^arena-challenge-(preview|live)-[0-9a-f-]{36}\.json$/i.test(f));
    const pending=files.map(f=>{try{return JSON.parse(fs.readFileSync(path.join(env.PUBLISH_STATE_DIR,f),'utf8'));}catch{return null;}}).filter(r=>r?.status==='pending').slice(0,20);
    await Promise.all(pending.map(async record=>{try{await update(record,await call(record,'status'));}catch{}}));
  }finally{busy=false;}};
  const timer=setInterval(refresh,60000);timer.unref();return {refresh,stop:()=>clearInterval(timer)};
}
module.exports={registerArenaCallbacks};
