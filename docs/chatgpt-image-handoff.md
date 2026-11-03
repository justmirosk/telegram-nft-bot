# ChatGPT artwork handoff — implementation plan

## Confirmed behavior
- `upload_image_chunk` accepts validated PNG/JPEG base64 chunks and returns `ready` after assembly.
- `publish_announcement` accepts a ready `image_upload_id` and has persistent duplicate-protected delivery receipts.
- The ChatGPT tool-orchestration runtime cannot directly read files in the image-generation container. A successful 68-byte diagnostic upload does not establish access to the generated JPEG.
- This is not a PC-versus-mobile Telegram problem.

## Non-goal
Do not add an arbitrary URL fetcher to Railway: it does not create a ChatGPT file handoff and introduces SSRF risks. Do not change production text publishing or OAuth.

## Preferred path
1. Verify a host-supported attachment/file reference argument can be passed to a connected MCP tool, including the host-side file resolver and auth semantics.
2. Only if supported, register `stage_image_attachment` with the exact supported attachment type, not a guessed URL or path.
3. Validate ownership, MIME magic, <=5 MiB size, SHA-256, and expiration; stage through the existing image-upload storage.
4. Reuse existing `publish_announcement(image_upload_id)` unchanged.
5. Test in isolation with a real generated image from mobile and desktop; check image hash and Telegram receipt.
6. Roll out behind a feature flag and retain the current chunk upload.

## If host attachment support is unavailable
Provide an explicit manual file-upload fallback, or investigate a host-provided local executor capability. Do not claim seamless generated-artwork publishing is solved.

## Acceptance criteria
- Generated image is delivered byte-identically, with its intended caption, to the explicitly approved destination.
- No publication during staging or tests.
- Text-only publishing, OAuth, idempotency, and receipt behavior remain unchanged.
- No server-side fetching of arbitrary user URLs.
