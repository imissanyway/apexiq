# ApexIQ

Mobile-first Apex Legends profile hub.

## Current production files

- `index.html`
- `admin.html`
- `admin-sw.js`
- `apexiq-worker-v4.9.9.131-auto-key-delivery-recovery.js`

## v4.9.9.131 automatic key delivery

1. A user submits the public beta-request form.
2. The browser stores a high-entropy private claim token.
3. The user receives a separate recovery code.
4. Admin taps **Accept & deliver key**.
5. The Worker generates exactly one beta key and attaches it to the request.
6. The requesting browser checks every 20 seconds and automatically signs in when approved.
7. A different browser can be linked with the request ID and recovery code.

The access key remains governed by the existing Apex username and two-device restrictions.
