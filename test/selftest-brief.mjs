/**
 * Samotest ranní a večerní zprávy (`R25`, tvar `R45`).
 *
 * Spuštění:  npm run selftest:logic
 *
 * 🚨 Nejcennější kontroly tu nejsou o textu, ale o TOM, KTERÉ HODINY se
 * popisují. Server běží v UTC, uživatel je v Praze — a večerní zpráva ve
 * 21:00 SELČ se v UTC odesílá ještě „dneska", zatímco mluvit má o noci
 * a zítřku.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  briefText, useky, BRIEF_PARAMS, RAIN_MENTION, DEN_OD, DEN_DO, BEZVETRI_POD,
} from '../web/lib/brief.js';
import { METRIC, IMPERIAL } from '../web/lib/units.js';
import { GUST_MARGIN_KMH } from '../web/lib/tile-tone.js';

/**
 * Výchozí počasí po hodinách, 17.–18. 9. 2026:
 *
 *   17. den    8 → 19 °C, zataženo, 10 %, vítr JZ 12 km/h
 *   noc        14 → 5 °C (nejníž v 5:00 18.), skoro jasno, vítr Z 8 km/h
 *   18. den    6 → 17 °C, ve 14–16 h déšť 70 %, vítr Z 35 km/h, v 15 h náraz 60
 */
function vychozi(datum, h) {
  const prvni = datum === '2026-09-17';
  const den = h >= DEN_OD && h < DEN_DO;
  if (den && prvni) return { t: 8 + ((h - 6) * 11) / 13, kod: 3, dest: 10, v: 12, smer: 225, naraz: 17 };
  if (den) {
    const dest = h >= 14 && h <= 16;
    return { t: 6 + ((h - 6) * 11) / 13, kod: dest ? 61 : 2, dest: dest ? 70 : 20, v: 35, smer: 270, naraz: h === 15 ? 60 : 40 };
  }
  // Noc: večer 14 °C a k ránu po stupni dolů až na 5 °C v 5:00.
  const t = h >= DEN_DO ? 14 - (h - 20) : 10 - h;
  return { t, kod: 1, dest: 5, v: 8, smer: 270, naraz: 12 };
}

/**
 * Odpověď Open-Meteo, jak ji vrací s `timezone=auto` pro Česko v létě
 * (+2 h): naivní místní časy, 24 za den.
 */
function predpoved({ dny = ['2026-09-17', '2026-09-18'], posunS = 7200, hodina = vychozi } = {}) {
  const H = {
    time: [], temperature_2m: [], weather_code: [], precipitation_probability: [],
    wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [],
  };
  for (const datum of dny) {
    for (let h = 0; h < 24; h++) {
      const x = hodina(datum, h);
      H.time.push(`${datum}T${String(h).padStart(2, '0')}:00`);
      H.temperature_2m.push(x.t);
      H.weather_code.push(x.kod);
      H.precipitation_probability.push(x.dest);
      H.wind_speed_10m.push(x.v);
      H.wind_direction_10m.push(x.smer);
      H.wind_gusts_10m.push(x.naraz);
    }
  }
  return { utc_offset_seconds: posunS, timezone: 'Europe/Prague', hourly: H };
}

/** Totéž počasí, jen s jinou hodnotou ve vybraných hodinách. */
function sUpravou(uprava) {
  return predpoved({ hodina: (d, h) => ({ ...vychozi(d, h), ...uprava(d, h, vychozi(d, h)) }) });
}

/** 17. 9. 2026 v 6:30 pražského času = 4:30 UTC. */
const RANO = Date.UTC(2026, 8, 17, 4, 30);
/** 17. 9. 2026 ve 21:00 pražského času = 19:00 UTC. */
const VECER = Date.UTC(2026, 8, 17, 19, 0);

const zprava = (kind, nowMs, f = predpoved(), lang = 'cs', units = METRIC) =>
  briefText({ forecast: f, kind, nowMs, lang, units });

/* ── které hodiny se popisují ───────────────────────────────────────── */

test('🚨 ranní zpráva: JEN dnešek od teď do večera, noc ne', () => {
  // Miki 24. 10. 2026: „ranní zpráva má ukazovat jen ten aktuální den".
  assert.deepEqual(useky({ forecast: predpoved(), kind: 'morning', nowMs: RANO }), [
    { druh: 'den', datum: '2026-09-17', od: '2026-09-17T06', do: '2026-09-17T20' },
  ]);
});

test('🚨 večerní zpráva: NOC a ZÍTŘEK, ne dnešek', () => {
  assert.deepEqual(useky({ forecast: predpoved(), kind: 'evening', nowMs: VECER }), [
    { druh: 'noc', od: '2026-09-17T21', do: '2026-09-18T06' },
    { druh: 'den', datum: '2026-09-18', od: '2026-09-18T06', do: '2026-09-18T20' },
  ]);
});

test('ranní zpráva zpřesní den, který slíbila večerní', () => {
  const vecerPred = useky({ forecast: predpoved(), kind: 'evening', nowMs: Date.UTC(2026, 8, 16, 18, 0) });
  const rano = useky({ forecast: predpoved(), kind: 'morning', nowMs: RANO });
  assert.equal(vecerPred[1].datum, rano[0].datum, 'ráno mluví znovu o dni, který slíbil večer');
  assert.equal(rano.at(-1).do, vecerPred.at(-1).do, 'a dál než do jeho večera nedohlédne');
});

test('🚨 hodiny se počítají v pásmu MÍSTA, ne serveru', () => {
  // Server (Netlify) běží v UTC. V 0:30 pražského času 18. 9. je v UTC
  // teprve 22:30 17. 9. — podle serveru by „dnes" byl ještě včerejšek.
  const pulnoc = Date.UTC(2026, 8, 17, 22, 30);
  const [den] = useky({ forecast: predpoved(), kind: 'morning', nowMs: pulnoc });
  assert.equal(den.datum, '2026-09-18');
  assert.equal(den.od, '2026-09-18T06', 'den začíná v 6, ne v půl jedné v noci');
});

test('večerní zpráva zdržená přes půlnoc: zbytek noci a den, který právě začíná', () => {
  // Bez sítě ji WorkManager pošle, až síť bude — klidně po půlnoci.
  const pulnoc = Date.UTC(2026, 8, 17, 22, 30);   // 0:30 pražského času 18. 9.
  assert.deepEqual(useky({ forecast: predpoved(), kind: 'evening', nowMs: pulnoc }), [
    { druh: 'noc', od: '2026-09-18T00', do: '2026-09-18T06' },
    { druh: 'den', datum: '2026-09-18', od: '2026-09-18T06', do: '2026-09-18T20' },
  ]);
  assert.match(zprava('evening', pulnoc).text, /\nDnes /, 'den je teď dnešek, ne zítřek');
});

test('ranní zpráva zdržená do dopoledne mluví o zbytku dne', () => {
  const [den] = useky({ forecast: predpoved(), kind: 'morning', nowMs: Date.UTC(2026, 8, 17, 7, 40) });
  assert.equal(den.od, '2026-09-17T09');
});

test('večerní zpráva nastavená na 18 h: noc začíná ve 20, ne v 18', () => {
  const [noc] = useky({ forecast: predpoved(), kind: 'evening', nowMs: Date.UTC(2026, 8, 17, 16, 0) });
  assert.equal(noc.od, '2026-09-17T20');
});

test('🚨 v den přechodu času se hodina čte z posunu TÉ odpovědi', () => {
  // 25. 10. 2026 v 6:30 SEČ = 5:30 UTC; odpověď už nese +1 h. S letním
  // posunem by vyšlo 7:30 a den by začal o hodinu později.
  const f = predpoved({ dny: ['2026-10-25', '2026-10-26'], posunS: 3600 });
  const [den] = useky({ forecast: f, kind: 'morning', nowMs: Date.UTC(2026, 9, 25, 5, 30) });
  assert.equal(den.od, '2026-10-25T06');
  assert.ok(briefText({ forecast: f, kind: 'morning', nowMs: Date.UTC(2026, 9, 25, 5, 30), lang: 'cs', units: METRIC }));
});

test('🚨 když úsek v předpovědi celý není, NEZVONÍ se', () => {
  // Zpráva o hodinách, o kterých nic nevíme, je horší než žádná. A půlka
  // noci by se tvářila jako celá: nejnižší teplota přichází až k ránu.
  const jenDnes = predpoved({ dny: ['2026-09-17'] });
  assert.equal(zprava('evening', VECER, jenDnes), null);
  assert.ok(zprava('morning', RANO, jenDnes), 'ranní zítřek nepotřebuje');

  const cizi = predpoved({ dny: ['2026-10-01', '2026-10-02'] });
  assert.equal(zprava('morning', RANO, cizi), null);
});

/* ── text ───────────────────────────────────────────────────────────── */

test('🚨 ranní zpráva: jeden řádek o dnešku, o noci ani slovo', () => {
  const r = zprava('morning', RANO);
  assert.equal(r.text, 'Dnes 8 až 19 °C · Zataženo, vítr JZ až 12 km/h');
  assert.equal(r.den, '2026-09-17');
});

test('večerní zpráva: noc, pak zítřek i s deštěm a nárazy', () => {
  const r = zprava('evening', VECER);
  assert.equal(r.text,
    'V noci nejníž 5 °C · Skoro jasno, vítr Z až 8 km/h\n' +
    'Zítra 6 až 17 °C · Déšť, pravděpodobnost 70 %, vítr Z až 35 km/h, nárazy 60 km/h');
  assert.equal(r.den, '2026-09-18');
});

test('🚨 den z HODIN, ne z denních dat: minimum noci se do zítřka neopakuje', () => {
  // Denní minimum je z půlnoci až půlnoci — „Zítra 5 až 17 °C" by opakovalo
  // pětku z noci o řádek výš. Den je od 6 do 20 h.
  const r = zprava('evening', VECER);
  assert.match(r.text, /Zítra 6 až 17 °C/);
});

test('🚨 jednotka je JEN u druhého čísla — „8 až 19 °C", ne „8 °C až 19 °C"', () => {
  const [den] = zprava('morning', RANO).text.split('\n');
  assert.equal(den.match(/°C/g).length, 1, den);
});

test('jev je NEJHORŠÍ hodina úseku — totéž pravidlo jako kód dne u Open-Meteo', () => {
  // Ověřeno 24. 10. 2026: denní `weather_code` je maximum hodinových.
  const f = sUpravou((d, h) => (d === '2026-09-17' && h === 17 ? { kod: 95 } : {}));
  assert.match(zprava('morning', RANO, f).text, /^Dnes .* · Bouřka,/);
});

test('🚨 jasno (kód 0) se napíše — nula není „nic"', () => {
  // `0 <= null` je v JS true; srovnání bez výslovného null by jasno zahodilo.
  const f = sUpravou(() => ({ kod: 0 }));
  assert.match(zprava('morning', RANO, f).text, /^Dnes 8 až 19 °C · Jasno,/);
});

/* ── vítr ───────────────────────────────────────────────────────────── */

test('🚨 vítr se píše VŽDYCKY, i slabý, a se směrem', () => {
  // Miki 24. 10. 2026: vítr a jeho směr chyběl. Dřív se psal až od 40 km/h.
  const f = sUpravou(() => ({ v: 4, naraz: 6, smer: 0 }));
  const radky = [zprava('morning', RANO, f), zprava('evening', VECER, f)].flatMap((r) => r.text.split('\n'));
  assert.equal(radky.length, 3, 'dnešek, noc i zítřek');
  for (const radek of radky) assert.match(radek, /vítr S až 4 km\/h$/, radek);
});

test('úplné bezvětří slovem, ne „vítr až 1 km/h"', () => {
  const f = sUpravou(() => ({ v: BEZVETRI_POD - 1, naraz: 2 }));
  assert.match(zprava('morning', RANO, f).text, /· Zataženo, bezvětří$/);
});

test('směr je průměr VÁŽENÝ RYCHLOSTÍ — slabé bezvětří ze západu nepřehlasuje vichr z východu', () => {
  const f = sUpravou((d, h) => (d === '2026-09-17' && h >= 6 && h < 20
    ? (h < 9 ? { v: 30, smer: 90 } : { v: 2, smer: 270 }) : {}));
  assert.match(zprava('morning', RANO, f).text, /^Dnes .*vítr V až 30 km\/h/);
});

test('🚨 vítr, který se točí, je „proměnlivý" — průměr by lhal', () => {
  // Půl noci ze severu, půl z jihu: průměrný směr je náhodné číslo.
  const f = sUpravou((d, h) => (h >= DEN_DO || h < DEN_OD ? { smer: h % 2 ? 0 : 180 } : {}));
  assert.match(zprava('evening', VECER, f).text, /^V noci .*vítr proměnlivý až 8 km\/h/);
});

test('směr jen v osmi stranách: 250° je západ, ne „ZJZ"', () => {
  const f = sUpravou(() => ({ smer: 250 }));
  assert.match(zprava('morning', RANO, f).text, /vítr Z až 12 km\/h/);
});

test('🚨 nárazy jen nad průměr o GUST_MARGIN_KMH — týž práh jako v appce', () => {
  const pod = sUpravou((d) => (d === '2026-09-17' ? { naraz: 12 + GUST_MARGIN_KMH - 1 } : {}));
  assert.doesNotMatch(zprava('morning', RANO, pod).text.split('\n')[0], /nárazy/);
  const na = sUpravou((d) => (d === '2026-09-17' ? { naraz: 12 + GUST_MARGIN_KMH } : {}));
  assert.match(zprava('morning', RANO, na).text.split('\n')[0], /, nárazy 27 km\/h$/);
});

/* ── déšť ───────────────────────────────────────────────────────────── */

test('🚨 slabá pravděpodobnost srážek se NEPÍŠE, od prahu včetně ano', () => {
  const pod = sUpravou(() => ({ dest: RAIN_MENTION - 1 }));
  assert.doesNotMatch(zprava('morning', RANO, pod).text, /pravděpodobnost/);
  const na = sUpravou(() => ({ dest: RAIN_MENTION }));
  assert.match(zprava('morning', RANO, na).text, new RegExp(`pravděpodobnost ${RAIN_MENTION} %`));
});

test('zpráva umí anglicky a v imperiálních jednotkách', () => {
  const r = zprava('evening', VECER, predpoved(), 'en', IMPERIAL);
  const [noc, zitra] = r.text.split('\n');
  assert.equal(noc, 'Tonight low 41 °F · Mostly clear, W wind up to 5 mph');
  assert.ok(zitra.startsWith('Tomorrow 43 to 63 °F · Rain, chance 70%'), zitra);
  assert.ok(zitra.endsWith('W wind up to 22 mph, gusts 37 mph'), zitra);
});

/* ── co dělat, když data nejsou ─────────────────────────────────────── */

test('🚨 bez teplot se NEZVONÍ — „Dnes — · Zataženo" není zpráva', () => {
  const bez = sUpravou(() => ({ t: null }));
  assert.equal(zprava('morning', RANO, bez), null);
});

test('prázdná nebo rozbitá odpověď nevyhodí výjimku, jen mlčí', () => {
  for (const f of [null, {}, { hourly: {} }, { hourly: { time: [] } }, { daily: { time: ['2026-09-17'] } }]) {
    assert.equal(zprava('morning', RANO, f), null);
  }
});

test('neznámý druh zprávy se odmítne', () => {
  assert.equal(zprava('poledne', RANO), null);
  assert.deepEqual(useky({ forecast: predpoved(), kind: 'poledne', nowMs: RANO }), []);
});

/* ── dotaz na předpověď ─────────────────────────────────────────────── */

test('🚨 stahují se DVA dny po HODINÁCH — večerní okno končí zítra ve 20 h', () => {
  assert.equal(BRIEF_PARAMS.forecast_days, '2');
  assert.equal(BRIEF_PARAMS.timezone, 'auto', 'bez pásma místa by se spletly hodiny');
  for (const pole of ['temperature_2m', 'weather_code', 'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m']) {
    assert.ok(BRIEF_PARAMS.hourly.split(',').includes(pole), `chybí ${pole}`);
  }
});

/* ============================================================
   STAVITEL NA SERVERU (`server/brief.js`)

   🚨 Sem patří kontroly toho, co se ptá ven — a hlavně ta o nulovém
   ostrově. Ta vada se v testech nad čistou logikou schovat umí, protože
   `briefText` dostane souřadnice až hotové.
   ============================================================ */

import { stavZpravu } from '../server/brief.js';

/** Předstíraný `fetch`: zapamatuje si adresu a vrátí připravenou odpověď. */
function falesnyFetch(telo, { ok = true, status = 200 } = {}) {
  const volani = [];
  const f = async (url) => {
    volani.push(url);
    return { ok, status, json: async () => telo };
  };
  f.volani = volani;
  return f;
}

test('🚨 NULOVÝ OSTROV: dotaz bez souřadnic nesmí vrátit počasí z Guinejského zálivu', async () => {
  // `Number(null)` je 0 a `Number.isFinite(0)` je true — dokud se hlídala
  // jen konečnost, vracela appka „Dnes 24 až 25 °C · Mrholení" pro bod 0,0.
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({ fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO, params: new URLSearchParams({ kind: 'morning', lang: 'cs' }) });
  assert.equal(r.text, null, 'bez souřadnic se nesmí nic vrátit');
  assert.equal(f.volani.length, 0, 'a ven se kvůli tomu nemá vůbec chodit');
});

test('🚨 ani výslovná nula není poloha', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({ fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO, params: new URLSearchParams({ lat: '0', lon: '0', kind: 'morning', lang: 'cs' }) });
  assert.equal(r.text, null);
  assert.equal(f.volani.length, 0);
});

test('stavitel se zeptá na správné místo a správná pole', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({
    fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO,
    params: new URLSearchParams({ lat: '49.5307', lon: '12.9436', kind: 'morning', lang: 'cs', units: 'metric' }),
  });
  assert.equal(r.text, 'Dnes 8 až 19 °C · Zataženo, vítr JZ až 12 km/h');

  const u = new URL(f.volani[0]);
  assert.equal(u.searchParams.get('latitude'), '49.5307');
  assert.equal(u.searchParams.get('longitude'), '12.9436');
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.equal(u.searchParams.get('forecast_days'), '2');
  assert.equal(u.searchParams.get('hourly'), BRIEF_PARAMS.hourly);
  // ⚠️ Parametry zprávy (`kind`, `lang`, `units`) se ven NEPOSÍLAJÍ —
  // Open-Meteo o nich nic neví a je to zbytečné plkání do cizí služby.
  for (const cizi of ['kind', 'lang', 'units', 'lat', 'lon']) {
    assert.equal(u.searchParams.get(cizi), null, `${cizi} nemá co dělat v dotazu na předpověď`);
  }
});

test('výpadek předpovědi zprávu umlčí, ale nespadne', async () => {
  const f = falesnyFetch(null, { ok: false, status: 503 });
  const r = await stavZpravu({
    fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO,
    params: new URLSearchParams({ lat: '49.5', lon: '13.0', kind: 'morning', lang: 'cs' }),
  });
  assert.equal(r.text, null);
  assert.match(r.duvod, /503/);
});

test('neznámý druh zprávy se ven neptá vůbec', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({
    fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO,
    params: new URLSearchParams({ lat: '49.5', lon: '13.0', kind: 'poledne', lang: 'cs' }),
  });
  assert.equal(r.text, null);
  assert.equal(f.volani.length, 0);
});
