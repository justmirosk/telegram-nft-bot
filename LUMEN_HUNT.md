# Lumen Hunt — preview setup

Lumen Hunt is disabled by default. Automatic BeaniScrolls crediting is configured separately from the game.

## Configuration
- `LUMEN_HUNT_ENABLED=true` — enable commands (omit/false to disable).
- `LUMEN_HUNT_GROUP_ID=-100...` — **required for rollout** to restrict the game to the intended group. Without it, all groups containing the bot can play.
- `LUMEN_HUNT_ADMIN_IDS=12345,67890` — Telegram numeric user IDs authorized for private payout reports.
- `LUMEN_HUNT_DATA_FILE=/data/lumen-hunt.json` — persisted JSON on the Railway mounted volume.

## Commands
- Group: `/bwhunt`, `/lboard`, `/myscore`, `/huntstats`.
- Admin private chat: `/huntadmin YYYY-MM-DD` (Monday UTC week start), `/huntpaid YYYY-MM-DD TELEGRAM_USER_ID`.

For manual weeks, verify the Citizen's linked wallet and award Lumens on BeaniScrolls before using `/huntpaid`. For automatic weeks, use `/huntadmin` to track status. Automatic weeks cannot be marked paid manually.

## Automatic BeaniScrolls credits
- Set `LUMEN_HUNT_SYNC_ORIGIN` to the canonical HTTPS BeaniScrolls host for the environment and `LUMEN_HUNT_SYNC_SECRET` to the corresponding server secret (minimum 32 characters).
- Set `LUMEN_HUNT_SYNC_START_WEEK` to a Monday in UTC. Configure the bot before the first hunt of that week. Any week with earlier manual hunts stays on the manual payout path.
- Deploy the BeaniScrolls endpoint with its database migration and corresponding secret before enabling sync on the bot.
- Positive daily rewards are queued when the hunt is saved. The top three bonus rewards are queued when the week closes. Each queued award keeps its ID across restarts and retries.
- A player's Telegram account must be linked to a BeaniScrolls wallet for credit to complete. The worker retries unlinked rewards after they link. Rewards can take several minutes to appear.

## Rules
One hunt per Telegram user ID per UTC date, with server-side weighted reward selection and a public edited Telegram result. Weeks run Monday 00:00 to Sunday 23:59 UTC. Top-three bonuses are 100/60/40 Lumens. Leaderboard ranking excludes bonuses. Equal scores are ordered by time of last score increase, then numeric ID. Payout reports show either manual payout status or automatic sync status.

## Validation before enabling
1. Run `npm test`; confirm no existing tests regress.
2. Deploy to a **nonproduction** Railway environment with its own bot token, Telegram test group and isolated data file/volume. Telegram long polling must not use the production bot token in two instances.
3. Verify two simultaneous button presses award once; another player's buttons cannot award; a second hunt is blocked.
4. Verify restart retains scores; UTC day and week rollover; ties; public messages; private admin report; manual credited status.
5. Confirm the volume at `/data` is backed up. JSON persistence is suitable for a single small bot instance only; migrate to transactional storage before multiple replicas or heavy usage.
6. Verify link-then-retry, daily rewards, weekly bonuses, and one award per reward ID in the Preview ledger. Confirm previous manual weeks are excluded.

## Known limitations
- The game does not publish a weekly announcement. The admin can retrieve a completed week's report with `/huntadmin`.
- The JSON file assumes a single bot process. No cross-instance locking.
- The feature is isolated from the existing tournament and NFT commands.
