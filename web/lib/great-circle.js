/**
 * Trasa vzdušnou čarou.
 *
 * ⚠️ ČISTÝ MODUL. Žádná síť, žádné DOM — jen zeměpis.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO VŮBEC JDE TAK SNADNO
 *
 * ETA jádro (`eta.js`) schválně **neví, kdo trasu spočítal**. Dostane body
 * a rychlostní profil, nic víc. Tenhle modul tedy nemusí nic obcházet —
 * jen dodá tvar, jaký jádro čeká, a všechno ostatní (vzorkování, časy
 * příjezdu, přiřazení hodin) funguje beze změny.
 *
 * Je to zároveň zkouška toho slibu z `R4`: „výměna routeru je nový adaptér,
 * ne zásah do jádra". Tady se nevyměnil router — **vypadl úplně**.
 *
 * K čemu to je:
 *   · lety, kluzáky, paragliding, drony — po silnici se nelétá,
 *   · lodě na volné vodě,
 *   · záchranná brzda, když routing selže nebo místo není u silnice,
 *   · a nestojí to ani jeden dotaz na cizí službu (žádná kvóta, žádný klíč).
 *
 * ⚠️ ČEHO SE TENHLE MODUL NETÝKÁ: vyhýbání se pevnině. Čára z Hamburku do
 * Osla vede přes Dánsko. Pro plavbu u břehu je to k ničemu — viz poznámka
 * u `straightRoute()`.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { distanceM } from './eta.js';

const R = 6371008.8;                 // střední poloměr Země v metrech
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/**
 * Ortodroma — nejkratší cesta po kouli.
 *
 * ⚠️ Není to úsečka na mapě. Na běžné (Mercatorově) mapě se jeví jako
 * oblouk, a čím delší trasa, tím větší rozdíl. Změřeno: střed trasy
 * Praha–New York vychází na **54,7° s. š.**, zatímco lineární průměr
 * souřadnic dá 45,4° — devět stupňů, tedy přes tisíc kilometrů vedle,
 * a to i s úplně jiným počasím. Proto se body počítají takhle a ne
 * prokládáním souřadnic.
 *
 * @param {[number, number]} a  `[šířka, délka]`
 * @param {[number, number]} b
 * @param {number} podil  0 = start, 1 = cíl
 * @returns {[number, number]}
 */
export function pointBetween(a, b, podil) {
  const [lat1, lon1] = [rad(a[0]), rad(a[1])];
  const [lat2, lon2] = [rad(b[0]), rad(b[1])];

  const uhel = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));

  // Body splývají — interpolovat není co a dělení nulou by dalo NaN.
  if (uhel === 0) return [a[0], a[1]];

  const A = Math.sin((1 - podil) * uhel) / Math.sin(uhel);
  const B = Math.sin(podil * uhel) / Math.sin(uhel);

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return [deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))];
}

/**
 * Body podél ortodromy, tak husté, aby se z nich dala trasa vzorkovat.
 *
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @param {number} [krokM]  vzdálenost mezi body
 */
export function greatCirclePoints(a, b, krokM = 10000) {
  const celkem = distanceM(a, b);
  if (!Number.isFinite(celkem) || celkem === 0) return [[a[0], a[1]]];

  const kroku = Math.max(1, Math.ceil(celkem / krokM));
  const body = [];
  for (let i = 0; i <= kroku; i++) body.push(pointBetween(a, b, i / kroku));
  return body;
}

/**
 * Trasa vzdušnou čarou ve tvaru, jaký čeká ETA jádro.
 *
 * ⚠️ **Rychlost je vstup, ne odhad.** Kluzák, dron a trajekt se pohybují
 * úplně jinak a appka nemá jak to uhodnout — kdyby si číslo vymyslela,
 * byly by časy příjezdu (a tím celé počasí na trase) nesmysl, který ale
 * vypadá věrohodně.
 *
 * ⚠️ **Nevyhýbá se pevnině.** Pro let nebo volnou vodu je čára správně,
 * pro plavbu u břehu ne: z Hamburku do Osla by vedla přes Dánsko. Skutečné
 * lodní routování potřebuje mapu moří a vyhýbání se souši — to tenhle modul
 * neumí a nepředstírá.
 *
 * @param {[number, number]} start
 * @param {[number, number]} cil
 * @param {number} rychlostKmh
 * @returns {{points: Array<[number,number]>, totalDistanceM: number,
 *            totalDurationS: number, legs: Array}|null}
 */
export function straightRoute(start, cil, rychlostKmh) {
  if (!Array.isArray(start) || !Array.isArray(cil)) return null;
  if (!Number.isFinite(rychlostKmh) || rychlostKmh <= 0) return null;

  const points = greatCirclePoints(start, cil);
  const totalDistanceM = distanceM(start, cil);
  const totalDurationS = (totalDistanceM / 1000 / rychlostKmh) * 3600;

  return {
    points,
    totalDistanceM,
    totalDurationS,
    // Rychlost je po celé trase stejná, takže rychlostní profil je jediný
    // úsek. Jádro pak počítá úměrou — a je to tentokrát správně, ne odhad
    // z nouze: vzdušnou čarou se opravdu letí konstantní rychlostí.
    legs: [{ distanceM: totalDistanceM, durationS: totalDurationS }],
  };
}
