/**
 * MeteoTrace — obrazovka meteostanice.
 *
 * ⚠️ Tenhle soubor je JEDINÝ, který sahá na DOM. Všechno, co se dá spočítat
 * bez stránky, leží ve `web/lib/` a je pokryté samotestem (viz §2.1 architektury).
 * Když sem přibývá výpočet, patří to nejspíš do `lib/`.
 */

'use strict';

import { t, tf, tp, detectLang, LANG_NAMES } from './lib/i18n.js';
import { defaultUnits, SYMBOL } from './lib/units.js';
import { apiGet, createRequestGroup } from './lib/api.js';
import {
  probePoints, routeProbes, nearestProbe, jeSrazka, jeJasno, probeDistanceM, reachKm,
  SIROKE_PRSTENCE_KM,
} from './lib/probes.js';
import { buildWarningsView } from './lib/warnings-view.js';
import { pollenIcon } from './lib/pollen-icons.js';
import { placeMeta, placeLabel, placeTitle, isUsablePoint } from './lib/geo-query.js';
import { searchQuery, stripDiacritics } from './lib/geo-query.js';
import { buildStationView, FORECAST_PARAMS, AIR_PARAMS, formatClock } from './lib/station.js';
import { sampleRoute, planRoute, departureOptions, distanceM } from './lib/eta.js';
import {
  fromOpenRouteService, toOrsCoord, toForecastParams, asLocationList, hoursToMs, spojUseky,
} from './lib/route-adapter.js';
import {
  buildRouteView, compareDepartures, routeMapData, departureAdvice, legRows, arrivalSentence,
  ROUTE_FORECAST_PARAMS,
} from './lib/route-view.js';
import { straightRoute } from './lib/great-circle.js';
import { fitCount } from './lib/fit-row.js';
import { routeQuip, placeQuip, okoliQuip } from './lib/quips.js';
import { isHazard } from './lib/weather-code.js';
import { formatDistance } from './lib/units.js';
import {
  parseStore, serializeStore, emptyStore, savePlace, forgetPlace, touchPlace,
  saveRoute, forgetRoute, touchRoute, routeKey, renameRoute, savedShortcuts,
  findNearby, savedAs, renamePlace, MAX_PLACES, MAX_NAME, MAX_ROUTES,
} from './lib/places.js';
// Mapa se natahuje líně — MapLibre je skoro megabajt a kdo radar neotevře,
// nemá ho proč platit. (Zvyk převzatý z Gulpky, kde se takhle načítá Tone.js.)
let mapModule = null;

const $ = (id) => document.getElementById(id);
const requests = createRequestGroup();

/** ⚠️ Verze se bumpuje až úplně nakonec a na všech místech najednou. */
const VERZE = '0.1.0';

const STORE_KEY = 'meteotrace.v1';

/**
 * Uložená místa mají VLASTNÍ klíč, oddělený od nastavení.
 *
 * 🚨 Nastavení se dá znovu naklikat za deset vteřin, seznam míst posbíraný
 * za rok ne. Kdyby ležely v jednom záznamu, pokažený zápis nastavení by
 * vzal s sebou i data, která appka neumí znovu získat.
 */
const PLACES_KEY = 'meteotrace.places.v1';

const state = {
  // 🚨 `null`, ne 'en'! Platná výchozí hodnota znamenala, že se odhad jazyka
  // podle zařízení NIKDY nespustil a appka mluvila anglicky i na českém
  // telefonu — s hotovým a otestovaným překladem v zádech.
  lang: null,
  langManual: '',      // co si uživatel vybral ručně; prázdné = podle zařízení
  theme: '',           // '' = podle zařízení · 'light' · 'dark'
  // Co je vlevo — a tím pádem i to, čím appka začíná. Výchozí je TRASA:
  // meteostanici pro jedno místo umí kdekdo, odlišovač je počasí po cestě
  // (`R8`). Komu to nesedí, přehodí si to v nastavení (Michal, 25. 8. 2026).
  primary: 'route',     // 'route' | 'station'
  units: null,
  place: null,          // {name, country, lat, lon}
  fix: null,            // poloha ze zařízení; JEN pro řazení nabídky, viz odkudSeDivam()
  places: emptyStore(), // uložená místa a trasy
  banner: null,         // trvalé sdělení o stavu appky, viz notice()
  screen: 'station',    // 'station' | 'route'
  // Trasa se zatím neukládá mezi spuštěními: rozdělaná cesta je něco jiného
  // než uložené místo a obnovovat ji po týdnu by nedávalo smysl.
  // `via` jsou mezibody v pořadí, jak se má jet. Prázdné pole = cesta z A do B.
  route: {
    from: null, to: null, via: [], profil: 'driving-car', rychlostKmh: 90,
  },
};

/* ============================================================
   ULOŽENÉ NASTAVENÍ
   ============================================================ */

function load() {
  // localStorage může být zakázané (soukromé okno, přísné nastavení).
  // Appka pak jen zapomíná — spadnout kvůli tomu nesmí.
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (saved.place) state.place = saved.place;
    if (saved.units) state.units = saved.units;
    // 🚨 Starší zápis nemá `langManual`, a jeho `lang` NENÍ volba uživatele —
    // je to zabetonovaná angličtina z doby, kdy se odhad jazyka nikdy
    // nespustil. Kdyby se přečetla, opravená appka by dál mluvila anglicky
    // přesně těm lidem, kteří si toho už všimli. Takový zápis se zahazuje
    // a jazyk se odhadne znovu.
    if (typeof saved.theme === 'string') state.theme = saved.theme;
    if (saved.primary === 'route' || saved.primary === 'station') state.primary = saved.primary;
    if (typeof saved.langManual === 'string') {
      state.langManual = saved.langManual;
      if (saved.lang) state.lang = saved.lang;
    }
  } catch { /* jede se dál s výchozím */ }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      place: state.place, units: state.units,
      // Ruční volba se ukládá zvlášť od výsledku: prázdná znamená „ptej se
      // zařízení i příště", ne „ulož si, co zařízení řeklo dneska".
      lang: state.langManual || null, langManual: state.langManual,
      theme: state.theme, primary: state.primary,
    }));
  } catch { /* nevadí */ }
}

/* ============================================================
   ULOŽENÁ MÍSTA

   Rozhodování je v `lib/places.js` — tady zbývá jen sáhnout do úložiště
   a přemalovat řádek s odkazy.
   ============================================================ */

function loadPlaces() {
  try {
    state.places = parseStore(localStorage.getItem(PLACES_KEY));
  } catch {
    state.places = emptyStore();
  }
}

/**
 * Zapsat se nemusí povést dvakrát: úložiště může být zakázané, nebo plné.
 *
 * ⚠️ Zapisuje se CELÝ sklad najednou, ne po záznamech. Kdyby se ukládalo
 * po kouskách a zápis by uprostřed selhal, zbyl by v úložišti napůl
 * přepsaný seznam — a to je horší než neuložit nic.
 */
function persistPlaces() {
  // ⚠️ Ticho je tu schválně. Zápis se volá i při pouhém přepnutí místa
  // (`touchPlace`), což si uživatel nevyžádal — a hláška o tom, že se
  // nepovedlo něco, oč nežádal, je jen šum. Že se v režimu jen pro čtení
  // ukládat nedá, se říká jednou při startu (viz `init`).
  const text = serializeStore(state.places);
  if (text === null) return false;
  try {
    localStorage.setItem(PLACES_KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Hvězdička u jména místa: uložit / odebrat. */
function toggleSave() {
  if (!state.place) return;

  const existing = findNearby(state.places, state.place);
  if (existing) {
    state.places = forgetPlace(state.places, existing.key);
  } else {
    const res = savePlace(state.places, state.place, Date.now());
    state.places = res.store;
    if (res.full) notice(t('places.full', state.lang));
  }
  persistPlaces();
  renderSaved();
}

function renderSaved() {
  const list = state.places.places;
  const current = state.place ? findNearby(state.places, state.place) : null;

  // Hvězdička dává smysl, jen když je co uložit.
  const btn = $('btn-save');
  btn.disabled = !state.place || state.places.readOnly;
  btn.querySelector('.star-icon').textContent = current ? '★' : '☆';
  btn.querySelector('.star-text').textContent = current
    ? t('places.savedShort', state.lang)
    : t('places.saveShort', state.lang);
  btn.setAttribute('aria-pressed', String(!!current));

  // 🚨 Když hvězdička odebírá NĚCO JINÉHO, než co je na obrazovce, musí to
  // být na ní vidět. Jinak klepnutí u „Karlína" smaže uloženou „Prahu"
  // o sto dvacet metrů dál a uživatel se nedozví ani co, ani proč.
  const other = state.place ? savedAs(state.places, state.place) : null;
  const label = current
    ? (other ? tf('places.removeNamed', { name: other.name }, state.lang)
             : t('places.remove', state.lang))
    : t('places.save', state.lang);
  btn.title = label;
  btn.setAttribute('aria-label', label);

  const hint = $('saved-as');
  hint.hidden = !other;
  hint.textContent = other ? tf('places.alreadySaved', { name: other.name }, state.lang) : '';

  // 🚨 DVĚ POJMENOVANÉ SKUPINY, ne jeden shluk. Michal 26. 8. 2026: vlevo
  // nadpis („Moje trasy"), který se dá rozklepnout na úplný seznam, a vedle
  // tolik posledních, kolik se doopravdy vejde.
  vykresliSkupinu({
    box: 'group-routes',
    radek: 'saved-routes-list',
    panel: 'routes-panel',
    polozky: state.places.routes.map((r) => ({ kind: 'route', item: r, name: r.name })),
    current: najdiUlozenouTrasu(),
  });

  vykresliSkupinu({
    box: 'group-places',
    radek: 'saved-list',
    panel: 'places-panel',
    polozky: list.map((p) => ({ kind: 'place', item: p, name: p.name })),
    current,
  });

  $('saved').hidden = !list.length && !state.places.routes.length;
}

/**
 * Jedna skupina uložených věcí: nadpis, řádek posledních a rozbalený seznam.
 *
 * ⚠️ Vykreslí se VŠECHNY položky a teprve pak se schovají ty, které se do
 * řádku nevešly. Změřit jde jen to, co v stránce opravdu je — odhadovat
 * šířku podle počtu písmen by u „Domov" a „Praha → Brno přes Jihlavu"
 * vyšlo pokaždé jinak.
 */
function vykresliSkupinu({ box, radek, panel, polozky, current }) {
  $(box).hidden = polozky.length === 0;
  if (!polozky.length) return;

  fill($(radek), polozky, (p) => stitekPolozky(p, current));

  // V rozbaleném seznamu je navíc poslední řádek: správa.
  fill($(panel), [...polozky, { sprava: true }], (p) => (p.sprava
    ? radekSpravy()
    : stitekPolozky(p, current)));

  // Měří se až po vykreslení, jinak nemá prohlížeč co měřit.
  requestAnimationFrame(() => srovnejRadek(radek));
}

/**
 * Poslední řádek rozbaleného seznamu: přejmenovat a smazat.
 *
 * ⚠️ Je to jiná věc než štítky nad ním, takže vypadá jinak — kdyby to byl
 * další štítek v řadě, klepl by na něj člověk omylem místo na místo.
 */
function radekSpravy() {
  const li = document.createElement('li');
  const btn = el('button', 'chip chip-sprava', `⋯ ${t('places.manage', state.lang)}`);
  btn.type = 'button';
  btn.addEventListener('click', () => { zavriPanely(); openPlaces(); });
  li.append(btn);
  return li;
}

/** Štítek jedné uložené věci — místa i trasy. */
function stitekPolozky(polozka, current) {
  const li = document.createElement('li');
  const je = polozka.item;

  // ⚠️ Trasa musí být na první pohled poznat, jinak řádek vypadá jako
  // seznam míst, ve kterém se jedno chová divně.
  const chip = polozka.kind === 'route'
    ? el('button', 'chip chip-route', [
      el('span', 'chip-znak', '↝'),
      el('span', '', polozka.name),
    ])
    : el('button', 'chip', polozka.name);

  chip.type = 'button';
  chip.setAttribute('aria-label', polozka.kind === 'route'
    ? `${t('routes.mine', state.lang)}: ${polozka.name}`
    : polozka.name);
  if (current && current.key === je.key) chip.setAttribute('aria-current', 'true');

  chip.addEventListener('click', () => {
    zavriPanely();
    if (polozka.kind === 'route') { pouzijTrasu(je); return; }

    state.places = touchPlace(state.places, je.key, Date.now());
    persistPlaces();
    const misto = { name: je.name, country: je.country, lat: je.lat, lon: je.lon };
    // Na trase uložené místo VYPLŇUJE TRASU — viz `doplnDoTrasy()`.
    if (state.screen === 'route') doplnDoTrasy(misto);
    else selectPlace(misto);
  });

  li.append(chip);
  return li;
}

/**
 * Schová ze řádku to, co se do něj nevejde.
 *
 * ⚠️ Nepočítá se s pevným počtem („tři poslední"): na širokém displeji by to
 * bylo plýtvání místem a na úzkém přetečení. Rozhodnutí dělá `fitCount()`
 * z naměřených šířek.
 */
function srovnejRadek(idRadku) {
  const radek = $(idRadku);
  if (!radek) return;

  const polozky = [...radek.children];
  for (const li of polozky) li.hidden = false;

  const sirky = polozky.map((li) => li.getBoundingClientRect().width);
  const mezera = parseFloat(getComputedStyle(radek).gap) || 8;
  const kolik = fitCount(sirky, radek.clientWidth, mezera);

  polozky.forEach((li, i) => { li.hidden = i >= kolik; });
}

/** Zavře oba rozbalené seznamy. */
function zavriPanely() {
  for (const [tlacitko, panel] of [['routes-toggle', 'routes-panel'], ['places-toggle', 'places-panel']]) {
    $(panel).hidden = true;
    $(tlacitko).setAttribute('aria-expanded', 'false');
  }
}

/** Rozbalí nebo zavře jeden seznam. */
function prepniPanel(tlacitko, panel) {
  const otevrit = $(panel).hidden;
  zavriPanely();
  $(panel).hidden = !otevrit;
  $(tlacitko).setAttribute('aria-expanded', String(otevrit));
}

/* ============================================================
   ULOŽENÉ TRASY

   `R8` je má v jádru vedle uložených míst: *„bez uložených míst a tras je to
   jednorázová hračka."* Rozhodování (shoda, sloučení, přetečení) je hotové
   a otestované v `lib/places.js` — tady zbývá jen sáhnout do úložiště
   a přemalovat řádek.

   ⚠️ Uloží se START, CÍL A ZPŮSOB, ne spočítaná trasa. Předpověď stará týden
   je k ničemu; smysl má „tahle cesta znovu", a ta se přepočítá.
   ============================================================ */

/**
 * Kam patří uložené místo, na které jsem klepl na obrazovce trasy.
 *
 * 🚨 Michal 25. 8. 2026: *„zkusil jsem přidat mezibod a kliknul na druhé
 * uložené místo a neprošlo."* Klepnutí totiž vždycky nastavovalo CÍL — takže
 * čerstvě přidaný mezibod zůstal prázdný a místo něj se přepsalo něco jiného.
 * Vypadalo to, že se neděje nic.
 *
 * Pravidlo je teď takové, jaké člověk čeká: **vyplní se pole, které čeká.**
 *
 *  1. prázdný mezibod (ten, co jsem právě přidal),
 *  2. prázdný cíl,
 *  3. jinak „jeď sem" — cíl a start z polohy.
 *
 * ⚠️ Co se stalo, se vždycky napíše. Tichý zápis do jednoho ze tří polí by
 * znamenal hledat očima, co se změnilo.
 */
function doplnDoTrasy(misto) {
  const prazdnyMezibod = state.route.via.findIndex((m) => !m);
  if (prazdnyMezibod !== -1) {
    zapisMisto(prazdnyMezibod, misto);
    vykresliMezibody();
    skryjVysledekTrasy();
    poznamkaTrasy(tf('route.viaSet', { n: prazdnyMezibod + 1, name: misto.name }, state.lang));
    return;
  }

  if (!state.route.to) {
    state.route.to = misto;
    $('route-to').value = misto.name;
    skryjVysledekTrasy();
    poznamkaTrasy(tf('route.toSet', { name: misto.name }, state.lang));
    return;
  }

  trasaKMistu(misto);
}

/**
 * „Jeď sem" — jedno klepnutí na uložené místo na obrazovce trasy.
 *
 * Michal 25. 8. 2026: *„po klepnutí na jedno z uložených míst ti to rovnou
 * nastaví cíl a start aktuální polohu."* Je to nejčastější dotaz vůbec:
 * jaké je počasí cestou tam, odsud, teď.
 *
 * ⚠️ O polohu se smí říct právě tady, protože to je uživatelovo klepnutí.
 * Bez gesta by vyskočila žádost, kterou si nikdo nevyžádal (viz `tichaPoloha`).
 *
 * ⚠️ Když polohu nedostaneme, cíl se NASTAVÍ STEJNĚ a řekne se, že chybí
 * start. Zahodit půlku zadání kvůli tomu, co se nepovedlo, by znamenalo
 * začínat od nuly.
 */
async function trasaKMistu(misto) {
  state.route.to = misto;
  $('route-to').value = misto.name;

  // ⚠️ Starý start, který je zrovna tam, kam mířím, přestal být startem.
  // Kdyby zůstal viset v poli, appka by tvrdila „nevím, kde jsi" a přitom
  // by tam jedno místo bylo napsané — dvě sdělení, která si odporují.
  const puvodni = state.route.from;
  if (puvodni && distanceM([puvodni.lat, puvodni.lon], [misto.lat, misto.lon]) < STEJNE_MISTO_M) {
    state.route.from = null;
    $('route-from').value = '';
  }

  const odkud = await polohaProStart();
  if (odkud) {
    state.route.from = odkud;
    $('route-from').value = odkud.name;
  }
  skryjVysledekTrasy();
  renderRoutes();

  if (!odkud) {
    poznamkaTrasy(t('route.needStart', state.lang));
    return;
  }
  poznamkaTrasy(tf('route.fromHere', { to: misto.name }, state.lang));
  loadRoute();
}

/**
 * Odkud se vyráží: poloha ze zařízení, jinak právě prohlížené místo.
 *
 * ⚠️ Prohlížené místo je náhrada, ne rovnocenná volba — proto se použije až
 * tehdy, když poloha není. A pozná se to podle jména, které zůstane v poli.
 */
function polohaProStart() {
  /**
   * ⚠️ Prohlížené místo se smí použít jako start, JEN když není zároveň cílem.
   * Jinak by z „jeď sem" vyšla cesta z Klatov do Klatov — appka by ji spočítala
   * (0,0 km) a tvářila se, že je vše v pořádku.
   */
  const nahradniStart = () => {
    const m = state.place;
    if (!isUsablePoint(m)) return null;
    const cil = state.route.to;
    if (cil && distanceM([m.lat, m.lon], [cil.lat, cil.lon]) < STEJNE_MISTO_M) return null;
    return m;
  };

  return new Promise((hotovo) => {
    if (isUsablePoint(state.fix)) {
      hotovo({ ...state.fix, name: t('search.myLocation', state.lang) });
      return;
    }
    if (!navigator.geolocation) {
      hotovo(nahradniStart());
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const bod = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (!isUsablePoint(bod)) { hotovo(nahradniStart()); return; }
        state.fix = bod;
        hotovo({ ...bod, name: t('search.myLocation', state.lang) });
      },
      () => hotovo(nahradniStart()),
      { timeout: 8000, maximumAge: 300000 },
    );
  });
}

/** Hvězdička u souhrnu trasy: uložit / odebrat. */
function toggleSaveRoute() {
  const { from, to, profil } = state.route;
  if (!from || !to) return;

  const existing = najdiUlozenouTrasu();
  if (existing) {
    state.places = forgetRoute(state.places, existing.key);
  } else {
    const res = saveRoute(state.places, {
      from, to, via: state.route.via.filter(Boolean), profile: profil,
    }, Date.now());
    state.places = res.store;
    if (res.full) notice(t('routes.full', state.lang));
  }
  persistPlaces();
  renderRoutes();
}

/** Je zrovna rozdělaná trasa mezi uloženými? */
function najdiUlozenouTrasu() {
  const { from, to, profil } = state.route;
  if (!from || !to) return null;
  const klic = routeKey({ from, to, via: state.route.via.filter(Boolean), profile: profil });
  return state.places.routes.find((r) => r.key === klic) || null;
}

function renderRoutes() {
  const current = najdiUlozenouTrasu();
  const btn = $('btn-save-route');
  // Hvězdička dává smysl, jen když je co uložit — tedy až je start i cíl.
  btn.disabled = !state.route.from || !state.route.to || state.places.readOnly;
  btn.querySelector('.star-icon').textContent = current ? '★' : '☆';
  btn.querySelector('.star-text').textContent = current
    ? t('routes.savedShort', state.lang)
    : t('routes.saveShort', state.lang);
  btn.setAttribute('aria-pressed', String(!!current));
  const popis = current ? t('routes.remove', state.lang) : t('routes.save', state.lang);
  btn.title = popis;
  btn.setAttribute('aria-label', popis);

  // Uložené trasy se vypisují ve společném řádku s místy — viz `renderSaved()`.
  renderSaved();
}

/**
 * Uložená trasa jedním klepnutím.
 *
 * ⚠️ Přepočítá se hned. Uložená cesta je otázka „jaké je počasí na téhle
 * cestě TEĎ" — ukázat k ní starý výsledek by byl přesně ten druh tichého
 * nesmyslu, kterému se tu vyhýbáme.
 */
function pouzijTrasu(r) {
  state.route.from = r.from;
  state.route.to = r.to;
  // ⚠️ I mezibody — uložená „cesta do práce přes školku" bez školky by byla
  // jiná cesta, a nic by na to neupozornilo.
  state.route.via = [...(r.via || [])];
  state.route.profil = r.profile;
  $('route-from').value = r.from.name;
  $('route-to').value = r.to.name;
  vykresliMezibody();
  state.places = touchRoute(state.places, r.key, Date.now());
  persistPlaces();
  vykresliZpusoby();
  renderRoutes();
  prepniObrazovku('route');
  loadRoute();
}

/** Seznam tras pro správu v dialogu. */
function renderManageRoutes() {
  const list = state.places.routes;
  const note = $('routes-note');

  // Tři různé stavy, které se nesmí splést — stejně jako u míst.
  if (state.places.readOnly) note.textContent = t('places.readOnly', state.lang);
  else if (!list.length) note.textContent = t('routes.empty', state.lang);
  else note.textContent = tf('routes.count', { count: list.length, max: MAX_ROUTES }, state.lang);
  note.hidden = false;

  fill($('routes-manage'), list, (r) => {
    const li = document.createElement('li');
    li.className = 'manage-row';

    // Trasa se jmenuje „Praha → Brno", ale lidsky je to „do práce".
    // Přejmenovat jde stejně jako místo — jinak by to byla dvojí logika
    // pro dvě věci, které uživatel vnímá jako jednu.
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'manage-name';
    input.value = r.name;
    input.maxLength = MAX_NAME;
    input.disabled = state.places.readOnly;
    input.setAttribute('aria-label', t('places.nameLabel', state.lang));
    input.placeholder = `${r.from.name} → ${r.to.name}`;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = r.name; input.blur(); }
    });
    input.addEventListener('blur', () => {
      const nove = input.value.trim();
      if (nove === r.name) return;
      if (!nove) {
        // Prázdné jméno sklad nemění — a musí být poznat, že se nic nestalo.
        input.value = r.name;
        notice(t('places.nameEmpty', state.lang));
        return;
      }
      state.places = renameRoute(state.places, r.key, nove);
      persistPlaces();
      renderRoutes();
      notice(tf('places.renamed', { name: nove }, state.lang));
    });
    li.append(input);

    const del = el('button', 'icon-btn', '🗑');
    del.type = 'button';
    del.disabled = state.places.readOnly;
    del.title = t('routes.remove', state.lang);
    del.setAttribute('aria-label', `${t('routes.remove', state.lang)}: ${r.name}`);
    del.addEventListener('click', () => {
      state.places = forgetRoute(state.places, r.key);
      persistPlaces();
      renderManageRoutes();
      renderRoutes();
      notice(tf('routes.removed', { name: r.name }, state.lang));
    });
    li.append(del);
    return li;
  });
}


/* ============================================================
   SPRÁVA ULOŽENÝCH MÍST

   Řádek v hlavičce slouží k PŘEPNUTÍ jedním klepnutím. Přejmenování
   a mazání sem nepatří — proto zvlášť, v dialogu.
   ============================================================ */

/* ============================================================
   NASTAVENÍ — JAZYK A JEDNOTKY

   🚨 Appka do 25. 8. 2026 mluvila jen anglicky, ačkoli češtinu měla celou
   přeloženou a otestovanou. Odhad jazyka podle zařízení se totiž nikdy
   nespustil: výchozí hodnota ve stavu byla `'en'`, a podmínka
   `if (!state.lang || …)` je platný jazyk, takže odhad nepřipadal v úvahu.
   **Správně napsaná mrtvá větev** — testy i18n přitom byly zelené, protože
   měřily překlad, ne to, jestli se k němu appka vůbec dostane.

   Odtud dvě věci: `state.lang` začíná jako `null` (= zatím nevíme) a jazyk
   jde přepnout ručně, ať se nemusí hádat s prohlížečem.

   ⚠️ Jednotky jsou samostatná osa (`R10`), ne součást jazyka. Pilot chce
   vítr v m/s, i kdyby appka mluvila anglicky.
   ============================================================ */

/** Nabídky jednotek. Hodnota je klíč do `SYMBOL`, popisek je ten symbol. */
const JEDNOTKY = {
  temp: ['c', 'f'],
  wind: ['kmh', 'ms', 'mph'],
  precip: ['mm', 'in'],
  distance: ['km', 'mi'],
};

function openSettings() {
  const jazyk = $('set-lang');
  fillOptions(jazyk, [
    // „Podle zařízení" musí být volba, ne jen výchozí chování: kdo si jazyk
    // jednou přepne, nemá jak se vrátit k automatice.
    { value: '', text: t('settings.languageAuto', state.lang) },
    ...Object.entries(LANG_NAMES).map(([kod, jmeno]) => ({ value: kod, text: jmeno })),
  ], state.langManual || '');

  fillOptions($('set-primary'), [
    { value: 'route', text: t('nav.route', state.lang) },
    { value: 'station', text: t('nav.station', state.lang) },
  ], state.primary);

  fillOptions($('set-theme'), [
    { value: '', text: t('settings.themeAuto', state.lang) },
    { value: 'light', text: t('settings.themeLight', state.lang) },
    { value: 'dark', text: t('settings.themeDark', state.lang) },
  ], state.theme || '');

  for (const [osa, hodnoty] of Object.entries(JEDNOTKY)) {
    fillOptions($(`set-${osa}`), hodnoty.map((h) => ({ value: h, text: SYMBOL[h] })),
      state.units[osa]);
  }

  $('about-version').textContent = tf('settings.version', { version: VERZE }, state.lang);
  $('settings-dialog').showModal();
}

function fillOptions(select, items, selected) {
  select.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.value;
    o.textContent = it.text;
    if (it.value === selected) o.selected = true;
    select.append(o);
  }
}

/**
 * Přepnutí jazyka.
 *
 * Prázdná hodnota znamená „podle zařízení" — uloží se jako prázdná, aby si
 * appka příště zase řekla o odhad, a ne aby zabetonovala dnešní výsledek.
 */
function zmenJazyk(kod) {
  state.langManual = kod || '';
  state.lang = kod || detectLang(navigator.languages || []);
  save();
  prekresliVse();
}

function zmenJednotku(osa, hodnota) {
  state.units = { ...state.units, [osa]: hodnota };
  save();
  prekresliVse();
}

/**
 * Překreslení po změně jazyka nebo jednotek.
 *
 * ⚠️ Nestačí přepsat texty se značkou `data-i18n`: čísla nesou jednotku
 * a hodiny nesou jazyk, takže se data musí složit znovu. Ven se kvůli tomu
 * nechodí — odpovědi drží klientská cache.
 */
function prekresliVse() {
  applyI18n();
  renderSaved();
  if (state.place) loadStation();
  if (state.route.from && state.route.to && !$('route-summary-card').hidden) loadRoute();
}


function openPlaces() {
  renderManage();
  renderManageRoutes();
  $('places-dialog').showModal();
}

/**
 * Seznam pro správu.
 *
 * ⚠️ Překresluje se po každé změně, takže rozepsané jméno by se ztratilo.
 * Proto se překresluje jen při otevření, po přejmenování a po odebrání —
 * ne při psaní.
 */
function renderManage() {
  const list = state.places.places;
  const note = $('places-note');

  // Tři různé věci, které se nesmí splést: nemám nic uloženého · mám plno ·
  // nemůžu měnit. Prázdný dialog beze slova vypadá jako rozbitá appka.
  if (state.places.readOnly) note.textContent = t('places.readOnly', state.lang);
  else if (!list.length) note.textContent = t('places.empty', state.lang);
  else note.textContent = tf('places.count', { count: list.length, max: MAX_PLACES }, state.lang);
  note.hidden = false;

  fill($('places-manage'), list, (p) => {
    const li = document.createElement('li');
    li.className = 'manage-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'manage-name';
    input.value = p.name;
    // Strop délky je vidět rovnou v poli — ořezat jméno až při ukládání
    // a nic neříct by vypadalo jako chyba.
    input.maxLength = MAX_NAME;
    input.disabled = state.places.readOnly;
    input.setAttribute('aria-label', t('places.nameLabel', state.lang));
    input.placeholder = t('places.namePlaceholder', state.lang);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = p.name; input.blur(); }
    });
    input.addEventListener('blur', () => commitRename(p, input));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'manage-remove';
    del.disabled = state.places.readOnly;
    setRemoveLabel(del, false);
    // ⚠️ Uložená místa appka neumí znovu získat, takže mazání má dvě klepnutí.
    // Ne dialogem — ten se odklikává naslepo. Tlačítko samo řekne, co udělá.
    del.addEventListener('click', () => {
      if (del.dataset.armed !== '1') {
        for (const jiny of $('places-manage').querySelectorAll('.manage-remove')) {
          setRemoveLabel(jiny, false);
        }
        setRemoveLabel(del, true);
        return;
      }
      state.places = forgetPlace(state.places, p.key);
      persistPlaces();
      notice(tf('places.removed', { name: p.name }, state.lang));
      renderManage();
      renderSaved();
    });

    li.append(input, del);
    return li;
  });
}

function setRemoveLabel(btn, armed) {
  btn.dataset.armed = armed ? '1' : '0';
  btn.textContent = armed
    ? t('places.confirmRemove', state.lang)
    : t('places.removeOne', state.lang);
  btn.classList.toggle('armed', armed);
}

function commitRename(place, input) {
  const nove = input.value;
  if (nove === place.name) return;

  const pred = state.places;
  state.places = renamePlace(state.places, place.key, nove);

  // Sklad se nezměnil → jméno bylo prázdné. Musí se to říct, jinak se pole
  // jen samo od sebe vrátí a vypadá to jako chyba appky.
  if (state.places === pred) {
    input.value = place.name;
    notice(t('places.nameEmpty', state.lang));
    return;
  }
  persistPlaces();
  notice(tf('places.renamed', { name: input.value.trim() }, state.lang));
  renderManage();
  renderSaved();
}

/* ============================================================
   PŘEKLADY DO STRÁNKY
   ============================================================ */

function applyI18n() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n, state.lang);
  }
  // Několik atributů najednou se odděluje svislítkem: `title:x|aria-label:x`.
  // Popisek pro čtečku a bublina bývají tentýž text a psát to dvakrát do
  // dvou značek by znamenalo, že se jednou opraví jen jeden z nich.
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split('|')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr, t(key, state.lang));
    }
  }
  $('splash-text').textContent = t('search.placeholder', state.lang);
  document.title = `${t('app.name', state.lang)} — ${t('app.tagline', state.lang)}`;
}

/* ============================================================
   HLEDÁNÍ MÍSTA
   ============================================================ */

let searchTimer = 0;

/**
 * Odkud se uživatel dívá. Posílá se k hledání, aby se tatáž ulice z desítky
 * měst seřadila od nejbližší.
 *
 * ⚠️ Když se ještě nikam nedíval, nic se neposílá — vymýšlet si střed
 * republiky by znamenalo tvrdit něco, co nevíme.
 */
/**
 * „Odkud se dívám" — bod, podle kterého se řadí nabídka hledání.
 *
 * 🚨 PROČ NA TOM ZÁLEŽÍ VÍC, NEŽ SE ZDÁ. Změřeno 25. 8. 2026 na dotazu
 * „Polní" (jedno z nejčastějších jmen ulic u nás):
 *
 *   bez polohy          → JM, Dolní Dunajovice, CK, EK, Hradec Králové…
 *                         **Horšovský Týn v prvních osmi vůbec není**
 *   z Horšovského Týna  → **Horšovský Týn**, Holýšov, Stod, Stříbro…
 *
 * Bez polohy tedy appka na běžné jméno ulice nenabídne to, co má člověk
 * pod nosem — a vypadá to, že tu ulici nezná. Michal na to narazil přesně
 * takhle.
 *
 * Pořadí zdrojů polohy:
 *  1. **vybrané místo** — nejsilnější signál, uživatel ho sám zvolil,
 *  2. **poloha ze zařízení**, ale JEN když už je povolená (viz `tichaPoloha`),
 *  3. nic — a to se musí říct nahlas, viz `showResults`.
 */
function odkudSeDivam() {
  for (const p of [state.place, state.fix]) {
    if (isUsablePoint(p)) return { lat: p.lat, lon: p.lon };
  }
  return {};
}

/** Ví appka, odkud se uživatel dívá? */
function znamePolohu() {
  return Number.isFinite(odkudSeDivam().lat);
}

/**
 * Poloha ze zařízení — POTICHU a jen když je povolená.
 *
 * ⚠️ Vyskočit s žádostí o polohu kvůli řazení nabídky by bylo drzé: uživatel
 * chtěl hledat, ne řešit oprávnění. Když už ale povolení jednou dal (tlačítko
 * ⌖), nemá důvod se ptát znovu — a hledání může být od té chvíle chytřejší.
 *
 * ⚠️ Neukládá se to jako vybrané místo. „Kde jsem" a „co si prohlížím" jsou
 * dvě různé věci; přepsat kvůli řazení obrazovku by bylo horší než neseřadit.
 */
async function tichaPoloha() {
  if (!navigator.geolocation || !navigator.permissions?.query) return;
  try {
    const stav = await navigator.permissions.query({ name: 'geolocation' });
    if (stav.state !== 'granted') return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const bod = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        // 🚨 Prohlížeč bez lokalizační služby vrací 0, 0 — a to není poloha,
        // to je „nevím". Viz `isUsablePoint()`.
        if (isUsablePoint(bod)) state.fix = bod;
      },
      () => { /* nevyšlo to — hledání jen nebude řadit podle okolí */ },
      { maximumAge: 10 * 60 * 1000, timeout: 5000 },
    );
  } catch { /* prohlížeč Permissions API nemá; bez polohy se to jen neseřadí */ }
}

function onSearchInput(text) {
  clearTimeout(searchTimer);
  const q = text.trim();
  if (q.length < 2) { hideResults(); return; }
  // Psaní je rychlejší než síť. Bez prodlevy by se na každé písmeno poslal
  // dotaz a limit geokódování by se vyčerpal na jednom slově.
  searchTimer = setTimeout(() => search(q), 280);
}

async function search(q) {
  try {
    const { data } = await requests.run('search', (signal) =>
      apiGet('geocode', { name: q, count: 8, language: state.lang, ...odkudSeDivam() }, { signal }));
    showResults(data?.results || []);
  } catch (e) {
    if (!requests.isAbort(e)) showResults([]);
  }
}

function showResults(list) {
  const ul = $('search-results');
  ul.innerHTML = '';

  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('search.noResults', state.lang);
    ul.append(li);
  } else {
    for (const r of list) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.textContent = r.name;
      const where = placeMeta(r);
      if (where) {
        const span = document.createElement('span');
        span.className = 'muted';
        span.textContent = ` · ${where}`;
        li.append(span);
      }
      const choose = () => selectPlace({
        name: placeTitle(r), country: r.country, lat: r.latitude, lon: r.longitude,
      }, placeLabel(r));
      li.addEventListener('click', choose);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(); });
      ul.append(li);
    }

    // 🚨 Nabídka bez polohy vypadá úplně stejně jako nabídka s polohou — jen
    // v ní chybí to, co má člověk pod nosem. Bez tohohle řádku si to nemá jak
    // spojit s tím, že appka neví, kde je.
    if (!znamePolohu()) {
      const li = document.createElement('li');
      li.className = 'empty hint-row';
      li.textContent = t('search.noFocus', state.lang);
      ul.append(li);
    }
  }
  ul.hidden = false;
}

const hideResults = () => { $('search-results').hidden = true; };

/**
 * @param {object} place
 * @param {string} [textDoPole]  co má zůstat ve vyhledávacím poli.
 *   U výběru z nabídky je to **úplná adresa i s obcí** — prázdné pole
 *   nebo samotné „náměstí Republiky" nutí uživatele hádat, co si vybral.
 *   U uloženého místa a u polohy z GPS se pole čistí: tam se nic nehledalo.
 */
function selectPlace(place, textDoPole = '') {
  state.place = place;
  save();
  hideResults();
  $('search-input').value = textDoPole;
  $('search-input').blur();
  renderSaved();
  loadStation();
}

/* ============================================================
   POLOHA
   ============================================================ */

function locate() {
  if (!navigator.geolocation) return;
  notice(t('search.searching', state.lang));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Poloha se pamatuje i pro řazení nabídky hledání. I když si uživatel
      // potom prohlédne něco jiného, pořád platí, KDE JE — a hledání ulice
      // pak nabídne to, co má pod nosem.
      const bod = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      // 🚨 „0, 0" není poloha, ale „nevím" — a mlčky ukázat počasí
      // v Guinejském zálivu je horší než přiznat, že to nevyšlo.
      if (!isUsablePoint(bod)) { notice(t('error.failed', state.lang)); return; }
      state.fix = bod;
      selectPlace({
        name: t('search.myLocation', state.lang),
        lat: pos.coords.latitude, lon: pos.coords.longitude,
      });
    },
    () => notice(t('error.failed', state.lang)),
    { timeout: 10000, maximumAge: 300000 },
  );
}

/* ============================================================
   NAČTENÍ A VYKRESLENÍ
   ============================================================ */

/**
 * Jméno bodu — nejdřív z našeho, teprve pak z cizího.
 *
 * 🚨 Dvoustupňově, a to schválně:
 *
 * 1. **Vlastní hranice ORP** (`R15`) — zadarmo, bez klíče, bez kvóty. Pokrývají
 *    ale jen Česko.
 * 2. **Opačné hledání u Pelias** — jen když první stupeň neví, tedy prakticky
 *    jen v cizině. Stojí kvótu sdílenou s hledáním adres, takže se nesmí ptát
 *    zbytečně.
 *
 * ⚠️ Z cizí odpovědi se bere `locality`, ne `name`. Změřeno 27. 8. 2026:
 * `name` je adresa nebo podnik — u Drážďan „Wilsdruffer Straße 17", u Vratislavi
 * dokonce jméno hospody. `locality` vrací „Drážďany", „Vratislav", „Linec",
 * a rovnou česky. Když ani ta není, zbývá kraj.
 */
async function jmenoBodu(bod, klic) {
  try {
    const jm = await requests.run(klic, (signal) => apiGet('place', {
      lat: bod.lat, lon: bod.lon,
    }, { signal }));
    if (jm.data?.nazev) return jm.data.nazev;
  } catch { /* zkusí se cizina */ }

  try {
    const rev = await requests.run(`${klic}-cizina`, (signal) => apiGet('geocodeReverse', {
      lat: bod.lat, lon: bod.lon, language: state.lang,
    }, { signal }));
    // ⚠️ Bere se první výsledek, který ZNÁ OBEC — ne prostě první. Ten bývá
    // podnik nebo ulice bez vazby na sídlo. Když obec nezná žádný, zbývá kraj.
    const results = rev.data?.results || [];
    const sObci = results.find((r) => r.locality);
    return sObci?.locality || results[0]?.admin1 || '';
  } catch {
    return '';                        // bez jména věta pořád nese směr a dálku
  }
}

/**
 * Zeptá se sond a najde nejbližší, která vyhovuje.
 *
 * @param {Array} sondy
 * @param {'dest'|'slunce'} hledame
 * @param {string} klic  jméno v skupině dotazů (ruší se při novém zadání)
 */
async function zeptejSond(sondy, hledame, klic) {
  if (!sondy.length) return null;

  const odpoved = await requests.run(klic, (signal) => apiGet('forecast', {
    latitude: sondy.map((s) => s.lat).join(','),
    longitude: sondy.map((s) => s.lon).join(','),
    current: 'weather_code,precipitation,cloud_cover',
    timezone: 'auto',
  }, { signal }));

  // 🚨 U seznamu souřadnic vrací Open-Meteo POLE odpovědí, u jedné souřadnice
  // objekt. Sjednotit, jinak by se sondy přiřadily naprázdno.
  const pole = Array.isArray(odpoved.data) ? odpoved.data : [odpoved.data];
  const stavy = pole.map((x) => x?.current || null);

  return nearestProbe(sondy, stavy, hledame === 'dest' ? jeSrazka : jeJasno);
}

/**
 * Společné jádro dovětku o okolí — pro místo i pro trasu.
 *
 * 🚨 Michal 27. 8. 2026: *„chybí ti tam to, co jsem chtěl hlavně — explicitně
 * místo, kde nejblíže prší."* Měl pravdu: appka uměla říct jen „do 120 km
 * nikde neprší", což je odpověď na jinou otázku. Když se v blízkém okolí nic
 * nenajde, jde se proto **na druhé, široké kolo** (200 / 320 / 500 km) — aby
 * se dalo odpovědět „nejbližší déšť, o kterém víme, je u Drážďan".
 *
 * ⚠️ Široké kolo se ptá JEN KDYŽ blízké nic nenašlo. Většinu dní tedy
 * nestojí nic.
 *
 * ⚠️ A mluví o sobě jinak. Osm směrů na pěti stech kilometrech jsou mezery
 * stovky kilometrů široké — „nejblíž prší" by tvrdilo přesnost, která tam
 * není. Odtud „nejbližší déšť, o kterém víme".
 *
 * @param {object} a
 * @param {HTMLElement} a.prvek         kam se to napíše
 * @param {'dest'|'slunce'} a.hledame
 * @param {Array} a.blizke              sondy prvního kola
 * @param {() => Array} a.siroke        sondy druhého kola (líně — ať se počítají jen když je třeba)
 * @param {boolean} [a.odTrasy]         měří se od trasy
 * @param {string} a.klic               jméno v skupině dotazů
 * @param {(nalez: object) => number} [a.vzdalenost]  jak daleko nález je (m)
 */
async function vypisOkoli(a) {
  const { prvek, hledame, blizke, klic } = a;
  prvek.hidden = true;
  prvek.textContent = '';

  if (state.lang !== 'cs') return;          // hlášky umí jen česky
  if (!blizke.length) return;

  try {
    let sondy = blizke;
    let nalez = await zeptejSond(sondy, hledame, klic);
    let siroko = false;

    if (!nalez) {
      const dalsi = a.siroke();
      if (dalsi.length) {
        siroko = true;
        sondy = dalsi;
        nalez = await zeptejSond(sondy, hledame, `${klic}-siroke`);
      }
    }

    const misto = nalez ? await jmenoBodu(nalez, `${klic}-jmeno`) : '';
    const metru = nalez ? (a.vzdalenost ? a.vzdalenost(nalez) : nalez.distanceM) : null;

    const veta = okoliQuip({
      hledame,
      km: Number.isFinite(metru) ? metru / 1000 : null,
      dirKey: nalez?.dirKey,
      misto,
      // 🚨 Kam se DOOPRAVDY dohlédlo, ne kam se dohlédnout mělo.
      dosahKm: reachKm(sondy),
      odTrasy: !!a.odTrasy,
      siroko,
    }, state.lang);

    if (!veta) return;
    prvek.textContent = veta;
    prvek.hidden = false;
  } catch (e) {
    if (requests.isAbort(e)) return;
    // Dovětek, který se nepovedl, mlčí. Chybová hláška o tom, kde neprší,
    // by byla víc na obtíž než sama informace.
  }
}

/**
 * Kde nejblíž prší od jednoho MÍSTA — a když prší tady, kam za sluncem.
 *
 * ⚠️ NIKDY NESHODÍ STANICI. Je to dovětek: když se nepovede, prostě není.
 */
async function ukazOkoli(place, c) {
  const stred = [place.lat, place.lon];

  // Zataženo se počítá jako „slunce tu není". Michalova věta mluví o slunci,
  // ne o suchu — a pod souvislou oblačností je odpověď „za sluncem se musí
  // jinam" pravdivá, i když neprší.
  const prsiTady = jeSrazka({ weather_code: c.code, precipitation: c.precipMm });
  const zatazeno = Number(c.cloudPct) >= 80;

  await vypisOkoli({
    prvek: $('now-around'),
    hledame: (prsiTady || zatazeno) ? 'slunce' : 'dest',
    blizke: probePoints(stred),
    siroke: () => probePoints(stred, SIROKE_PRSTENCE_KM),
    klic: 'okoli',
    vzdalenost: (n) => probeDistanceM(stred, n) ?? n.distanceM,
  });
}

/**
 * Kde nejblíž prší od TRASY — a když prší na ní, kam za sluncem.
 *
 * 🚨 Michal 27. 8. 2026: *„tys to dal jen do místa, já to hledal tam, kde je
 * to nejdůležitější, U TRASY!"* U jednoho místa je to zajímavost; u cesty je
 * to otázka, jestli má smysl jet jinudy.
 *
 * ⚠️ Ptá se na TEĎ, ne na čas příjezdu. Body trasy mají počasí v čase, kdy tam
 * dorazíš — tohle je jiná otázka („kde zrovna prší") a věta ji drží v přítomném
 * čase. Předpověď pro osmačtyřicet sond na osmačtyřicet různých hodin by byla
 * o řád víc dat za odpověď, kterou nikdo nechtěl.
 *
 * ⚠️ NIKDY NESHODÍ TRASU.
 */
async function ukazOkoliTrasy(view, cara) {
  const body = (view?.points || [])
    .map((p) => p.point)
    .filter((b) => Array.isArray(b) && Number.isFinite(b[0]));
  const podklad = body.length ? body : (cara || []);

  await vypisOkoli({
    prvek: $('route-around'),
    // Prší po trase → hledá se slunce. Neprší → hledá se déšť.
    hledame: view.summary.rainCount > 0 ? 'slunce' : 'dest',
    blizke: routeProbes(podklad),
    // ⚠️ U širokého kola stačí dvě kotvy a větší odstup: na pěti stech
    // kilometrech je jedno, od kterého konce trasy se měří.
    siroke: () => routeProbes(podklad, {
      prstence: SIROKE_PRSTENCE_KM, kotev: 2, odstupKm: 120,
    }),
    odTrasy: true,
    klic: 'okoli-trasa',
  });
}

async function loadStation() {
  const place = state.place;
  if (!place) return;

  notice(null);
  $('place-name').textContent = place.name;

  try {
    const [fc, air, warn] = await requests.run('station', async (signal) => {
      const common = { latitude: place.lat, longitude: place.lon };
      // Pyl je doplněk — když se nepovede, počasí se kvůli němu neshodí.
      // Pyl ani výstrahy nesmí shodit počasí — proto `catch`. U výstrah se
      // ale neúspěch NEZAMLČÍ: `null` se propíše do stavu „nepodařilo se
      // načíst", což je něco jiného než „nic nehrozí".
      return Promise.all([
        apiGet('forecast', { ...common, ...FORECAST_PARAMS }, { signal }),
        apiGet('air', { ...common, ...AIR_PARAMS }, { signal }).catch(() => null),
        apiGet('warnings', { lat: place.lat, lon: place.lon, lang: state.lang, geo: 1 }, { signal })
          .catch(() => null),
      ]);
    });

    render(fc.data, air?.data);
    renderWarnings(warn ? warn.data : null);

    if (fc.stale) {
      notice(tf('error.stale', { age: humanAge(fc.ageS) }, state.lang));
    }
  } catch (e) {
    if (requests.isAbort(e)) return;          // zrušený dotaz není chyba
    notice(`${t('error.failed', state.lang)} ${e.message}`);
  }
}

/**
 * Výstrahy.
 *
 * ⚠️ Karta se NESCHOVÁVÁ jen proto, že je seznam prázdný. „Žádné výstrahy
 * neplatí" a „výstrahy se nepodařilo načíst" vypadají bez věty úplně stejně —
 * a jedno z toho je klid, druhé je nevědomost.
 */
function renderWarnings(payload) {
  const view = buildWarningsView({ payload, lang: state.lang, nowMs: Date.now() });

  $('warnings-card').hidden = false;

  const note = $('warnings-note');
  note.textContent = view.zprava;
  note.hidden = !view.zprava;

  // Obrys do mapy: kreslí se podle NEJZÁVAŽNĚJŠÍ výstrahy, protože pohled na
  // mapu má odpovídat tomu, co je nahoře na kartě. Mapa se zakládá později
  // a líně, takže se to jen odloží sem.
  state.warningArea = view.polozky.length && payload?.geometrie
    ? { geometrie: payload.geometrie, trida: view.polozky[0].trida }
    : null;

  const list = $('warnings-list');
  list.replaceChildren();
  for (const p of view.polozky) {
    const li = document.createElement('li');
    li.className = `warn warn-${p.trida}`;

    const badge = document.createElement('span');
    badge.className = 'warn-badge';
    badge.textContent = p.zavaznost;

    const head = document.createElement('strong');
    head.className = 'warn-title';
    head.textContent = p.obdobi ? `${p.nadpis} · ${p.obdobi}` : p.nadpis;

    li.append(badge, head);

    if (p.popis) {
      const kde = document.createElement('span');
      kde.className = p.nejiste ? 'warn-where warn-uncertain' : 'warn-where';
      kde.textContent = p.popis;
      li.append(kde);
    }
    list.append(li);
  }
}

function render(forecast, air) {
  const view = buildStationView({
    forecast, air, lang: state.lang, units: state.units, nowMs: Date.now(),
  });
  if (!view) { notice(t('error.failed', state.lang)); return; }

  // 🚨 Odkrýt meteostanici smí jen tehdy, když na ní uživatel opravdu je.
  // Data se načítají i na pozadí (návrat do appky, přepnutí místa), a bez
  // téhle podmínky vyskočila stanice přes obrazovku trasy — záložka svítila
  // „Trasa", ale koukal jsi na počasí jednoho místa.
  $('splash').hidden = true;
  if (state.screen === 'station') $('station').hidden = false;

  const c = view.current;
  $('now-icon').textContent = c.icon;
  $('now-temp').textContent = c.temp;
  $('now-cond').textContent = c.condition;
  $('now-feels').textContent = c.feelsLike;
  // 🚨 CELÝM SLOVEM, ne zkratkou. Michal 27. 8. 2026: *„to bys měl
  // překlápět automaticky na celá slova, to lidi neznaj."* Měl pravdu —
  // „VSV" je značka pro meteorologa, ne pro člověka, který se dívá, jestli
  // si vzít bundu. Bublina to nezachrání: na telefonu žádná není.
  //
  // ⚠️ Zkratka nezmizela úplně — zůstává tam, kde se měří na pixely
  // (řádky bodů trasy). Tady je místa dost, tak se to napíše pořádně.
  const vitr = $('d-wind');
  vitr.textContent = c.wind;
  if (c.windDirLong) {
    vitr.append(el('span', 'dir', c.windDirLong));
    vitr.setAttribute('aria-label', `${c.wind}, ${c.windDirLong}`);
  }
  $('d-gusts').textContent = c.gusts;
  $('d-humidity').textContent = c.humidity;
  $('d-precip').textContent = c.precip;
  $('d-cloud').textContent = c.cloudCover;
  $('d-uv').textContent = c.uvIndex;
  $('d-sunrise').textContent = view.sun.sunrise;
  $('d-sunset').textContent = view.sun.sunset;
  $('now-updated').textContent = c.updated;

  // Hláška k místu. ⚠️ Bere čísla, ne naformátované texty — z „12,5 km/h"
  // se rozhodovat nedá.
  const hlaskaMista = placeQuip({
    hazard: isHazard(c.code),
    hazardWhat: c.condition,
    windKmh: c.windKmh,
    windDirKey: c.windDirKey,
    gustKmh: c.gustKmh,
    tempC: c.tempC,
    isDay: c.isDay,
  }, state.lang);
  const zertMista = $('now-quip');
  zertMista.hidden = !hlaskaMista;
  zertMista.textContent = hlaskaMista;

  // Dovětek o okolí se dotahuje zvlášť a nikoho nezdržuje.
  if (state.place) ukazOkoli(state.place, c);

  hlidejRolovani();
  fill($('hours'), view.hourly, (h) => {
    const bunka = el('div', 'hour', [
      el('div', 't', h.time),
      el('span', 'i', h.icon),
      el('div', 'v', h.temp),
      el('div', 'p', h.precipProb === '0 %' ? '' : h.precipProb),
    ]);
    // Předěl dne. Bez něj je dvoudenní pruh bludiště — „v 8:00" se dá číst
    // jako dnes i zítra.
    if (h.dayLabel) {
      bunka.dataset.day = h.dayLabel;
      bunka.classList.add('hour-newday');
    }
    return bunka;
  });

  fill($('days'), view.daily, (d) => el('li', '', [
    el('span', 'd', d.day),
    el('span', 'p', d.precipProb === '0 %' ? '' : d.precipProb),
    el('span', 'i', d.icon),
    el('span', 'r', [document.createTextNode(d.hi + ' '), el('span', 'lo', d.lo)]),
  ]));

  showRadar(view.timeZone);

  renderPollen(view);
}

/**
 * Pyl.
 *
 * ⚠️ Karta se neschovává jen proto, že seznam je prázdný. „Dnes nic nelítá"
 * a „o tomhle místě data nemáme" jsou dvě různé zprávy a obě se musí říct —
 * schovaná karta neřekne ani jednu.
 */
function renderPollen(view) {
  const karta = $('pollen-card');
  const note = $('pollen-note');
  karta.hidden = false;

  const zprava = {
    nedostupne: t('pollen.none', state.lang),
    zadny: t('pollen.allClear', state.lang),
    data: t('pollen.measured', state.lang),
  }[view.pollenStatus] || '';
  note.textContent = zprava;
  note.hidden = !zprava;

  // Když data nejsou, nemá smysl vypisovat šest prázdných řádků.
  const polozky = view.pollenStatus === 'nedostupne' ? [] : view.pollen;
  fill($('pollen'), polozky, (p) => {
    const level = el('span', 'lvl', p.levelText);
    level.dataset.level = p.level;            // barvu odznaku řídí CSS podle stupně

    const jmeno = el('span', 'pollen-name', [pollenSvg(p.species), el('span', '', p.name)]);
    const li = el('li', '', [jmeno, level]);
    li.dataset.level = p.level;               // stejnou barvou se obarví i lístek
    return li;
  });
}

/* ============================================================
   MAPA NA OBRAZOVCE TRASY

   ⚠️ Mapa je JEDNA a mezi obrazovkami se PŘESOUVÁ. Druhá instance MapLibre
   by znamenala druhý WebGL kontext, druhý megabajt v paměti a druhé stahování
   dlaždic — na telefonu daň, kterou nic neospravedlňuje (`R0`).

   Vedlejší zisk: na trase je tím pádem i radar. Vidět čáru trasy přes pole
   srážek je přesně to, kvůli čemu tahle appka vznikla.
   ============================================================ */

/**
 * Vzhled: světlý, tmavý, nebo podle zařízení.
 *
 * ⚠️ Zapisuje se JEDNA značka na kořenový prvek a zbytek dělá CSS. Kdyby se
 * barvy přepínaly v JS, musela by se každá nová barva pamatovat na dvou
 * místech — a jednou by se to zapomnělo.
 *
 * Prázdná hodnota značku smaže, takže platí `prefers-color-scheme` a appka
 * se přepne sama, když si telefon v noci přepne motiv.
 */
function pouzijVzhled() {
  const k = document.documentElement;
  if (state.theme === 'light' || state.theme === 'dark') k.dataset.theme = state.theme;
  else delete k.dataset.theme;

  // ⚠️ Prohlížeč musí vědět taky — jinak zůstanou posuvníky a políčka
  // formulářů v opačném režimu než appka kolem nich.
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = state.theme || 'light dark';

  // Mapa má vlastní styl a musí se přebarvit s appkou, ne až po znovunačtení.
  mapModule?.refreshTheme?.();
}

/**
 * Pořadí záložek. Pořadí v DOM se NEMĚNÍ — mění se jen `order` v CSS.
 *
 * ⚠️ Přehazovat prvky v DOM by znamenalo, že se čtečce obrazovky a klávesnici
 * změní pořadí procházení jinak než očima. Takhle je vizuální pořadí volba
 * vzhledu a strom zůstává stabilní.
 */
function pouzijPoradi() {
  // ⚠️ Značka jde na záložky I na uložené věci: skupiny sedí pod svými
  // záložkami, takže když se prohodí záložky, musí se prohodit i ony.
  for (const el of [document.querySelector('.tabs'), $('saved')]) {
    el?.setAttribute('data-primary', state.primary);
  }
}

/** Je mapa vypnutá parametrem v adrese? Používá to layoutový test. */
function mapaVypnuta() {
  return new URLSearchParams(location.search).get('nomap') === '1';
}

/**
 * Napíše sdělení do plochy mapy, aniž by se kvůli tomu tahal celý MapLibre.
 *
 * ⚠️ Modul mapy váží skoro megabajt. Kvůli jedné větě ho stahovat nebudeme —
 * proto se sem píše přímo, stejnou značkou, jakou používá `map.js`.
 */
function zpravaMistoMapy(text) {
  const box = $('map');
  if (!box) return;
  let p = box.querySelector('.map-zprava');
  if (!p) {
    p = document.createElement('p');
    p.className = 'map-zprava';
    box.append(p);
  }
  p.textContent = text;
}

/** Přesune kartu s mapou k obrazovce, která je zrovna vidět. */
function presunMapu() {
  const karta = document.querySelector('.map-card');
  if (!karta) return;                      // ?nomap=1 — kartu jsme odstranili
  const cil = state.screen === 'route' ? $('route-map-slot') : $('station-map-slot');
  if (karta.parentElement !== cil) cil.append(karta);

  // Klepnutí do mapy dělá na každé obrazovce něco jiného, takže to musí
  // říkat i nápověda pod ní. Tichá změna významu je horší než žádná.
  const hint = $('map-hint');
  if (hint) hint.textContent = t(state.screen === 'route' ? 'route.pickHint' : 'radar.pickHint', state.lang);

  // 🚨 Než se trasa spočítá, není mapu z čeho postavit — a prázdný obdélník
  // vypadá jako rozbitá appka. Michal 25. 8. 2026: „mapa tam není žádná."
  // Řekne se tedy, na co se čeká.
  if (mapaVypnuta()) { zpravaMistoMapy(t('radar.disabled', state.lang)); return; }

  if (state.screen === 'route' && !mapModule) {
    import('./map.js')
      .then((m) => {
        if (state.screen === 'route' && !mapModule) m.mapMessage(t('route.mapWaiting', state.lang));
      })
      .catch(() => { /* mapa se nenačetla — na trase to nic nekazí */ });
  }

  // Po přesunu má karta jinou šířku; MapLibre si rozměr sám nehlídá.
  mapModule?.refreshMap?.();
}

/**
 * Výběr místa klepnutím do mapy. Co se s ním stane, závisí na obrazovce:
 * na meteostanici je to nové místo, na trase start nebo cíl.
 */
function vyberZMapy(misto) {
  if (state.screen !== 'route') { selectPlace(misto); return; }

  // Prázdné pole se plní zleva doprava; když jsou obě plná, přepisuje se cíl.
  // Je to nejčastější případ: start bývá „odsud" a mění se, kam se letí.
  const kam = !state.route.from ? 'from' : 'to';
  state.route[kam] = misto;
  $(kam === 'from' ? 'route-from' : 'route-to').value = misto.name;
  poznamkaTrasy(t(kam === 'from' ? 'route.pickedFrom' : 'route.pickedTo', state.lang));
}

/**
 * Mapa pro obrazovku trasy.
 *
 * ⚠️ Když ještě není co ukázat, mapa se na trase VŮBEC neobjeví. Prázdná mapa
 * někde uprostřed republiky by tvrdila „tady jsi", což není pravda — a vymyslet
 * střed země je pořád vymýšlení (viz `odkudSeDivam()`).
 */
async function ukazMapuTrasy(trasaProMapu) {
  if (mapaVypnuta()) return;

  const stred = state.route.from || state.place || state.fix;
  if (!isUsablePoint(stred)) return;

  try {
    mapModule ??= await import('./map.js');
    await mapModule.showMap({
      lat: stred.lat, lon: stred.lon, lang: state.lang,
      timeZone: state.routeTimeZone || 'UTC',
      onPick: vyberZMapy,
      // Na trase se pohled nepřenastavuje na jeden bod — od toho je `fitBounds`
      // v `showRoute()`, který ukáže celou cestu.
      keepView: true,
    });
    presunMapu();
    mapModule.showRoute(trasaProMapu || null, { fit: !!trasaProMapu });
  } catch (e) {
    console.warn('[MeteoTrace] mapa trasy se nenačetla:', e.message);
  }
}

/** Trasa pro mapu. Rozhodování je v `route-view.js`, tady zbývá formát času. */
function trasaProMapu(view, trasa, pasmo) {
  return routeMapData(view, trasa.points, (p) => [
    formatClock(p.etaMs, pasmo, state.lang), p.condition, p.temp,
  ].filter(Boolean).join(" · "));
}


/**
 * Hlídá, na kterou stranu ještě pruh hodin pokračuje.
 *
 * 🚨 Že se dá rolovat, musí být vidět. Pruh to uměl od začátku, ale
 * s neviditelným posuvníkem to nebylo poznat — Michal 27. 8. 2026: „nevejde
 * se celá". Stín na kraji je jediné, co o tom řekne bez klepnutí.
 *
 * ⚠️ Zapojí se JEDNOU. Překreslení hodin nemá zakládat další posluchače;
 * po pár přepnutích místa by jich byly desítky.
 */
let rolovaniZapojeno = false;

function hlidejRolovani() {
  const pruh = $('hours');
  const box = $('hours-box');
  if (!pruh || !box) return;

  const prepocitej = () => {
    // ⚠️ Pruh přesahuje přes kraj karty a má vnitřní okraj, takže `scrollLeft`
    // je na začátku 18, ne 0. Bez téhle opravy svítí levý stín hned po
    // otevření a tvrdí, že vlevo něco je — přitom je to začátek.
    const zleva = parseFloat(getComputedStyle(pruh).paddingLeft) || 0;
    const zbyva = pruh.scrollWidth - pruh.clientWidth - pruh.scrollLeft;
    box.dataset.vlevo = pruh.scrollLeft > zleva + 4 ? '1' : '0';
    box.dataset.vpravo = zbyva > 4 ? '1' : '0';
  };

  if (!rolovaniZapojeno) {
    pruh.addEventListener('scroll', prepocitej, { passive: true });
    kolecemDoBoku(pruh);
    new ResizeObserver(prepocitej).observe(pruh);
    rolovaniZapojeno = true;
  }
  requestAnimationFrame(prepocitej);
}

/**
 * Kolečkem myši do boku.
 *
 * 🚨 Na počítači se vodorovný pruh myší roluje mizerně: kolečko hýbe
 * stránkou, ne pruhem, a člověk musí táhnout posuvník. Michal 27. 8. 2026.
 * Na telefonu je to prstem samozřejmé — na webu samozřejmé není.
 *
 * ⚠️ NEKRADE SE STRÁNCE ROLOVÁNÍ. Když je pruh na konci (nebo na začátku)
 * a člověk točí dál, událost se nechá projít a roluje stránka. Jinak by se
 * kurzor nad hodinami choval jako past, ve které stránka „zamrzne".
 *
 * ⚠️ Trackpad, který posílá vodorovný pohyb sám, se nechává být — jinak by
 * se pohyb sečetl dvakrát a pruh by ujížděl.
 */
function kolecemDoBoku(pruh) {
  pruh.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;      // vodorovný trackpad

    // Kolečko hlásí posun v pixelech, řádcích nebo stránkách — sjednotit.
    const krok = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? pruh.clientWidth : 1);
    const posun = e.deltaY * krok;
    const zbyva = pruh.scrollWidth - pruh.clientWidth - pruh.scrollLeft;

    if (posun > 0 && zbyva <= 1) return;                      // konec → nech stránku
    if (posun < 0 && pruh.scrollLeft <= 0) return;            // začátek → nech stránku

    e.preventDefault();
    pruh.scrollLeft += posun;
  }, { passive: false });
}

/**
 * Mapa s radarem. Načte se až teď, ne při startu appky.
 * Selhání mapy nesmí shodit zbytek obrazovky — počasí je důležitější.
 */
async function showRadar(timeZone) {
  // ?nomap=1 mapu vynechá. Používá to test rozvržení: pět rámů, každý
  // s vlastním MapLibre a WebGL, by stránku přetížilo — a rozvržení se
  // na mapě stejně neměří, je to div s pevnou výškou.
  //
  // 🚨 A ŘEKNE SE TO. Dřív se karta mlčky odstranila, takže appka vypadala
  // úplně stejně jako appka s rozbitou mapou — a přesně na tom se Michal
  // 25. 8. 2026 chytil: dostal ode mě odkaz s `?nomap=1` a hlásil „mapa tam
  // není žádná". Vypnutá věc musí být poznat od vadné.
  if (mapaVypnuta()) {
    zpravaMistoMapy(t('radar.disabled', state.lang));
    return;
  }
  try {
    mapModule ??= await import('./map.js');
    await mapModule.showMap({
      lat: state.place.lat, lon: state.place.lon, lang: state.lang, timeZone,
      // Klepnutí do mapy vybere místo. Projde touž cestou jako výsledek
      // hledání, takže se o něj postará i hvězdička a uložená místa.
      onPick: vyberZMapy,
      keepView: state.place.fromMap === true,
    });
    // I když výstraha není, musí se zavolat — jinak by po přepnutí místa
    // zůstal na mapě viset obrys toho předchozího.
    presunMapu();
    mapModule.showWarningArea(state.warningArea?.geometrie || null, state.warningArea?.trida);
    // Trasa na meteostanici nepatří — jinak by na mapě zůstala viset čára
    // k místu, které si uživatel právě přestal prohlížet.
    mapModule.showRoute(null);
  } catch (e) {
    console.warn('[MeteoTrace] mapa se nenačetla:', e.message);
  }
}

/**
 * Lístek alergenu. Kreslí se čárou, barvu si bere z okolí (`currentColor`),
 * takže drží semafor stejně jako odznak vedle.
 *
 * ⚠️ Pro odečítač obrazovky je to výzdoba — jméno druhu i stupeň jsou vedle
 * jako text. Piktogram, který by nesl informaci sám, by byl pro nevidomého
 * prázdné místo.
 */
function pollenSvg(species) {
  const tvar = pollenIcon(species);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pollen-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (!tvar) return svg;                       // neznámý druh: prázdné místo, ne cizí tvar

  if (tvar.plocha) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', tvar.plocha);
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('opacity', '0.9');   // silueta NESE tvar, nemůže být přišeptaná
    svg.append(p);
  }
  if (tvar.cara) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', tvar.cara);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
  }
  if (tvar.kruh) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', tvar.kruh[0]);
    c.setAttribute('cy', tvar.kruh[1]);
    c.setAttribute('r', tvar.kruh[2]);
    c.setAttribute('fill', 'currentColor');
    c.setAttribute('opacity', '0.9');
    svg.append(c);
  }
  return svg;
}

/* ============================================================
   TRASA — DRUHÁ OBRAZOVKA

   Odlišovač celé appky (R8): počasí v bodech cesty V ČASE PŘÍJEZDU.
   Veškerý výpočet leží v otestovaných modulech (`eta.js`, `route-adapter.js`,
   `route-view.js`); tady se jen skládá obrazovka.
   ============================================================ */

/** Způsoby dopravy. Klíč je profil ORS, ten se posílá jako dovětek cesty. */
const ZPUSOBY = [
  { profil: 'driving-car', klic: 'route.car' },
  { profil: 'cycling-regular', klic: 'route.bike' },
  { profil: 'foot-walking', klic: 'route.walk' },
  // ⚠️ Vzdušná čára NENÍ profil ORS. Trasa se počítá u nás a ven nejde ani
  // jeden dotaz na routing — proto `bezRouteru`. Jádro to nepozná: dostane
  // tentýž tvar dat jako od routeru (R4).
  { profil: 'straight', klic: 'route.straight', bezRouteru: true },
];

/**
 * Po kolika metrech se trasa vzorkuje.
 *
 * ⚠️ Kompromis, ne libovolné číslo: hustší vzorkování znamená víc bodů
 * v jednom dotazu na předpověď (delší odpověď na mobilní data) a jemnější
 * obrázek. 25 km je na autě zhruba čtvrthodina jízdy — kratší úsek by se
 * v hodinové předpovědi stejně neprojevil.
 */
const KROK_M = 25000;

/** Posuny odjezdu, které se srovnávají. Víc než tři hodiny dopředu nikdo neplánuje. */
const POSUNY_MIN = [0, 60, 120, 180];

/**
 * Blíž než tohle už to není cesta, ale tentýž bod.
 *
 * Stejný práh jako u shody uložených míst (`places.js`): co se vejde do
 * 150 metrů, je pro člověka „tady".
 */
const STEJNE_MISTO_M = 150;

function prepniObrazovku(kam) {
  state.screen = kam;
  $('station').hidden = kam !== 'station' || !state.place;
  $('route').hidden = kam !== 'route';
  $('splash').hidden = kam !== 'station' || !!state.place;
  for (const [id, jmeno] of [['tab-station', 'station'], ['tab-route', 'route']]) {
    $(id).setAttribute('aria-selected', String(kam === jmeno));
  }
  presunMapu();
}

/**
 * Výběr místa do pole na obrazovce trasy.
 *
 * Používá totéž hledání jako hlavní pole nahoře — jen si drží vlastní výsledky
 * a vlastní zrušení. Kdyby sdílelo `requests.run('search')` s hlavním polem,
 * psaní do jednoho pole by rušilo dotaz druhého.
 */
/**
 * Uložená místa do nabídky v polích trasy.
 *
 * ⚠️ Hledá se v JEDNOM jméně — tom, které místu dal uživatel. „Domov" nemá
 * s obcí nic společného a hledat ho podle původního názvu by znamenalo, že
 * si vlastní pojmenování nenajde.
 *
 * ⚠️ Bez diakritiky, ať „prace" najde „Práci" — psaní na telefonu bez háčků
 * je běžnější než s nimi.
 */
function ulozenaProNabidku(dotaz) {
  const q = stripDiacritics(String(dotaz || '').trim().toLowerCase());
  const vse = state.places.places;
  if (!q) return vse.slice(0, 5);
  return vse.filter((p) => stripDiacritics(p.name.toLowerCase()).includes(q)).slice(0, 5);
}

/**
 * Zápis místa do trasy. Cíl je `'from'`, `'to'`, nebo POŘADÍ mezibodu.
 *
 * ⚠️ Jedno místo zápisu schválně: bez něj by každá nová obsluha musela vědět,
 * že mezibody jsou pole a start s cílem klíče — a jednou by se to spletlo.
 */
function zapisMisto(kam, misto) {
  if (typeof kam === 'number') state.route.via[kam] = misto;
  else state.route[kam] = misto;
}

/**
 * Pole mezibodů.
 *
 * ⚠️ Pole se překresluje CELÉ při každé změně počtu, takže se rozepsaný text
 * bere ze stavu, ne z DOM. Rozdělaný mezibod se drží jako `null` — jméno
 * v poli by nestačilo, protože k trase je potřeba souřadnice.
 *
 * ⚠️ Řádky nemají stabilní `id`, ale nabídka výsledků ho potřebuje — dostanou
 * ho podle pořadí. Po odebrání se tedy překreslí všechny.
 */
function vykresliMezibody() {
  const box = $('route-via');
  box.innerHTML = '';

  state.route.via.forEach((misto, i) => {
    const radek = document.createElement('div');
    radek.className = 'route-via-row';

    const pole = document.createElement('label');
    pole.className = 'route-field';
    pole.append(el('span', '', `${t('route.via', state.lang)} ${i + 1}`));

    const input = document.createElement('input');
    input.type = 'search';
    input.id = `route-via-${i}`;
    input.autocomplete = 'off';
    input.placeholder = t('route.viaPlaceholder', state.lang);
    input.value = misto?.name || '';
    pole.append(input);

    const nabidka = document.createElement('ul');
    nabidka.id = `route-via-${i}-results`;
    nabidka.className = 'results inline';
    nabidka.hidden = true;
    pole.append(nabidka);

    const pryc = el('button', 'icon-btn', '✕');
    pryc.type = 'button';
    pryc.title = t('route.removeVia', state.lang);
    pryc.setAttribute('aria-label', t('route.removeVia', state.lang));
    pryc.addEventListener('click', () => {
      state.route.via.splice(i, 1);
      vykresliMezibody();
      skryjVysledekTrasy();
    });

    radek.append(pole, pryc);
    box.append(radek);

    pripojVyber(input.id, nabidka.id, i);
  });
}

function pripojVyber(inputId, resultsId, kam) {
  const input = $(inputId);
  const results = $(resultsId);
  let timer = 0;

  const skryj = () => { results.hidden = true; results.innerHTML = ''; };

  // 🚨 Uložená místa patří i sem. Kdo si uloží „Domov" a „Práci", nechce je
  // při každé trase znovu vypisovat — a hledat vlastní domov přes geokodér
  // je absurdní. Prázdné pole proto rovnou nabídne, co má člověk uložené.
  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      const ulozena = ulozenaProNabidku('');
      if (ulozena.length) ukazVysledky([], ulozena);
    }
  });

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    // Vybrané místo přestává platit ve chvíli, kdy uživatel začne psát něco
    // jiného. Jinak by tlačítko počítalo trasu do místa, které už není v poli.
    zapisMisto(kam, null);
    // Uložená místa se ukazují hned — nečeká se na síť ani na dvě písmena.
    const ulozena = ulozenaProNabidku(q);
    if (q.length < 2) {
      if (ulozena.length) ukazVysledky([], ulozena);
      else skryj();
      return;
    }
    ukazVysledky([], ulozena);
    timer = setTimeout(async () => {
      try {
        const { data } = await requests.run(`search-${kam}`, (signal) =>
          apiGet('geocode', { name: q, count: 8, language: state.lang, ...odkudSeDivam() }, { signal }));
        ukazVysledky(data?.results || [], ulozenaProNabidku(q));
      } catch (e) {
        if (!requests.isAbort(e)) ukazVysledky([], ulozenaProNabidku(q));
      }
    }, 280);
  });

  input.addEventListener('blur', () => setTimeout(skryj, 150));

  function ukazVysledky(list, ulozena = []) {
    results.hidden = false;
    // Poslední řádek je sdělení, ne místo: buď „nic jsme nenašli", nebo
    // „nevím, kde jsi, tak to neumím seřadit". Obojí je stav, který by jinak
    // vypadal jako obyčejná nabídka. Viz `odkudSeDivam()`.
    // Uložená místa jdou první: jsou to jistoty, ne návrhy.
    const radky = ulozena.map((m) => ({ ulozene: m }));
    if (list.length) radky.push(...list);
    else if (!ulozena.length) radky.push({ zprava: t('search.noResults', state.lang) });
    if (list.length && !znamePolohu()) radky.push({ zprava: t('search.noFocus', state.lang) });

    fill(results, radky, (r) => {
      const li = document.createElement('li');
      if (r.zprava) {
        li.className = 'empty';
        li.textContent = r.zprava;
        return li;
      }
      // Uložené místo se pozná hvězdičkou — ať je jasné, proč je nahoře
      // a proč u něj není adresa z geokodéru.
      const ulozene = r.ulozene;
      const btn = el('button', '', [
        el('span', 'r-name', ulozene ? `★ ${ulozene.name}` : r.name),
        el('span', 'r-meta', ulozene ? t('places.saved', state.lang) : placeMeta(r)),
      ]);
      btn.type = 'button';
      if (ulozene) {
        btn.addEventListener('click', () => {
          zapisMisto(kam, {
            name: ulozene.name, country: ulozene.country, lat: ulozene.lat, lon: ulozene.lon,
          });
          input.value = ulozene.name;
          skryj();
        });
        li.append(btn);
        return li;
      }
      btn.addEventListener('click', () => {
        // 🚨 V poli zůstává ÚPLNÁ adresa i s obcí — „náměstí Republiky" samo
        // o sobě nerozliší osm měst, ve kterých takové náměstí je.
        zapisMisto(kam, {
          name: placeTitle(r), country: r.country, lat: r.latitude, lon: r.longitude,
        });
        input.value = placeLabel(r);
        skryj();
      });
      li.append(btn);
      return li;
    });
  }
}

function vykresliZpusoby() {
  fill($('route-modes'), ZPUSOBY, (z) => {
    const b = el('button', 'mode', t(z.klic, state.lang));
    b.type = 'button';
    b.dataset.profil = z.profil;
    b.setAttribute('aria-pressed', String(state.route.profil === z.profil));
    b.addEventListener('click', () => {
      // ⚠️ Způsob dopravy je součást identity trasy (R8) — autem a na kole
      // je to jiná cesta i jiný čas. Přepnutí proto musí zahodit starý
      // výsledek, ne ho nechat viset pod novým tlačítkem.
      state.route.profil = z.profil;
      vykresliZpusoby();
      vykresliRychlost();
      // U vzdušné čáry se rovnou řekne, co umí a co ne — že se nevyhýbá
      // pevnině, se nesmí zjistit až podle divné trasy přes Dánsko.
      poznamkaTrasy(z.bezRouteru ? t('route.straightNote', state.lang) : null);
      skryjVysledekTrasy();
    });
    return b;
  });
}

/** Rychlost se ptá jen tam, kde ji nemá kdo spočítat. */
function vykresliRychlost() {
  const zpusob = ZPUSOBY.find((z) => z.profil === state.route.profil);
  $('route-speed-row').hidden = !zpusob?.bezRouteru;
}

function skryjVysledekTrasy() {
  $('route-summary-card').hidden = true;
  $('route-points-card').hidden = true;
}

function poznamkaTrasy(text) {
  const p = $('route-note');
  p.textContent = text || '';
  p.hidden = !text;
}

/**
 * Spočítá trasu a počasí na ní.
 *
 * Tři dotazy ven, v tomhle pořadí a ne jinak:
 *   1. trasa (ORS) — bez ní není kudy,
 *   2. předpověď pro VŠECHNY body jedním dotazem,
 *   3. …a to je všechno. Srovnání časů odjezdu je zadarmo, počítá se
 *      z týchž dat, jen z jiných hodin (R8).
 */
async function loadRoute() {
  const { from, to, profil } = state.route;
  if (!from || !to) { poznamkaTrasy(t('route.needBoth', state.lang)); return; }

  // 🚨 Trasa z místa do téhož místa NENÍ trasa. Appka ji ochotně spočítala
  // („0,0 km, příjezd v 18:46") a tvářila se, že je všechno v pořádku —
  // přitom to je zadání, které nedává smysl. Michal na to narazil 25. 8. 2026
  // přes „jeď sem", když se start nedal zjistit a spadl na prohlížené místo.
  if (distanceM([from.lat, from.lon], [to.lat, to.lon]) < STEJNE_MISTO_M) {
    poznamkaTrasy(t('route.sameSpot', state.lang));
    skryjVysledekTrasy();
    return;
  }

  poznamkaTrasy(t('route.computing', state.lang));
  skryjVysledekTrasy();

  try {
    const zpusob = ZPUSOBY.find((z) => z.profil === profil);

    // 🚨 Trasa se skládá z ÚSEKŮ mezi sousedními body. Mezibody umí ORS jen
    // přes POST s tělem, a naše proxy propouští jen GET (`R2`) — což je
    // bezpečnostní rozhodnutí, ne nedodělek. Viz `spojUseky()`.
    const zastavky = [from, ...state.route.via.filter(Boolean), to];
    const useky = [];

    for (let i = 0; i < zastavky.length - 1; i += 1) {
      const a = zastavky[i];
      const b = zastavky[i + 1];
      let usek;

      if (zpusob?.bezRouteru) {
        // Ani jeden dotaz ven: ortodroma se spočítá u nás ze dvou bodů
        // a rychlosti, kterou zadal uživatel. Jádru je jedno, odkud trasa je.
        usek = straightRoute([a.lat, a.lon], [b.lat, b.lon], state.route.rychlostKmh);
      } else {
        const geo = await requests.run(`route-${i}`, (signal) =>
          apiGet('route', { start: toOrsCoord([a.lat, a.lon]), end: toOrsCoord([b.lat, b.lon]) },
            { signal, subPath: profil }));
        usek = fromOpenRouteService(geo.data);
      }

      // ⚠️ Chybějící úsek NELZE přeskočit. Trasa bez něj by vedla jinudy,
      // než uživatel zadal, a nic by na to neupozornilo.
      if (!usek) { poznamkaTrasy(t('route.failed', state.lang)); return; }
      // Popis úseku pro výpis: odkud kam a kolik to je. Bez toho by se dalo
      // ukázat jen „celkem 97 km", což u cesty přes zastávky nestačí.
      usek.from = a;
      usek.to = b;
      usek.distanceM = usek.totalDistanceM;
      usek.durationS = usek.totalDurationS;
      useky.push(usek);
    }

    const trasa = spojUseky(useky);
    if (!trasa) { poznamkaTrasy(t('route.failed', state.lang)); return; }

    const vzorky = sampleRoute(trasa.points, KROK_M);
    const fc = await requests.run('route-forecast', (signal) =>
      apiGet('forecast', { ...toForecastParams(vzorky), ...ROUTE_FORECAST_PARAMS }, { signal }));

    const mista = asLocationList(fc.data);
    if (!mista.length) { poznamkaTrasy(t('route.noWeather', state.lang)); return; }

    const hourMs = hoursToMs(mista[0]);
    const odjezd = Date.now();
    const plan = planRoute({ ...trasa, departureMs: odjezd, hourMs, stepM: KROK_M });
    const view = buildRouteView({ plan, forecast: fc.data, lang: state.lang, units: state.units });
    if (!view) { poznamkaTrasy(t('route.noWeather', state.lang)); return; }

    // Srovnání odjezdů — bez jediného dotazu navíc.
    const varianty = departureOptions({
      ...trasa, baseDepartureMs: odjezd, offsetsMin: POSUNY_MIN, hourMs, stepM: KROK_M,
    });
    const srovnani = compareDepartures({
      options: varianty, forecast: fc.data, lang: state.lang, units: state.units,
    });

    poznamkaTrasy(null);
    vykresliTrasu({ view, plan, trasa, srovnani, mista, useky });
  } catch (e) {
    if (requests.isAbort(e)) return;
    poznamkaTrasy(`${t('route.failed', state.lang)} ${e.message}`);
  }
}

/* ============================================================
   SROVNÁNÍ ČASŮ ODJEZDU (`R8`, bod 3)

   🚨 TAHLE FUNKCE JE ZADARMO — a je dost možná tím, co appku prodá líp než
   samotné trasy. Open-Meteo nevrací pro bod jedno číslo, ale CELÉ HODINOVÉ
   POLE. Po jednom volání máme v paměti počasí ve všech bodech ve všech
   hodinách, takže otázka „a co když vyjedu o dvě hodiny později?" je jen
   čtení jiného indexu v datech, která už jsou stažená.

   **Ani jeden dotaz navíc, žádné čekání.** Proto se varianty počítají rovnou
   při výpočtu trasy a přepínač je jen ukazuje.
   ============================================================ */


/**
 * Rozpis úseků pod souhrnem. Ukazuje se jen u trasy se zastávkami — u cesty
 * z A do B by jen zopakoval, co je o řádek výš.
 */
function vykresliUseky(useky, odjezdMs, pasmo) {
  const box = $('route-legs');
  const data = legRows(useky, odjezdMs);
  box.hidden = !data;
  if (!data) return;

  box.innerHTML = '';
  for (const r of data.rows) {
    box.append(el('li', 'leg', [
      el('span', 'leg-kam', `${r.from} → ${r.to}`),
      el('span', 'leg-km', formatDistance(r.distanceM, state.units, state.lang)),
      el('span', 'leg-cas', formatClock(r.arrivalMs, pasmo, state.lang)),
    ]));
  }

  // ⚠️ Součet se vypisuje i tady, přestože je v souhrnu nad tím: v rozpisu
  // jsou čísla pod sebou a oko je sečíst zkusí. Když to nesedí, člověk hledá
  // chybu — a když sedí, je to potvrzení.
  box.append(el('li', 'leg leg-soucet', [
    el('span', 'leg-kam', t('route.total', state.lang)),
    el('span', 'leg-km', formatDistance(data.totalDistanceM, state.units, state.lang)),
    el('span', 'leg-cas', formatClock(data.arrivalMs, pasmo, state.lang)),
  ]));
}

/** Krátký odznak k variantě: co na té cestě čeká. */
function odznakVarianty(summary) {
  if (summary.hazardCount) return tf('route.badgeHazard', { count: summary.hazardCount }, state.lang);
  if (summary.rainCount) return tf('route.badgeRain', { count: summary.rainCount }, state.lang);
  return t('route.badgeClear', state.lang);
}

function vykresliOdjezdy() {
  const r = state.routeResult;
  const varianty = r?.srovnani?.options || [];

  // Jedna varianta není srovnání. Přepínač o jednom tlačítku by jen zabíral
  // místo a předstíral volbu, která neexistuje.
  $('route-departures').hidden = varianty.length < 2;
  if (varianty.length < 2) return;

  fill($('route-departures'), varianty, (v) => {
    const b = el('button', 'departure', [
      el('span', 'dep-time', v.offsetMin === 0
        ? t('route.now', state.lang)
        : tf('route.later', { hours: Math.round(v.offsetMin / 60) }, state.lang)),
      el('span', 'dep-badge', odznakVarianty(v.summary)),
    ]);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v.offsetMin === r.posun));
    // Nejlepší varianta je označená i tehdy, když zrovna není vybraná —
    // jinak by rada nad přepínačem ukazovala někam, kde nic není vidět.
    if (r.srovnani.worthMoving && v.offsetMin === r.srovnani.best.offsetMin) {
      b.dataset.best = '1';
    }
    if (v.summary.hazardCount) b.dataset.hazard = '1';
    b.addEventListener('click', () => prepniOdjezd(v.offsetMin));
    return b;
  });
}

/**
 * Přepnutí odjezdu.
 *
 * ⚠️ Přepíná se CELÝ výsledek — souhrn, body i mapa. Kdyby se přepsal jen
 * seznam, ukazoval by souhrn nad ním čas příjezdu jiné varianty a nikdo by
 * si toho nevšiml.
 */
function prepniOdjezd(posun) {
  const r = state.routeResult;
  const varianta = r?.srovnani?.options.find((o) => o.offsetMin === posun);
  if (!varianta) return;

  vykresliTrasu({
    view: varianta,
    plan: varianta.plan || r.plan,
    trasa: r.trasa,
    srovnani: r.srovnani,
    mista: [{ timezone: r.pasmo }],
    useky: r.useky,
  });
}


function vykresliTrasu({ view, plan, trasa, srovnani, mista, useky }) {
  const pasmo = mista[0]?.timezone || 'UTC';

  // Výsledek se drží celý, ať jde přepnout odjezd bez jediného dotazu ven.
  // Varianty jsou spočítané už teď — viz `vykresliOdjezdy()`.
  state.routeResult = {
    view, plan, trasa, srovnani, pasmo, useky: useky || state.routeResult?.useky,
    posun: view.offsetMin || 0,
  };
  vykresliOdjezdy();

  $('route-summary-card').hidden = false;
  renderRoutes();
  $('route-summary').textContent = tf('route.result', {
    distance: formatDistance(trasa.totalDistanceM, state.units, state.lang),
    arrival: formatClock(plan.arrivalMs, pasmo, state.lang),
  }, state.lang);

  // ⚠️ Věty o nejistotě se PŘIDÁVAJÍ, nenahrazují souhrn. Odhadnutý čas
  // a část trasy za obzorem předpovědi jsou dvě různé věci a obojí musí být
  // vidět — mlčky vydávat odhad za jistotu je horší než ho neukázat.
  const dovetky = [];
  if (plan.estimated) dovetky.push(t('route.estimated', state.lang));
  if (plan.beyondForecast) dovetky.push(t('route.beyond', state.lang));
  if (view.summary.hazardCount) {
    dovetky.push(tp('route.hazards', view.summary.hazardCount, {}, state.lang));
  } else if (view.summary.rainCount) {
    dovetky.push(tp('route.rain', view.summary.rainCount, {}, state.lang));
  } else {
    dovetky.push(t('route.clear', state.lang));
  }
  $('route-summary').append(el('span', 'route-extra', dovetky.join(' ')));

  // 🚨 Co tam zastihneš, je celý smysl appky — souhrn to musí říct, ne jen
  // kolik je to kilometrů. Viz `arrivalSentence()`.
  const veta = arrivalSentence(view, formatClock(plan.arrivalMs, pasmo, state.lang), state.lang);
  const cil = $('route-arrival');
  cil.hidden = !veta;
  cil.textContent = veta;

  // Hláška k trase. ⚠️ Stojí POD údaji jako dovětek — kdyby zabrala místo
  // teploty nebo větru, byla by z appky legrace, ne nástroj. A u nebezpečí
  // mlčí, viz `quips.js`.
  const posledni = view.points[view.points.length - 1];
  const hlaska = routeQuip({
    hazard: view.summary.hazardCount > 0,
    // 🚨 Jev se musí pojmenovat — vtip, ze kterého se nedozvíš, co hrozí,
    // je jen vtip. Bere se ten nejzávažnější po trase.
    hazardWhat: view.summary.worst?.condition || '',
    rainCount: view.summary.rainCount,
    windKmh: Math.max(0, ...view.points.map((p) => p.windKmh || 0)),
    // ⚠️ Směr se bere od bodu, kde fouká nejvíc — o tom se mluví.
    windDirKey: view.points.reduce((a, p) => ((p.windKmh || 0) > (a?.windKmh || 0) ? p : a), null)?.windDirKey || "",
    tempC: posledni?.tempC ?? null,
    distanceM: trasa.totalDistanceM,
    arrivalHour: new Date(plan.arrivalMs).getHours(),
  }, state.lang);

  const zert = $('route-quip');
  zert.hidden = !hlaska;
  zert.textContent = hlaska;

  // Dovětek o okolí trasy se dotahuje zvlášť a nikoho nezdržuje.
  ukazOkoliTrasy(view, trasa.points);

  // Rada o posunu odjezdu se ukáže, JEN když má cenu (R8: `worthMoving`).
  // Rada bez užitku podkopává důvěru ve všechny ostatní.
  const rada = $('route-advice');
  const lepsi = srovnani.worthMoving && srovnani.best && srovnani.best.offsetMin > 0;
  rada.hidden = !lepsi;
  if (lepsi) rada.textContent = departureAdvice(view.summary, srovnani.best.offsetMin, state.lang);

  vykresliUseky(useky, view.departureMs || Date.now(), pasmo);

  $('route-points-card').hidden = false;
  fill($('route-points'), view.points, (p) => {
    const li = document.createElement('li');
    li.className = 'route-point';
    if (p.hazard) li.dataset.hazard = '1';

    const cas = el('span', 'rp-time', formatClock(p.etaMs, pasmo, state.lang));
    // ⚠️ Nula je platná nadmořská výška (hladina moře), takže se testuje
    // konečnost, ne pravdivost. Jinak by pobřežní bod vypadal, jako by se
    // výška neznala.
    const kmText = formatDistance(p.distanceM, state.units, state.lang);
    const km = el('span', 'rp-km', Number.isFinite(p.elevationM)
      ? `${kmText} · ${Math.round(p.elevationM)} m n. m.`
      : kmText);
    const ikona = el('span', 'rp-icon', p.icon);
    const popis = el('span', 'rp-cond', p.condition || '');
    const teplota = el('span', 'rp-temp', p.temp ?? '');

    // 🚨 Samotné srážky nestačí. Michal 26. 8. 2026: „mělo by to psát i vítr,
    // normální i pocitovou teplotu, protože třeba vítr fouká." Pro pilota je
    // náraz větru důležitější než déšť.
    //
    // ⚠️ Píše se jen to, co něco přidává: pocitovka když se liší od teploměru,
    // náraz když je citelně nad průměrem. Jinak by každý řádek nesl tatáž
    // čísla dvakrát a přestalo by se to číst.
    const detaily = [];
    let popisSmeru = '';
    if (p.known) {
      if (p.wind && p.wind !== '—') {
        // Celé slovo i tady. Řádek je delší, ale „12 km/h severovýchodní"
        // se dá přečíst; „12 km/h SV" se dá jen tušit.
        const smerem = p.windDirLong || (p.windDir !== '—' ? p.windDir : '');
        detaily.push(`${p.wind}${smerem ? ` ${smerem}` : ''}`);
        if (p.windDirLong) popisSmeru = p.windDirLong;
      }
      if (p.gustsMatter && p.gusts && p.gusts !== '—') {
        detaily.push(`${t('now.gusts', state.lang).toLowerCase()} ${p.gusts}`);
      }
      if (p.feelsDiffers && p.feels && p.feels !== '—') {
        detaily.push(`${t('now.feelsLike', state.lang).toLowerCase()} ${p.feels}`);
      }
      if (p.rain && p.precipProbText && p.precipProbText !== '—') {
        detaily.push(`${t('now.precipitation', state.lang).toLowerCase()} ${p.precipProbText}`);
      }
    }

    const text = [popis, km];
    if (detaily.length) {
      const radek = el('span', 'rp-detail', detaily.join(' · '));
      // Zkratka směru se vysvětlí i tady — bublinou a pro odečítač obrazovky.
      if (popisSmeru) radek.title = `${t('now.wind', state.lang)}: ${popisSmeru}`;
      text.push(radek);
    }
    if (p.gustsMatter) li.dataset.gusts = '1';

    li.append(cas, ikona, el('span', 'rp-text', text), teplota);
    return li;
  });

  // A totéž do mapy: čára trasy a body obarvené podle toho, co v nich čeká.
  state.routeTimeZone = pasmo;
  ukazMapuTrasy(trasaProMapu(view, trasa, pasmo));
}

/* ---------- drobné pomůcky nad DOM ---------- */

function el(tag, cls, content) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (Array.isArray(content)) node.append(...content);
  else if (content != null) node.textContent = content;
  return node;
}

function fill(parent, items, build) {
  parent.innerHTML = '';
  for (const item of items) parent.append(build(item));
}

/**
 * Pruh s upozorněním.
 *
 * ⚠️ `state.banner` je trvalé sdělení o stavu appky (třeba že se uložená
 * místa nedají měnit). Chvilkové hlášky ho smějí překrýt, ale `notice(null)`
 * ho vrátí — jinak by ho první načtení stanice smazalo a uživatel by se
 * o stavu appky dozvěděl jen na zlomek vteřiny při startu.
 */
function notice(text) {
  const n = $('notice');
  const msg = text || state.banner || '';
  n.textContent = msg;
  n.hidden = !msg;
}

function humanAge(seconds) {
  const min = Math.round(seconds / 60);
  return min < 60
    ? `${min} ${t('time.min', state.lang)}`
    : `${Math.round(min / 60)} ${t('time.hour', state.lang)}`;
}

/* ============================================================
   START
   ============================================================ */

/**
 * Místo zadané v odkazu: `?lat=50.08&lon=14.44&name=Praha`.
 *
 * Slouží ke sdílení („koukni, jaké je počasí tady") a zároveň se díky tomu
 * dá appka otevřít rovnou na konkrétním místě, aniž by se do ní muselo klikat.
 * Jazyk a jednotky jdou přebít stejně (`?lang=cs&units=imperial`).
 */
function placeFromUrl() {
  const q = new URLSearchParams(location.search);
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  // Nesmysl se neukládá — mimo rozsah i nulový ostrov, viz `isUsablePoint()`.
  if (!isUsablePoint({ lat, lon })) return null;
  return { name: q.get('name') || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon };
}

function init() {
  load();
  loadPlaces();

  const q = new URLSearchParams(location.search);
  const fromUrl = placeFromUrl();
  if (fromUrl) state.place = fromUrl;
  if (LANG_NAMES[q.get('lang')]) state.lang = q.get('lang');
  if (q.get('units') === 'imperial') state.units = defaultUnits('en-US');
  if (q.get('units') === 'metric') state.units = defaultUnits('cs-CZ');

  if (!state.lang || !LANG_NAMES[state.lang]) state.lang = detectLang(navigator.languages || []);
  if (!state.units) state.units = defaultUnits(navigator.language || '');

  pouzijVzhled();
  pouzijPoradi();
  applyI18n();
  renderSaved();
  renderRoutes();

  // Poloha na pozadí — jen když už je povolená. Nikdo se kvůli řazení
  // nabídky neptá; viz `tichaPoloha()`.
  tichaPoloha();

  // 🚨 Řekni to hned, ne až při pokusu o zápis. Hvězdička je v tomhle režimu
  // vypnutá, takže žádné klepnutí nepřijde a hláška vázaná na zápis by se
  // nikdy nezobrazila. Stav je výjimečný, tak si pruh zaslouží.
  if (state.places.readOnly) {
    state.banner = t('places.readOnly', state.lang);
    notice(null);
  }

  $('search-input').addEventListener('input', (e) => onSearchInput(e.target.value));
  $('search-form').addEventListener('submit', (e) => e.preventDefault());
  $('btn-locate').addEventListener('click', locate);
  $('btn-save').addEventListener('click', toggleSave);
  $('routes-toggle').addEventListener('click', () => prepniPanel('routes-toggle', 'routes-panel'));
  $('places-toggle').addEventListener('click', () => prepniPanel('places-toggle', 'places-panel'));

  // ⚠️ Rozbalený seznam se zavírá klepnutím vedle i Escapem. Panel, který
  // zůstane viset přes obsah, je horší než žádný.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.saved-group')) zavriPanely();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zavriPanely(); });

  // Po otočení telefonu nebo rozložení skládacího displeje se do řádku vejde
  // jiný počet štítků — musí se přepočítat, ne zůstat podle staré šířky.
  new ResizeObserver(() => {
    srovnejRadek('saved-routes-list');
    srovnejRadek('saved-list');
  }).observe($('saved'));
  $('btn-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => $('settings-dialog').close());
  $('set-lang').addEventListener('change', (e) => zmenJazyk(e.target.value));
  $('set-theme').addEventListener('change', (e) => { state.theme = e.target.value; save(); pouzijVzhled(); });
  $('set-primary').addEventListener('change', (e) => { state.primary = e.target.value; save(); pouzijPoradi(); });
  for (const osa of Object.keys(JEDNOTKY)) {
    $(`set-${osa}`).addEventListener('change', (e) => zmenJednotku(osa, e.target.value));
  }
  $('tab-station').addEventListener('click', () => prepniObrazovku('station'));
  $('tab-route').addEventListener('click', () => prepniObrazovku('route'));
  $('route-go').addEventListener('click', loadRoute);
  $('route-add-via').addEventListener('click', () => {
    // Nový mezibod je zatím prázdný — vyplní ho až výběr z nabídky.
    state.route.via.push(null);
    vykresliMezibody();
    $(`route-via-${state.route.via.length - 1}`)?.focus();
  });
  $('btn-save-route').addEventListener('click', toggleSaveRoute);
  $('route-swap').addEventListener('click', () => {
    // Prohození musí přehodit i text v polích, ne jen data — jinak by pole
    // ukazovala něco jiného, než co se spočítá.
    const { from, to } = state.route;
    state.route.from = to;
    state.route.to = from;
    // ⚠️ Cesta zpátky vede přes tytéž zastávky, ale v opačném pořadí.
    state.route.via.reverse();
    vykresliMezibody();
    const a1 = $('route-from');
    const b1 = $('route-to');
    [a1.value, b1.value] = [b1.value, a1.value];
    skryjVysledekTrasy();
  });
  $('route-speed').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    // Nesmyslná rychlost se nedosazuje mlčky: pole si drží, co uživatel napsal,
    // a výpočet se prostě nespustí (straightRoute vrátí null → hláška).
    state.route.rychlostKmh = Number.isFinite(v) && v > 0 ? v : 0;
    skryjVysledekTrasy();
  });
  vykresliRychlost();
  pripojVyber('route-from', 'route-from-results', 'from');
  pripojVyber('route-to', 'route-to-results', 'to');
  vykresliZpusoby();
  vykresliMezibody();
  $('places-close').addEventListener('click', () => $('places-dialog').close());
  // Rozepsané jméno se má uložit i tehdy, když se dialog zavře klávesou Esc
  // nebo klepnutím vedle — jinak by práce zmizela bez varování.
  $('places-dialog').addEventListener('close', () => {
    const otevrene = document.activeElement;
    if (otevrene && otevrene.classList?.contains('manage-name')) otevrene.blur();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.top')) hideResults();
  });

  // Návrat do appky = data můžou být stará. Vyžádat čerstvá, ale jen když
  // je co ukazovat — jinak by se zbytečně střílelo do prázdna.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.place) loadStation();
  });

  if (state.place) loadStation();

  // Levá záložka je zároveň ta, kterou appka začíná — jinak by nastavení
  // slibovalo něco jiného, než dělá.
  //
  // ⚠️ Výjimka: když se otevírá trasa a není z čeho ji počítat, ale uložené
  // místo existuje, ukáže se rovnou počasí. Prázdný formulář místo dat by
  // byl krok zpátky pro toho, kdo appku otevírá kvůli jedné rychlé věci.
  const zacniNa = state.primary === 'route' && (state.route.from || !state.place)
    ? 'route'
    : 'station';
  prepniObrazovku(zacniNa);
}

/**
 * Service worker — jen na webu.
 *
 * 🚨 V androidím obalu se NEREGISTRUJE. Assety tam servíruje
 * `WebViewAssetLoader` z balíčku appky a service worker s vlastní cache by
 * po aktualizaci APK pouštěl staré soubory. Poučení z Gulpky, kde to stálo
 * večer hledání (viz architektura, kap. 5).
 *
 * ⚠️ Registruje se až po `load`: dřív by soupeřil o síť s prvním počasím,
 * které uživatel doopravdy chce vidět.
 */
function zapojServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'appassets.androidplatform.net') return;   // WebView
  if (location.protocol === 'file:') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => {
      // Nevadí — appka funguje dál, jen se nedá otevřít offline.
      console.warn('[MeteoTrace] service worker se nezaregistroval:', e.message);
    });
  });
}

zapojServiceWorker();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
