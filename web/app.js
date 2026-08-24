/**
 * MeteoTrace — obrazovka meteostanice.
 *
 * ⚠️ Tenhle soubor je JEDINÝ, který sahá na DOM. Všechno, co se dá spočítat
 * bez stránky, leží ve `web/lib/` a je pokryté samotestem (viz §2.1 architektury).
 * Když sem přibývá výpočet, patří to nejspíš do `lib/`.
 */

'use strict';

import { t, tf, detectLang, LANG_NAMES } from './lib/i18n.js';
import { defaultUnits } from './lib/units.js';
import { apiGet, createRequestGroup } from './lib/api.js';
import { buildWarningsView } from './lib/warnings-view.js';
import { pollenIcon } from './lib/pollen-icons.js';
import { buildStationView, FORECAST_PARAMS, AIR_PARAMS, formatClock } from './lib/station.js';
import { sampleRoute, planRoute, departureOptions } from './lib/eta.js';
import {
  fromOpenRouteService, toOrsCoord, toForecastParams, asLocationList, hoursToMs,
} from './lib/route-adapter.js';
import { buildRouteView, compareDepartures, ROUTE_FORECAST_PARAMS } from './lib/route-view.js';
import { straightRoute } from './lib/great-circle.js';
import { formatDistance } from './lib/units.js';
import {
  parseStore, serializeStore, emptyStore, savePlace, forgetPlace, touchPlace,
  findNearby, savedAs, renamePlace, MAX_PLACES, MAX_NAME,
} from './lib/places.js';
// Mapa se natahuje líně — MapLibre je skoro megabajt a kdo radar neotevře,
// nemá ho proč platit. (Zvyk převzatý z Gulpky, kde se takhle načítá Tone.js.)
let mapModule = null;

const $ = (id) => document.getElementById(id);
const requests = createRequestGroup();

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
  lang: 'en',
  units: null,
  place: null,          // {name, country, lat, lon}
  places: emptyStore(), // uložená místa a trasy
  banner: null,         // trvalé sdělení o stavu appky, viz notice()
  screen: 'station',    // 'station' | 'route'
  // Trasa se zatím neukládá mezi spuštěními: rozdělaná cesta je něco jiného
  // než uložené místo a obnovovat ji po týdnu by nedávalo smysl.
  route: { from: null, to: null, profil: 'driving-car', rychlostKmh: 90 },
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
    if (saved.lang) state.lang = saved.lang;
  } catch { /* jede se dál s výchozím */ }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      place: state.place, units: state.units, lang: state.lang,
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
  $('saved').hidden = list.length === 0;

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

  fill($('saved-list'), list, (p) => {
    const li = document.createElement('li');
    const chip = el('button', 'chip', p.name);
    chip.type = 'button';
    if (current && current.key === p.key) chip.setAttribute('aria-current', 'true');
    chip.addEventListener('click', () => {
      state.places = touchPlace(state.places, p.key, Date.now());
      persistPlaces();
      selectPlace({ name: p.name, country: p.country, lat: p.lat, lon: p.lon });
    });
    li.append(chip);
    return li;
  });
}

/* ============================================================
   SPRÁVA ULOŽENÝCH MÍST

   Řádek v hlavičce slouží k PŘEPNUTÍ jedním klepnutím. Přejmenování
   a mazání sem nepatří — proto zvlášť, v dialogu.
   ============================================================ */

function openPlaces() {
  renderManage();
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
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    const [attr, key] = el.dataset.i18nAttr.split(':');
    el.setAttribute(attr, t(key, state.lang));
  }
  $('splash-text').textContent = t('search.placeholder', state.lang);
  document.title = `${t('app.name', state.lang)} — ${t('app.tagline', state.lang)}`;
}

/* ============================================================
   HLEDÁNÍ MÍSTA
   ============================================================ */

let searchTimer = 0;

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
      apiGet('geocode', { name: q, count: 6, language: state.lang }, { signal }));
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
      const where = [r.admin1, r.country].filter(Boolean).join(', ');
      if (where) {
        const span = document.createElement('span');
        span.className = 'muted';
        span.textContent = ` · ${where}`;
        li.append(span);
      }
      const choose = () => selectPlace({
        name: r.name, country: r.country, lat: r.latitude, lon: r.longitude,
      });
      li.addEventListener('click', choose);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(); });
      ul.append(li);
    }
  }
  ul.hidden = false;
}

const hideResults = () => { $('search-results').hidden = true; };

function selectPlace(place) {
  state.place = place;
  save();
  hideResults();
  $('search-input').value = '';
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
    (pos) => selectPlace({
      name: t('search.myLocation', state.lang),
      lat: pos.coords.latitude, lon: pos.coords.longitude,
    }),
    () => notice(t('error.failed', state.lang)),
    { timeout: 10000, maximumAge: 300000 },
  );
}

/* ============================================================
   NAČTENÍ A VYKRESLENÍ
   ============================================================ */

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

  $('splash').hidden = true;
  $('station').hidden = false;

  const c = view.current;
  $('now-icon').textContent = c.icon;
  $('now-temp').textContent = c.temp;
  $('now-cond').textContent = c.condition;
  $('now-feels').textContent = c.feelsLike;
  $('d-wind').textContent = `${c.wind} ${c.windDir}`;
  $('d-gusts').textContent = c.gusts;
  $('d-humidity').textContent = c.humidity;
  $('d-precip').textContent = c.precip;
  $('d-cloud').textContent = c.cloudCover;
  $('d-uv').textContent = c.uvIndex;
  $('d-sunrise').textContent = view.sun.sunrise;
  $('d-sunset').textContent = view.sun.sunset;
  $('now-updated').textContent = c.updated;

  fill($('hours'), view.hourly, (h) => el('div', 'hour', [
    el('div', 't', h.time),
    el('span', 'i', h.icon),
    el('div', 'v', h.temp),
    el('div', 'p', h.precipProb === '0 %' ? '' : h.precipProb),
  ]));

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

/**
 * Mapa s radarem. Načte se až teď, ne při startu appky.
 * Selhání mapy nesmí shodit zbytek obrazovky — počasí je důležitější.
 */
async function showRadar(timeZone) {
  // ?nomap=1 mapu vynechá. Používá to test rozvržení: pět rámů, každý
  // s vlastním MapLibre a WebGL, by stránku přetížilo — a rozvržení se
  // na mapě stejně neměří, je to div s pevnou výškou.
  if (new URLSearchParams(location.search).get('nomap') === '1') {
    document.querySelector('.map-card')?.remove();
    return;
  }
  try {
    mapModule ??= await import('./map.js');
    await mapModule.showMap({
      lat: state.place.lat, lon: state.place.lon, lang: state.lang, timeZone,
      // Klepnutí do mapy vybere místo. Projde touž cestou jako výsledek
      // hledání, takže se o něj postará i hvězdička a uložená místa.
      onPick: (misto) => selectPlace(misto),
      keepView: state.place.fromMap === true,
    });
    // I když výstraha není, musí se zavolat — jinak by po přepnutí místa
    // zůstal na mapě viset obrys toho předchozího.
    mapModule.showWarningArea(state.warningArea?.geometrie || null, state.warningArea?.trida);
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

function prepniObrazovku(kam) {
  state.screen = kam;
  $('station').hidden = kam !== 'station' || !state.place;
  $('route').hidden = kam !== 'route';
  $('splash').hidden = kam !== 'station' || !!state.place;
  for (const [id, jmeno] of [['tab-station', 'station'], ['tab-route', 'route']]) {
    $(id).setAttribute('aria-selected', String(kam === jmeno));
  }
}

/**
 * Výběr místa do pole na obrazovce trasy.
 *
 * Používá totéž hledání jako hlavní pole nahoře — jen si drží vlastní výsledky
 * a vlastní zrušení. Kdyby sdílelo `requests.run('search')` s hlavním polem,
 * psaní do jednoho pole by rušilo dotaz druhého.
 */
function pripojVyber(inputId, resultsId, kam) {
  const input = $(inputId);
  const results = $(resultsId);
  let timer = 0;

  const skryj = () => { results.hidden = true; results.innerHTML = ''; };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    // Vybrané místo přestává platit ve chvíli, kdy uživatel začne psát něco
    // jiného. Jinak by tlačítko počítalo trasu do místa, které už není v poli.
    state.route[kam] = null;
    if (q.length < 2) { skryj(); return; }
    timer = setTimeout(async () => {
      try {
        const { data } = await requests.run(`search-${kam}`, (signal) =>
          apiGet('geocode', { name: q, count: 6, language: state.lang }, { signal }));
        ukazVysledky(data?.results || []);
      } catch (e) {
        if (!requests.isAbort(e)) ukazVysledky([]);
      }
    }, 280);
  });

  input.addEventListener('blur', () => setTimeout(skryj, 150));

  function ukazVysledky(list) {
    results.hidden = false;
    fill(results, list.length ? list : [null], (r) => {
      const li = document.createElement('li');
      if (!r) {
        li.className = 'empty';
        li.textContent = t('search.noResults', state.lang);
        return li;
      }
      const btn = el('button', '', [
        el('span', 'r-name', r.name),
        el('span', 'r-meta', [r.admin1, r.country].filter(Boolean).join(', ')),
      ]);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        state.route[kam] = { name: r.name, country: r.country, lat: r.latitude, lon: r.longitude };
        input.value = r.name;
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

  poznamkaTrasy(t('route.computing', state.lang));
  skryjVysledekTrasy();

  try {
    const zpusob = ZPUSOBY.find((z) => z.profil === profil);
    let trasa;

    if (zpusob?.bezRouteru) {
      // Ani jeden dotaz ven: ortodroma se spočítá u nás ze dvou bodů
      // a rychlosti, kterou zadal uživatel. Jádru je jedno, odkud trasa je.
      trasa = straightRoute([from.lat, from.lon], [to.lat, to.lon], state.route.rychlostKmh);
    } else {
      const geo = await requests.run('route', (signal) =>
        apiGet('route', { start: toOrsCoord([from.lat, from.lon]), end: toOrsCoord([to.lat, to.lon]) },
          { signal, subPath: profil }));
      trasa = fromOpenRouteService(geo.data);
    }
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
    vykresliTrasu({ view, plan, trasa, srovnani, mista });
  } catch (e) {
    if (requests.isAbort(e)) return;
    poznamkaTrasy(`${t('route.failed', state.lang)} ${e.message}`);
  }
}

function vykresliTrasu({ view, plan, trasa, srovnani, mista }) {
  const pasmo = mista[0]?.timezone || 'UTC';

  $('route-summary-card').hidden = false;
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
    dovetky.push(tf('route.hazards', { count: view.summary.hazardCount }, state.lang));
  } else if (view.summary.rainCount) {
    dovetky.push(tf('route.rain', { count: view.summary.rainCount }, state.lang));
  } else {
    dovetky.push(t('route.clear', state.lang));
  }
  $('route-summary').append(el('span', 'route-extra', dovetky.join(' ')));

  // Rada o posunu odjezdu se ukáže, JEN když má cenu (R8: `worthMoving`).
  // Rada bez užitku podkopává důvěru ve všechny ostatní.
  const rada = $('route-advice');
  const lepsi = srovnani.worthMoving && srovnani.best && srovnani.best.offsetMin > 0;
  rada.hidden = !lepsi;
  if (lepsi) {
    rada.textContent = tf('route.adviceLater', {
      minutes: srovnani.best.offsetMin,
      reason: srovnani.best.summary.worst || t('route.clear', state.lang),
    }, state.lang);
  }

  $('route-points-card').hidden = false;
  fill($('route-points'), view.points, (p) => {
    const li = document.createElement('li');
    li.className = 'route-point';
    if (p.hazard) li.dataset.hazard = '1';

    const cas = el('span', 'rp-time', formatClock(p.etaMs, pasmo, state.lang));
    const km = el('span', 'rp-km', formatDistance(p.distanceM, state.units, state.lang));
    const ikona = el('span', 'rp-icon', p.icon);
    const popis = el('span', 'rp-cond', p.condition || '');
    const teplota = el('span', 'rp-temp', p.temp ?? '');

    li.append(cas, ikona, el('span', 'rp-text', [popis, km]), teplota);
    return li;
  });
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
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;   // nesmysl neukládat
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

  applyI18n();
  renderSaved();

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
  $('btn-manage').addEventListener('click', openPlaces);
  $('tab-station').addEventListener('click', () => prepniObrazovku('station'));
  $('tab-route').addEventListener('click', () => prepniObrazovku('route'));
  $('route-go').addEventListener('click', loadRoute);
  $('route-swap').addEventListener('click', () => {
    // Prohození musí přehodit i text v polích, ne jen data — jinak by pole
    // ukazovala něco jiného, než co se spočítá.
    const { from, to } = state.route;
    state.route.from = to;
    state.route.to = from;
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
