# ApexIQ Request Security v4.9.9.134

This patch hardens the public beta-request funnel without changing profile,
badge, sticker, ranked, or automatic-key-delivery behavior.

Security layers:
- Cloudflare Turnstile with mandatory server-side Siteverify validation
- Hostname and action binding
- KV-backed request rate limiting
- Persistent random browser request ID, hashed server-side
- Hashed IP and username identifiers; no raw IP storage
- Admin Block & delete action
- 180-day source blocks
- 30-day sanitized audit retention after deletion
- Security status and unblock controls in the iPhone admin app
- Existing request push notifications preserved
