const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function startPublisher(bot, env = process.env) {
  if (env.PUBLISH_ENABLED !== 'true') return null;
  const key = env.PUBLISH_API_KEY || '';
  const destinations = JSON.parse(env.PUBLISH_DESTINATIONS || '{}');
  const dir = env.PUBLISH_STATE_DIR;
  if (key.length < 32 || !dir || !Object.keys(destinations).length) {
    throw new Error('Publisher requires a 32+ character key, destinations and persistent state directory');
  }
  for (const dest of Object.values(destinations)) {
    if (!dest || !/^-\d+$/.test(String(dest.chat_id)) ||
        (dest.message_thread_id !== undefined && (!Number.isSafeInteger(dest.message_thread_id) || dest.message_thread_id < 1))) {
      throw new Error('Invalid publisher destination');
    }
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const secretHash = crypto.createHash('sha256').update(`Bearer ${key}`).digest();
  const publish = async (input, reply) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400, { error: 'Invalid request' });
  const { request_id: id, destination, text, image_base64: encoded } = input;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id) ||
      typeof destination !== 'string' || !Object.hasOwn(destinations, destination) ||
      typeof text !== 'string' || !text.trim() || [...text].length > (encoded ? 1024 : 4096) ||
      Object.keys(input).some(k => !['request_id', 'destination', 'text', 'image_base64'].includes(k))) {
    return reply(400, { error: 'Invalid request, destination or text length' });
  }
  let image;
  let mime;
  if (encoded !== undefined) {
    if (typeof encoded !== 'string' || !encoded.length || (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded) || Buffer.from(encoded, 'base64').toString('base64') !== encoded)) return reply(400, { error: 'Invalid base64' });
    image = Buffer.from(encoded, 'base64');
    mime = image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : image[0] === 255 && image[1] === 216 && image[2] === 255 ? 'image/jpeg' : null;
    if (!mime || image.length > 5 * 1024 * 1024) return reply(400, { error: 'Use PNG or JPEG up to 5 MiB' });
  }
  const file = path.join(dir, `${id}.json`);
  const hash = crypto.createHash('sha256').update(JSON.stringify({ request_id: id, destination, text, ...(encoded !== undefined ? { image_base64: encoded } : {}) })).digest('hex');
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ hash, status: 'pending' })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prior.hash !== hash) return reply(409, { error: 'Request ID already used for different content' });
    return reply(prior.status === 'sent' ? 200 : 409, prior);
  }
  const target = destinations[destination];
  const options = target.message_thread_id ? { message_thread_id: target.message_thread_id } : {};
  let sent;
  try {
    sent = image
      ? await bot.sendPhoto(target.chat_id, image, { ...options, caption: text }, { filename: mime === 'image/png' ? 'announcement.png' : 'announcement.jpg', contentType: mime })
      : await bot.sendMessage(target.chat_id, text, options);
  } catch {
    // Keep pending: Telegram may have accepted a request before a network timeout.
    return reply(502, { request_id: id, status: 'pending', error: 'Delivery uncertain; check Telegram before retrying with a new ID' });
  }
  const receipt = { hash, status: 'sent', request_id: id, chat_id: sent.chat.id, message_id: sent.message_id, date: sent.date };
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(receipt), { mode: 0o600 });
  fs.renameSync(temp, file);
  return reply(200, receipt);
  };
  const handleMcp = require('./publishingMcp').createMcpHandler({ destinations, dir, publish, env });
  const oauth = require('./publishingOAuth').createPublishingOAuth(env, destinations);
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (oauth && (pathname.startsWith('/.well-known/') || ['/authorize', '/token', '/revoke', '/oauth/github/callback', '/oauth/consent'].includes(pathname))) {
      return oauth.app(req, res, () => reply(404, { error: 'Not found' }));
    }
    const supplied = crypto.createHash('sha256').update(req.headers.authorization || '').digest();
    if (oauth && pathname === '/mcp') {
      try {
        const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
        if (!bearer) throw Error();
        await oauth.provider.verifyAccessToken(bearer[1]);
      } catch {
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${oauth.metadataUrl}", scope="publish:telegram"`);
        return reply(401, { error: 'OAuth authorization required' });
      }
    } else if (!crypto.timingSafeEqual(secretHash, supplied)) return reply(401, { error: 'Unauthorized' });
    if (req.url === '/mcp' && req.headers.origin &&
        !String(env.PUBLISH_ALLOWED_ORIGINS || '').split(',').includes(req.headers.origin)) return reply(403, { error: 'Origin not allowed' });
    if (req.url === '/mcp' && req.method !== 'POST') return handleMcp(req, res);
    if (req.method !== 'POST' || !['/publish', '/mcp'].includes(req.url)) return reply(404, { error: 'Not found' });
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return reply(415, { error: 'Use application/json' });
    let bytes = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { reply(413, { error: 'Request too large' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'Invalid JSON' }); }
      if (req.url === '/mcp') return await handleMcp(req, res, input);
      return await publish(input, reply);
    } catch {
      if (!res.headersSent) reply(500, { error: 'Publisher error; check delivery before resubmitting' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(Number(env.PORT || 3000), '0.0.0.0');
  return server;
}
module.exports = { startPublisher };
