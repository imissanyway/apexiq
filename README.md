# ApexIQ

Mobile-first Apex Legends profile hub.

## Production entry points

- `index.html` — main private-beta application
- `app.html` — compatibility redirect to the main application
- `admin.html` — iPhone/mobile admin console
- `admin-sw.js` — admin PWA service worker
- `apexiq-worker-v4.9.9.128-founder-request-cache.js` — current Cloudflare Worker
- `assets/` — approved badges, stickers, logos, and application assets
- `badge-manifest.json` — active badge manifest

## Deployment

1. Publish the repository root through GitHub Pages.
2. Deploy `apexiq-worker-v4.9.9.128-founder-request-cache.js` separately in Cloudflare Workers.
3. Fully close and reopen the installed admin app once after deploying v4.9.9.128.
