const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {registerArenaCallbacks}=require('./arenaCallbacks');
const id='ae84d9be-0000-4000-8000-000000000009';
async function setup(action) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-callback-'));const file=path.join(dir,`arena-challenge-preview-${id}.json`);fs.writeFileSync(file,JSON.stringify({id,environment:'preview',chat_id:-123,message_id:9,text:'Original challenge',status:'pending'}));
 const answers=[],edits=[],calls=[];let handler;
 const bot={on:(_e,cb)=>{handler=cb;},answerCallbackQuery:async(_id,answer)=>answers.push(answer),editMessageCaption:async(...args)=>edits.push(args)};
 const worker=registerArenaCallbacks(bot,{env:{PUBLISH_ENABLED:'true',PUBLISH_STATE_DIR:dir,PUBLISH_API_KEY:'k'.repeat(40)},linkedWallet:async player=>player==='44'?'0x1111111111111111111111111111111111111111':null,fetcher:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return action(JSON.parse(init.body));}});
 return {dir,file,worker,answers,edits,calls,handler,close(){worker.stop();fs.rmSync(dir,{recursive:true});}};
}
test('uses actual linked sender identity and removes buttons after successful acceptance',async()=>{
 const x=await setup(async()=>Response.json({status:'accepted',battleId:id}));try{
  await x.handler({id:'tap',data:`arena:p:a:${id}`,from:{id:44},message:{chat:{id:-123},message_id:9}});
  assert.equal(x.calls[0].body.telegramUserId,'44');assert.equal(x.calls[0].body.wallet,'0x1111111111111111111111111111111111111111');assert.equal(x.calls[0].url,'https://gems-testnet.beaniscrolls.site/api/beast-arena/telegram');
  assert.equal(x.edits[0][1].reply_markup.inline_keyboard[0][0].text,'▶️ Watch battle');assert.equal(JSON.parse(fs.readFileSync(x.file)).status,'accepted');
 }finally{x.close();}
});
test('rejects forwarded posts, unlinked people and server-denied ownership without editing',async()=>{
 const x=await setup(async()=>Response.json({error:'Only the defending owner can respond.'},{status:403}));try{
  const tap={id:'tap',data:`arena:p:r:${id}`,from:{id:44},message:{chat:{id:-999},message_id:9}};
  await x.handler(tap);assert.equal(x.calls.length,0);
  await x.handler({...tap,message:{chat:{id:-123},message_id:9},from:{id:55}});assert.equal(x.calls.length,0);
  await x.handler({...tap,message:{chat:{id:-123},message_id:9}});assert.equal(x.calls.length,1);assert.equal(x.edits.length,0);assert.equal(JSON.parse(fs.readFileSync(x.file)).status,'pending');
 }finally{x.close();}
});
test('refreshes expiry and website refusals without approving a fight',async()=>{
 const x=await setup(async body=>{assert.equal(body.action,'status');return Response.json({status:'expired'});});try{await x.worker.refresh();assert.equal(x.edits[0][1].reply_markup.inline_keyboard.length,0);assert.equal(JSON.parse(fs.readFileSync(x.file)).status,'expired');}finally{x.close();}
});
