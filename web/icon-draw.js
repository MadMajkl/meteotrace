/**
 * Kreslení piktogramů z `lib/sky-icons.js` do stránky.
 *
 * ⚠️ VLASTNÍ SOUBOR, PROTOŽE HO POTŘEBUJÍ DVA. Kreslič původně seděl
 * v `app.js`, jenže laboratoř ikon (`test/sky-icon-lab.html`) si ho pak
 * musela napsat znovu — a hned se rozešly: laboratoř neuměla prstenec ani
 * otáčení, takže ukazovala něco jiného, než co appka opravdu vykreslí.
 * Nástroj na ověřování, který ověřuje vlastní kopii, je horší než žádný.
 *
 * ⚠️ Tvary samotné (čistá geometrie) zůstávají v `lib/sky-icons.js`. Tady je
 * jen DOM.
 */

'use strict';

/**
 * Nakreslí tvar z `sky-icons.js`.
 *
 * ⚠️ Jeden kreslič pro všechny tvary. Kdyby si každý údaj kreslil po svém,
 * rozešly by se tloušťky čar a ikony by přestaly vypadat jako jedna sada —
 * a to je přesně to, co na appce vidí jako první každý.
 *
 * ⚠️ Pro odečítač obrazovky je to výzdoba (`aria-hidden`): popis i hodnota
 * stojí vedle jako text. Piktogram, který by nesl informaci sám, by byl
 * pro nevidomého prázdné místo.
 *
 * @param {object} tvar   `{plocha, cara, kruh, kotouc, tecka, svetlo, ocas}`
 * @param {string} trida
 * @param {number|null} [otoceni]  stupně (větrná růžice)
 */
export function kresliTvar(tvar, trida = 'sky-icon', otoceni = null) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', trida);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (!tvar) return svg;

  const cesta = (d, jak = {}) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', jak.fill || 'none');
    if (jak.stroke) {
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', jak.width || '1.6');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
    }
    return p;
  };
  const kruh = ([cx, cy, r], jak = {}) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', jak.fill || 'none');
    if (jak.stroke) {
      c.setAttribute('stroke', 'currentColor');
      c.setAttribute('stroke-width', jak.width || '1.4');
    }
    if (jak.opacity) c.setAttribute('opacity', jak.opacity);
    return c;
  };

  // Pevná část (prstenec, ciferník, obrys kotouče) se NEOTÁČÍ.
  if (tvar.kruh) svg.append(kruh(tvar.kruh, { stroke: true }));
  if (tvar.kotouc) svg.append(kruh(tvar.kotouc, { stroke: true, opacity: '0.45' }));
  // Čáry jsou vždycky pevná část: obzor, ciferník, světové strany.
  for (const d of tvar.cara || []) svg.append(cesta(d, { stroke: true }));

  // Otáčivá část dostane vlastní skupinu — prstenec musí zůstat na místě,
  // jinak by sever necestoval nahoře a růžice by nebyla k ničemu.
  const cil = otoceni == null ? svg : (() => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `rotate(${Math.round(otoceni)} 12 12)`);
    svg.append(g);
    return g;
  })();

  if (tvar.svetlo) cil.append(cesta(tvar.svetlo, { fill: 'currentColor' }));
  if (tvar.plocha) cil.append(cesta(tvar.plocha, { fill: 'currentColor' }));
  if (tvar.ocas) cil.append(cesta(tvar.ocas, { stroke: true, width: '1.3' }));
  if (tvar.tecka) svg.append(kruh(tvar.tecka, { fill: 'currentColor' }));

  return svg;
}
