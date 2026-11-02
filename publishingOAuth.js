const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { mcpAuthRouter, createOAuthMetadata } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidRequestError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const CLIENT_ID = 'minibeany-chatgpt';
const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
const SCOPE = 'publish:telegram';
const COOKIE = '__Host-minibeany-oauth';
const random = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const challenge = value => crypto.createHash('sha256').update(value).digest('base64url');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Single-replica persistent records. Raw access/refresh/code tokens are never saved.
class OAuthStore {
  constructor(dir) { this.dir = dir; this.sweptAt = 0; fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  file(kind, token) { return path.join(this.dir, `${kind}-${hash(token)}.json`); }
  put(kind, token, value, seconds) {
    if (Date.now() - this.sweptAt > 60000) {
      this.sweptAt = Date.now();
      for (const name of fs.readdirSync(this.dir)) {
        if (!/^[a-z]+-[a-f0-9]{64}\.json$/.test(name)) continue;
        const file = path.join(this.dir, name);
        try { if (JSON.parse(fs.readFileSync(file, 'utf8')).expires <= Date.now()) fs.unlinkSync(file); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
    const file = this.file(kind, token);
    const temp = `${file}.${random()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ ...value, expires: Date.now() + seconds * 1000 }), { mode: 0o600, flag: 'wx' });
    const fd = fs.openSync(temp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  }
  get(kind, token) {
    if (typeof token !== 'string' || token.length < 10 || token.length > 256) throw new InvalidGrantError('Invalid or expired authorization');
    let value;
    try { value = JSON.parse(fs.readFileSync(this.file(kind, token), 'utf8')); }
    catch { throw new InvalidGrantError('Invalid or expired authorization'); }
    if (value.expires <= Date.now()) { this.remove(kind, token); throw new InvalidGrantError('Invalid or expired authorization'); }
    return value;
  }
  take(kind, token) { const value = this.get(kind, token); this.remove(kind, token); return value; }
  remove(kind, token) { try { fs.unlinkSync(this.file(kind, token)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}

function createPublishingOAuth(env, destinations, fetcher = fetch) {
  if (env.PUBLISH_OAUTH_ENABLED !== 'true') return null;
  const origin = new URL(env.PUBLISH_PUBLIC_URL);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw Error('PUBLISH_PUBLIC_URL must be an HTTPS origin');
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !/^\d+$/.test(env.PUBLISH_GITHUB_USER_ID || '')) throw Error('GitHub OAuth credentials and permanent user ID required');
  const resource = new URL('/mcp', origin).href;
  const githubCallback = new URL('/oauth/github/callback', origin).href;
  const store = new OAuthStore(path.join(env.PUBLISH_STATE_DIR, 'oauth'));
  const client = { client_id: CLIENT_ID, client_name: 'MiniBeany Telegram Publisher', redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: SCOPE };
  const checkResource = r => { if (r && r.href !== resource) throw new InvalidRequestError('Invalid resource'); };
  const checkScopes = scopes => { if (scopes && scopes.some(s => s !== SCOPE)) throw new InvalidScopeError('Unsupported scope'); };
  const checkClient = (record, c) => { if (record.clientId !== c.client_id) throw new InvalidGrantError('Wrong client'); };
  const cookies = req => {
    const match = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
    return match ? match.slice(COOKIE.length + 1) : '';
  };
  const browserBound = (req, record) => {
    const cookie = cookies(req);
    if (!cookie || hash(cookie) !== record.cookieHash) throw new InvalidGrantError('Sign-in must finish in the same browser');
  };
  const tokens = (c, grantId) => {
    const access = random(), refresh = random();
    store.put('access', access, { clientId: c.client_id, grantId }, 3600);
    store.put('refresh', refresh, { clientId: c.client_id, grantId }, 30 * 86400);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: SCOPE };
  };
  const provider = {
    clientsStore: { getClient: async id => id === CLIENT_ID ? client : undefined },
    async authorize(c, params, res) {
      checkResource(params.resource); checkScopes(params.scopes);
      if (params.redirectUri !== REDIRECT_URI) throw new InvalidRequestError('Invalid redirect URI');
      const state = random(), cookie = random(), verifier = random();
      store.put('transaction', state, { clientId: c.client_id, redirectUri: params.redirectUri, state: params.state,
        codeChallenge: params.codeChallenge, verifier, cookieHash: hash(cookie) }, 600);
      res.cookie(COOKIE, cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600000 });
      const redirect = new URL('https://github.com/login/oauth/authorize');
      redirect.search = new URLSearchParams({ client_id: env.GITHUB_OAUTH_CLIENT_ID, redirect_uri: githubCallback,
        state, code_challenge: challenge(verifier), code_challenge_method: 'S256' }).toString();
      // No scopes: GitHub is used only for public identity, not repository access.
      res.redirect(redirect.href);
    },
    async challengeForAuthorizationCode(c, code) { const r = store.get('code', code); checkClient(r, c); return r.codeChallenge; },
    async exchangeAuthorizationCode(c, code, verifier, redirectUri, r) {
      checkResource(r);
      const record = store.get('code', code); checkClient(record, c);
      if (redirectUri !== record.redirectUri) throw new InvalidGrantError('Redirect URI mismatch');
      // SDK has already checked downstream PKCE before reaching this method.
      store.take('code', code);
      const grantId = random(); store.put('grant', grantId, { clientId: c.client_id, userId: env.PUBLISH_GITHUB_USER_ID }, 30 * 86400);
      return tokens(c, grantId);
    },
    async exchangeRefreshToken(c, token, scopes, r) {
      checkResource(r); checkScopes(scopes);
      const record = store.get('refresh', token); checkClient(record, c);
      store.get('grant', record.grantId); store.take('refresh', token);
      return tokens(c, record.grantId);
    },
    async verifyAccessToken(token) {
      try {
        const record = store.get('access', token), grant = store.get('grant', record.grantId);
        if (grant.userId !== env.PUBLISH_GITHUB_USER_ID || grant.clientId !== record.clientId) throw Error();
        return { token, clientId: record.clientId, scopes: [SCOPE], expiresAt: Math.floor(record.expires / 1000), resource: new URL(resource) };
      } catch { throw new InvalidTokenError('Invalid or expired access token'); }
    },
    async revokeToken(c, { token }) {
      for (const kind of ['access', 'refresh']) {
        try { const record = store.get(kind, token); checkClient(record, c); store.remove('grant', record.grantId); }
        catch (e) { if (!(e instanceof InvalidGrantError)) throw e; }
      }
    },
  };
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }); next(); });
  const options = { provider, issuerUrl: origin, resourceServerUrl: new URL(resource), scopesSupported: [SCOPE] };
  app.get('/.well-known/oauth-authorization-server', (req, res) => res.json({ ...createOAuthMetadata(options),
    token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true }));
  // RFC 9207 requires issuer identification on error responses as well.
  app.use('/authorize', (req, res, next) => {
    const redirect = res.redirect.bind(res);
    res.redirect = (...args) => {
      const index = args.length - 1;
      try {
        const target = new URL(args[index]);
        if (target.origin + target.pathname === REDIRECT_URI) { target.searchParams.set('iss', origin.href); args[index] = target.href; }
      } catch { /* SDK only redirects to a validated client URI. */ }
      return redirect(...args);
    };
    next();
  });
  app.use(mcpAuthRouter(options));
  app.get('/oauth/github/callback', async (req, res) => {
    try {
      if (typeof req.query.state !== 'string' || typeof req.query.code !== 'string' || req.query.error) throw Error();
      const record = store.get('transaction', req.query.state); browserBound(req, record);
      // Consume upstream state before network calls, preventing callback replay.
      store.take('transaction', req.query.state);
      const response = await fetcher('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
          code: req.query.code, redirect_uri: githubCallback, code_verifier: record.verifier }) });
      const upstream = await response.json();
      if (!response.ok || typeof upstream.access_token !== 'string') throw Error();
      const identity = await fetcher('https://api.github.com/user', { redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${upstream.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'MiniBeany-Publisher' } });
      const user = await identity.json();
      if (!identity.ok || String(user.id) !== env.PUBLISH_GITHUB_USER_ID) return res.status(403).send('This private publisher is restricted to its owner.');
      // Discard GitHub token. Consent grants access to this publisher, never GitHub.
      const consent = random(); store.put('consent', consent, record, 300);
      res.type('html').send(`<!doctype html><html><head><title>Connect MiniBeany Publisher</title></head><body><h1>Connect MiniBeany Telegram Publisher</h1><p>Allow ChatGPT to publish text and graphics to: ${Object.keys(destinations).map(escape).join(', ')}.</p><p>Messages must only be sent on your explicit instruction. Connecting sends no Telegram message.</p><form method="post" action="/oauth/consent"><input type="hidden" name="transaction" value="${consent}"><button name="decision" value="allow">Connect publisher</button><button name="decision" value="deny">Cancel</button></form></body></html>`);
    } catch { res.status(400).send('Sign-in failed or expired. Start Connect again.'); }
  });
  app.post('/oauth/consent', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    try {
      if (req.headers.origin !== origin.origin) throw Error();
      const record = store.get('consent', req.body.transaction); browserBound(req, record);
      store.take('consent', req.body.transaction);
      const redirect = new URL(record.redirectUri);
      if (record.state !== undefined) redirect.searchParams.set('state', record.state);
      redirect.searchParams.set('iss', origin.href);
      if (req.body.decision === 'allow') {
        const code = random(); store.put('code', code, record, 120); redirect.searchParams.set('code', code);
      } else redirect.searchParams.set('error', 'access_denied');
      res.clearCookie(COOKIE, { secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
      res.redirect(redirect.href);
    } catch { res.status(400).send('Authorization expired or invalid. Start Connect again.'); }
  });
  return { app, provider, resource, metadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', origin).href };
}
module.exports = { createPublishingOAuth, CLIENT_ID, REDIRECT_URI, SCOPE, OAuthStore };
