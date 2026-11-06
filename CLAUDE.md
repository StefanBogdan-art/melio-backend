# Melio

Melio (`ro.melio.app`) is an AI-powered Android app for the Romanian market. It scans supermarket receipts, keeps a virtual fridge/pantry with expiry tracking, and generates personalized recipes from the purchased ingredients. Zero-waste angle, Romanian-language content. Solo project by Bogdan, who manages the whole stack.

## How to work with Bogdan

- Reply to Bogdan in Romanian, concisely. Code, comments and identifiers stay in English; UI strings are RO/EN.
- **Surgical changes only.** Touch only what is necessary for the requested fix. No refactoring beyond the targeted change. This is a standing requirement across all sessions.
- Make the edits directly in the files instead of describing steps for him to apply by hand.
- He thinks in product and user scenarios, not technical specs. Give concrete, step-by-step guidance and correct course immediately when he points out a misalignment.
- Validate UI/flow before adding backend dependencies. Avoid premature optimization.
- Prefer verified facts over assumed details.
- Do not commit, push or deploy unless asked. Render auto-deploys on every push, so a push is a production deploy.

## Repo layout (this folder: `~/Documents/GitHub/melio-backend`)

One repo holds both the backend and the Capacitor app:

- `server.js`: Express backend (routes: `GET /api/health`, `POST /api/retete`, `POST /api/analizeaza-bon`).
- `family.js`: client and server logic for the Family Fridge (Supabase).
- `www/index.html`: the whole frontend in one file (HTML, CSS and JS, ~200 KB). `www` is Capacitor's `webDir`.
- `android/`, `ios/`: Capacitor native projects. After changing `www/`, sync with `npx cap sync android` (or `ios`).
- `supabase-schema.sql`: Family Fridge schema; run it in the Supabase SQL Editor (idempotent).
- `docs/review-2026-10-17.md`: last full app review (v1.25): what was applied, what remains.
- `melio-test.mjs`, `test-report.html`: older test script and report.
- `_to_delete/`: files set aside for removal. Leave them alone.
- `~/Documents/GitHub/Smart-kitchen-app` is an older copy (single initial commit, 30 Aug 2026). Do not use it as a source.

Remote: `github.com/StefanBogdan-art/melio-backend`. Scripts: `npm start`, `npm run dev` (nodemon).

## Stack

- **Frontend:** Capacitor/Ionic Android app (Capacitor 8), monolithic `www/index.html`, `localStorage` for client state.
- **Backend:** Node.js/Express `server.js`, deployed on Render, URL `https://melio-backend.onrender.com`.
- **AI:** Anthropic API (`@anthropic-ai/sdk`), all three calls in `server.js` use `claude-haiku-4-5-20251001` (switched from `claude-sonnet-4-6` for cost and speed, ~4x cheaper, ~3x faster). Some `console.log` strings still say "Sonnet". Recipes are cached for 7 days, with a separate cache per language. Billing at `console.anthropic.com`.
- **Family fridge:** Supabase (households, members, shopping list, chat) with Realtime. RLS is disabled on purpose; writes go through the backend with the service key. Never expose that key in the frontend.
- **Push:** `firebase-admin` and `@capacitor/push-notifications` are installed, but FCM is not enabled yet (see the review).
- **Images:** HEIC handling via `sharp` + `heic-convert`.
- **Monetization:** Google AdMob banner, publisher ID `ca-app-pub-2341403641602879`.
- **Distribution:** Google Play Console (Production plus closed testing; the internal Alpha track is used for pre-production validation).
- **Release keystore:** `melio-keystore.jks`, alias `melio`. The copy in the notes lives on the Windows PC (`C:\Users\Bodo\`). Never commit it.

## Current state (as of the 17-18 Oct 2026 review)

- Live in Google Play Production since 4 Jul 2026, with public five-star reviews from real users. Review state: v1.25, versionCode 25. Details in `docs/review-2026-10-17.md`.
- RO/EN support through the `_T` dictionary, `t()` and `translateApp` (plus `FT` for the family fridge). Server-side recipes can be returned in English.
- Expiry notifications use per-product absolute alerts on channel `melio_v2` (sound `melio_chime.wav`).
- Pending deploys noted in the review: `server.js` redeploy for English recipes, and for "Cumpăr mai târziu" the SQL `ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS later BOOLEAN DEFAULT FALSE;` (already at the end of `supabase-schema.sql`) plus a `family.js` redeploy.
- Open items: push notifications with the app closed (needs `google-services.json`, `FIREBASE_SERVICE_ACCOUNT` on Render, `window.MELIO_FCM_ENABLED = true`), decorative toggles in the Notifications modal, hardcoded "Membru din Iunie 2026", AI recipe screen not verified against a real server.

## Lessons from production

- **Additive patching:** for the monolithic `www/index.html`, appending a self-contained fix script before `</body>` is safer than editing existing functions inline, when a fix would otherwise ripple through the file.
- **Outage debugging order:** check API account status and billing before suspecting code or SDK. An HTTP 500 on recipe generation was caused by Anthropic credits running out and was first misdiagnosed as an SDK version issue.
- **AdMob position:** `TOP_CENTER` made the banner disappear on newer Android devices (reverted). Keep `BOTTOM_CENTER` and compensate with padding on `.bnav`, `s-confirm` and `flex-shrink:0` button containers.
- **Notification channels (Android 8+):** a channel's sound and importance are immutable after creation. To change them, use a new channel id and delete the old one.
- **Emoji for manual products:** `getEmoji(item.name)` with category fallbacks (`fruit → 🍱`, `veggie → 🥗`).
- **Play Console:** the 14-day/20-tester closed-testing requirement is independent of the production track and does not reset when production updates ship.
- **Cost:** recipe generation is the dominant API cost. The levers are model choice and caching.
- **Supermarkets:** no Romanian supermarket has a public API. The realistic path is MVP, then user growth, then partnership leverage.
- **Security:** `MELIO_APP_SECRET` is hardcoded in `www/index.html` and sent as the `X-Melio-App` header. It ships inside the APK, so anyone can read it; do not rely on it as real authentication.

## Roadmap (deliberately deferred)

- Shared shopping list push notifications (Firebase Cloud Messaging).
- "Next week" shopping list, separate from the current week's list.
- Meal planner + shopping cart: proposed `/api/plan-mese` endpoint as MVP, real supermarket prices later.
- iOS: `ios/` exists; needs Xcode, separate AdMob IDs, `Info.plist` permissions (camera, photos), safe-area CSS, App Store Connect.
- More languages through an AI-backed `/api/translate-ui` endpoint, with no structural change.
- Refactoring (extract CSS/JS, then modules): acknowledged as necessary but explicitly deferred. Rough guide: extract CSS/JS around 100-200 users, full modularization at 500+.
- Growth: short-form "surprise result" videos for TikTok/Instagram, with Melio as the hero. The Play Store listing converts well, so external promotion matters more than more listing tweaks.
