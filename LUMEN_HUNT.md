# Lumen Hunt — preview setup

This feature is committed to `feature/lumen-hunt` and is **disabled by default**. Do not merge to `main` or enable on Railway until tests and a controlled Telegram-group trial are complete.

## Configuration
- `LUMEN_HUNT_ENABLED=true` — enable commands (omit/false to disable).
- `LUMEN_HUNT_GROUP_ID=-100...` — **required for rollout** to restrict the game to the intended group. Without it, all groups containing the bot can play.
- `LUMEN_HUNT_ADMIN_IDS=12345,67890` — Telegram numeric user IDs authorized for private payout reports.
- `LUMEN_HUNT_DATA_FILE=/data/lumen-hunt.json` — persisted JSON on the Railway mounted volume.

## Commands
- Group: `/bwhunt`, `/lboard`, `/myscore`, `/huntstats`.
- Admin private chat: `/huntadmin YYYY-MM-DD` (Monday UTC week start), `/huntpaid YYYY-MM-DD TELEGRAM_USER_ID`.

`/huntpaid` only marks a manual payment as credited. It does **not** credit BeaniScrolls. Verify the citizen/wallet link and complete the actual Lumen credit first.

## Rules
One hunt per Telegram user ID per UTC date, with server-side weighted reward selection and a public edited Telegram result. Weeks run Monday 00:00 to Sunday 23:59 UTC. Top-three bonuses are 100/60/40 Lumens. Leaderboard ranking excludes bonuses. Equal scores are ordered by time of last score increase, then numeric ID. Payout reports are pending until manually marked credited.

## Validation before enabling
1. Run `npm test`; confirm no existing tests regress.
2. Deploy to a **nonproduction** Railway environment with its own bot token, Telegram test group and isolated data file/volume. Telegram long polling must not use the production bot token in two instances.
3. Verify two simultaneous button presses award once; another player's buttons cannot award; a second hunt is blocked.
4. Verify restart retains scores; UTC day and week rollover; ties; public messages; private admin report; manual credited status.
5. Confirm the volume at `/data` is backed up. JSON persistence is suitable for a single small bot instance only; migrate to transactional storage before multiple replicas or heavy usage.
6. Confirm no auto-crediting to BeaniScrolls is implied or performed.

## Known limitations
- No Telegram-to-BeaniScrolls identity linking yet; manual wallet verification is mandatory.
- No automatic weekly announcement or payout. Admin retrieves a completed week's report with `/huntadmin`.
- The JSON file assumes a single bot process. No cross-instance locking.
- The feature is isolated from the existing tournament and NFT commands.
