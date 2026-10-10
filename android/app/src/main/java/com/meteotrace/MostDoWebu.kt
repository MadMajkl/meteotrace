package com.meteotrace

import android.content.Context
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat

/**
 * Jediné okno z webové appky do nativní vrstvy.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO VŮBEC EXISTUJE
 *
 * Nativní vrstva neví, které místo si uživatel prohlíží — to leží v úložišti
 * WebView a zvenčí se k němu nedostane. Hlídání výstrah na pozadí ale bez
 * toho bodu nemá co kontrolovat. Web tedy při každém načtení stanice řekne
 * „hlídej tohle", a obal si to uloží.
 *
 * ⚠️ **Most zůstane úzký.** Je to jediné místo, kudy může web sáhnout do
 * telefonu, a každá další metoda je další věc, kterou musí někdo prověřit.
 * Co jde udělat ve webu, se dělá ve webu (`R13`).
 *
 * 🚨 `addJavascriptInterface` zpřístupní tenhle objekt VŠEMU, co se ve
 * WebView načte. Proto se most připojuje jen k naší stránce a WebView má
 * zakázanou navigaci mimo vlastní původ (`shouldOverrideUrlLoading`
 * v `MainActivity`). Kdyby se do WebView dostal cizí obsah, sáhl by sem
 * jinak taky.
 * ────────────────────────────────────────────────────────────────────────
 */
class MostDoWebu(
    private val ctx: Context,
    /**
     * ⚠️ Žádost o povolení musí spustit ACTIVITA, ne kontext — a na UI vlákně.
     * Metody mostu volá WebView z vlastního vlákna, takže si to obstará
     * `MainActivity` v téhle funkci; sem se ta složitost netahá.
     */
    private val zadost: () -> Unit,
    /**
     * Jak je na tom povolení polohy: `granted`, `prompt`, `denied`, `off`.
     * Zjišťuje to ACTIVITA (potřebuje ji `shouldShowRequestPermissionRationale`).
     */
    private val stavPolohyZActivity: () -> String,
    /** Vyřídí povolení polohy podle stavu — dialog, nebo nastavení. Na UI vlákně. */
    private val povolPolohuVActivite: () -> Unit,
    /** Otevře nastavení appky v telefonu (baterie, upozornění). Na UI vlákně. */
    private val otevriNastaveniAppkyVActivite: () -> Unit,
) {

    /** Umí tenhle obal hlídat výstrahy? Web se ptá, aby věděl, co nabídnout. */
    @JavascriptInterface
    fun umiUpozorneni(): Boolean = true

    /**
     * Zapne hlídání jednoho místa: výstrahy a (když `bourky`) bouřky z radaru.
     *
     * ⚠️ Nadpisy chodí HOTOVÉ z webu, protože jazyk appky je volba uživatele,
     * kdežto `strings.xml` se řídí jazykem systému. Viz `Vystrahy.Hlidane`.
     *
     * 🚨 Počet parametrů MUSÍ sedět s voláním v `app.js` (`zapisHlidani`).
     * Most hledá metodu podle jména I počtu — jiný počet znamená „metoda
     * neexistuje" a hlídání by se tiše nezapnulo. Hlídá `selftest-obal.mjs`.
     */
    @JavascriptInterface
    fun hlidejVystrahy(
        lat: Double,
        lon: Double,
        nadpis: String,
        lang: String,
        prah: String,
        nadpisBourka: String,
        bourky: Boolean,
    ) {
        Vystrahy.hlidej(ctx, Vystrahy.Hlidane(lat, lon, nadpis, lang, prah, nadpisBourka, bourky))
    }

    /** Vypne hlídání a zapomene, o čem se už zvonilo. */
    @JavascriptInterface
    fun nehlidejVystrahy() {
        Vystrahy.nehlidej(ctx)
    }

    /**
     * Smí appka zobrazovat upozornění?
     *
     * 🚨 Web se MUSÍ mít jak zeptat. Bez toho by přepínač v nastavení tvrdil
     * „zapnuto", zatímco Android by upozornění zahazoval — a uživatel by na
     * to přišel až tím, že by mu nepřišla výstraha. Přesně ten druh tichého
     * selhání, který se pozná pozdě a draho.
     */
    @JavascriptInterface
    fun majiPovoleni(): Boolean = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    /** Vyžádá si povolení. Odpověď si web zjistí příštím `majiPovoleni()`. */
    @JavascriptInterface
    fun zadejOPovoleni() {
        zadost()
    }

    /* ── povolení polohy z nastavení appky ────────────────────────────── */

    /** Umí tenhle obal říct stav polohy a vyřídit povolení? Starší obal ne. */
    @JavascriptInterface
    fun umiPolohu(): Boolean = true

    /**
     * Stav povolení polohy: `granted` · `prompt` · `denied` · `off`.
     *
     * 🚨 Web se MUSÍ mít jak zeptat. Do 30. 9. 2026 se o polohu žádalo jen
     * při klepnutí na „Tady" — a kdo dialog odmítl dvakrát, tomu se už
     * Android nezeptal a appka jen opakovala „polohu se nepodařilo zjistit".
     * Michal: *„potřebujeme do nastavení dát, aby tam bylo na kliknutí
     * povolení polohy!"* Význam stavů a co se k nim ukazuje je
     * v `web/lib/location-access.js`.
     */
    @JavascriptInterface
    fun stavPolohy(): String = stavPolohyZActivity()

    /**
     * Jedno klepnutí v nastavení appky. Podle stavu se buď zeptá systémovým
     * dialogem, nebo otevře nastavení appky (když se Android už ptát nebude),
     * nebo nastavení polohy (když je v telefonu vypnutá).
     * Výsledek si web přečte ze `stavPolohy()` — obal mu dá vědět událostí
     * `meteotrace:poloha`.
     */
    @JavascriptInterface
    fun povolPolohu() {
        povolPolohuVActivite()
    }

    /* ── ranní a večerní zpráva (R25) ─────────────────────────────────── */

    /** Umí tenhle obal posílat ranní a večerní zprávu? */
    @JavascriptInterface
    fun umiZpravy(): Boolean = true

    /**
     * Zapne ranní a večerní zprávu pro danou polohu.
     *
     * ⚠️ Nadpisy chodí HOTOVÉ z webu, v jazyce appky — `strings.xml` se řídí
     * jazykem systému (viz `Vystrahy.Hlidane`). Jsou dva, protože ráno
     * a večer se v nich liší slovo, a skládat to tady by znamenalo mít
     * v obalu překlad.
     *
     * 🚨 Součástí nadpisu je JMÉNO MÍSTA. Zpráva chodí pro poslední polohu,
     * kterou web zjistil — kdo odjel a appku neotevřel, dostane starou
     * a musí to poznat (`R25`).
     *
     * @param ranoMin minuty od půlnoci (6:30 = 390)
     */
    @JavascriptInterface
    fun nastavZpravy(
        lat: Double,
        lon: Double,
        nadpisRano: String,
        nadpisVecer: String,
        lang: String,
        units: String,
        ranoMin: Int,
        vecerMin: Int,
    ) {
        Zpravy.nastav(ctx, Zpravy.Nastaveni(lat, lon, nadpisRano, nadpisVecer, lang, units, ranoMin, vecerMin))
    }

    /** Vypne zprávy a zapomene i naplánované budíky. */
    @JavascriptInterface
    fun vypniZpravy() {
        Zpravy.vypni(ctx)
    }

    /**
     * Chodí zprávy?
     *
     * 🚨 Web se MUSÍ mít jak zeptat — stejně jako u výstrah. Bez toho by
     * přepínač tvrdil „zapnuto", zatímco by se po odinstalaci povolení nebo
     * po vypnutí kanálu nic nedělo.
     */
    @JavascriptInterface
    fun zpravyZapnuty(): Boolean = Zpravy.zapnuto(ctx)

    /* ── stav na pozadí (R37) ─────────────────────────────────────────── */

    /** Umí tenhle obal říct, co se děje na pozadí? Starší obal ne. */
    @JavascriptInterface
    fun umiStavNaPozadi(): Boolean = true

    /**
     * Fakta o upozorněních a zprávách na pozadí jako JSON (`StavNaPozadi`):
     * kdy proběhla kontrola, kdy přišla zpráva a proč ne, kanály, baterie.
     *
     * 🚨 Bez tohohle se tichá porucha nedá odlišit od tiché funkce — zprávy
     * dvakrát nechodily a nedalo se zjistit proč.
     */
    @JavascriptInterface
    fun stavNaPozadi(): String = StavNaPozadi.json(ctx)

    /** Otevře nastavení appky v telefonu — tam je Baterie i Upozornění. */
    @JavascriptInterface
    fun otevriNastaveniAppky() {
        otevriNastaveniAppkyVActivite()
    }

    /* ── widget na ploše (R29) ────────────────────────────────────────── */

    /** Umí tenhle obal widget? Web se ptá, aby starému obalu nic neposílal. */
    @JavascriptInterface
    fun umiWidget(): Boolean = true

    /**
     * Pro jaké místo má widget ukazovat počasí.
     *
     * ⚠️ `misto` chodí HOTOVÉ z webu (jméno, nebo „Moje poloha" v jazyce
     * appky) a ukazuje se ve widgetu vždycky — widget jde pro POSLEDNÍ
     * známou polohu, ne pro tu, kde je telefon teď (`R25`).
     *
     * Web to volá při každém startu i poloze; stahuje se ale jen při změně
     * nebo u starých dat (`Widget.nastav`).
     */
    @JavascriptInterface
    fun nastavWidget(lat: Double, lon: Double, misto: String, lang: String, units: String) {
        Widget.nastav(ctx, lat, lon, misto, lang, units)
    }
}
