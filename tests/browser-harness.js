/* Melio browser regression harness (no network, no API cost).
 * Served from repo root; load into http://localhost:PORT/www/index.html, then:
 *   await window.__melioRegression({lang:'en'})   -> JSON report
 * Never touches the real backend: fetch/alert/confirm/prompt/open are stubbed. */
(function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var RO_DIA = /[ăâîșțşţĂÂÎȘȚ]/;
  var RO_WORDS = /\b(rețete|retete|frigider\w*|produs\w*|scanează|scaneaza|adaugă|adauga|șterge|sterge|salvează|salveaza|înapoi|inapoi|continuă|continua|bon|bonuri|familie|cumpără|cumpara|listă|lista|mesaj\w*|notificări|notificari|expiră|expira|zile|azi|mâine|maine|ingrediente|gătește|gateste|profil|nume|setări|setari|ajutor|închide|inchide|bună|buna|acasă|acasa|alege|încarcă|incarca|poză|poza|galerie|trimite|gata|nou|nouă)\b/i;
  var JS_KEYWORDS = /^(if|for|while|switch|return|function|typeof|this|event|document|window|var|let|const|new|void|catch|alert|confirm|prompt|parseInt|parseFloat|String|Number|Boolean|JSON|Math|Date|setTimeout|stopPropagation|preventDefault|querySelector|querySelectorAll|getElementById|classList|toggle|add|remove|click|focus|blur|select|stopImmediatePropagation|value|style|scrollIntoView|reload|history|location|navigator|stop|trim|toLowerCase|toUpperCase|includes|map|filter|forEach|join|slice|split|replace|indexOf|push|getItem|setItem|removeItem|closest|contains|dispatchEvent|Capacitor)$/;

  var MOCK_RECIPES = { ingrediente_corectate: [{ original: 'zzz', corectat: 'Zzz', emoji: '🥗' }], retete: [1, 2, 3, 4, 5, 6].map(function (i) { return { nume: 'Recipe ' + i, ingrediente_folosite: ['Zzz'], ingrediente_complete: ['Zzz', 'salt'], timp: '20 min', dificultate: 'Easy', calorii: 300, proteine: 20, carbohidrati: 30, grasimi: 10, pasi: ['Step one.', 'Step two.'] }; }), sugestie_completare: 'Add rice.' };
  var MOCK_BON = { produse: [{ nume: 'Zzz milk', emoji: '🥛' }, { nume: 'Zzz bread', emoji: '🍞' }] };

  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function label(el) { return ((el.innerText || el.getAttribute('aria-label') || el.title || el.value || el.id || el.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 60); }
  function leaks(text) {
    var out = [];
    text.split(/\n+/).forEach(function (l) { l = l.trim(); if (l && (RO_DIA.test(l) || RO_WORDS.test(l))) out.push(l.slice(0, 80)); });
    return out;
  }
  function snapshot() {
    var act = document.querySelector('.screen.active');
    var mods = Array.prototype.filter.call(document.querySelectorAll('.modal-overlay'), function (m) { return m.style.display && m.style.display !== 'none'; }).map(function (m) { return m.id; });
    return JSON.stringify([act && act.id, mods, act ? act.innerHTML.length : 0, Object.keys(localStorage).map(function (k) { return k + localStorage.getItem(k).length; }).join(), document.body.className, (document.getElementById('toast') || {}).innerText || '']);
  }
  function closeAllModals() { document.querySelectorAll('.modal-overlay').forEach(function (m) { m.style.display = 'none'; }); }

  window.__melioRegression = async function (opts) {
    opts = opts || {};
    var lang = opts.lang || 'ro';
    var rep = { lang: lang, js_errors: [], undefined_handlers: [], click_errors: [], no_effect: [], untranslated: [], screens: {}, modals: {}, flows: {}, buttons_total: 0, fetches: [] };
    var cur = null;
    function onErr(e) { var m = (e.message || (e.reason && (e.reason.message || e.reason)) || 'error') + ''; if (/Document is not focused/.test(m)) return; /* clipboard needs focus: harness artifact */ (cur ? rep.click_errors : rep.js_errors).push((cur ? '[' + cur + '] ' : '') + m.slice(0, 160)); }
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
    var origApi = window.API_BASE; try { API_BASE = 'http://127.0.0.1:9'; } catch (e) {} // safety net: never hit the real backend
    var origFetch = window.fetch, oa = window.alert, oc = window.confirm, op = window.prompt, oo = window.open;
    window.fetch = function (url) {
      url = String(url); rep.fetches.push(url.replace(/^https?:\/\/[^/]+/, ''));
      var body = /retete/.test(url) ? MOCK_RECIPES : /analizeaza-bon/.test(url) ? MOCK_BON : /health/.test(url) ? { status: 'ok' } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    window.alert = function () {}; window.confirm = function () { return true; }; window.prompt = function () { return null; }; window.open = function () { return null; };

    function seed() {
      var iso = function (d) { var x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      fridgeItems.length = 0;
      [['Zzz milk', -1, 'dairy'], ['Zzz bread', 0, 'other'], ['Zzz apple', 2, 'fruit'], ['Zzz rice', 30, 'other']].forEach(function (a, i) { fridgeItems.push({ id: i + 1, name: a[0], days: 5, expDate: iso(a[1]), cat: a[2] }); });
      saveFridge(); try { renderFridge(); renderHomeExpiry(); } catch (e) {}
    }
    if (opts.seed !== false) seed();
    // language
    if (typeof _lang !== 'undefined' && _lang !== lang) { toggleLanguage(); await sleep(400); }
    rep.lang_active = _lang;

    var screens = Array.prototype.map.call(document.querySelectorAll('.screen'), function (s) { return s.id; });
    var modals = Array.prototype.map.call(document.querySelectorAll('.modal-overlay'), function (m) { return m.id; });

    // 1) onclick handlers that reference undefined functions (would be a ReferenceError on click)
    var seen = {};
    document.querySelectorAll('[onclick]').forEach(function (el) {
      var code = el.getAttribute('onclick');
      (code.match(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(function (m) {
        var name = m.replace(/^[^A-Za-z_$]*/, '').replace(/\s*\($/, '');
        if (JS_KEYWORDS.test(name) || seen[name]) return;
        seen[name] = 1;
        if (typeof window[name] !== 'function') rep.undefined_handlers.push(name + '()  <- ' + label(el));
      });
    });

    // 2) every screen: text leaks + click every button
    async function audit(containerEl, key, bucket, reopen) {
      var txt = containerEl.innerText || '';
      var lk = lang === 'en' ? leaks(txt) : [];
      lk.forEach(function (l) { rep.untranslated.push(key + ': ' + l); });
      var okBtn = function (b) { return visible(b) && !b.disabled && !/toggleLanguage/.test(b.getAttribute('onclick') || ''); };
      var btns = Array.prototype.filter.call(containerEl.querySelectorAll('[onclick],button,.btn,a[href]'), okBtn);
      var seenLabels = {};
      bucket[key] = { buttons: 0, leaks: lk.length };
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        reopen();
        await sleep(40);
        var again = Array.prototype.filter.call(containerEl.querySelectorAll('[onclick],button,.btn,a[href]'), okBtn)[i];
        if (!again) continue;
        var lb = label(again), before = snapshot(), nf = rep.fetches.length;
        cur = key + ' > ' + lb;
        try { again.click(); } catch (e) { rep.click_errors.push('[' + cur + '] ' + e.message); }
        await sleep(120);
        var changed = snapshot() !== before || rep.fetches.length !== nf;
        if (!changed && !/^(a)$/i.test(again.tagName)) rep.no_effect.push(key + ' > ' + lb);
        cur = null;
        // EN text after click (modals/toasts)
        if (lang === 'en') leaks((document.body.innerText || '').split('\n').filter(function (l) { return l.length < 90; }).join('\n')).forEach(function (l) { var m = key + ' (after "' + lb + '"): ' + l; if (rep.untranslated.indexOf(m) < 0 && !rep.untranslated.some(function (u) { return u.endsWith(': ' + l); })) rep.untranslated.push(m); });
        bucket[key].buttons++; rep.buttons_total++;
        closeAllModals();
        if (_lang !== lang) { rep.click_errors.push('[' + key + ' > ' + lb + '] changed language unexpectedly'); toggleLanguage(); await sleep(300); }
      }
    }
    for (var s = 0; s < screens.length; s++) {
      if (screens[s] === 's-splash') continue;
      (function (id) { rep._reopen = function () { closeAllModals(); seed(); goTo(id); }; })(screens[s]);
      goTo(screens[s]); await sleep(150);
      await audit(document.getElementById(screens[s]), screens[s], rep.screens, rep._reopen);
    }
    for (var m = 0; m < modals.length; m++) {
      (function (id) { rep._reopen = function () { closeAllModals(); seed(); goTo('s-profile'); openModal(id); }; })(modals[m]);
      goTo('s-profile'); openModal(modals[m]); await sleep(150);
      await audit(document.getElementById(modals[m]), modals[m], rep.modals, rep._reopen);
      closeAllModals();
    }
    delete rep._reopen;

    // 3) flows with mocked API
    try {
      // language toggle round trip: text must change and come back
      goTo('s-home'); await sleep(100);
      var t1 = document.getElementById('s-home').innerText; toggleLanguage(); await sleep(400);
      var t2 = document.getElementById('s-home').innerText; toggleLanguage(); await sleep(400);
      var t3 = document.getElementById('s-home').innerText;
      rep.flows.lang_toggle_changes_text = t1 !== t2; rep.flows.lang_toggle_restores = t1 === t3;
      if (_lang !== lang) { toggleLanguage(); await sleep(300); }
      goTo('s-home'); await sleep(100);
      seed(); rep.flows.fridge_items = fridgeItems.length;
      // manual receipt -> confirm screen
      goTo('s-scan'); await sleep(100);
      var inp = document.querySelector('.manual-row input'); if (inp) inp.value = 'Zzz milk';
      await window.runManualAI(); await sleep(300);
      rep.flows.confirm_screen = document.querySelector('.screen.active').id;
      if (lang === 'en') leaks(document.getElementById('s-confirm').innerText).forEach(function (l) { rep.untranslated.push('flow confirm: ' + l); });
      await audit(document.getElementById('s-confirm'), 'flow:s-confirm', rep.screens, function () { closeAllModals(); goTo('s-confirm'); });
      // recipes (mocked API)
      rep.fetches.length = 0;
      goTo('s-result'); await window.buildAndShowRecipes([{ n: 'Zzz milk', k: 'zzz milk', e: '🥛' }, { n: 'Zzz bread', k: 'zzz bread', e: '🍞' }], t('recipes_for_you'), null, true); await sleep(1800);
      var res = document.getElementById('s-result');
      rep.flows.recipes_api_calls = rep.fetches.filter(function (u) { return /retete/.test(u); }).length;
      rep.flows.recipe_cards = (res.innerText.match(/Recipe \d/g) || []).length;
      if (lang === 'en') leaks(res.innerText).forEach(function (l) { rep.untranslated.push('flow recipes: ' + l); });
      await audit(res, 'flow:s-result', rep.screens, function () { closeAllModals(); goTo('s-result'); });
      // home after a scan (last-scan banner)
      goTo('s-home'); await sleep(200);
      if (lang === 'en') leaks(document.getElementById('s-home').innerText).forEach(function (l) { rep.untranslated.push('flow home after scan: ' + l); });
    } catch (e) { rep.flows.error = e.message; }

    window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
    window.fetch = origFetch; try { API_BASE = origApi; } catch (e) {} window.alert = oa; window.confirm = oc; window.prompt = op; window.open = oo;
    rep.fetches = rep.fetches.length;
    rep.summary = { buttons_clicked: rep.buttons_total, js_errors: rep.js_errors.length, click_errors: rep.click_errors.length, undefined_handlers: rep.undefined_handlers.length, untranslated: rep.untranslated.length, no_effect: rep.no_effect.length };
    return rep;
  };
})();
