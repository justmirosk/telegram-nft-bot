// The website owns the approval/reward state and the durable notification queue.
// Reuse MiniBeany's authenticated publisher and persistent duplicate receipts.
function startArenaDelivery(env = process.env, fetcher = fetch) {
  const key = env.PUBLISH_API_KEY;
  if (env.PUBLISH_ENABLED !== 'true' || !key || key.length < 32) return null;
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      await Promise.all(['https://beaniscrolls.site', 'https://gems-testnet.beaniscrolls.site'].map(async origin => {
        try { await fetcher(origin + '/api/beast-arena/notifications', { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(50000) }); } catch { /* A durable queued event will be retried on the next poll. */ }
      }));
    } finally { busy = false; }
  };
  // No startup or connection-test publishing.
  const timer = setInterval(poll, 60000);
  timer.unref();
  return { stop: () => clearInterval(timer), poll };
}
module.exports = { startArenaDelivery };
