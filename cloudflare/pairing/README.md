# PianoCanva Cloudflare pairing
This service exchanges WebRTC connection descriptions using single-use 8-digit codes.
It never receives drawing strokes, camera video, or audio.
Codes expire after 10 minutes. Host and guest connections use separate random tokens.
Connection metadata is removed after completing pairing or by a Durable Object alarm.
One device can claim each code; guessed codes and expired sessions are rejected.
The Worker accepts only the configured PianoCanva origin and limits attempts per IP.
Rate limits are per Cloudflare location; this is an initial service, not a global abuse-proof limit.

## Deploy
Use the existing solmidollc/Pianocast repository with Cloudflare Workers Builds.
Choose the root directory cloudflare/pairing, build command npm install --no-audit --no-fund, and deploy command npm run deploy.
Set the build variable SKIP_DEPENDENCY_INSTALL=true so the custom install command is used.
The Worker name is pianocanva-pairing. The Wrangler config provisions a SQLite-backed Durable Object on the Free plan.
Do not upgrade to a paid Workers plan for this setup.
After deployment, verify the Worker URL /health, then put the HTTPS Worker URL into src/annotation/cloudflareConfig.ts.
The empty URL intentionally keeps manual pairing working until the backend is deployed.
No API token belongs in the browser bundle or repository.

Alternative: run npm install and npm run deploy within this folder with a locally authorized Wrangler login.

## User flow
PianoCanva → Annotation → Connect tablet or phone → Create pairing code.
The device can scan the QR, open the supplied link, or enter the eight digits in the companion.
The companion connects without copying a return code.
Use manual pairing if the Cloudflare service is unavailable.
Devices still need direct WebRTC connectivity (normally the same Wi-Fi). A TURN relay is separate infrastructure and is not included.
The host uses a hibernating WebSocket only to receive the connection answer; it closes after pairing.

Deployed service: https://pianocanva-pairing.solmidollc.workers.dev
