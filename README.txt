ApexIQ Admin Mobile

FILES
- admin.html
- admin-manifest.webmanifest
- admin-sw.js
- admin-icon-192.png
- admin-icon-512.png
- apexiq-worker-v4.9.9.97-admin-mobile-security.txt

DEPLOY
1. Upload admin.html, admin-manifest.webmanifest, admin-sw.js, and both icon PNGs
   into the same GitHub Pages folder as ApexIQ.
2. Deploy the included Worker update.
3. Open:
   https://imissanyway.github.io/apexiq/admin.html
4. In Safari on iPhone:
   Share -> Add to Home Screen.

LOGIN
- Email: the admin email already configured in your Worker.
- Secret: the Cloudflare secret APEXIQ_ADMIN_SECRET.
- The secret is never stored by the web app.
- Admin tokens expire after six hours.

FEATURES
- Mobile dashboard with active/disabled/device totals
- Search and filter all beta records
- Create assigned beta users
- Generate bulk disabled/unassigned access keys
- Edit username, platform, role, badge, device limit, status, and notes
- Copy access keys
- Reset device locks
- Enable or disable access
- Delete access records
- Installable iPhone PWA shell
- Session-only token storage by default

IMPORTANT
The Worker security update makes admin responses private/no-store and adds an explicit
logout endpoint. It does not alter ApexIQ player, ranked, Meta, badge, or profile behavior.
