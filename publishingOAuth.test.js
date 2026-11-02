const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { createPublishingOAuth, CLIENT_ID, REDIRECT_URI, SCOPE } = require('./publishingOAuth');
const { startPublisher } = require('./publisher');

test('GitHub-backed OAuth: owner restriction, browser binding, consent, PKCE, rotation, persistence and revocation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-oauth-'));
  const env = { PUBLISH_OAUTH_ENABLED: 'true', PUBLISH_STATE_DIR: dir, PUBLISH_PUBLIC_URL: 'https://publisher.example',
    GITHUB_OAUTH_CLIENT_ID: 'github-client', GITHUB_OAUTH_CLIENT_SECRET: 'github-secret', PUBLISH_GITHUB_USER_ID: '198136300' };
  let userId = 198136300, upstreamCalls = 0;
  const fetcher = async (url, opts) => {
    upstreamCalls++;
    assert.equal(opts.redirect, 'error');
    if (url.endsWith('/access_token')) {
      assert.equal(opts.body.get('client_secret'), 'github-secret');
      assert(opts.body.get('code_verifier'));
      return { ok: true, json: async () => ({ access_token: 'github-token' }) };
    }
    assert.equal(url, 'https://api.github.com/user');
    return { ok: true, json: async () => ({ id: userId }) };
  };
  const oauth = createPublishingOAuth(env, { 'nft-frens': {} }, fetcher);
  const server = http.createServer(oauth.app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const start = async (extra = {}) => {
    const query = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', state: 'chatgpt-original-state', scope: SCOPE,
      resource: oauth.resource, ...extra });
    const response = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
    return { response, redirect: response.headers.get('location'), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const callback = async (begin, cookie = begin.cookie) => fetch(`${base}/oauth/github/callback?${new URLSearchParams({ state: new URL(begin.redirect).searchParams.get('state'), code: 'upstream-code' })}`, { headers: { Cookie: cookie || '' }, redirect: 'manual' });
  const consent = async (transaction, cookie, decision = 'allow', origin = env.PUBLISH_PUBLIC_URL) => fetch(`${base}/oauth/consent`, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ transaction, decision }) });
  const token = async params => fetch(`${base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, ...params }) });
  try {
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(meta.authorization_response_iss_parameter_supported, true);
    assert.equal(meta.registration_endpoint, undefined);
    assert.equal((await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()).resource, oauth.resource);
    assert.equal((await start({ redirect_uri: 'https://evil.example/callback' })).response.status, 400);
    for (const extra of [{ resource: 'https://evil.example/mcp' }, { scope: 'repo' }]) {
      const rejected = await start(extra), target = new URL(rejected.redirect);
      assert.equal(target.origin + target.pathname, REDIRECT_URI);
      assert(target.searchParams.has('error'));
      assert.equal(target.searchParams.get('iss'), env.PUBLISH_PUBLIC_URL + '/');
    }
    const begin = await start();
    assert.equal(begin.response.status, 302);
    assert.equal(new URL(begin.redirect).origin, 'https://github.com');
    assert.equal(new URL(begin.redirect).searchParams.has('scope'), false);
    assert.match(begin.response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(begin.response.headers.get('set-cookie'), /Secure/);
    assert.equal((await callback(begin, 'wrong-cookie')).status, 400); assert.equal(upstreamCalls, 0);
    const page = await callback(begin); assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'origin');
    assert(page.headers.get('content-security-policy').includes("form-action 'self' " + REDIRECT_URI));
    const transaction = (await page.text()).match(/name="transaction" value="([^"]+)"/)[1];
    assert.equal((await callback(begin)).status, 400);
    assert.equal((await consent(transaction, begin.cookie, 'allow', 'https://evil.example')).status, 400);
    assert.equal((await consent(transaction, begin.cookie, 'allow', 'null')).status, 400);
    const approved = await consent(transaction, begin.cookie);
    assert.equal(approved.status, 302);
    const redirect = new URL(approved.headers.get('location'));
    assert.equal(redirect.origin + redirect.pathname, REDIRECT_URI);
    assert.equal(redirect.searchParams.get('state'), 'chatgpt-original-state');
    assert.equal(redirect.searchParams.get('iss'), env.PUBLISH_PUBLIC_URL + '/');
    assert.equal((await consent(transaction, begin.cookie)).status, 400);
    const args = { grant_type: 'authorization_code', code: redirect.searchParams.get('code'), redirect_uri: REDIRECT_URI, code_verifier: verifier, resource: oauth.resource };
    assert.equal((await token({ ...args, code_verifier: 'wrong'.repeat(12) })).status, 400);
    assert.equal((await token({ ...args, redirect_uri: 'https://evil.example' })).status, 400);
    const issued = await token(args); assert.equal(issued.status, 200);
    const issuedTokens = await issued.json();
    assert.equal((await token(args)).status, 400);
    let sends = 0;
    const bot = { sendMessage: async () => { sends++; } };
    const publishing = startPublisher(bot, { ...env, PUBLISH_ENABLED: 'true', PORT: '0',
      PUBLISH_API_KEY: 'a'.repeat(64), PUBLISH_DESTINATIONS: '{"nft-frens":{"chat_id":"-1001116461252"}}' });
    await once(publishing, 'listening');
    try {
      const endpoint = `http://127.0.0.1:${publishing.address().port}/mcp`;
      const anonymous = await fetch(endpoint); assert.equal(anonymous.status, 401);
      assert.match(anonymous.headers.get('www-authenticate'), /oauth-protected-resource/);
      assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } })).status, 401);
      const listed = await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + issuedTokens.access_token,
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
      assert.equal(listed.status, 200); assert.equal((await listed.json()).result.tools.length, 3);
      assert.equal(sends, 0);
    } finally { await new Promise(r => publishing.close(r)); }
    assert.equal((await oauth.provider.verifyAccessToken(issuedTokens.access_token)).clientId, CLIENT_ID);
    const restarted = createPublishingOAuth(env, { 'nft-frens': {} }, fetcher);
    await restarted.provider.verifyAccessToken(issuedTokens.access_token);
    assert.equal((await token({ grant_type: 'refresh_token', refresh_token: issuedTokens.refresh_token, scope: 'repo' })).status, 400);
    const refreshed = await (await token({ grant_type: 'refresh_token', refresh_token: issuedTokens.refresh_token, resource: oauth.resource })).json();
    assert(refreshed.access_token);
    assert.equal((await token({ grant_type: 'refresh_token', refresh_token: issuedTokens.refresh_token })).status, 400);
    await restarted.provider.revokeToken({ client_id: CLIENT_ID }, { token: refreshed.refresh_token });
    await assert.rejects(oauth.provider.verifyAccessToken(refreshed.access_token));
    await assert.rejects(oauth.provider.verifyAccessToken(issuedTokens.access_token));
    userId = 99;
    assert.equal((await callback(await start())).status, 403);
    userId = 198136300;
    const deniedBegin = await start(), deniedPage = await callback(deniedBegin);
    const deniedTx = (await deniedPage.text()).match(/name="transaction" value="([^"]+)"/)[1];
    const denied = await consent(deniedTx, deniedBegin.cookie, 'deny');
    assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'), 'access_denied');
    const records = fs.readdirSync(path.join(dir, 'oauth')).map(f => fs.readFileSync(path.join(dir, 'oauth', f), 'utf8')).join('');
    assert(!records.includes('github-secret')); assert(!records.includes('github-token')); assert(!records.includes(issuedTokens.access_token));
    assert(!records.includes(issuedTokens.refresh_token));
  } finally { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true }); }
});

test('OAuth stays disabled without an explicit enable; invalid setup fails closed', () => {
  assert.equal(createPublishingOAuth({}, {}), null);
  assert.throws(() => createPublishingOAuth({ PUBLISH_OAUTH_ENABLED: 'true', PUBLISH_PUBLIC_URL: 'http://example.com' }, {}));
});
