/**
 * Service worker — appka na ploše, která se otevře i bez signálu.
 *
 * ⚠️ BĚŽÍ JEN NA WEBU. V androidím obalu se NEREGISTRUJE (viz `app.js`):
 * assety tam servíruje `WebViewAssetLoader` a service worker s vlastní cache
 * by po aktualizaci APK servíroval staré soubory — přesně tohle stálo večer
 * ladění u Gulpky.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 SÍŤ MÁ PŘEDNOST, CACHE JE ZÁCHRANNÁ SÍŤ.
 *
 * Obvyklý „cache first" je rychlejší, ale u appky bez build kroku je zrádný:
 * soubory se jmenují pořád stejně (`app.js`), takže by prohlížeč po vydání
 * opravy dál pouštěl tu starou — a nikdo by nepoznal, proč oprava „nefunguje".
 *
 * Proto se nejdřív zkusí síť a **do cache se sahá, až když selže**. Za to se
 * platí jedním kolem na síť u startu; appka je malá, takže je to znát míň
 * než den hledání, proč se změna neprojevila.
 * ────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ `/api/` se NEUKLÁDÁ VŮBEC. Předpověď stará dva dny je horší než hláška
 * „nepodařilo se načíst": o cache se stará proxy, která k datům umí přidat
 * i to, jak jsou stará (`X-MeteoTrace-Stale`). Kdyby si je držel ještě
 * service worker, servíroval by je bez téhle značky — tedy jako čerstvá.
 */

'use strict';

/** ⚠️ Změna jména = vyhození staré cache. Bumpuje se při zásahu do skořápky. */
const CACHE = 'meteotrace-v1';

/**
 * Skořápka appky. Co tady není, se z cache stejně doplní za běhu — tohle je
 * jen to, bez čeho by se po instalaci neotevřelo vůbec nic.
 */
const SKORAPKA = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  // ⚠️ `skipWaiting` je tu schválně: nový service worker má převzít hned.
  // Bez toho by na starých kartách zůstal viset ten předchozí a uživatel by
  // se k opravě dostal až po zavření všech oken appky.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SKORAPKA))
      .catch(() => { /* offline při instalaci — doplní se za běhu */ })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((jmena) => Promise.all(jmena.filter((j) => j !== CACHE).map((j) => caches.delete(j))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Cizí domény (dlaždice mapy, radar) si spravují vlastní cache prohlížeče.
  // Sahat na ně by znamenalo držet gigabajty, které nikdo nechtěl.
  if (url.origin !== self.location.origin) return;

  // 🚨 Data nikdy. Viz poznámka nahoře.
  if (url.pathname.startsWith('/api/')) return;

  // Jen čtení — POST se přes proxy stejně nepropouští (`R2`).
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((odpoved) => {
        // Uloží se jen to, co se povedlo. Chybová stránka v cache by se
        // příště tvářila jako appka.
        if (odpoved && odpoved.ok) {
          const kopie = odpoved.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie)).catch(() => {});
        }
        return odpoved;
      })
      .catch(async () => {
        const ulozene = await caches.match(e.request);
        if (ulozene) return ulozene;

        // Odkaz otevřený offline na adresu, kterou jsme nikdy neviděli:
        // ukáže se aspoň appka, ne chybová stránka prohlížeče.
        if (e.request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw new Error('offline');
      }),
  );
});
