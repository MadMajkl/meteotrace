/**
 * Bouřka z radaru ČHMÚ — upozornění i tehdy, když oficiální výstraha
 * nepřijde (`R37`).
 *
 * ⚠️ ČISTÝ MODUL. Žádná síť, žádné DOM, žádné rozbalování. Server sem
 * pošle už přečtené pixely (`png-index.js`), tady se z nich rozhoduje.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO VZNIKLO
 *
 * 8. 10. 2026 kolem 16:00 přešla přes Horšovský Týn bouřka. ČHMÚ pro celý
 * Plzeňský kraj nevydal žádnou výstrahu, model bouřku neviděl ani zpětně —
 * a upozornění stála jen na výstrahách. Radar ji přitom viděl celou:
 * jádro ≥ 48 dBZ v 15:10 38 km daleko, v 15:50 6 km, v 16:00 nad městem.
 *
 * DVA ZDROJE, KAŽDÝ NA NĚCO JINÉHO
 *
 *   · **pozorování** (`z_max3d`, po 5 min) říká, ŽE JE TO BOUŘKA —
 *     souvislé jádro ≥ 48 dBZ, viděné dvakrát po sobě;
 *   · **předpověď ČHMÚ** (`fct_z_max`, +10 až +60 min) říká, ŽE TO JDE SEM.
 *
 * 🚨 O síle se NEROZHODUJE z předpovědi. Extrapolace jádra rozmazává:
 * 8. 10. čekala u Týna 40 dBZ, přišlo 52. Práh „≥ 44 v předpovědi" by
 * bouřku ohlásil pozdě a v obyčejném dešti zvonil zbytečně (ověřeno).
 *
 * KALIBRACE (10. 10. 2026, `tools/bourka-kalibrace.mjs` nad tímhle kódem,
 * data ČHMÚ 8. a 10. 10., 1 275 bodů po Česku): 86 % zásahů bouřkou
 * ohlášeno aspoň 10 min předem, medián předstihu 38 min, 4 z 203 vůbec
 * (buňka vznikla přímo nad místem); v dešti bez bouřek nula upozornění;
 * 35 % upozornění skončí bez jádra do 20 km (~18 %, když se za oprávněné
 * počítá i silný déšť, který pak přišel). ⚠️ Byla to jediná bouřková situace v týdnu —
 * na letních bouřkách se prahy musí přeměřit. Postup v `03-vyvoj-progress.md`.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { VYREZ, NEJSTARSI_BEH_MS } from './nowcast.js';
import { t, tf } from './i18n.js';
import { isUsablePoint } from './geo-query.js';

/** Povinná citace zdroje (CC BY 4.0). */
export const ZDROJ = 'ČHMÚ';
export const LICENCE = 'CC BY 4.0';

/** Rozměr snímků ČHMÚ (`pacz2gmaps3`): 1 km na pixel, webový Mercator. */
export const SIRKA = 680;
export const VYSKA = 460;

/**
 * Barevná stupnice ČHMÚ: index v paletě, barva, dBZ (dolní mez třídy).
 *
 * 🚨 Čte se podle INDEXU, ne podle barvy. Paleta má bílou `#fcfcfc`
 * dvakrát — jednou jako 60 dBZ, jednou na začátku šedé škály, kterou
 * snímky používají pro okolí. Podle barvy by se šedá plocha četla jako
 * nejsilnější bouřka. Index se ale ověřuje barvou (`tabulkaOdrazivosti`):
 * když ČHMÚ paletu přestaví, radši nevědět nic než číst nesmysl.
 * Ověřeno 10. 10. 2026 na `z_max3d` i `fct_z_max`.
 */
export const STUPNICE = [
  [181, 'fcfcfc', 60], [182, 'a00000', 56], [183, 'fc0000', 52], [184, 'fc5800', 48],
  [185, 'fc8400', 44], [186, 'fcb000', 40], [187, 'e0dc00', 36], [188, '9cdc00', 32],
  [189, '34d800', 28], [190, '00bc00', 24], [191, '00a000', 20], [192, '006cc0', 16],
  [193, '0000fc', 12], [194, '3000a8', 8], [195, '380070', 4],
];

/** Jádro bouřky: tolik dBZ a víc… */
export const PRAH_JADRA = 48;
/** …a kolem něj (okno 5 × 5 px) aspoň `OKOLI_MIN` pixelů s `PRAH_OKOLI` a víc. */
export const PRAH_OKOLI = 44;
export const OKOLI_MIN = 5;

/** Kolik dBZ v předpovědi znamená „sem dorazí silné srážky". */
export const PRAH_PREDPOVEDI = 40;

/** Jak daleko smí být jádro teď a před pěti minutami. */
export const DOSAH_JADRA_KM = 50;
export const DOSAH_JADRA_PREDTIM_KM = 55;
/** Jádro už u místa: bez předpovědi, jen dvakrát po sobě takhle blízko. */
export const BLIZKO_KM = 3;
export const BLIZKO_PREDTIM_KM = 8;
/** Okruh kolem místa, ve kterém se hledají srážky z předpovědi. */
export const OKRUH_PREDPOVEDI_KM = 6;

/**
 * Jak dlouho po ohlášené bouřce mlčet.
 *
 * ⚠️ Rozhoduje server, obal jen porovnává čas (`R37`). Počítá se od
 * POSLEDNÍHO hlášení bouřky, ne od zazvonění: dokud bouřka trvá, mlčí se,
 * a nová se ohlásí až po dvou hodinách klidu. Bez toho by kolísání kolem
 * prahu zvonilo každou čtvrthodinu — a takový kanál si člověk vypne.
 */
export const TICHO_MIN = 120;

/** Pozorování starší než tohle už o „teď" nic neříká. */
export const NEJSTARSI_POZOROVANI_MS = 20 * 60_000;

/** Druhy odpovědi. `nevim` a `mimo` NEJSOU klid — viz `bourkaProMisto`. */
export const STAVY = ['bourka', 'klid', 'mimo', 'nevim'];

const dd = (n) => String(n).padStart(2, '0');

/**
 * Jméno snímku pozorování. 🚨 Časy jsou UTC, jako u předpovědi
 * (`nazevBehu` v `nowcast.js`).
 */
export function nazevSnimku(ms) {
  const d = new Date(Math.floor(ms / 300_000) * 300_000);
  return `pacz2gmaps3.z_max3d.${d.getUTCFullYear()}${dd(d.getUTCMonth() + 1)}${dd(d.getUTCDate())}` +
    `.${dd(d.getUTCHours())}${dd(d.getUTCMinutes())}.0.png`;
}

/**
 * Index palety → dBZ (0 = bez ozvěny nebo nic, co by bylo odrazivostí).
 *
 * @param {Uint8Array} paleta  trojice RGB z `prectiPng`
 * @returns {Uint8Array}       256 hodnot
 */
export function tabulkaOdrazivosti(paleta) {
  const dbz = new Uint8Array(256);
  for (const [i, hex, z] of STUPNICE) {
    const barva = [paleta?.[3 * i], paleta?.[3 * i + 1], paleta?.[3 * i + 2]]
      .map((b) => (b ?? 256).toString(16).padStart(2, '0')).join('');
    if (barva !== hex) {
      throw new Error(`Paleta radaru se změnila: index ${i} má barvu #${barva}, čekala se #${hex} (${z} dBZ).`);
    }
    dbz[i] = z;
  }
  return dbz;
}

/**
 * Souvislá jádra bouřek: pixel ≥ 48 dBZ, kolem kterého je dost silných.
 *
 * ⚠️ Jednotlivý pixel nestačí. Ojedinělé „jádro" se v dešti objeví na
 * jednom snímku a na dalším není — bez souvislosti a bez potvrzení dalším
 * snímkem hlásila kalibrace v obyčejném dešti 22–51 bouřek.
 *
 * @returns {Array<[number, number, number]>} `[x, y, dBZ]`
 */
export function souvislaJadra(pixely, dbz, sirka = SIRKA, vyska = VYSKA) {
  const out = [];
  for (let i = 0; i < pixely.length; i++) {
    const z = dbz[pixely[i]];
    if (z < PRAH_JADRA) continue;
    const x0 = i % sirka;
    const y0 = (i - x0) / sirka;
    let n = 0;
    for (let y = Math.max(0, y0 - 2); y <= Math.min(vyska - 1, y0 + 2); y++) {
      for (let x = Math.max(0, x0 - 2); x <= Math.min(sirka - 1, x0 + 2); x++) {
        if (dbz[pixely[y * sirka + x]] >= PRAH_OKOLI) n++;
      }
    }
    if (n >= OKOLI_MIN) out.push([x0, y0, z]);
  }
  return out;
}

/**
 * Kam podle předpovědi dorazí silné srážky a kdy poprvé.
 *
 * @param {Array<{minut: number, pixely: Uint8Array}>} snimky
 * @returns {Array<[number, number, number]>} `[x, y, minut]` — první snímek s ≥ 40 dBZ
 */
export function stopaPredpovedi(snimky, dbz, sirka = SIRKA) {
  const prvni = new Map();
  for (const s of [...(snimky || [])].sort((a, b) => a.minut - b.minut)) {
    for (let i = 0; i < s.pixely.length; i++) {
      if (dbz[s.pixely[i]] >= PRAH_PREDPOVEDI && !prvni.has(i)) prvni.set(i, s.minut);
    }
  }
  return [...prvni].map(([i, minut]) => [i % sirka, Math.floor(i / sirka), minut]);
}

/**
 * Bod → pixel (desetinný). Webový Mercator přes `VYREZ` z `nowcast.js`.
 * @returns {{x: number, y: number}|null} `null` mimo snímek
 */
export function pixelBodu(lat, lon, vyrez = VYREZ, sirka = SIRKA, vyska = VYSKA) {
  const my = (f) => Math.log(Math.tan(Math.PI / 4 + (f * Math.PI) / 360));
  const x = ((lon - vyrez.zapad) / (vyrez.vychod - vyrez.zapad)) * sirka;
  const y = ((my(vyrez.sever) - my(lat)) / (my(vyrez.sever) - my(vyrez.jih))) * vyska;
  if (!(x >= 0 && y >= 0 && x < sirka && y < vyska)) return null;
  return { x, y };
}

/**
 * Kolik km má pixel na dané šířce. Mercator je úhlojevný, takže svisle
 * stejně jako vodorovně — od 1,04 km na jihu po 0,96 km na severu Česka.
 */
export function kmNaPixel(lat, vyrez = VYREZ, sirka = SIRKA) {
  return ((vyrez.vychod - vyrez.zapad) / sirka) * 111.32 * Math.cos((lat * Math.PI) / 180);
}

const STRANY = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Odkud: světová strana jádra viděná z místa. */
function strana(dx, dy) {
  const stupne = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return STRANY[Math.round((((stupne % 360) + 360) % 360) / 45) % 8];
}

/** Nejbližší pixel ze seznamu (střed pixelu, ne roh). */
function nejblizsi(seznam, bod) {
  let nej = null;
  for (const p of seznam || []) {
    const d = Math.hypot(p[0] + 0.5 - bod.x, p[1] + 0.5 - bod.y);
    if (!nej || d < nej.d) nej = { d, p };
  }
  return nej;
}

/**
 * Hrozí místu bouřka?
 *
 * 🚨 `nevim` a `mimo` nejsou `klid`. Starý radar, chybějící předpověď
 * nebo místo za okrajem snímku se NESMÍ tvářit jako „nic se neblíží" —
 * přesně to se stalo s MeteoAlarmem (`R20`).
 *
 * @param {object} digest  výstup stavitele (`server/chmi-storm.js`)
 * @param {{lat: number, lon: number, nowMs: number}} kde
 * @returns {{stav: string, za?: number, km?: number, smer?: string, sila?: number, duvod?: string}}
 */
export function bourkaProMisto(digest, { lat, lon, nowMs }) {
  if (!isUsablePoint({ lat, lon })) return { stav: 'nevim', duvod: 'Chybí místo.' };
  if (!digest || !Array.isArray(digest.jadra) || !Array.isArray(digest.jadraPredtim)) {
    return { stav: 'nevim', duvod: digest?.duvod || 'Radar se nepodařilo načíst.' };
  }
  if (!(nowMs - digest.pozorovanoMs <= NEJSTARSI_POZOROVANI_MS)) {
    return { stav: 'nevim', duvod: 'Snímek radaru je starý.' };
  }
  const stopaPlati = Array.isArray(digest.stopa) && nowMs - digest.behMs <= NEJSTARSI_BEH_MS;

  const vyrez = digest.vyrez || VYREZ;
  const bod = pixelBodu(lat, lon, vyrez, digest.sirka || SIRKA, digest.vyska || VYSKA);
  if (!bod) return { stav: 'mimo' };
  const km = kmNaPixel(lat, vyrez, digest.sirka || SIRKA);

  const ted = nejblizsi(digest.jadra, bod);
  const predtim = nejblizsi(digest.jadraPredtim, bod);
  const dTed = ted ? ted.d * km : Infinity;
  const dPredtim = predtim ? predtim.d * km : Infinity;

  // Síla: nejsilnější pixel téhož jádra (do 10 km od nejbližšího), ne okraj,
  // který bývá nejblíž a nejslabší.
  const sila = () => Math.max(...digest.jadra
    .filter((p) => Math.hypot(p[0] - ted.p[0], p[1] - ted.p[1]) * km <= 10)
    .map((p) => p[2]));
  const vysledek = (za) => ({
    stav: 'bourka',
    za,
    km: Math.round(dTed),
    smer: strana(ted.p[0] + 0.5 - bod.x, ted.p[1] + 0.5 - bod.y),
    sila: sila(),
  });

  if (dTed <= BLIZKO_KM && dPredtim <= BLIZKO_PREDTIM_KM) return vysledek(0);

  // Bez platné předpovědi se nedá říct „jde to sem" — a „klid" by byla
  // nepravda o něčem, o čem nic nevíme.
  if (!stopaPlati) return { stav: 'nevim', duvod: 'Předpověď radaru chybí nebo je stará.' };

  if (dTed <= DOSAH_JADRA_KM && dPredtim <= DOSAH_JADRA_PREDTIM_KM) {
    let minut = null;
    for (const [x, y, m] of digest.stopa) {
      if (Math.hypot(x + 0.5 - bod.x, y + 0.5 - bod.y) * km > OKRUH_PREDPOVEDI_KM) continue;
      if (minut === null || m < minut) minut = m;
    }
    if (minut !== null) {
      const za = Math.max(0, Math.round((digest.behMs + minut * 60_000 - nowMs) / 60_000));
      return vysledek(za);
    }
  }
  return { stav: 'klid' };
}

/**
 * Odpověď `/api/storm` pro jedno místo — z podkladu, který leží v cache.
 *
 * ⚠️ `tichoMin` posílá server, aby obal nemusel znát žádné číslo o počasí
 * (`R17`, `R37`). Obal jen porovná čas posledního hlášení bouřky.
 *
 * @param {object} digest  výstup `stavBourky`
 * @param {Record<string,string>} params  `lat`, `lon`, `lang`
 * @param {number} nowMs
 */
export function odpovedProMisto(digest, params = {}, nowMs = 0) {
  const lang = String(params.lang || 'cs').slice(0, 2);
  // 🚨 `Number(undefined)` je NaN, ale `Number('')` a `Number(null)` jsou 0 —
  // nulový ostrov (Guinejský záliv). `isUsablePoint` ho odmítne.
  const lat = params.lat == null || params.lat === '' ? NaN : Number(params.lat);
  const lon = params.lon == null || params.lon === '' ? NaN : Number(params.lon);
  const v = bourkaProMisto(digest, { lat, lon, nowMs });
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  return {
    stav: v.stav,
    bourka: v.stav === 'bourka'
      ? { za: v.za, km: v.km, smer: v.smer, sila: v.sila, text: textBourky(v, lang) }
      : null,
    ...(v.duvod ? { duvod: v.duvod } : {}),
    tichoMin: TICHO_MIN,
    pozorovano: iso(digest?.pozorovanoMs),
    beh: iso(digest?.behMs),
    zdroj: ZDROJ,
    licence: LICENCE,
  };
}

/**
 * Věta do upozornění, v jazyce appky.
 *
 * ⚠️ Nadpis s MÍSTEM skládá web (`storm.title`) — zná jméno, které si
 * člověk místu dal. Tahle věta proto místo nejmenuje.
 * ⚠️ Tón věcný a s radou, co dělat (pravidlo z 26. 8. 2026).
 */
export function textBourky(v, lang = 'cs') {
  if (!v || v.stav !== 'bourka') return '';
  const casti = [];
  if (v.za === 0 && v.km <= BLIZKO_KM) casti.push(t('storm.here', lang));
  else {
    const odkud = t(`storm.from.${v.smer}`, lang);
    casti.push(v.za <= 10
      ? tf('storm.soon', { from: odkud }, lang)
      : tf('storm.coming', { from: odkud, min: String(Math.round(v.za / 5) * 5) }, lang));
  }
  if (v.sila >= 56) casti.push(t('storm.strong', lang));
  casti.push(t('storm.advice', lang));
  casti.push(t('storm.source', lang));
  return casti.join(' ');
}
