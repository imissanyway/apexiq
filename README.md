# ApexIQ

Mobile-first Apex Legends profile hub.

## Current production files

- `index.html`
- `admin.html`
- `admin-sw.js`
- `apexiq-worker-v4.9.9.130-founder-persistence-request-lfg-delete.js`

## v4.9.9.130

- Founder On/Off uses a dedicated authenticated Worker endpoint.
- Admin verifies the saved Founder value immediately.
- Founder lookup no longer permanently caches a false result.
- A logged-in founder can see their own badge without waiting for KV propagation.
- Old access requests can be permanently deleted.
- Local LFG posts have individual Delete buttons.
- Deleting the last LFG post no longer allows the old storage key to restore it.
