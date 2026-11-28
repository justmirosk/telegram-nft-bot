const {test}=require('node:test')
const assert=require('node:assert/strict')
const {openRaidSchedule}=require('./raidSchedule')
test('announcement and launch are independently claimed once',()=>{
 let time=0
 const store=openRaidSchedule(':memory:',{now:()=>time})
 const id='12345678-1234-1234-1234-123456789abc'
 store.save(id,{name:'Test'},600000,1/12)
 assert.equal(store.claim(id,'announcement'),false)
 time=300000
 assert.equal(store.claim(id,'announcement'),true)
 assert.equal(store.claim(id,'announcement'),false)
 store.finish(id,'announcement',true)
 time=600000
 assert.equal(store.claim(id,'launch'),true)
 store.recover()
 assert.equal(store.get(id).launch,'review')
 assert.equal(store.claim(id,'launch'),false)
 store.close()
})
