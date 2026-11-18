const test=require('node:test');
const assert=require('node:assert/strict');
const {PATHS,weekKey,leaderboard,bonuses,roll}=require('./lumenHunt');
test('path probabilities sum to 100 and rewards are supported',()=>{
 for(const path of Object.values(PATHS)) {
  assert.equal(path.weights.reduce((s,x)=>s+x[1],0),100);
  for(let i=0;i<100;i++) { const reward=roll(path.weights); assert.ok(path.weights.some(([v])=>v===reward)); }
 }
});
test('week starts Monday UTC including Sunday rollover',()=>{
 assert.equal(weekKey(new Date('2026-11-22T23:59:00Z')),'2026-11-16');
 assert.equal(weekKey(new Date('2026-11-23T00:00:00Z')),'2026-11-23');
});
test('leaderboard sums weekly hunts and assigns bonuses once',()=>{
 const hunts={
  a:{userId:'1',name:'Alpha',week:'2026-11-16',lumens:25,at:'2026-11-16T12:00:00Z'},
  b:{userId:'2',name:'Beta',week:'2026-11-16',lumens:50,at:'2026-11-16T12:01:00Z'},
  c:{userId:'1',name:'Alpha',week:'2026-11-16',lumens:25,at:'2026-11-17T12:00:00Z'},
  d:{userId:'3',name:'Other week',week:'2026-11-23',lumens:100,at:'2026-11-23T12:00:00Z'}
 };
 const ranks=bonuses(leaderboard({hunts},'2026-11-16'));
 assert.deepEqual(ranks.map(x=>[x.userId,x.lumens,x.bonus,x.total]),[['2',50,100,150],['1',50,60,110]]);
});

test('numeric Telegram IDs remain consistent across leaderboard and payout',()=>{
 const hunts={a:{userId:123,name:'Hunter',week:'2026-11-16',lumens:25,at:'2026-11-16T12:00:00Z'}};
 const ranks=bonuses(leaderboard({hunts},'2026-11-16'));
 assert.equal(ranks[0].userId,'123');
 assert.equal(ranks[0].total,125);
});
test('ties rank by when score was reached',()=>{
 const hunts={
  a:{userId:'1',name:'First',week:'2026-11-16',lumens:25,at:'2026-11-16T12:00:00Z'},
  b:{userId:'2',name:'Second',week:'2026-11-16',lumens:25,at:'2026-11-16T13:00:00Z'}
 };
 assert.deepEqual(leaderboard({hunts},'2026-11-16').map(x=>x.userId),['1','2']);
});
