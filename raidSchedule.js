const { DatabaseSync } = require('node:sqlite')
const LEADS = [1/12,1,2,3,4,6,8,12,24,48]
function openRaidSchedule(filename, { now = Date.now } = {}) {
  const db = new DatabaseSync(filename)
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS raid_schedule (id TEXT PRIMARY KEY, template TEXT NOT NULL, starts INTEGER NOT NULL, announces INTEGER, announcement TEXT NOT NULL DEFAULT 'pending', launch TEXT NOT NULL DEFAULT 'pending', cancelled INTEGER NOT NULL DEFAULT 0, error TEXT) STRICT")
  const get = id => db.prepare('SELECT * FROM raid_schedule WHERE id=?').get(id)
  const list = () => db.prepare('SELECT * FROM raid_schedule ORDER BY starts').all()
  function save(id, template, starts, lead) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(starts) || starts <= now() || (lead !== null && !LEADS.includes(lead))) throw new Error('Invalid schedule')
    const announces = lead === null ? null : starts - lead * 3600000
    if (announces !== null && announces < now()) throw new Error('Announcement time is in the past')
    db.prepare('INSERT INTO raid_schedule(id,template,starts,announces) VALUES(?,?,?,?)').run(id,JSON.stringify(template),starts,announces)
    return get(id)
  }
  function cancel(id) {
    return db.prepare("UPDATE raid_schedule SET cancelled=1 WHERE id=? AND launch='pending' AND announcement!='sending'").run(id).changes === 1
  }
  function claim(id, kind) {
    if (!['announcement','launch'].includes(kind)) throw new Error('Invalid dispatch')
    const due = kind === 'launch' ? 'starts' : 'announces'
    return db.prepare("UPDATE raid_schedule SET "+kind+"='sending' WHERE id=? AND cancelled=0 AND "+kind+"='pending' AND "+due+"<=?"+(kind==='announcement'?" AND starts>?":" AND announcement!='sending'")).run(...(kind==='announcement'?[id,now(),now()]:[id,now()])).changes===1
  }
  function finish(id, kind, success) {
    if (!['announcement','launch'].includes(kind)) throw new Error('Invalid dispatch')
    db.prepare("UPDATE raid_schedule SET "+kind+"=? WHERE id=? AND "+kind+"='sending'").run(success?'sent':'review',id)
  }
  // Telegram has no idempotency key. Ambiguous sends require manual review, not automatic replay.
  function recover() {
    db.exec("UPDATE raid_schedule SET announcement='review' WHERE announcement='sending'; UPDATE raid_schedule SET launch='review' WHERE launch='sending'")
  }
  return { get,list,save,cancel,claim,finish,recover,close:()=>db.close() }
}
module.exports = { openRaidSchedule, LEADS }
