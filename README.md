# ApexIQ

Mobile-first Apex Legends profile hub.

## Production entry points

- index.html â€” main ApexIQ web application
- dmin.html â€” mobile admin console
- $ProductionWorker â€” current Cloudflare Worker
- ssets/ â€” approved badges, stickers, logos, and application assets
- adge-manifest.json â€” active badge manifest

## Deployment

GitHub Pages serves index.html from the repository root.

Deploy the current Worker separately in Cloudflare Workers:

$ProductionWorker

Historical builds and retired Workers are stored under ackups/repo-archive/.
