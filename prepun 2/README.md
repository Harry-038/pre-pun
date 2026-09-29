# PrePun League backend

Runs on Node 18+ with no installs. Data lives in `data/` (db.json + videos/) - back this folder up.

## Run
    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-password' SECRET='random-64-chars' node server.js
Open http://localhost:3000. Run `npm test` to check the API (13 tests).

## Environment
- SECRET: signs login tokens. Required in production.
- ADMIN_EMAIL / ADMIN_PASSWORD: creates the first admin on first start.
- DEV_PAY=1: lets gyms "pay" without a gateway. Use for testing only.
- WEBHOOK_SECRET: your payment gateway signs webhook calls to POST /api/webhook/payment
  with HMAC-SHA256 of the raw body in the x-signature header. Body: {"adId":"..."}.
  (Only needed if you use a gateway - see "Getting paid" below.)
- UPI_ID / UPI_NAME: your VPA (e.g. yourbusiness@okhdfcbank) and the display name shown
  in the gym's UPI app. Set these to accept ad payments by UPI - see "Getting paid" below.
- DATA_DIR, PORT: optional.

## Getting paid
Two ways to collect ad payments, and you can offer either or both:

**A. Your own UPI ID (fastest to set up, manual)**
Set UPI_ID (and optionally UPI_NAME). Once you approve a gym's ad request, the app shows
them a UPI QR code and an "Open in a UPI app" link with the amount pre-filled. The gym pays,
then taps "I've paid". Nothing is verified automatically - check your bank app or UPI app
for the payment, then press "Confirm payment received" on the Ads & payments admin screen.
The ad is scheduled the moment you confirm. Because this is manual, a gym could tap "I've
paid" before actually paying - always check your bank before confirming.

**B. A payment gateway (Razorpay etc., automatic)**
Set WEBHOOK_SECRET and point the gateway's webhook at POST /api/webhook/payment. You'll
still need to add a page where the gym is sent to the gateway's checkout - that part isn't
built yet since it depends on which gateway and your account keys. Ask to have it added
once you have test API keys.

## Deploy
Any host with a persistent disk (Render, Railway, Fly.io, a VPS). Put HTTPS in front (the host or Caddy/nginx).
Mount the disk at DATA_DIR. Start command: `node server.js`.

## Frontend
`public/index.html` is the real app: sign up, log in, and every screen calls this API.
It's a glassmorphism/prism theme (frosted panels over a purple-pink-cyan glow).
It's served automatically at `/` by this server, so deploying the backend deploys the site too.
If you ever host the page somewhere else, click the "API server" link on the login screen
to point it at your backend's URL (saved per-browser).

## Not done yet
- No payment gateway checkout page yet: create the gateway order for an ad, and point its webhook here.
- No email verification or password reset, no video streaming ranges (seek/scrub), no AI features.
- The home tab's daily log (workout/food/weight) is kept per-device for the progress-card image; it isn't saved to the account yet.
