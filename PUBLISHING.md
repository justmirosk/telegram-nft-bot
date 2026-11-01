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

## Connecting ChatGPT

This API is the bot side of the integration. This chat currently has no Telegram
or general authenticated HTTP action tool. Deploying this change alone does not
make `/publish` callable from this chat. A supported custom action/connector or
MCP adapter must expose the publish operation to the chat and securely supply
the bearer secret. The HTTP endpoint itself is not an MCP server. Do not claim
end-to-end posting works until that connection and a live test are verified.

A publishing client should show the completed text, image and destination before
sending, publish only upon the user's instruction, reuse request IDs for retries,
and report the returned receipt. Creating or editing a draft is not authorization
to send it.

## Verification

`npm test` uses a fake Telegram client, local HTTP requests and temporary receipt
storage. It exercises missing authentication, disallowed destinations, text
limits, image handling, idempotency across restart, payload conflicts, ambiguous
delivery errors, and disabled/incomplete configuration. No test contacts Telegram.
