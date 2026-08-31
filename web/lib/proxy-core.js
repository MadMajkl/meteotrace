/**
 * Rozhodovací část proxy — co se má s dotazem stát.
 *
 * ⚠️ ČISTÝ MODUL. Nic nestahuje, nic neukládá. Dostane popis dotazu a vrátí
 * PLÁN: kam se má sáhnout, s jakými hlavičkami, pod jakým klíčem to uložit
 * a jak odpověď upravit. Vlastní `fetch` dělá až platformní obal — na Netlify
 * jeden, ve WebView druhý (`R2`).
 *
 * Díky tomu se dá celá logika proxy — včetně bezpečnostních pravidel —
 * otestovat bez sítě a bez serveru.
 */

'use strict';

import {
  isKnownService, buildUrl, upstreamHeaders, cacheKey, ttlFor, trimWarnings,
  mapParams, fromPelias, UPSTREAMS, isLocalService,
} from './upstreams.js';
import { findArea, matchWarningAreas, areaGeoJSON } from './orp.js';
import { staciNa } from './severity.js';

/** Předpona, pod kterou proxy poslouchá. */
export const API_PREFIX = '/api/';

/**
 * Rozebere cestu `/api/<služba>[/<dovětek>]`.
 *
 * Vrací `null` u čehokoli, co tomu tvaru neodpovídá — včetně hlubších cest.
 * ⚠️ Víc než jeden dovětek se odmítá schválně: každý další segment je další
 * příležitost, jak se pokusit vylézt z domény služby jinam.
 *
 * @param {string} pathname
 * @returns {{service: string, subPath: string}|null}
 */
export function parseApiPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(API_PREFIX)) return null;

  const rest = pathname.slice(API_PREFIX.length);
  if (!rest) return null;

  const parts = rest.split('/').filter((p) => p !== '');
  if (parts.length === 0 || parts.length > 2) return null;

  return { service: parts[0], subPath: parts[1] || '' };
}

/**
 * Sestaví plán dotazu, nebo popíše, proč to nejde.
 *
 * @param {object} req
 * @param {string} req.pathname
 * @param {Record<string,string>|URLSearchParams} [req.params]
 * @param {string} [req.method]
 * @param {Record<string,string>} [req.env]
 * @returns {{ok: true, service: string, url: string, headers: object, cacheKey: string, ttlS: number, dropped: string[]}
 *         | {ok: false, status: number, error: string}}
 */
export function planRequest(req) {
  const { pathname, params = {}, method = 'GET', env = {} } = req;

  // Proxy propouští jen čtení. Zápis by znamenal, že přes nás jde cizí službě
  // něco měnit — nic takového nepotřebujeme a nechceme to mít otevřené.
  if (method !== 'GET' && method !== 'HEAD') {
    return { ok: false, status: 405, error: 'Povolené je jen GET.' };
  }

  const parsed = parseApiPath(pathname);
  if (!parsed) return { ok: false, status: 404, error: 'Neznámá cesta.' };

  const { service, subPath } = parsed;
  if (!isKnownService(service)) {
    return { ok: false, status: 404, error: `Neznámá služba: ${service}` };
  }

  try {
    // ⚠️ Parametry se PŘELOŽÍ do řeči služby dřív, než se z nich skládá adresa
    // i klíč cache. Klient mluví pořád stejně (`name`, `count`) — co z toho je
    // `text` a co `size`, ví jen katalog. Výměna zdroje je pak změna v katalogu,
    // ne v obrazovce (`R0`).
    const prelozene = mapParams(service, params);

    // Místní služba se skládá u nás — nemá adresu ani hlavičky, jen klíč
    // cache. Viz `place` v katalogu.
    if (isLocalService(service)) {
      return {
        ok: true,
        service,
        localOnly: true,
        url: null,
        headers: {},
        cacheKey: cacheKey(service, prelozene, subPath),
        ttlS: ttlFor(service),
        dropped: droppedOf(service, prelozene),
        fallback: null,
      };
    }

    return {
      ok: true,
      service,
      url: buildUrl(service, prelozene, subPath),
      headers: upstreamHeaders(service, env),
      cacheKey: cacheKey(service, prelozene, subPath),
      ttlS: ttlFor(service),
      dropped: droppedOf(service, prelozene),
      // Kam sáhnout, když tenhle zdroj selže nebo nic nenajde.
      fallback: UPSTREAMS[service].fallback || null,
      // Služby, u kterých nestačí odpověď propustit: musí se zkusit víc
      // adres, nebo se odpověď skládá z archivu (nowcast ČHMÚ). Skládá je
      // pojmenovaný stavitel na serveru — katalog říká jen KTERÝ.
      builder: UPSTREAMS[service].builder || null,
    };
  } catch (e) {
    // Chybějící klíč je chyba NAŠEHO nasazení, ne uživatelova dotazu → 500.
    // Nepřípustný dovětek cesty je naopak vadný dotaz → 400.
    const isConfig = /klíč/i.test(e.message);
    return { ok: false, status: isConfig ? 500 : 400, error: e.message };
  }
}

/** Pomocná: co se z dotazu zahodilo (kvůli logu, ne kvůli chybě). */
function droppedOf(service, params) {
  // Místní služba žádnou adresu nestaví, takže se z ní nedá nic „zahodit".
  if (isLocalService(service)) return [];

  const entries = params instanceof URLSearchParams
    ? [...params.keys()] : Object.keys(params || {});
  const url = buildUrl(service, params, '');
  return entries.filter((k) => !url.includes(`${encodeURIComponent(k)}=`));
}

/**
 * Úprava odpovědi před odesláním klientovi.
 *
 * Zatím jediný případ: výstrahy se ořežou (feed má přes 1 MB, na mobilní data
 * je to moc). Ostatní služby se propouštějí beze změny — proxy má být tenká.
 *
 * @param {string} service
 * @param {any} body  rozparsovaná odpověď
 * @param {Record<string,string>} [params]
 */
export function transformBody(service, body, params = {}) {
  // Odpověď geokodéru se srovná na tvar, který appka zná z původního zdroje.
  // Díky tomu obrazovka o výměně vůbec neví.
  if (UPSTREAMS[service]?.normalize === 'pelias') return fromPelias(body);

  // 🚨 Podle KATALOGU, ne podle jména služby. Zdroje výstrah jsou dva
  // (ČHMÚ a záloha MeteoAlarm) a oba dávají týž tvar; kdyby se ořez vázal
  // na jméno `warnings`, záloha by se neořezala a klientovi by přišel
  // syrový feed. Viz `R20`.
  if (UPSTREAMS[service]?.normalize === 'warnings') {
    const lang = (params.lang || params.language || 'cs').slice(0, 2);
    return { warnings: trimWarnings(body, lang), sent: casVydani(body) };
  }
  return body;
}

/**
 * Kdy zdroj naposledy promluvil.
 *
 * 🚨 BEZ TOHO SE NEDÁ ODLIŠIT KLID OD MRTVÉHO ZDROJE. Prázdný seznam
 * výstrah znamená buď „nic nehrozí", nebo „už tři dny nic nechodí" — a to
 * jsou dvě úplně jiné zprávy. Přesně na tohle Michal 31. 8. 2026 doplatil:
 * MeteoAlarm stál od 28. 8. a appka mlčky tvrdila klid.
 *
 * ČHMÚ dává `sent` v hlavičce dokumentu; MeteoAlarm ho má u každé zprávy
 * zvlášť, tak se z nich vezme ta nejnovější.
 */
export function casVydani(body) {
  if (body?.sent) return body.sent;
  const casy = ((body && body.warnings) || [])
    .map((w) => w?.alert?.sent)
    .filter(Boolean)
    .sort();
  return casy.length ? casy[casy.length - 1] : null;
}

/**
 * Výřez odpovědi podle polohy tazatele.
 *
 * ⚠️ TOHLE SE DĚLÁ AŽ ZA CACHE, a je to podstatné. Pod klíčem cache leží
 * odpověď společná všem (celý ořezaný feed); teprve tady se z ní krájí to,
 * co se týká jednoho místa. Kdyby se ukládal až výřez, dostal by druhý tazatel
 * výstrahy prvního — a neměl by jak to poznat.
 *
 * Bez souřadnic se nefiltruje podle místa — appka může chtít i celý přehled.
 * Prošlé výstrahy se ale vyhazují vždycky.
 *
 * @param {string} service
 * @param {any} body                     odpověď po {@link transformBody}
 * @param {Record<string,string>} params
 * @param {object} [opts]
 * @param {Array} [opts.areas]  rozbalené hranice ORP (`unpackAreas`)
 * @param {number} [opts.nowMs] čas pro vyhození prošlých výstrah
 */
export function filterByPlace(service, body, params = {}, opts = {}) {
  if (service !== 'warnings') return body;

  // 🚨 Feed nese i výstrahy, které dávno skončily — v odpovědi z 22. 8. jich
  // byla víc než polovina. Ven se posílat nemají: je to zbytečný objem na
  // mobilních datech. Přesné odfiltrování dělá až klient při výpisu, protože
  // tahle odpověď se drží v cache minuty a mezitím může něco vypršet.
  const vsechny = (body && body.warnings) || [];
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : 0;
  const vystrahy = nowMs
    ? vsechny.filter((w) => {
      if (!w.expires) return true;
      const konec = new Date(w.expires).getTime();
      return Number.isNaN(konec) || konec > nowMs;
    })
    : vsechny;

  // Práh závažnosti pro upozorňování. ⚠️ Filtruje se AŽ TADY, za cache —
  // stejně jako výřez podle místa. V cache leží feed společný všem; kdyby
  // se ukládal už profiltrovaný, dostal by tazatel s nižším prahem odpověď
  // toho s vyšším a přišel by o výstrahy, aniž by se to dalo poznat.
  const podlePrahu = params.minSeverity
    ? vystrahy.filter((w) => staciNa(w.severity, params.minSeverity))
    : vystrahy;

  // Bez souřadnic se nefiltruje podle místa — appka může chtít i celý přehled.
  // Prošlé se ale vyhazují tak jako tak: jsou k ničemu v obou případech.
  const lat = Number(params.lat);
  const lon = Number(params.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ...body, warnings: podlePrahu };

  // Hranice nejsou po ruce (nezapojený obal, ořezané nasazení). Vrátit všechno
  // je lepší než zamlčet bouřku — ale MUSÍ to být poznat, jinak by se odhad
  // tvářil jako výběr. Od toho je `filtrovano`.
  if (!opts.areas || !opts.areas.length) {
    return { warnings: podlePrahu, sent: body?.sent ?? null, misto: null, pokryto: false, filtrovano: false };
  }

  const misto = findArea([lat, lon], opts.areas);

  // Bod mimo pokrytí (cizina). Prázdný seznam je správná odpověď — ale sám
  // o sobě vypadá stejně jako „nic nehrozí", což je něco úplně jiného.
  // `pokryto: false` dovolí klientovi říct, jak to je.
  if (!misto) return { warnings: [], sent: body?.sent ?? null, misto: null, pokryto: false, filtrovano: true };

  const vybrane = matchWarningAreas(podlePrahu, [misto]);
  const out = {
    warnings: vybrane,
    // ⚠️ Čas vydání jde ven vždycky — na něm stojí rozdíl mezi „je klid"
    //    a „zdroj tři dny mlčí". Viz `casVydani()`.
    sent: body?.sent ?? null,
    misto: { nazev: misto.nazev, kraj: misto.kraj },
    pokryto: true,
    filtrovano: true,
  };

  // Hranice území se přikládá jen na vyžádání (`geo=1`) a jen když je co
  // kreslit. Je to řádově kilobajty — na mobilních datech se to počítá,
  // a kdo mapu neotevře, nemá důvod to platit.
  if (params.geo === '1' && vybrane.length) {
    const cele = opts.areas.find((u) => u.nazev === misto.nazev);
    const geometrie = cele ? areaGeoJSON(cele) : null;
    if (geometrie) out.geometrie = geometrie;
  }
  return out;
}

/**
 * Hlavičky odpovědi pro klienta.
 *
 * `s-maxage` míří na CDN Netlify, `max-age` na prohlížeč. `stale-while-revalidate`
 * dovolí ukázat starší odpověď a načíst novou na pozadí — pro appku, která se
 * otevírá v autě na špatném signálu, je to znát.
 *
 * @param {object} a
 * @param {number} a.ttlS
 * @param {boolean} [a.fresh]  false = servíruje se prošlá odpověď z cache
 * @param {number} [a.ageS]
 */
export function responseHeaders({ ttlS, fresh = true, ageS = 0 }) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${ttlS}, s-maxage=${ttlS}, stale-while-revalidate=${ttlS * 4}`,
  };
  if (!fresh) {
    // Ať je na klientovi i v logu poznat, že tohle není čerstvé — jinak by se
    // stará data tvářila jako nová a nikdo by si výpadku nevšiml.
    h['X-MeteoTrace-Stale'] = '1';
    h['Age'] = String(ageS);
  }
  return h;
}

/** Tělo chybové odpovědi. Vždy JSON, ať klient nemusí hádat podle stavu. */
export function errorBody(status, message) {
  return { error: message, status };
}
