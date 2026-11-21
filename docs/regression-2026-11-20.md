# Raport regresie Melio (20 nov 2026)

Metodă: harness automat în browser (`tests/browser-harness.js`), API simulat (zero cost, niciun apel către backend-ul real), plus verificare statică de traduceri (`tests/i18n-check.mjs`). Skill refolosibil: `.claude/skills/melio-regression/SKILL.md`.

## Rezultat
| Verificare | RO | EN |
|---|---|---|
| Butoane apăsate (12 ecrane + 4 modale + fluxuri) | 144 | 126 |
| Erori JavaScript | 0 | 0 |
| Erori la apăsarea butoanelor | 0 | 0 |
| Handlere `onclick` către funcții nedefinite | 0 | 0 |
| Text netradus în EN (fără benzile de reclame false) | – | 0 |
| Dicționare `_T` (177 chei), `FT` (59), `NOTIF_TXT`: paritate RO/EN | OK | OK |
| Schimbare limbă RO→EN→RO restaurează textul | da | da |
| Flux bon manual → confirmare → 6 rețete (API simulat) | OK | OK |

Build iOS în simulator: reușit, aplicația pornește (splash și ecranul de start verificate).

## Bug-uri reparate în această sesiune
**Backend (`server.js`)**
1. Litere chirilice „д" în promptul de bon ("Incluде", "incluде-l") → corectate.
2. Pozele de pe iPhone puteau veni rotite: adăugat `.rotate()` + redimensionare maximă 2000 px.
3. Log-uri care spuneau „Sonnet" pentru PDF → „Haiku".

**Frontend (`www/index.html`)**
4. Butonul „Activează notificările" apela funcții inexistente (`requestNotifPermission`, `scheduleDailyRecipe`): ReferenceError, modalul nu se închidea → definite.
5. Nume de produs neescapat în lista de ingrediente (risc XSS) → `escHtml`.
6. EN: „Continuă →" (ecranul Scan) rămânea în română → `data-i18n="continue_arrow"`.
7. EN: titlul „Rețetele tale" rămânea în română → tradus când e titlul implicit.
8. EN: banner „Ultima scanare: Manual · … · 1 produse" → cheile `last_scan`, `scan_manual/photo/digital`, `product_one/many` (cu singular/plural corect RO și EN); bannerul se actualizează la schimbarea limbii.
9. EN: butonul „Folosește aceste ingrediente →" → `data-i18n="use_ingredients"`.
10. EN: unitatea „zile" din ecranul de confirmare, din lista „alte produse" → `t('days_word')`.
11. Gramatică: „1 produse urgente" → „1 produs urgent" / „1 urgent item".
12. Mecanism nou: orice element cu `data-i18n="cheie"` urmează limba, la `translateApp`.

**iOS (pregătire)**: proiect Xcode regenerat, `Info.plist`, `PrivacyInfo.xcprivacy`, sunet, ID-uri AdMob pe platformă, limită 60 notificări, polyfill `AbortSignal.timeout`, ascundere reclame false și meniu IP pe iOS. Detalii în `docs/plan-ios-2026-11-18.md`.

## Rămase / de știut
- Benzile de „reclame" false (Jamilacuisine, FreshBox, HelloFresh, Lidl Plus, Kaufland) sunt text românesc și apar în EN dacă nu rulează bannerul real. Pe Android se ascund când AdMob afișează; pe iOS sunt ascunse. De scos definitiv când vrei.
- Comutatoarele din modalul Notificări rămân decorative (cunoscut din review-ul din octombrie).
- „Membru din Iunie 2026" fix (cunoscut).
- Data din „Ultima scanare" folosește formatul românesc (zz.ll.aaaa), neschimbat în EN; e neambiguu.
- Neverificabil fără dispozitiv: cameră/galerie, banner AdMob real, livrarea notificărilor și sunetul, tastatura peste chat, safe-area pe modale (iPhone cu notch), Realtime între două telefoane, flux cu server real.
- Frigiderul familiar a fost testat doar ca navigare și butoane, cu API simulat. Logica reală (listă, chat, push) cere server + Supabase.

## Nevoie de acțiune de la tine
1. **Deploy backend:** `server.js` (rotire imagini, prompt curat, log-uri) nu e încă pe Render. Un push = deploy în producție; nu l-am făcut.
2. **Build Android nou:** `npx cap sync` a rulat deja (android și ios au `www` actual). Mai lipsește build-ul AAB și urcarea în Play Console.
3. **Comituri:** nimic nu e comis în git (`server.js`, `www/index.html`, `ios/`, `tests/`, `docs/`, `.claude/skills/`).
