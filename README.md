# ApexIQ

Mobile-first Apex Legends profile hub.

## Production entry points

- `index.html` — main private-beta application
- `app.html` — compatibility redirect
- `admin.html` — mobile admin console
- `admin-sw.js` — admin PWA service worker
- `apexiq-worker-v4.9.9.129-founder-control-request-form.js` — current Cloudflare Worker
- `assets/` — application assets

## v4.9.9.129

- Founder badges are assigned per beta user from the admin panel.
- Founder badge display-case size matches other badge icons.
- Searching an unapproved profile removes the Founder badge.
- Request access opens the public request form and sends it to Admin → Requests.
