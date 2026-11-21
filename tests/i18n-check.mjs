// Static i18n check: node tests/i18n-check.mjs
// Parses the _T / FT / NOTIF_TXT dictionaries from www/index.html and reports key parity and untranslated EN strings.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'www', 'index.html'), 'utf8');

function grab(name) {
  const m = html.match(new RegExp('var ' + name + '\\s*=\\s*\\{'));
  if (!m) return null;
  let i = m.index + m[0].length - 1, d = 0, q = null, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++;
    if (c === '}' && --d === 0) return new Function('return (' + html.slice(i, j + 1) + ')')();
  }
}
const RO_DIA = /[ăâîșțşţĂÂÎȘȚ]/;
const RO_WORDS = /\b(rețete|retete|frigider|produs|produse|scanează|scaneaza|adaugă|adauga|șterge|sterge|salvează|salveaza|înapoi|inapoi|continuă|continua|bon|familie|cumpără|cumpara|listă|lista|mesaj|notificări|notificari|expiră|expira|zile|azi|mâine|maine|ingrediente|gătește|gateste|profil|nume|setări|setari|ajutor|închide|inchide|bună|buna)\b/i;
let problems = 0;
const bad = (m) => { problems++; console.log('  ✗ ' + m); };

for (const name of ['_T', 'FT']) {
  const d = grab(name); if (!d) { bad(name + ' not found'); continue; }
  const ro = d.ro || {}, en = d.en || {};
  console.log(`\n${name}: ${Object.keys(ro).length} RO keys, ${Object.keys(en).length} EN keys`);
  for (const k of Object.keys(ro)) if (!(k in en)) bad(`${name}.${k} missing in EN (RO: "${String(ro[k]).slice(0, 50)}")`);
  for (const k of Object.keys(en)) if (!(k in ro)) bad(`${name}.${k} missing in RO`);
  for (const k of Object.keys(en)) {
    const v = en[k];
    if (typeof v !== 'string') continue;
    if (!v.trim()) bad(`${name}.en.${k} is empty`);
    else if (RO_DIA.test(v)) bad(`${name}.en.${k} has Romanian diacritics: "${v.slice(0, 60)}"`);
    else if (RO_WORDS.test(v)) bad(`${name}.en.${k} looks Romanian: "${v.slice(0, 60)}"`);
    else if (ro[k] === v && v.length > 3 && /[a-z]{4}/i.test(v) && !/^[\W\d_]+$/.test(v)) console.log(`  ? ${name}.${k} identical RO/EN: "${v.slice(0, 50)}" (ok if a proper noun)`);
  }
  // placeholders must match
  for (const k of Object.keys(ro)) if (typeof ro[k] === 'string' && typeof en[k] === 'string') {
    const ph = s => (s.match(/\{[a-z0-9_]+\}|%s|%d/gi) || []).sort().join();
    if (ph(ro[k]) !== ph(en[k])) bad(`${name}.${k} placeholders differ: RO "${ph(ro[k])}" vs EN "${ph(en[k])}"`);
  }
}
const nt = grab('NOTIF_TXT');
if (nt) for (const k of Object.keys(nt.ro)) if (!nt.en[k]) bad('NOTIF_TXT.' + k + ' missing in EN');

// Static HTML: visible Romanian text nodes with no data-i18n/id hook (cannot be translated)
const body = html.slice(html.indexOf('<body'), html.indexOf('<script'));
const txt = [...body.matchAll(/>([^<>{}]{3,})</g)].map(m => m[1].trim()).filter(s => RO_DIA.test(s));
console.log(`\nStatic HTML text nodes with Romanian diacritics: ${txt.length} (translated at runtime by id via translateApp; verify in browser run)`);
console.log(problems ? `\n${problems} problem(s)` : '\nOK');
process.exit(problems ? 1 : 0);
