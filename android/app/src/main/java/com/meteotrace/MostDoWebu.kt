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
) {

    /** Umí tenhle obal hlídat výstrahy? Web se ptá, aby věděl, co nabídnout. */
    @JavascriptInterface
    fun umiUpozorneni(): Boolean = true

    /**
     * Zapne hlídání jednoho místa.
     *
     * ⚠️ `nadpis` chodí HOTOVÝ z webu, protože jazyk appky je volba uživatele,
     * kdežto `strings.xml` se řídí jazykem systému. Viz `Vystrahy.Hlidane`.
     */
    @JavascriptInterface
    fun hlidejVystrahy(lat: Double, lon: Double, nadpis: String, lang: String, prah: String) {
        Vystrahy.hlidej(ctx, Vystrahy.Hlidane(lat, lon, nadpis, lang, prah))
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
}
