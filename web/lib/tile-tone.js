/**
 * Kdy se dlaždice podbarví — a jak moc.
 *
 * Michal 29. 8. 2026 si vyžádal barevný semafor u větru, UV, tlaku a soumraku.
 * Prahy jsou tady, v čistém modulu, protože **jsou to návrhová rozhodnutí,
 * ne kosmetika**: barva, která svítí pořád, přestane cokoli znamenat, a barva,
 * která se neobjeví nikdy, je hotová funkce vypadající jako chybějící.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 BARVA NIKDY NENESE ÚDAJ SAMA
 *
 * Vedle každé podbarvené dlaždice stojí popis i hodnota — „Vítr / 82 km/h".
 * Kdo barvy nerozliší (a barvoslepost má každý dvanáctý muž), nesmí o nic
 * přijít. Barva je zvýrazňovač, ne sdělení. Totéž pravidlo drží záložky
 * a stupně alergenů.
 *
 * ⚠️ Stupně se vracejí jako JMÉNA (`klid`, `pozor`, `zle`), ne jako barvy.
 * Konkrétní odstín patří do CSS, kde se dá vyměnit s motivem — a v růžovém
 * motivu vypadá „zle" jinak než v tmavém.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Stupnice, na které se všichni domluví. Od nejklidnějšího po nejhorší. */
export const STUPNE = ['zadny', 'klid', 'mirne', 'pozor', 'zle', 'krize'];

/* ── vítr ─────────────────────────────────────────────────────────────── */

/**
 * Prahy podle Beaufortovy stupnice, protože ta je o účincích, ne o číslech.
 *
 * ⚠️ Hranice jsou tam, kde se mění, co vítr DĚLÁ:
 *   20 km/h (3 Bf) — hýbe listím, ničemu nevadí
 *   39 km/h (6 Bf) — obtížně se drží deštník
 *   62 km/h (8 Bf) — láme větve, chůze proti větru je práce
 *   75 km/h (9 Bf) — vichřice: poškozuje střechy
 *  103 km/h (11 Bf) — vichřice s plošnými škodami
 */
const VITR_PRAHY = [
  { od: 0, stupen: 'klid' },
  { od: 20, stupen: 'mirne' },
  { od: 39, stupen: 'pozor' },
  { od: 62, stupen: 'zle' },
  { od: 75, stupen: 'krize' },
];

/**
 * 🚨 Od téhle rychlosti se podbarvuje CELÁ dlaždice.
 *
 * Devět Beaufortů, tedy vichřice. Nižší práh by dlaždici barvil několikrát
 * do měsíce a přestalo by to být varování — stalo by se to výzdobou.
 * Vichřice je vzácná právě dost na to, aby si červené pozadí zasloužila.
 */
export const VICHRICE_KMH = 75;

/**
 * Stupeň větru. Bere se **vyšší z rychlosti a nárazů**.
 *
 * ⚠️ A to je podstatné: škodu obvykle udělá náraz, ne průměr. Vítr 45 km/h
 * s nárazy 95 km/h je nebezpečná situace, kterou by samotný průměr ukázal
 * jako „pozor" místo „krize".
 */
export function windTon(kmh, gustKmh = null) {
  const v = Math.max(
    Number.isFinite(kmh) ? kmh : -1,
    Number.isFinite(gustKmh) ? gustKmh : -1,
  );
  if (v < 0) return { stupen: 'zadny', vichrice: false, podil: 0 };

  let stupen = 'klid';
  for (const p of VITR_PRAHY) if (v >= p.od) stupen = p.stupen;

  return {
    stupen,
    vichrice: v >= VICHRICE_KMH,
    // 0–1 pro plynulé obarvení střelky. Strop je vichřice; nad ní se už
    // barva nemění, protože „červenější než červená" neexistuje.
    podil: Math.min(1, v / VICHRICE_KMH),
  };
}

/* ── UV index ─────────────────────────────────────────────────────────── */

/**
 * Stupně podle WHO. ⚠️ Nevymýšlejí se vlastní: UV index je mezinárodní
 * stupnice a její hranice zná i leták u bazénu.
 *
 *   0–2 nízký · 3–5 střední · 6–7 vysoký · 8–10 velmi vysoký · 11+ extrémní
 */
export function uvTon(uv) {
  if (!Number.isFinite(uv)) return { stupen: 'zadny', podil: 0 };
  if (uv < 3) return { stupen: 'klid', podil: uv / 11 };
  if (uv < 6) return { stupen: 'mirne', podil: uv / 11 };
  if (uv < 8) return { stupen: 'pozor', podil: uv / 11 };
  if (uv < 11) return { stupen: 'zle', podil: uv / 11 };
  return { stupen: 'krize', podil: 1 };
}

/* ── tlak ─────────────────────────────────────────────────────────────── */

/**
 * Tlak mimo obvyklé rozmezí.
 *
 * ⚠️ Počítá se z tlaku PŘEPOČTENÉHO NA HLADINU MOŘE (QNH). Skutečný tlak
 * v místě klesá s nadmořskou výškou — ve čtyřech stech metrech je kolem
 * 970 hPa, což je úplně normální hodnota, ale proti stupnici by vypadala
 * jako hluboká tlaková níže. Appka by pak v Jeseníkách hlásila trvalou
 * krizi.
 *
 * Hranice: běžné rozmezí je zhruba 1000–1025 hPa. Pod 990 a nad 1035 je to
 * situace, kterou lidé citliví na tlak poznají.
 */
export function pressureTon(hPa) {
  if (!Number.isFinite(hPa)) return { stupen: 'zadny', smer: null };
  if (hPa < 990) return { stupen: 'zle', smer: 'nizky' };
  if (hPa < 1000) return { stupen: 'pozor', smer: 'nizky' };
  if (hPa > 1035) return { stupen: 'zle', smer: 'vysoky' };
  if (hPa > 1025) return { stupen: 'pozor', smer: 'vysoky' };
  return { stupen: 'klid', smer: null };
}

/* ── soumrak a svítání ────────────────────────────────────────────────── */

/**
 * Jak moc zrovna probíhá východ nebo západ Slunce (0–1).
 *
 * Michal: *„při probíhajícím západu a východu změnit adekvátně podbarvení
 * dotyčné dlaždice dynamicky."* Dlaždice tedy nesvítí celý den stejně —
 * rozhoří se, když se to děje, a zase vyhasne.
 *
 * ⚠️ Okno je **±45 minut**, ne pár vteřin. Východ Slunce není okamžik, ale
 * děj: obloha se barví dávno předtím, než kotouč vyleze, a chvíli potom.
 * Vteřinové okno by nikdo nikdy neviděl a funkce by vypadala jako rozbitá.
 *
 * ⚠️ Pracuje se v **epoch milisekundách**, ne v místním čase. Poslední
 * březnová neděle má 23 hodin — kdo počítá odečítáním místních časů,
 * dvakrát ročně minul o hodinu. (Totéž pravidlo jako v `eta.js`.)
 *
 * @param {number} nowMs
 * @param {number|null} okamzikMs  východ nebo západ
 * @param {number} [oknoMin]
 * @returns {number} 1 přesně v okamžiku, 0 mimo okno
 */
export function soumrakPodil(nowMs, okamzikMs, oknoMin = 45) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(okamzikMs)) return 0;
  const okno = oknoMin * 60000;
  if (okno <= 0) return 0;
  const odstup = Math.abs(nowMs - okamzikMs);
  if (odstup >= okno) return 0;
  return +(1 - odstup / okno).toFixed(3);
}
