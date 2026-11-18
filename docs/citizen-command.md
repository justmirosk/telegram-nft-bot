# BeaniScrolls Citizen Card command (development)

The existing Telegram bot now registers `/citizen <wallet>` and provides an inline button linking to the public BeaniScrolls Citizen profile. This is a staged integration, **not** the complete graphical Citizen Card feature.

## Environment
- `BEANISCROLLS_URL` (optional): defaults to https://beaniscrolls.com
- `CITIZEN_CARD_IMAGE_ENDPOINT` (optional): HTTPS image endpoint accepting a `wallet` query parameter. Must return a publicly retrievable Telegram-compatible image. Leave unset until the BeaniScrolls renderer exists.

## Remaining work before enabling graphical cards
1. Build a BeaniScrolls server-side card image renderer reusing `BeaniWorldCitizenCard` and the shared citizen summary logic.
2. Ensure the renderer uses public, verified data only, with affinity visibility enforced server-side (including Thornvail).
3. Implement Telegram-user-to-wallet binding via wallet signature challenge and Telegram user ID, with expiration and replay prevention. Do not treat a Telegram username or profile social handle as wallet ownership proof.
4. Enable `/citizen` without wallet argument only after the verified binding exists.
5. Test images, links, privacy, missing profiles, and Telegram photo delivery in the private test group.

## Development testing
Run `npm test`. No production deploy is implied by this branch.
