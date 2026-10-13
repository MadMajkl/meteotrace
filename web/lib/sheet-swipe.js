/**
 * Odpalcování listu (dialogu) zprava doleva = zavřít.
 *
 * Miki 13. 10. 2026: *„klepnutí palcem vedle nastavení (ne, jen do křížku)
 * by ho taky asi mělo zavřít, ne? A odpalcování zprava doleva?"* Do té doby
 * šly listy (nastavení, správa míst, dar) zavřít jen křížkem a Escapem.
 *
 * Tady je **jen rozhodování**, ne dotyky ani DOM — stejně jako u potažení
 * dolů (`pull-refresh.js`). Kdy se gesto chytí, kam list pojede za prstem
 * a kdy se po puštění zavře, se tak dá ověřit bez prstu
 * (`selftest-sheet-swipe.mjs`).
 */

/** Kolik px musí prst ujet, než se pozná směr. Do té doby to může být klepnutí. */
export const ROZHODNUTI = 10;

/** Zavře se po tažení přes tuhle část šířky listu… */
export const PODIL = 0.33;

/** …ale aspoň přes tolik px — na úzkém listu by třetina byla pár milimetrů. */
export const MIN_PX = 64;

/**
 * …nebo švihem: rychlý pohyb doleva zavře i na kratší dráze (px/ms).
 * Kdo listem mrskne, chce ho pryč, i když prst ujel jen kousek.
 */
export const SVIH = 0.5;

/**
 * Stavový automat jednoho gesta. Pořadí `start` → `move`* → `end`.
 *
 * 🚨 Gesto patří listu, JEN když jde prst doleva a víc do strany než
 * dolů. Svislý pohyb je rolování obsahu listu (nastavení je dlouhé) —
 * ten se gestu vzdá a list se ani nehne. Tah doprava nedělá nic: zavírá se
 * jen tím směrem, o který Miki řekl.
 *
 * @param {object} [nastaveni]
 */
export function createSwipe({
  rozhodnuti = ROZHODNUTI, podil = PODIL, minPx = MIN_PX, svih = SVIH,
} = {}) {
  // 'klid' · 'ceka' (směr ještě není jasný) · 'tahne' (list jede za prstem)
  // · 'pustil' (je to rolování — do konce dotyku se nic neděje)
  let stav = 'klid';
  let x0 = 0;
  let y0 = 0;
  let sirka = 0;
  let posun = 0;
  let rychlost = 0;
  let minuleX = 0;
  let minuleT = 0;

  const reset = () => { stav = 'klid'; posun = 0; rychlost = 0; };

  return {
    get tahne() { return stav === 'tahne'; },
    get posun() { return posun; },

    /**
     * Začátek dotyku. Vrací, jestli se gesto může chytit.
     *
     * ⚠️ `nelze` vyřazuje místa, která si vodorovný pohyb berou sama: pole
     * (posun kurzoru, výběr textu), výběry, posuvníky a cokoli, co se roluje
     * do strany. Víc prstů = přibližování, ne tažení.
     */
    start(x, y, t, { sirka: s = 0, prstu = 1, nelze = false } = {}) {
      reset();
      if (nelze || prstu !== 1 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      stav = 'ceka';
      x0 = x; y0 = y;
      sirka = s;
      minuleX = x; minuleT = t;
      return true;
    },

    /**
     * Pohyb prstu. Vrací posun listu v px (≤ 0), nebo `null`, když gesto
     * listu nepatří (rolování, tah doprava, druhý prst).
     */
    move(x, y, t, { prstu = 1 } = {}) {
      if (stav === 'klid' || stav === 'pustil') return null;
      if (prstu !== 1) { stav = 'pustil'; posun = 0; return null; }
      const dx = x - x0;
      const dy = y - y0;

      if (stav === 'ceka') {
        if (Math.abs(dx) < rozhodnuti && Math.abs(dy) < rozhodnuti) return 0;
        // Doleva A víc do strany než dolů (s rezervou — šikmý palec
        // jede vždycky trochu i dolů).
        if (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2) stav = 'tahne';
        else { stav = 'pustil'; return null; }
      }

      // Zpátky doprava list nepřejede — vrátí se na své místo a dál nejde.
      posun = Math.min(0, dx);
      const dt = t - minuleT;
      if (dt > 0) {
        // Vyhlazená rychlost: jeden trhaný vzorek nesmí rozhodnout o zavření.
        const v = (x - minuleX) / dt;
        rychlost = rychlost * 0.4 + v * 0.6;
      }
      minuleX = x; minuleT = t;
      return posun;
    },

    /** Puštění. Vrací, jestli se má list zavřít; jinak se vrací na místo. */
    end() {
      const zavrit = stav === 'tahne'
        && (posun <= -Math.max(minPx, sirka * podil)
          || (rychlost <= -svih && posun <= -rozhodnuti * 2));
      reset();
      return zavrit;
    },

    /** Zrušení systémem (hovor, gesto zpět) — list se vrací, nic se nezavře. */
    zrus() { reset(); },
  };
}
