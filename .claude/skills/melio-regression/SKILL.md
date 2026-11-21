---
name: melio-regression
description: Use before every Melio release or after any change to www/index.html, server.js or family.js. Runs the full regression: every screen, modal and button in RO and EN, JS errors, undefined handlers, untranslated (Romanian-in-EN) text, plus mocked recipe/scan flows. No API cost.
---

# Melio regression

Run this after any frontend change and before every release (`melio-release`). It never calls the real backend: `fetch` is stubbed and `API_BASE` is pointed at a dead port.

## 1. Static i18n check (2 seconds)
```bash
cd ~/Documents/GitHub/melio-backend && node tests/i18n-check.mjs
```
Checks `_T`, `FT` and `NOTIF_TXT`: RO/EN key parity, empty EN values, Romanian diacritics or words inside EN strings, placeholder mismatches. Must print `OK`.

## 2. Browser run (every screen, modal, button)
1. Serve the repo root: `cd ~/Documents/GitHub/melio-backend && python3 -m http.server 8765 --bind 127.0.0.1 &`
2. Open `http://127.0.0.1:8765/www/index.html?v=<random>` in the built-in browser pane (random query avoids stale cache). In the page, set a profile first if the app shows onboarding: `localStorage.setItem('melio_p', JSON.stringify({name:'Test',av:'👨‍🍳'}))` then reload.
3. Load the harness and start the run WITHOUT awaiting (the whole run takes more than the 45 s tool limit, and a hidden pane is throttled):
   ```js
   await new Promise(function(res,rej){var s=document.createElement('script');s.src='/tests/browser-harness.js?'+Date.now();s.onload=res;s.onerror=rej;document.head.appendChild(s);});
   window.__repEN = null; window.__repRO = null;
   window.__melioRegression({lang:'en'}).then(function(r){window.__repEN=r; return window.__melioRegression({lang:'ro'});}).then(function(r){window.__repRO=r;});
   ```
4. Poll `JSON.stringify({en:!!window.__repEN, ro:!!window.__repRO})` every ~30 s. When done, read `window.__repEN.summary` / `.untranslated` / `.click_errors` / `.undefined_handlers` / `.flows`.

The harness seeds 4 fridge items (`Zzz ...`: expired, today, +2 days, +30 days), clicks every visible button on every `.screen` and `.modal-overlay` (skipping the language toggle, which is tested separately), runs the manual-receipt flow, the mocked 6-recipe flow, and the language round trip.

## 3. Reading the report
- **Must be 0:** `js_errors`, `click_errors`, `undefined_handlers`, `untranslated` (in the EN run), `flows.lang_toggle_*` must be `true`, `flows.recipe_cards` = 6, `flows.recipes_api_calls` = 1.
- **Known and accepted:**
  - The mock ad strips (`.admob`, "Jamilacuisine", "FreshBox", "HelloFresh"...) are Romanian placeholder ads. They are hidden by `applyAdSpacing()` when the real AdMob banner shows (Android) and by CSS on iOS.
  - `🇷🇴 Română` is the language name and is meant to stay Romanian.
  - `no_effect` is informational: emoji avatar pickers, preference chips and toggles only change classes, and empty-form submits just show an alert (stubbed).
- Share (📤) uses the clipboard, which fails with "Document is not focused" when the pane is not focused. The harness filters that.

## 4. After fixing something
Re-run both steps. If you added UI text, add the key to BOTH `_T.ro` and `_T.en` (and `FT` for the family fridge), and make sure the element is updated by `translateApp` (use `data-i18n="key"` on static elements). Then `npx cap sync android` and `npx cap sync ios`.

## Not covered (needs a device)
Camera/gallery, real AdMob banner, push/local notification delivery and sound, keyboard over chat, safe-area on modals on a notch phone, Realtime between two phones. For iOS, build with `xcodebuild` for the simulator (see `docs/plan-ios-2026-11-18.md`).
