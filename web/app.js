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
import { buildStationView, FORECAST_PARAMS, AIR_PARAMS } from './lib/station.js';
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
