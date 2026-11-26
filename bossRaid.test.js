const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { Worker } = require('node:worker_threads')
const { openBossRaid } = require('./bossRaid')

const scope = { chat: '-100', topic: '8', post: '20' }
const evidenceFor = (token, tribe = 'Polarim') => {
  const wallet = `wallet-${token}`
  return { token, wallet, openingOwner: wallet, confirmedOwner: wallet, openingBlock: '42', confirmedBlock: '43', tribe }
}
const attack = (message, token, evidence = evidenceFor(token)) =>
  ({ ...scope, message, player: token, evidence })

function fixture(t, hp = 600, closes = 3_600_000) {
  const dir = mkdtempSync(join(tmpdir(), 'boss-raid-'))
  const file = join(dir, 'raid.sqlite')
  let time = 0
  let damageRoll = 0
  const engine = openBossRaid(file, { now: () => time, roll: () => damageRoll })
  t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }) })
  engine.launch({ id: 'raid', ...scope, closes, hp, openingBlock: '42', beast: '1', lumens: 500 })
  return {
    engine, file,
    hit(request, at, roll = 0) {
      time = at
      damageRoll = roll
      return engine.attack(request)
    },
  }
}

function startWorker(t, file, request, { at = 1, replay = false } = {}) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads')
    const { openBossRaid } = require(workerData.module)
    const engine = openBossRaid(workerData.file, {
      now: () => workerData.at,
      roll: () => {
        if (workerData.replay) throw new Error('Replayed damage was rolled')
        return 0
      },
    })
    parentPort.postMessage({ ready: true })
    parentPort.once('message', () => {
      parentPort.postMessage(engine.attack(workerData.request))
      engine.close()
    })
  `, { eval: true, workerData: { file, request, at, replay, module: require.resolve('./bossRaid') } })
  t.after(() => worker.terminate())
  const messages = []
  worker.on('message', message => messages.shift()?.resolve(message))
  worker.on('error', error => { for (const pending of messages.splice(0)) pending.reject(error) })
  worker.on('exit', code => {
    for (const pending of messages.splice(0)) pending.reject(new Error(`Worker exited with code ${code}`))
  })
  const next = () => new Promise((resolve, reject) => messages.push({ resolve, reject }))
  const exited = new Promise(resolve => worker.once('exit', resolve))
  return {
    ready: next(),
    exited,
    run() {
      const result = next()
      worker.postMessage('attack')
      return result
    },
  }
}

test('six accepted hits reproduce the raid and persist the winning prizes', t => {
  const { engine, hit } = fixture(t)
  const hits = [
    ['78', 0, 0], ['50', 20_000, 5], ['66', 60_000, -5],
    ['78', 300_000, 0], ['50', 320_000, -10], ['66', 360_000, 5],
  ].map(([token, time, roll], index) => hit(attack(String(index), token), time, roll))
  assert.deepEqual(hits.map(hit => hit.hp), [500, 395, 300, 190, 90, 0])
  assert.equal(hits[2].stage, 'wounded')
  assert.equal(hits[5].damage, 90)
  assert.equal(engine.getRaid('raid').winner_message, '5')
  assert.deepEqual(engine.prizes('raid').map(p => [p.kind, p.recipient, p.amount, p.winning_message]), [
    ['beast', 'wallet-66', null, '5'], ['tribe-lumens', 'Polarim', 500, '5'],
  ])
})

test('cooldown rejects early attacks and the seventh attack preserves HP', t => {
  const { engine, hit } = fixture(t, 3600)
  assert.equal(hit(attack('1', '78'), 0).hits, 1)
  assert.deepEqual(hit(attack('early', '78'), 299_000), { status: 'cooldown', nextAt: 300_000 })
  for (let index = 1; index < 6; index++) {
    assert.equal(hit(attack(String(index + 1), '78'), index * 300_000).hits, index + 1)
  }
  assert.deepEqual(hit(attack('cap', '78'), 1_800_000), { status: 'cap' })
  assert.equal(engine.getRaid('raid').hp, 3000)
})

test('scope, missing evidence, transfers and relinks preserve attack history', t => {
  const { engine, hit } = fixture(t)
  const first = attack('1', '78')
  assert.equal(hit({ ...first, topic: 'elsewhere' }, 0).status, 'wrong-post')
  assert.equal(hit({ ...first, evidence: null }, 0).status, 'retry')
  assert.equal(hit(first, 0).hits, 1)
  const evidence = evidenceFor('78')
  assert.equal(hit(attack('2', '78', { ...evidence, confirmedOwner: 'buyer' }), 300_000).status, 'ineligible')
  assert.equal(hit(attack('3', '78', { ...evidence, wallet: 'buyer' }), 300_000).status, 'ineligible')
  assert.equal(hit({ ...attack('4', '78'), player: 'other' }, 300_000).status, 'ineligible')
  assert.equal(engine.getRaid('raid').hp, 500)
  assert.equal(hit(attack('5', '78'), 300_000).hits, 2)
})

test('Tribe attribution is captured at the first accepted hit', t => {
  const { engine, hit } = fixture(t, 200)
  hit(attack('1', '66'), 0)
  hit(attack('2', '66', evidenceFor('66', 'Solarim')), 300_000)
  assert.equal(engine.prizes('raid')[1].recipient, 'Polarim')
})

test('a winner without a Tribe can win the Beast', t => {
  const { engine, hit } = fixture(t, 100)
  hit(attack('1', '66', evidenceFor('66', null)), 0)
  assert.deepEqual(engine.prizes('raid').map(p => p.state), ['pending', 'unawarded'])
})

test('an attack at the deadline expires the raid without a winner', t => {
  const { engine, hit } = fixture(t, 100, 10)
  assert.equal(hit(attack('1', '78'), 10).status, 'expired')
  assert.equal(engine.cancel('raid'), 'expired')
  assert.deepEqual(engine.prizes('raid'), [])
})

test('cancellation and defeat are terminal', t => {
  const { engine, hit } = fixture(t, 100)
  assert.equal(engine.cancel('raid'), 'cancelled')
  assert.equal(hit(attack('1', '78'), 1).status, 'cancelled')
  assert.deepEqual(engine.prizes('raid'), [])
})

test('two workers record one final hit and replay it after reopening the database', { timeout: 15_000 }, async t => {
  const { engine, file } = fixture(t, 90)
  const contenders = [attack('1', '78'), attack('2', '66')]
  const workers = contenders.map(request => startWorker(t, file, request))
  await Promise.all(workers.map(worker => worker.ready))
  const results = await Promise.all(workers.map(worker => worker.run()))
  assert.deepEqual(results.map(result => result.status).sort(), ['accepted', 'defeated'])
  const winningIndex = results.findIndex(result => result.status === 'accepted')
  const winner = contenders[winningIndex]
  assert.equal(engine.getRaid('raid').hp, 0)
  assert.equal(engine.cancel('raid'), 'defeated')
  assert.deepEqual(engine.prizes('raid').map(p => p.winning_message), [winner.message, winner.message])
  assert.deepEqual(await Promise.all(workers.map(worker => worker.exited)), [0, 0])
  const restarted = startWorker(t, file, { ...winner, evidence: null }, { at: 9_000_000, replay: true })
  await restarted.ready
  assert.deepEqual(await restarted.run(), results[winningIndex])
  assert.equal(await restarted.exited, 0)
})

test('two workers handling the same message commit identical results and one hit', { timeout: 15_000 }, async t => {
  const { engine, file } = fixture(t)
  const request = attack('1', '78')
  const workers = [startWorker(t, file, request), startWorker(t, file, request)]
  await Promise.all(workers.map(worker => worker.ready))
  const results = await Promise.all(workers.map(worker => worker.run()))
  assert.deepEqual(results[0], results[1])
  assert.equal(results[0].hits, 1)
  assert.equal(engine.getRaid('raid').hp, 500)
})
