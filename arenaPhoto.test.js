const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {once}=require('node:events');const {startPublisher}=require('./publisher');
test('challenge photo carries two decision buttons, binds its receipt, and replays without duplicate sends',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-photo-'));const calls=[];const key='k'.repeat(40),id='ae84d9be-0000-4000-8000-000000000009';
 const server=startPublisher({sendPhoto:async(...args)=>{calls.push(args);return{chat:{id:-123},message_id:7};}},{PORT:'0',PUBLISH_ENABLED:'true',PUBLISH_API_KEY:key,PUBLISH_STATE_DIR:dir,PUBLISH_DESTINATIONS:JSON.stringify({'beaniscrolls-test':{chat_id:'-123'}})});
 try{if(!server.listening)await once(server,'listening');
  const payload={request_id:'arena-photo-test-001',destination:'beaniscrolls-test',text:'First Beast challenges Second Beast\nhttps://gems-testnet.beaniscrolls.site/sanctuary/arena?challenge='+id,image_base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64'),arena_challenge:{id,environment:'preview'}};
  async function post(body){return fetch(`http://127.0.0.1:${server.address().port}/publish`,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});}
  assert.equal((await post(payload)).status,200);assert.equal((await post(payload)).status,200);assert.equal(calls.length,1);
  const buttons=calls[0][2].reply_markup.inline_keyboard[0];assert.equal(buttons.length,2);assert.equal(buttons[0].callback_data,`arena:p:a:${id}`);assert.equal(buttons[1].callback_data,`arena:p:r:${id}`);
  const binding=JSON.parse(fs.readFileSync(path.join(dir,`arena-challenge-preview-${id}.json`)));assert.equal(binding.message_id,7);assert.equal(binding.chat_id,-123);assert.equal(binding.text,'First Beast challenges Second Beast');assert.equal(calls[0][2].caption,'First Beast challenges Second Beast');assert.equal(calls[0][2].reply_markup.inline_keyboard[1][0].text,'🏟 Open Arena');
  assert.equal((await post({...payload, request_id:'arena-result-test-001',arena_challenge:undefined,text:'Battle result\nhttps://gems-testnet.beaniscrolls.site/sanctuary/arena?battle='+id})).status,200);assert.equal(calls[1][2].caption,'Battle result');assert.equal(calls[1][2].reply_markup.inline_keyboard[0][0].text,'▶️ Watch battle');
  assert.equal((await post({...payload,request_id:'arena-invalid-001',arena_challenge:{id,environment:'live'}})).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true});}
});
