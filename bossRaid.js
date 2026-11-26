const { randomInt } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const COOLDOWN_MS = 300_000
const MAX_HITS = 6
const DAMAGE_ROLLS = [15, 25, 35, 55]

const schema = `
  CREATE TABLE IF NOT EXISTS raids (
    id TEXT PRIMARY KEY, chat TEXT NOT NULL, topic TEXT NOT NULL, post TEXT NOT NULL,
    opens INTEGER NOT NULL, closes INTEGER NOT NULL, opening_block TEXT NOT NULL,
    max_hp INTEGER NOT NULL CHECK (max_hp > 0),
    hp INTEGER NOT NULL CHECK (hp BETWEEN 0 AND max_hp),
    beast TEXT NOT NULL, lumens INTEGER NOT NULL CHECK (lumens >= 0),
    state TEXT NOT NULL CHECK (state IN ('active', 'defeated', 'expired', 'cancelled')),
    winner_message TEXT,
    UNIQUE (chat, post)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS active_raid_topic ON raids (chat, topic)
    WHERE state = 'active';
  CREATE TABLE IF NOT EXISTS raid_damage_rules (
    raid TEXT PRIMARY KEY REFERENCES raids(id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_launches (
    id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_display (
    raid TEXT PRIMARY KEY REFERENCES raids(id), name TEXT NOT NULL,
    attacking TEXT NOT NULL, wounded TEXT NOT NULL, defeated TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_entrants (
    raid TEXT NOT NULL REFERENCES raids(id), player TEXT NOT NULL, wallet TEXT NOT NULL,
    token TEXT NOT NULL, tribe TEXT, hits INTEGER NOT NULL, last_hit INTEGER NOT NULL,
    PRIMARY KEY (raid, player), UNIQUE (raid, wallet), UNIQUE (raid, token)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_attacks (
    chat TEXT NOT NULL, message TEXT NOT NULL, raid TEXT NOT NULL REFERENCES raids(id),
    player TEXT NOT NULL, decision_time INTEGER NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY (chat, message)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_profile_selections (
    wallet TEXT PRIMARY KEY, token TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_participation_prizes (
    beast TEXT NOT NULL, player TEXT NOT NULL, wallet TEXT NOT NULL, tribe TEXT,
    raid TEXT NOT NULL REFERENCES raids(id), amount INTEGER NOT NULL,
    PRIMARY KEY (beast, player), UNIQUE (beast, wallet)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_reward_delivery (
    id TEXT PRIMARY KEY, beast TEXT NOT NULL, kind TEXT NOT NULL,
    wallet TEXT NOT NULL, tribe TEXT, paid INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE TABLE IF NOT EXISTS raid_prizes (
    raid TEXT NOT NULL REFERENCES raids(id), kind TEXT NOT NULL, recipient TEXT,
    amount INTEGER, state TEXT NOT NULL, winning_message TEXT NOT NULL,
    PRIMARY KEY (raid, kind)
  ) STRICT;
`

function openBossRaid(filename, { live = false, now = Date.now, roll = () => randomInt(-10, 11), pickDamage = () => DAMAGE_ROLLS[randomInt(DAMAGE_ROLLS.length)] } = {}) {
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  db.exec(schema)

  function transaction(run) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function launch({ id, chat, topic, post, closes, openingBlock, hp, beast, lumens, display, steppedDamage = false }) {
    return transaction(() => {
      const opens = now()
      if (!Number.isSafeInteger(closes) || closes <= opens) throw new RangeError('Invalid closing time')
      db.prepare(`
        UPDATE raids SET state = 'expired'
        WHERE chat = ? AND topic = ? AND state = 'active' AND closes <= ?
      `).run(chat, topic, opens)
      db.prepare(`
        INSERT INTO raids (id, chat, topic, post, opens, closes, opening_block, max_hp, hp, beast, lumens, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(id, chat, topic, post, opens, closes, openingBlock, hp, hp, beast, lumens)
      if (steppedDamage) db.prepare('INSERT INTO raid_damage_rules VALUES (?)').run(id)
      if (display) {
        db.prepare('INSERT INTO raid_display VALUES (?, ?, ?, ?, ?)')
          .run(id, display.name, display.attacking, display.wounded, display.defeated)
      }
    })
  }

  function getRaid(id) {
    return db.prepare('SELECT * FROM raids WHERE id = ?').get(id)
  }

  // The adapter authenticates the Telegram reply and supplies verified link and chain evidence.
  // If the evidence lookup fails, omit it so the same message can be retried.
  function attack({ chat, topic, post, message, player, evidence }) {
    return transaction(() => {
      const raid = db.prepare('SELECT * FROM raids WHERE chat = ? AND topic = ? AND post = ?')
        .get(chat, topic, post)
      if (!raid) return { status: 'wrong-post' }
      const prior = db.prepare('SELECT raid, player, result FROM raid_attacks WHERE chat = ? AND message = ?')
        .get(chat, message)
      if (prior) {
        return prior.raid === raid.id && prior.player === player ? JSON.parse(prior.result) : { status: 'wrong-post' }
      }
      const at = now()
      const record = result => {
        db.prepare('INSERT INTO raid_attacks VALUES (?, ?, ?, ?, ?, ?)')
          .run(chat, message, raid.id, player, at, JSON.stringify(result))
        return result
      }
      if (raid.state !== 'active') return record({ status: raid.state })
      if (at >= raid.closes) {
        db.prepare("UPDATE raids SET state = 'expired' WHERE id = ?").run(raid.id)
        return record({ status: 'expired' })
      }
      const entrant = db.prepare('SELECT * FROM raid_entrants WHERE raid = ? AND player = ?').get(raid.id, player)
      const locked = live && entrant
      if (!locked && (!evidence || evidence.openingBlock !== raid.opening_block)) return { status: 'retry' }

      const { token, tribe, openingOwner, confirmedOwner, confirmedBlock } = locked
        ? { token: entrant.token, tribe: entrant.tribe, confirmedBlock: null }
        : evidence
      const wallet = locked ? entrant.wallet : evidence.wallet?.toLowerCase()
      if (!locked && (!wallet || (!live && openingOwner?.toLowerCase() !== wallet) || confirmedOwner?.toLowerCase() !== wallet)) {
        return record({ status: 'ineligible' })
      }
      if (typeof token !== 'string' || (!locked && typeof confirmedBlock !== 'string')) return { status: 'retry' }
      if (entrant && (entrant.wallet !== wallet || entrant.token !== token)) return record({ status: 'ineligible' })
      if (!entrant && db.prepare('SELECT 1 FROM raid_entrants WHERE raid = ? AND (wallet = ? OR token = ?)')
        .get(raid.id, wallet, token)) return record({ status: 'ineligible' })
      if (entrant?.hits >= MAX_HITS) return record({ status: 'cap' })
      if (entrant && at < entrant.last_hit + COOLDOWN_MS) {
        return record({ status: 'cooldown', nextAt: entrant.last_hit + COOLDOWN_MS })
      }
      if (!entrant && tribe !== null && typeof tribe !== 'string') return { status: 'retry' }

      const stepped = Boolean(db.prepare('SELECT 1 FROM raid_damage_rules WHERE raid = ?').get(raid.id))
      const rolled = stepped ? pickDamage() : roll()
      const validRoll = stepped ? DAMAGE_ROLLS.includes(rolled) : Number.isInteger(rolled) && rolled >= -10 && rolled <= 10
      if (!validRoll) throw new RangeError('Invalid damage roll')
      const armor = raid.hp > raid.max_hp / 2 ? 10 : 0
      const damage = Math.min(raid.hp, (stepped ? rolled : 110 + rolled) - armor)
      const hp = raid.hp - damage
      const hits = (entrant?.hits ?? 0) + 1
      const stage = hp === 0 ? 'defeated' : hp <= raid.max_hp / 2 ? 'wounded' : 'attacking'
      const tribeSnapshot = entrant ? entrant.tribe : tribe
      db.prepare(`
        INSERT INTO raid_entrants VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (raid, player) DO UPDATE SET hits = excluded.hits, last_hit = excluded.last_hit
      `).run(raid.id, player, wallet, token, tribeSnapshot, hits, at)
      db.prepare('UPDATE raids SET hp = ?, state = ?, winner_message = ? WHERE id = ?')
        .run(hp, hp === 0 ? 'defeated' : 'active', hp === 0 ? message : null, raid.id)
      const participationAwarded = db.prepare(`
        INSERT INTO raid_participation_prizes (beast, player, wallet, tribe, raid, amount)
        VALUES (?, ?, ?, ?, ?, 25)
        ON CONFLICT DO NOTHING
      `).run(raid.beast, player, wallet, tribeSnapshot, raid.id).changes === 1
      if (live) {
        const enqueue = db.prepare('INSERT OR IGNORE INTO raid_reward_delivery (id, beast, kind, wallet, tribe) VALUES (?, ?, ?, ?, ?)')
        if (participationAwarded) enqueue.run('participation:' + raid.beast + ':' + wallet, raid.beast, 'participation', wallet, null)
        if (hp === 0) enqueue.run('winner:' + raid.beast, raid.beast, 'winner', wallet, tribeSnapshot)
      }
      if (hp === 0) {
        const prize = db.prepare('INSERT INTO raid_prizes VALUES (?, ?, ?, ?, ?, ?)')
        prize.run(raid.id, 'beast', wallet, null, 'pending', message)
        prize.run(raid.id, 'tribe-lumens', tribeSnapshot, raid.lumens, tribeSnapshot ? 'pending' : 'unawarded', message)
      }
      return record({
        status: 'accepted', participationAwarded, token, rolled, armor, damage, previousHp: raid.hp, hp, stage, hits,
        nextAt: hp > 0 && hits < MAX_HITS ? at + COOLDOWN_MS : null,
        openingBlock: raid.opening_block, confirmedBlock,
      })
    })
  }

  function latest(chat, topic) {
    return transaction(() => {
      db.prepare(`
        UPDATE raids SET state = 'expired'
        WHERE chat = ? AND topic = ? AND state = 'active' AND closes <= ?
      `).run(chat, topic, now())
      return db.prepare('SELECT * FROM raids WHERE chat = ? AND topic = ? ORDER BY rowid DESC LIMIT 1')
        .get(chat, topic)
    })
  }

  function entrant(id, player) {
    return db.prepare('SELECT * FROM raid_entrants WHERE raid = ? AND player = ?').get(id, player)
  }

  function damageDealt(id, player) {
    return db.prepare(`
      SELECT COALESCE(SUM(json_extract(result, '$.damage')), 0) AS damage
      FROM raid_attacks WHERE raid = ? AND player = ?
    `).get(id, player).damage
  }

  function winner(id) {
    return db.prepare(`
      SELECT player, result FROM raid_attacks
      JOIN raids ON raids.id = raid_attacks.raid AND raids.winner_message = raid_attacks.message
      WHERE raids.id = ?
    `).get(id)
  }

  function cancel(id) {
    return transaction(() => {
      const raid = getRaid(id)
      if (!raid || raid.state !== 'active') return raid?.state ?? 'missing'
      const state = now() >= raid.closes ? 'expired' : 'cancelled'
      db.prepare('UPDATE raids SET state = ? WHERE id = ?').run(state, id)
      return state
    })
  }

  return {
    launch, attack, cancel, getRaid, latest, entrant, damageDealt, winner,
    claimLaunch: id => db.prepare('INSERT OR IGNORE INTO raid_launches VALUES (?, ?)').run(id, now()).changes === 1,
    hasLaunch: id => Boolean(db.prepare('SELECT 1 FROM raid_launches WHERE id = ?').get(id)),
    display: id => db.prepare('SELECT name, attacking, wounded, defeated FROM raid_display WHERE raid = ?').get(id),
    rewardBatch: () => db.prepare('SELECT id, beast, kind, wallet, tribe FROM raid_reward_delivery WHERE paid = 0 ORDER BY rowid LIMIT 100').all(),
    markRewardPaid: id => db.prepare('UPDATE raid_reward_delivery SET paid = 1 WHERE id = ?').run(id),
    beastAwarded: beast => Boolean(db.prepare("SELECT 1 FROM raid_reward_delivery WHERE id = ?").get('winner:' + beast)),
    profileToken: wallet => db.prepare('SELECT token FROM raid_profile_selections WHERE wallet = ?').get(wallet)?.token ?? null,
    saveProfileToken: (wallet, token) => db.prepare(`
      INSERT INTO raid_profile_selections VALUES (?, ?)
      ON CONFLICT (wallet) DO UPDATE SET token = excluded.token
    `).run(wallet, token),
    participationPrizes: id => db.prepare('SELECT * FROM raid_participation_prizes WHERE raid = ? ORDER BY player').all(id),
    prizes: id => db.prepare('SELECT * FROM raid_prizes WHERE raid = ? ORDER BY kind').all(id),
    close: () => db.close(),
  }
}

module.exports = { openBossRaid }
