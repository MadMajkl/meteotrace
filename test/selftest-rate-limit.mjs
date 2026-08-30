/**
 * Samotest omezovače dotazů.
 *
 * 🚨 Ochrana je obor, kde „test prošel" znamená nejmíň ze všech. Zelený test
 * ověří, že se při 100 dotazech odmítne stý — ale ne to, že se ochrana dá
 * obejít podvrženou hlavičkou, že padne na první uživatele za sdílenou IP,
 * nebo že si sama sežere paměť. Testy níž proto míří **na obejití**, ne na
 * šťastnou cestu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLimiter, createStore, originPovolen, tridaSluzby, LIMITY,
} from '../web/lib/rate-limit.js';

const T0 = Date.parse('2026-08-30T12:00:00Z');

/** Pošle `kolik` dotazů a vrátí, kolik z nich prošlo. */
function prozen(limiter, { kolik, trida = 'klic', ip = '1.2.3.4', od = T0, krokMs = 0 }) {
  let proslo = 0;
  for (let i = 0; i < kolik; i++) {
    if (limiter.zkus({ trida, ip, nowMs: od + i * krokMs }).ok) proslo++;
  }
  return proslo;
}

/* ============================================================
   ZÁKLAD
   ============================================================ */

test('do stropu se pustí, za stropem se odmítne', () => {
  const l = createLimiter({ store: createStore() });
  const mez = LIMITY.klic.zaIP.pocet;
  assert.equal(prozen(l, { kolik: mez }), mez, 'všechno pod stropem musí projít');
  assert.equal(l.zkus({ trida: 'klic', ip: '1.2.3.4', nowMs: T0 }).ok, false);
});

test('odmítnutí řekne, za jak dlouho to zkusit', () => {
  const l = createLimiter({ store: createStore() });
  prozen(l, { kolik: LIMITY.klic.zaIP.pocet });
  const v = l.zkus({ trida: 'klic', ip: '1.2.3.4', nowMs: T0 });
  assert.equal(v.ok, false);
  assert.ok(v.retryAfterS > 0 && v.retryAfterS <= LIMITY.klic.zaIP.oknoS, v.retryAfterS);
  assert.ok(v.pravidlo, 'musí být poznat, které pravidlo to zaseklo');
});

test('🚨 odmítnutý dotaz si příděl NEUKOUSNE', () => {
  // Jinak by se tazatel odmítáním sám hnal hlouběji do zákazu: každý pokus
  // by prodlužoval čekání a appka by se z toho už nedostala.
  const l = createLimiter({ store: createStore() });
  const mez = LIMITY.klic.zaIP.pocet;
  prozen(l, { kolik: mez });
  for (let i = 0; i < 50; i++) l.zkus({ trida: 'klic', ip: '1.2.3.4', nowMs: T0 });

  // Po celém okně musí být zase volno — kdyby se odmítnutí počítala, nebylo by.
  const pozdeji = T0 + LIMITY.klic.zaIP.oknoS * 1000 * 2;
  assert.equal(l.zkus({ trida: 'klic', ip: '1.2.3.4', nowMs: pozdeji }).ok, true);
});

test('po uplynutí okna se příděl vrátí', () => {
  const l = createLimiter({ store: createStore() });
  prozen(l, { kolik: LIMITY.klic.zaIP.pocet });
  const pozdeji = T0 + LIMITY.klic.zaIP.oknoS * 1000 * 2;
  assert.equal(l.zkus({ trida: 'klic', ip: '1.2.3.4', nowMs: pozdeji }).ok, true);
});

test('🚨 klouzavé okno nepustí dvojnásobek na přelomu minuty', () => {
  // Pevné okno má tuhle díru: plný příděl na konci jedné minuty a hned
  // zase na začátku druhé. Tudy by prošlo dvakrát tolik, než smí.
  const l = createLimiter({ store: createStore() });
  const mez = LIMITY.klic.zaIP.pocet;
  const oknoMs = LIMITY.klic.zaIP.oknoS * 1000;

  const konecOkna = Math.floor(T0 / oknoMs) * oknoMs + oknoMs - 1000;
  assert.equal(prozen(l, { kolik: mez, od: konecOkna }), mez);

  // Hned po přelomu: pevné okno by pustilo dalších `mez`, klouzavé skoro nic.
  const poPrelomu = konecOkna + 2000;
  const proslo = prozen(l, { kolik: mez, od: poPrelomu });
  assert.ok(proslo < mez / 2, `přes přelom prošlo ${proslo} z ${mez}`);
});

/* ============================================================
   OBEJITÍ
   ============================================================ */

test('🚨 jeden tazatel neodstřihne ostatní', () => {
  // Na mobilní síti sedí za jednou adresou celá čtvrť (CGNAT), ale i tak:
  // příděl je NA ADRESU, ne společný. Kdyby byl společný, stačil by jeden
  // člověk a appka by přestala fungovat všem.
  const l = createLimiter({ store: createStore() });
  prozen(l, { kolik: LIMITY.klic.zaIP.pocet + 20, ip: 'utocnik' });
  assert.equal(l.zkus({ trida: 'klic', ip: 'nekdo-jiny', nowMs: T0 }).ok, true);
});

test('🚨 příděly se nemíchají mezi třídami', () => {
  // Kdo vyčerpá trasy (placené), musí dál dostat předpověď a radar (zdarma).
  // Jinak by drahá služba stáhla ke dnu i tu levnou.
  const l = createLimiter({ store: createStore() });
  prozen(l, { kolik: LIMITY.klic.zaIP.pocet + 5, trida: 'klic' });
  assert.equal(l.zkus({ trida: 'klic', ip: '1.2.3.4', nowMs: T0 }).ok, false);
  assert.equal(l.zkus({ trida: 'volne', ip: '1.2.3.4', nowMs: T0 }).ok, true);
});

test('🚨 neznámá adresa nesdílí jedno počitadlo se všemi', () => {
  // Kdyby prázdná adresa byla klíč jako každý jiný, sešli by se pod ním
  // všichni, u kterých se adresu nepodařilo zjistit — a stačil by jeden,
  // aby zbytek odstřihl. Platí na ně jen celkový strop.
  const l = createLimiter({ store: createStore() });
  const proslo = prozen(l, { kolik: LIMITY.klic.zaIP.pocet + 10, ip: '' });
  assert.ok(proslo > LIMITY.klic.zaIP.pocet,
    `bez adresy má platit jen celkový strop, prošlo ${proslo}`);
});

test('celkový strop platí i na tazatele, kteří se střídají', () => {
  // Tímhle se brání rozprostřenému útoku z mnoha adres — aspoň v rámci
  // jedné instance. Že to není globální strop, je napsané v modulu.
  const l = createLimiter({ store: createStore() });
  let proslo = 0;
  for (let i = 0; i < LIMITY.klic.celkem.pocet + 50; i++) {
    if (l.zkus({ trida: 'klic', ip: `ip-${i}`, nowMs: T0 }).ok) proslo++;
  }
  assert.equal(proslo, LIMITY.klic.celkem.pocet);
});

test('🚨 paměť počitadel nesmí růst donekonečna', () => {
  // Jinak by z ochrany byla nová zranitelnost: pošli dotazy z tisíců adres
  // a instance dojde paměť. Nejhorší, co se smí stát, je zapomenuté
  // počitadlo — tedy někdo dostane víc, ne že appka spadne.
  const store = createStore({ maxKeys: 50 });
  const l = createLimiter({ store });
  for (let i = 0; i < 5000; i++) l.zkus({ trida: 'klic', ip: `ip-${i}`, nowMs: T0 });
  assert.ok(store.size <= 50, `v paměti zůstalo ${store.size} klíčů`);
});

/* ============================================================
   PŮVOD DOTAZU
   ============================================================ */

test('🚨 chybějící Origin se NEODMÍTÁ', () => {
  // Vlastní stránka ho neposílá (je to týž původ) a appka v obalu taky ne.
  // Odmítat ho by znamenalo vypnout appku všem a nechat projít jen skripty,
  // které si hlavičku napíšou — tedy přesný opak toho, oč jde.
  assert.equal(originPovolen('', ['meteotrace.com']), true);
  assert.equal(originPovolen(undefined, ['meteotrace.com']), true);
});

test('cizí stránka nad naší kvótou se odmítne', () => {
  const povolene = ['meteotrace.com', 'localhost:8099'];
  assert.equal(originPovolen('https://meteotrace.com', povolene), true);
  assert.equal(originPovolen('https://www.meteotrace.com', povolene), true);
  assert.equal(originPovolen('http://localhost:8099', povolene), true);
  assert.equal(originPovolen('https://zlodej.cz', povolene), false);
});

test('🚨 podobná adresa není naše adresa', () => {
  // Kdyby se porovnávalo „obsahuje", prošlo by `meteotrace.com.zlodej.cz`
  // i `nemeteotrace.com`. Porovnává se celý host, ne kus řetězce.
  const povolene = ['meteotrace.com'];
  assert.equal(originPovolen('https://meteotrace.com.zlodej.cz', povolene), false);
  assert.equal(originPovolen('https://nemeteotrace.com', povolene), false);
  assert.equal(originPovolen('https://meteotrace.com.evil', povolene), false);
  assert.equal(originPovolen('nesmysl', povolene), false, 'nerozebratelný původ je cizí');
});

/* ============================================================
   ZAŘAZENÍ SLUŽEB
   ============================================================ */

test('🚨 třída se odvozuje z klíče, ne z ručního seznamu', () => {
  // Kdyby se služby vypisovaly ručně, nová služba s klíčem by se do seznamu
  // zapomněla přidat a mlčky by běžela bez ochrany. Takhle je chráněná od
  // chvíle, kdy se zapíše do katalogu.
  assert.equal(tridaSluzby({ needsKey: true }), 'klic');
  assert.equal(tridaSluzby({ needsKey: false }), 'volne');
  assert.equal(tridaSluzby({}), 'volne');
  assert.equal(tridaSluzby(undefined), 'volne');
});

test('meze dávají smysl vůči kvótě ORS (2 000/den, 40/min)', () => {
  // ⚠️ Strop na tazatele musí být pod minutovým limitem ORS, jinak by
  // jediný člověk uměl vyčerpat minutovou kvótu sám.
  assert.ok(LIMITY.klic.zaIP.pocet < 40, 'jeden tazatel nesmí vyčerpat minutu ORS');
  // A denní strop na tazatele musí být hluboko pod denní kvótou, aby
  // několik lidí nevybralo celý den.
  assert.ok(LIMITY.klic.denneZaIP.pocet < 2000 / 4);
  // Volné zdroje mají mít volnější ruku než ty placené.
  assert.ok(LIMITY.volne.zaIP.pocet > LIMITY.klic.zaIP.pocet);
});
