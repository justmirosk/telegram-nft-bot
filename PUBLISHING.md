# Announcement publishing with the existing bot

This optional HTTP API runs inside the existing Node process and uses the existing
Telegram bot token. It does not start another bot, poller or service. Existing
NFT commands are unchanged. Publishing is disabled unless explicitly enabled.

## Railway setup

1. Keep the existing bot token and NFT configuration.
2. Mount a persistent Railway volume at `/data` for delivery receipts. Do not
   enable publishing with ephemeral storage: receipts prevent duplicate sends.
3. Set `PUBLISH_API_KEY` to a securely generated random secret (at least 32
   characters). Store it in Railway variables and the calling connection's secret
   storage, never in GitHub or a post.
4. Set `PUBLISH_DESTINATIONS` to a JSON object of approved aliases and numeric
   Telegram group IDs. Example:
   `{"nft-frens":{"chat_id":"-1001234567890","message_thread_id":123}}`.
   Omit `message_thread_id` for the group's general chat. Verify IDs before use.
5. Set `PUBLISH_STATE_DIR=/data/publisher` and `PUBLISH_ENABLED=true`.
6. Enable Railway HTTPS public networking for the existing service on its `PORT`.
7. Ensure the existing bot belongs to the group and may send text/photos there.
8. Connect an authenticated client, then perform a deliberately approved test.

No live message is sent by deployment or startup. GET `/health` returns only
`{"ok":true}`. Do not expose the service over unencrypted HTTP.

## API contract

POST `/publish`, with `Authorization: Bearer <secret>` and
`Content-Type: application/json`:

```json
{
  "request_id": "announcement-2026-11-01-001",
  "destination": "nft-frens",
  "text": "The final approved announcement",
  "image_base64": "<optional PNG/JPEG file bytes encoded as base64>"
}
```

Text is plain text (no Markdown parsing). Limits: 4096 Unicode code points for
text, 1024 for a photo caption, 5 MiB image, 8 MiB JSON request. For longer posts,
prepare separate explicitly approved messages with distinct IDs. Image URLs are
not accepted; clients upload bytes, avoiding arbitrary server-side URL fetching.

Success returns `status: sent`, `chat_id`, `message_id`, `date` and `request_id`.
Repeat the identical request ID and content to retrieve the existing receipt
without sending again. Changed content under an existing ID returns 409.

A timeout/error after reservation leaves the request pending, even if Telegram
may already have delivered it. Repeating it returns 409 and does not resend.
Check the actual group before creating a new ID. Never automatically retry an
uncertain delivery with a new ID. Back up the persistent volume; receipts must
not be deleted while old request IDs might be retried. Keep one service replica.

## Connecting ChatGPT privately

The same authenticated listener now serves a stateless Streamable HTTP MCP
endpoint at `/mcp`, using the official MCP SDK. It creates no additional bot,
poller, server listener or Railway service. The existing `/publish` contract
is preserved. Both routes share validation and persistent delivery receipts.

MCP tools:
- `list_destinations`: read approved aliases without sending.
- `get_publish_receipt`: read a receipt by request ID without sending.
- `publish_announcement`: send approved text/PNG/JPEG bytes, with
  `user_instructed_publish: true` required. This is declared a write action
  (`readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: true`).

The caller's boolean cannot independently prove human approval. The private
plugin skill requires explicit user instruction for each final announcement.
Use the host's ask-for-approval permission for the publishing tool. Never enable
automatic publishing based on drafting, graphic generation or group content.

Authentication is `Authorization: Bearer <PUBLISH_API_KEY>`. The private plugin
declares API-key authentication so the host stores the credential separately.
Never use the Telegram bot token as the publishing key. Never put either token
in chat, the package, logs, a repository or URL parameters. This bearer key grants
access to all configured destinations: keep the plugin private and rotate the
key in both Railway and host connection storage if exposed.

MCP browser requests with an Origin header are denied by default. If a verified
host requires one, set `PUBLISH_ALLOWED_ORIGINS` to exact comma-separated HTTPS
origins; never use a wildcard. Server-to-server requests without Origin work.

### Finish connection

1. Configure the existing service as described above: persistent volume, random
   publishing secret, verified destination aliases and group/topic IDs, one
   replica, and HTTPS public networking. Set a consistent listener/domain port.
   Do not change or replace the existing Telegram bot token.
2. Deploy this branch through the existing repository/service. Verify a terminal
   successful deployment, unauthenticated `/mcp` returns 401, then authenticated
   MCP initialization and tool discovery. Do not call the send tool to test auth.
3. The private package source is in
   `plugins/minibeany-telegram-publisher/`. With the publishing key supplied
   through a secure environment, run:
   `python3 package-publishing-plugin.py https://<verified-service-host>/mcp`.
   This only initializes and lists tools, then writes a private plugin ZIP with
   the verified endpoint and API-key auth declaration, never the secret.
4. Save that archive using Plugin Creator's `create_plugin` when available,
   install the returned private plugin, and enter the publishing key through the
   host's credential UI. Do not claim connection complete until its tools appear.
5. List destination aliases and inspect receipts read-only. Only after the user
   explicitly instructs a particular test post should any live send be attempted.

Image inputs are exact PNG/JPEG bytes in `image_base64`. No server-side URL
fetching or local filesystem paths are accepted. The current MCP adapter does
not implement ChatGPT attachment/file-resolution Extensions. A host capable of
passing exact image bytes can send graphics; an attachment-only host needs that
additional file-transfer capability before image publishing can be claimed.

The service remains disabled unless `PUBLISH_ENABLED=true`. Startup,
initialization, tool discovery, read-only receipt checks and packaging send no
Telegram messages.

## Verification

`npm test` uses a fake Telegram client, local HTTP requests and temporary receipt
storage. It exercises missing authentication, disallowed destinations, text
limits, image handling, idempotency across restart, reordered JSON fields, 4 MiB uploads, MCP discovery and tool calls, explicit-send
argument validation, payload conflicts, ambiguous
delivery errors, and disabled/incomplete configuration. No test contacts Telegram.

## Browser-compatible GitHub OAuth (v0.2)

The optional OAuth upgrade runs in the same existing bot process/listener.
It is disabled by default, preserving the deployed API-key connection until
the GitHub application has been registered. When enabled, /mcp accepts only
publisher OAuth access tokens; the API key remains restricted to /publish.
ChatGPT never receives the GitHub app secret or a GitHub access token.

Create a GitHub OAuth application with:
- Application name: MiniBeany Telegram Publisher
- Homepage: https://zealous-optimism-production-5324.up.railway.app
- Authorization callback:
  https://zealous-optimism-production-5324.up.railway.app/oauth/github/callback
- Device flow: leave disabled.

Enter the GitHub client ID and generated client secret directly in the existing
Railway service variables as GITHUB_OAUTH_CLIENT_ID and
GITHUB_OAUTH_CLIENT_SECRET. Do not paste the secret into chat or GitHub source.
Then configure PUBLISH_PUBLIC_URL to the HTTPS origin above,
PUBLISH_GITHUB_USER_ID=198136300 (verified owner justmirosk), and
PUBLISH_OAUTH_ENABLED=true. Keep the existing receipt volume and one replica.

The GitHub app requests no repository scope. It fetches /user only to compare
the permanent ID. The temporary GitHub token is discarded, and the browser
shows a separate publisher consent screen. Completing connection never sends
a Telegram message.

The MCP authorization server uses the official SDK with a statically registered
public client:
- client ID: minibeany-chatgpt
- token endpoint authentication: none (S256 PKCE is mandatory)
- ChatGPT callback: https://chatgpt.com/connector_platform_oauth_redirect
- scope: publish:telegram
- metadata: /.well-known/oauth-authorization-server
- protected resource metadata: /.well-known/oauth-protected-resource/mcp

It advertises RFC 9207 issuer identification and includes the issuer on
authorization responses. Both OAuth legs use PKCE. Upstream GitHub state and
publisher consent are one-time, short-lived and bound to an HttpOnly Secure
SameSite=Lax browser cookie. Publisher access tokens last one hour; refresh
tokens rotate and grant lifetimes are limited to thirty days. Revocation
invalidates the whole grant. Codes and raw access/refresh tokens are not stored;
receipt-volume OAuth records use hashed filenames and owner-only permissions.
GitHub tokens and the app secret are not written to this state directory.

After activation, verify metadata, the unauthenticated 401 challenge and the
full sign-in flow. Package the plugin using --oauth and create it privately
through Plugin Creator. Select OAuth with the provided public client ID above,
not the GitHub client ID. Use the GitHub app credentials only in Railway.
Authenticated live discovery remains pending until the owner completes Connect.
Do not call publish_announcement as an authentication test.
