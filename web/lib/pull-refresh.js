/**
 * Potažení dolů = načíst znovu.
 *
 * Tady je **jen rozhodování**, ne dotyky ani DOM: kolik se má pruh posunout,
 * kdy je tažení dost dlouhé a kdy se do gesta vůbec nemá pouštět. Díky tomu
 * se dá celé chování ověřit bez prohlížeče (`selftest-pull-refresh.mjs`) —
 * a to je u gesta, které se jinak zkouší jen prstem, to jediné, co ho
 * uhlídá.
 *
 * 🚨 **Prohlížeč má vlastní potažení dolů a to naše by přebil.** Chrome na
 * Androidu na přetažení nahoře stránku CELOU ZNOVU NAČTE. Kdyby se to
 * nevypnulo (`overscroll-behavior-y: contain` v CSS), soupeřila by dvě gesta
 * o tentýž prst: jednou by se osvěžila data, podruhé by zmizela appka
 * i s rozdělanou trasou. Modul to neumí zařídit, ale bez toho pravidla
 * v CSS nemá smysl.
 */

/**
 * Kam až se dá pruh přetáhnout (px). Prst může jet dál, pruh už ne —
 * gumový doraz je poznat hmatem, že se dál nic nezmění.
 */
export const MAX_POSUN = 150;

/**
 * Od kolika px posunu se po puštění doopravdy načítá.
 *
 * ⚠️ Je to posun PRUHU, ne dráha prstu. Kvůli odporu níž je dráha prstu
 * delší — u 56 px pruhu je to zhruba 89 px prstem. Kratší práh by se
 * spouštěl při obyčejném rolování nahoru.
 */
export const PRAH = 56;

/**
 * Odpor tažení: prst jede pořád, pruh se zpomaluje a k `max` se jen blíží.
 *
 * `max · dy / (dy + max)` — na začátku se pruh hýbe s prstem 1 : 1 (gesto
 * je hned „chycené"), ale `max` nikdy nepřekročí. Lineární posun by buď
 * ujel do půlky obrazovky, nebo by se musel tvrdě uříznout — a tvrdý
 * doraz vypadá jako záseknutá appka.
 *
 * @param {number} dy  dráha prstu dolů v px (záporná = nahoru)
 * @param {number} [max]
 */
export function posunZTazeni(dy, max = MAX_POSUN) {
  if (!Number.isFinite(dy) || dy <= 0) return 0;
  return (max * dy) / (dy + max);
}

/**
 * Stavový automat jednoho gesta.
 *
 * Pořadí je `start` → `move`* → `end`. Mimo gesto je `posun` nula a `end()`
 * vrací `false`, takže se náhodným pořadím volání nedá nic spustit.
 *
 * @param {object} [nastaveni]
 * @param {number} [nastaveni.prah]
 * @param {number} [nastaveni.max]
 */
export function createPull({ prah = PRAH, max = MAX_POSUN } = {}) {
  let drzi = false;      // jede gesto?
  let zacatek = 0;       // kde prst začal
  let posun = 0;

  return {
    get drzi() { return drzi; },
    get posun() { return posun; },
    /** Je tažení dost dlouhé na to, aby se po puštění načítalo? */
    get spusti() { return posun >= prah; },

    /**
     * Začátek dotyku. Vrací, jestli se gesto chytlo.
     *
     * 🚨 Chytá se **jen na samém vrchu stránky**. Kdo roluje zpátky nahoru
     * a přetáhne to, čeká konec seznamu — ne načítání. A `nelze` vyřazuje
     * místa, která si dotyk berou sama (mapa, otevřený dialog): tam by
     * potažení znamenalo posun mapy, ne osvěžení.
     *
     * ⚠️ Víc prstů = přibližování, ne tažení. Vlastní posun by se při něm
     * pral s přibližováním prohlížeče.
     */
    start(y, { scrollY = 0, prstu = 1, nelze = false } = {}) {
      drzi = false;
      posun = 0;
      if (nelze || prstu !== 1 || scrollY > 0 || !Number.isFinite(y)) return false;
      drzi = true;
      zacatek = y;
      return true;
    },

    /**
     * Posun prstu. Vrací posun pruhu v px, nebo `null`, když gesto neběží.
     *
     * ⚠️ Tažení NAHORU gesto ruší — je to rolování, ne osvěžování. Bez toho
     * by stačilo šoupnout prstem nahoru a zpátky dolů a pruh by se vyhoupl
     * uprostřed rolování.
     */
    move(y, { prstu = 1 } = {}) {
      if (!drzi) return null;
      if (prstu !== 1) { this.zrus(); return null; }
      const dy = y - zacatek;
      if (dy < 0) { this.zrus(); return null; }
      posun = posunZTazeni(dy, max);
      return posun;
    },

    /** Puštění. Vrací, jestli se má načítat; pruh se tak jako tak vrací. */
    end() {
      const ano = drzi && posun >= prah;
      drzi = false;
      posun = 0;
      return ano;
    },

    /** Zrušení bez spuštění (rolování nahoru, druhý prst, přerušení systémem). */
    zrus() {
      drzi = false;
      posun = 0;
    },
  };
}
