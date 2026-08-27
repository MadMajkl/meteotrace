/**
 * Sondy do okolí — kde nejblíž prší a kde nejblíž svítí.
 *
 * ⚠️ ČISTÝ MODUL. Jen počítá souřadnice a vybírá z hotových odpovědí; sám
 * nikam nesahá.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 PROČ TO VŮBEC JDE LEVNĚ
 *
 * Open-Meteo přijímá v JEDNOM dotazu čárkou oddělený seznam souřadnic.
 * Rozeseje se tedy kolem místa pravidelná síť sond a zeptá se na ně naráz —
 * jeden dotaz, ne čtyřiadvacet. A ptáme se jen na `current`, tedy pár čísel
 * na bod; hodinová pole by byla o dva řády víc dat.
 *
 * 🚨 A PROČ TO NENÍ RADAR
 *
 * Radarové dlaždice jsou obrázky. Číst z nich, kde prší, by znamenalo
 * dekódovat pixely a hádat, co která barva znamená. Model dá totéž číslem,
 * a to i tam, kde radar nedosvítí.
 *
 * ⚠️ Sondy jsou tedy MODEL, ne měření — v hlášce se proto mluví o tom, kde
 * se déšť očekává, ne kde „je".
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { distanceM } from './eta.js';
import { jeSlunecno } from './weather-code.js';

/** Poloměr Země v metrech (stejná hodnota jako v `eta.js`). */
const R = 6371000;

/** Osm směrů, po kterých se sondy rozesílají. */
const SMERY = [
  { klic: 'n', uhel: 0 },
  { klic: 'ne', uhel: 45 },
  { klic: 'e', uhel: 90 },
  { klic: 'se', uhel: 135 },
  { klic: 's', uhel: 180 },
  { klic: 'sw', uhel: 225 },
  { klic: 'w', uhel: 270 },
  { klic: 'nw', uhel: 315 },
];

/**
 * Vzdálenosti prstenců v kilometrech.
 *
 * ⚠️ Blízký prstenec musí být dost blízko, aby odpověď dávala smysl („dvacet
 * kilometrů" je jiná informace než „sto"), a vzdálený dost daleko, aby se
 * v běžný den vůbec něco našlo. Tři prstence stačí; čtvrtý by přidal osm
 * sond a skoro žádnou novou odpověď.
 */
export const PRSTENCE_KM = [25, 60, 120];

/**
 * Prstence druhého, ŠIROKÉHO kola.
 *
 * 🚨 Michal 27. 8. 2026: *„chybí ti tam to, co jsem chtěl hlavně —
 * explicitně místo, kde nejblíže prší."* Odpověď „do 120 km nikde neprší"
 * je odpověď na jinou otázku. Když blízké okolí nic nenajde, jde se dál.
 *
 * ⚠️ Tohle kolo se ptá JEN KDYŽ blízké nic nenašlo — většinu dní tedy
 * nestojí nic.
 *
 * ⚠️ A je HRUBÉ: osm směrů na pěti stech kilometrech nechává mezery
 * stovky kilometrů široké. Věta se o tom musí vyjádřit jinak („nejbližší
 * déšť, o kterém víme"), jinak by tvrdila přesnost, kterou nemá.
 */
export const SIROKE_PRSTENCE_KM = [200, 320, 500];

/**
 * Rozeseje sondy kolem místa.
 *
 * @param {[number, number]} stred  [šířka, délka]
 * @param {number[]} [prstence]     vzdálenosti v km
 * @returns {Array<{lat: number, lon: number, dirKey: string, distanceM: number}>}
 */
export function probePoints(stred, prstence = PRSTENCE_KM) {
  const [lat, lon] = stred || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const body = [];
  for (const km of prstence) {
    for (const smer of SMERY) {
      const b = posunuty(lat, lon, km * 1000, smer.uhel);
      body.push({
        ...b,
        dirKey: smer.klic,
        distanceM: Math.round(km * 1000),
        // Prstenec si sonda nese s sebou. Po sloučení a ořezu je to jediné,
        // podle čeho se pozná, JAK DALEKO se doopravdy dohlédlo.
        prstenecKm: km,
      });
    }
  }
  return body;
}

/**
 * Bod ve vzdálenosti a směru od zadaného.
 *
 * ⚠️ Počítá se po kouli, ne v rovině: sto kilometrů na východ je v Čechách
 * o půl stupně jinde než sto kilometrů na sever, a plochý výpočet by sondy
 * postupně vychýlil.
 */
function posunuty(lat, lon, metru, uhelStupnu) {
  const d = metru / R;
  const th = (uhelStupnu * Math.PI) / 180;
  const f1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;

  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(
    Math.sin(th) * Math.sin(d) * Math.cos(f1),
    Math.cos(d) - Math.sin(f1) * Math.sin(f2),
  );

  return {
    lat: Number(((f2 * 180) / Math.PI).toFixed(4)),
    lon: Number(((((l2 * 180) / Math.PI) + 540) % 360 - 180).toFixed(4)),
  };
}

/** Kódy počasí, které znamenají srážky (WMO). */
const SRAZKY = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67,
  71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

/** Prší (nebo sněží) na tomhle bodě? */
export function jeSrazka(stav) {
  if (!stav) return false;
  if (SRAZKY.has(Number(stav.weather_code))) return true;
  return Number(stav.precipitation) > 0.1;
}

/**
 * Je tady jasno nebo skoro jasno?
 *
 * 🚨 Počítá se i „zataženo jen vysoko". Michal 27. 8. 2026 stál na slunci
 * a appka mu nabízela, že za sluncem musí sto dvacet kilometrů — protože
 * kód počasí říkal „zataženo", zatímco dole nebyl ani obláček. Kdyby se
 * závoj nezapočítal, posílala by appka lidi za sluncem tam, kde ho mají
 * nad hlavou.
 */
export function jeJasno(stav) {
  if (!stav) return false;
  return jeSlunecno({
    code: Number(stav.weather_code),
    low: stav.cloud_cover_low,
    mid: stav.cloud_cover_mid,
    high: stav.cloud_cover_high,
    direct: stav.direct_radiation,
    total: stav.shortwave_radiation,
    isDay: stav.is_day == null ? true : !!stav.is_day,
  });
}

/**
 * Nejbližší sonda, která vyhovuje podmínce.
 *
 * ⚠️ Sondy chodí zpátky v TÉMŽE POŘADÍ, v jakém se posílaly — jinak by se
 * odpověď přiřadila cizímu bodu a appka by ukázala déšť na opačné straně.
 * Volající to musí zaručit; tady se jen kontroluje počet.
 *
 * @param {Array} sondy      výstup {@link probePoints}
 * @param {Array} odpovedi   stavy ve stejném pořadí
 * @param {(stav: object) => boolean} vyhovuje
 * @returns {{lat, lon, dirKey, distanceM, stav}|null}
 */
export function nearestProbe(sondy, odpovedi, vyhovuje) {
  if (!Array.isArray(sondy) || !Array.isArray(odpovedi)) return null;
  if (sondy.length !== odpovedi.length) return null;

  let nejlepsi = null;
  sondy.forEach((s, i) => {
    if (!vyhovuje(odpovedi[i])) return;
    if (!nejlepsi || s.distanceM < nejlepsi.distanceM) nejlepsi = { ...s, stav: odpovedi[i] };
  });
  return nejlepsi;
}

/**
 * Vzdálenost mezi místem a sondou podle skutečných souřadnic.
 *
 * Prstenec říká, na jakou vzdálenost byla sonda POSLÁNA; tohle říká, jak
 * daleko doopravdy leží. Liší se to o kousek kvůli zaokrouhlení souřadnic.
 */
export function probeDistanceM(stred, sonda) {
  if (!stred || !sonda) return null;
  return Math.round(distanceM(stred, [sonda.lat, sonda.lon]));
}

/**
 * Osm směrů podle úhlu — z čísla na klíč (`n`, `ne`, …).
 *
 * ⚠️ Půl výseče se přičítá PŘED dělením, jinak by sever začínal až na nule
 * a všechno mezi 337° a 360° by spadlo na severozápad.
 */
export function bearingKey(z, do_) {
  if (!z || !do_) return '';
  const f1 = (z[0] * Math.PI) / 180;
  const f2 = (do_[0] * Math.PI) / 180;
  const dl = ((do_[1] - z[1]) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  const uhel = (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  return SMERY[Math.floor(((uhel + 22.5) % 360) / 45)].klic;
}

/** Nejbližší bod trasy k zadanému místu, i s odstupem. */
function kTrase(bod, trasa) {
  let nejlepsi = null;
  let nejmensi = Infinity;
  for (const t of trasa) {
    const d = distanceM(t, bod);
    if (d < nejmensi) { nejmensi = d; nejlepsi = t; }
  }
  return { bod: nejlepsi, metru: nejmensi };
}

/**
 * Kolik sond se pošle nejvýš.
 *
 * ⚠️ Strop je tu proto, že u dlouhé trasy by se sondy množily s každým
 * kotevním bodem. Sto sond by jedním dotazem prošlo taky, jenže odpověď by
 * byla o řád větší — a na mobilních datech se to pozná.
 */
export const MAX_SOND = 48;

/**
 * Sondy kolem CELÉ TRASY, ne kolem jednoho místa.
 *
 * 🚨 Michal 27. 8. 2026: *„tys to dal jen do místa, já to hledal tam, kde je
 * to nejdůležitější, U TRASY!"* Měl pravdu — u trasy je otázka „a kde teda
 * prší?" mnohem naléhavější než u jednoho bodu.
 *
 * Postup: po trase se rozmístí kotvy, kolem každé se rozsejí sondy jako
 * u místa, a pak se to protřídí:
 *
 * 1. **Sloučí se blízké sondy.** Kotvy na sebe vidí, takže se jejich věnce
 *    překrývají; bez slučování by se na tytéž souřadnice posílalo pětkrát.
 * 2. **Zahodí se sondy u samotné trasy.** Ty by neodpovídaly na otázku „kde
 *    jinde", jen by zopakovaly, co už o trase víme.
 * 3. **Vzdálenost i směr se počítají OD TRASY**, ne od kotvy. Věta zní
 *    „40 km na jih od trasy" — a to musí sedět vůči celé cestě, ne vůči
 *    náhodnému bodu na ní.
 *
 * @param {Array<[number, number]>} trasa  body trasy [šířka, délka]
 * @param {object} [opts]
 * @param {number} [opts.kotev]     kolik kotev po trase (výchozí 4)
 * @param {number} [opts.odstupKm]  jak blízko k trase se sondy zahazují
 * @param {number[]} [opts.prstence]
 * @returns {Array<{lat, lon, dirKey, distanceM}>}
 */
export function routeProbes(trasa, opts = {}) {
  const body = (trasa || []).filter(
    (b) => Array.isArray(b) && Number.isFinite(b[0]) && Number.isFinite(b[1]),
  );
  if (!body.length) return [];

  const kotev = Math.max(1, Math.min(opts.kotev || 4, body.length));
  const prstence = opts.prstence || PRSTENCE_KM;
  const odstupM = (opts.odstupKm ?? 20) * 1000;

  // Kotvy rovnoměrně po trase — první a poslední vždycky, ať se nepřehlédne
  // ani začátek, ani cíl.
  const kotvy = [];
  for (let i = 0; i < kotev; i += 1) {
    const idx = kotev === 1 ? 0 : Math.round((i * (body.length - 1)) / (kotev - 1));
    kotvy.push(body[idx]);
  }

  const videne = new Map();
  for (const kotva of kotvy) {
    for (const s of probePoints(kotva, prstence)) {
      // Slučovací klíč: zaokrouhlení na desetinu stupně, tedy zhruba deset
      // kilometrů. Jemnější mřížka by sousední věnce nesloučila vůbec.
      const klic = `${s.lat.toFixed(1)},${s.lon.toFixed(1)}`;
      if (videne.has(klic)) continue;

      const odtrasy = kTrase([s.lat, s.lon], body);
      if (odtrasy.metru < odstupM) continue;      // to už je prakticky trasa

      videne.set(klic, {
        lat: s.lat,
        lon: s.lon,
        dirKey: bearingKey(odtrasy.bod, [s.lat, s.lon]),
        distanceM: Math.round(odtrasy.metru),
        prstenecKm: s.prstenecKm,
      });
    }
  }

  // 🚨 OŘEZÁVÁ SE PO PRSTENCÍCH, ne podle vzdálenosti.
  //
  // Prostý „vezmi nejbližších 48" vypadá rozumně a je to past: u trasy
  // Praha–Brno se do stropu vejdou jen dva bližší prstence a ten vzdálený
  // vypadne CELÝ. Appka se pak nepodívá dál než na šedesát kilometrů — ale
  // klidně napíše „do 120 km nikde neprší". To by nebyl odhad, to by byla
  // nepravda.
  //
  // Proto se z každého prstence bere stejný díl a v každém nejbližší první.
  // Kdo je uvnitř prstence blíž trase, je i užitečnější odpověď.
  const podlePrstence = new Map();
  for (const s of videne.values()) {
    if (!podlePrstence.has(s.prstenecKm)) podlePrstence.set(s.prstenecKm, []);
    podlePrstence.get(s.prstenecKm).push(s);
  }

  const prstencu = podlePrstence.size || 1;
  const dilNaPrstenec = Math.max(1, Math.floor(MAX_SOND / prstencu));

  const vybrane = [];
  for (const [, skupina] of [...podlePrstence.entries()].sort((a, b) => a[0] - b[0])) {
    skupina.sort((a, b) => a.distanceM - b.distanceM);
    vybrane.push(...skupina.slice(0, dilNaPrstenec));
  }

  return vybrane.sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * Jak daleko se doopravdy dohlédlo.
 *
 * ⚠️ Tohle NENÍ totéž co poslední prstenec v {@link PRSTENCE_KM}. Sondy se
 * slučují a ořezávají, takže vzdálený prstenec může být zastoupený jen
 * chabě — nebo (kdyby se ořezávalo špatně) vůbec. Věta „do X km nikde
 * neprší" musí mluvit o tom, kam se opravdu podívalo, jinak tvrdí víc,
 * než kolik se ví.
 */
export function reachKm(sondy) {
  if (!Array.isArray(sondy) || !sondy.length) return 0;
  return Math.max(...sondy.map((s) => s.prstenecKm || Math.round(s.distanceM / 1000)));
}
