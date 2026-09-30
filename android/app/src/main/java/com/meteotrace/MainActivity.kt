package com.meteotrace

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Tenký obal kolem webové appky (`R1`).
 *
 * Appka samotná je web v `assets/www` — tenhle soubor jen otevře WebView,
 * dá webu stabilní `https` původ a obslouží `/api/…` nativně.
 * **Žádná logika appky tady nesmí přibýt**: co se dá udělat ve webu, se
 * dělá ve webu, protože tam je to otestované a společné s prohlížečem.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    /**
     * Kdo zrovna čeká na odpověď, jestli smí znát polohu.
     *
     * 🚨 Web se ptá přes `navigator.geolocation`, jenže ve WebView to nestačí:
     * povolení musí dát ANDROID (systémový dialog) a teprve pak WebView.
     * Bez obojího se `getCurrentPosition` nikdy neozve — ani chybou.
     * Michal 28. 8. 2026: *„neumí to pracovat s polohou na mobilu… takže
     * si to zapomíná říct o povolení?"* Přesně tak.
     */
    private var cekaNaPolohu: ((Boolean) -> Unit)? = null

    private val zadostOPolohu = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { vysledky ->
        val povoleno = vysledky.values.any { it }
        cekaNaPolohu?.invoke(povoleno)
        cekaNaPolohu = null

        // 🚨 Android se už ptát NEBUDE (dialog se neukázal) → když o povolení
        // žádal člověk tlačítkem v nastavení appky, otevře se mu nastavení
        // telefonu. Jinak by tlačítko nedělalo nic.
        //
        // ⚠️ Pozná se to podle `shouldShowRequestPermissionRationale`, NE
        // podle času. První verze měřila, jestli odpověď přišla „okamžitě"
        // (< 450 ms) — na emulátoru ale tichá odpověď trvala 808 ms a na
        // pomalém telefonu by to dopadlo stejně. Po odmítnutí, po kterém se
        // smí ptát znovu, vrací Android `true`; `false` = už se nezeptá.
        val trvalo = SystemClock.elapsedRealtime() - zadostOd
        val uzSeNezepta = POLOHA.none { ActivityCompat.shouldShowRequestPermissionRationale(this, it) }
        Log.d("MeteoTrace", "žádost o polohu: povoleno=$povoleno, trvalo $trvalo ms, uzSeNezepta=$uzSeNezepta")
        if (!povoleno && uzSeNezepta && priOdmitnutiOtevritNastaveni) otevriNastaveniAppky()
        priOdmitnutiOtevritNastaveni = false

        // Nastavení appky ukazuje stav povolení — ať se přepíše hned.
        oznamPolohuWebu()
    }

    /** Kdy se naposledy spustila žádost o polohu (viz výsledek žádosti výš). */
    private var zadostOd = 0L

    /** Žádost spustil člověk tlačítkem v nastavení — při tichém „ne" otevřít nastavení telefonu. */
    private var priOdmitnutiOtevritNastaveni = false

    /**
     * Povolení k upozorněním.
     *
     * 🚨 Od Androidu 13 (API 33) ho uživatel dává ručně a bez něj `notify()`
     * TIŠE selže — appka by tvrdila „hlídám", telefon by nic neukázal a přišlo
     * by se na to až tím, že by nedorazila výstraha.
     *
     * ⚠️ Výsledek se nikam nevrací: web si stav zjistí sám příštím dotazem
     * na most. Předávat ho zpátky by znamenalo držet rozdělaný callback přes
     * otočení displeje — a to je zbytečná složitost tam, kde stačí zeptat se
     * znovu.
     */
    private val zadostOUpozorneni = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* stav si web přečte z `majiPovoleni()` */ }

    private fun maPolohu(): Boolean = POLOHA.any {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    /** Je v telefonu zapnutá poloha jako taková? Bez ní povolení nestačí. */
    private fun sluzbaPolohyZapnuta(): Boolean {
        val lm = getSystemService(LOCATION_SERVICE) as? LocationManager ?: return true
        return LocationManagerCompat.isLocationEnabled(lm)
    }

    private fun pametPolohy() = getSharedPreferences(PAMET_POLOHY, MODE_PRIVATE)

    /**
     * Stav povolení polohy pro web: `granted` · `off` · `denied` · `prompt`.
     *
     * 🚨 Android neumí říct „zakázáno natrvalo" přímo.
     * `shouldShowRequestPermissionRationale` je `false` ve DVOU případech:
     * když se ještě nikdo neptal, a když se už ptát nesmí (na Androidu 11+
     * po druhém odmítnutí). Rozliší je jen to, jestli jsme se už někdy
     * ptali — a to si pamatujeme sami (`KLIC_PTALI_SE`).
     *
     * ⚠️ TÁŽ TABULKA je v `androidAccess()` ve `web/lib/location-access.js`,
     * kde má samotest. Kdo změní jednu, musí změnit obě —
     * hlídá to `selftest-obal.mjs`.
     */
    private fun stavPolohy(): String {
        if (maPolohu()) return if (sluzbaPolohyZapnuta()) "granted" else "off"
        val ptaliSe = pametPolohy().getBoolean(KLIC_PTALI_SE, false)
        val muzeSeZeptat = POLOHA.any { ActivityCompat.shouldShowRequestPermissionRationale(this, it) }
        return if (ptaliSe && !muzeSeZeptat) "denied" else "prompt"
    }

    /** Systémový dialog o poloze. Zapamatuje si, že už jsme se ptali. */
    private fun zeptejSeNaPolohu() {
        pametPolohy().edit().putBoolean(KLIC_PTALI_SE, true).apply()
        zadostOd = SystemClock.elapsedRealtime()
        zadostOPolohu.launch(POLOHA)
    }

    /**
     * Jedno klepnutí na „Povolit polohu" v nastavení appky.
     *
     * 🚨 Co udělá, ZÁVISÍ NA STAVU. Dialog, který se po trvalém zákazu už
     * neukáže, by z tlačítka udělal mrtvé tlačítko — proto se v tom případě
     * otevře nastavení appky v telefonu, kde jde povolení zapnout ručně.
     */
    private fun povolPolohu() {
        when (stavPolohy()) {
            "prompt" -> zeptejSeNaPolohu()
            // ⚠️ „denied" je ODHAD (viz `stavPolohy`): kdo povolení vypnul
            // ručně v nastavení telefonu, toho se Android zeptá znovu. Proto
            // se nejdřív zkusí dialog a nastavení telefonu se otevře, jen
            // když se dialog neukáže — viz výsledek žádosti.
            "denied" -> {
                priOdmitnutiOtevritNastaveni = true
                zeptejSeNaPolohu()
            }
            "off" -> otevriNastaveni(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        }
    }

    private fun otevriNastaveniAppky() {
        otevriNastaveni(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)),
        )
    }

    private fun otevriNastaveni(intent: Intent) {
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w("MeteoTrace", "nastavení nejde otevřít: ${intent.action}", e)
        }
    }

    /**
     * Řekne webu, že se povolení polohy mohlo změnit.
     *
     * ⚠️ Web si stav PŘEČTE SÁM (`stavPolohy()`), tady se jen zvoní —
     * výsledek se nepředává, ať neexistují dvě pravdy.
     */
    private fun oznamPolohuWebu() {
        if (!::webView.isInitialized) return
        webView.evaluateJavascript("window.dispatchEvent(new Event('meteotrace:poloha'))", null)
    }

    /**
     * Návrat do appky — typicky z nastavení telefonu, kde člověk povolení
     * právě zapnul. Bez tohohle by nastavení appky dál tvrdilo „zakázáno".
     */
    override fun onResume() {
        super.onResume()
        oznamPolohuWebu()
    }

    /**
     * Stránka běží na stabilním `https` původu, ne na `file://`.
     *
     * Bez toho by neplatilo úložiště prohlížeče mezi verzemi (uložená místa!)
     * a řada webových rozhraní by byla zakázaná.
     */
    private val startUrl = "$PUVOD/assets/www/index.html"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        webView = WebView(this)
        setContentView(webView)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                val url = request.url

                // 🚨 `/api/` se NESMÍ obsloužit přes WebViewAssetLoader.
                // Ten předává obsluze jen cestu a DOTAZOVACÍ ČÁST ZAHAZUJE —
                // takže by z `/api/forecast?latitude=50…` zbylo `/api/forecast`
                // a server by dostal dotaz na něco úplně jiného, než appka
                // žádala. Tady je celá adresa k dispozici, tak se použije.
                if (url.path?.startsWith("/api/") == true) {
                    val cesta = url.path + (url.query?.let { "?$it" } ?: "")
                    return ApiPipe.forward(BuildConfig.API_BASE, cesta)
                }

                return assetLoader.shouldInterceptRequest(url)
            }

            /**
             * Vlastní obsah zůstává uvnitř, cizí odkaz jde do PROHLÍŽEČE.
             *
             * 🚨 Vrátit jen `true` nestačí. `true` znamená „postaráno",
             * jenže se pak nestane vůbec nic: klepnutí na dar nebo na
             * crosslink by mlčky nic neudělalo a od rozbitého tlačítka
             * by se to nedalo odlišit. Odkaz proto musí někdo otevřít —
             * a je to systém, ne WebView. Uvnitř obalu by cizí stránka
             * navíc vypadala jako součást appky.
             *
             * ⚠️ Když si adresu nemá kdo vzít (telefon bez prohlížeče,
             * `ActivityNotFoundException`), zůstane odkaz nefunkční —
             * ale aspoň se to nestane potichu v běžném případě.
             */
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (request.url.host == HOSTITEL) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (e: ActivityNotFoundException) {
                    Log.w("MeteoTrace", "odkaz nemá kdo otevřít: ${request.url}", e)
                }
                return true
            }
        }


        /**
         * Poloha: dvoje dveře, ne jedny.
         *
         * ⚠️ Ptá se JEN naše stránka. `origin` se proto porovnává — kdyby
         * appka někdy načetla cizí obsah, nesmí se jím dát vydat za nás.
         *
         * 🚨 `retain = false`: WebView si souhlas NEPAMATUJE, pokaždé se zeptá
         * obalu — a ten ví, jak to doopravdy je (`maPolohu()`). Do 30. 9. 2026
         * tu bylo `true` a WebView si pamatoval „ano" i poté, co člověk
         * povolení v telefonu vypnul: obalu se už neptal, na polohu marně
         * čekal a „Tady" končilo obecným „nepodařilo se" místo žádosti
         * o povolení. Dialog se kvůli tomu neukazuje častěji — když povolení
         * je, odpoví obal hned a bez ptaní.
         */
        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback,
            ) {
                if (!origin.startsWith(PUVOD)) {
                    callback.invoke(origin, false, false)
                    return
                }
                if (maPolohu()) {
                    callback.invoke(origin, true, false)
                    return
                }
                cekaNaPolohu = { povoleno -> callback.invoke(origin, povoleno, false) }
                zeptejSeNaPolohu()
            }
        }

        /**
         * Most do nativní vrstvy — hlídání výstrah na pozadí.
         *
         * 🚨 Připojuje se JEN k naší stránce. `addJavascriptInterface`
         * zpřístupní objekt všemu, co se ve WebView načte, a navigace mimo
         * vlastní původ je proto zakázaná výš (`shouldOverrideUrlLoading`).
         */
        webView.addJavascriptInterface(
            MostDoWebu(
                applicationContext,
                zadost = {
                    // ⚠️ Most volá WebView z vlastního vlákna; dialog o povolení
                    // patří na UI vlákno, jinak se neukáže vůbec.
                    runOnUiThread {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            zadostOUpozorneni.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        // Na starším Androidu se o nic žádat nemusí — povolení
                        // se dávalo instalací a `majiPovoleni()` už vrací pravdu.
                    }
                },
                stavPolohyZActivity = { stavPolohy() },
                povolPolohuVActivite = { runOnUiThread { povolPolohu() } },
            ),
            "MeteoTraceObal",
        )

        // Souhlas, který si WebView zapamatoval ve starší verzi obalu (viz
        // `retain` výš), se zahodí — jinak by u lidí, kteří ho už mají
        // uložený, oprava neplatila. Obal odpoví znovu, a správně.
        GeolocationPermissions.getInstance().clearAll()

        // Ladění WebView z počítače (chrome://inspect) — jen v ladicím sestavení.
        // Ve vydání by to byla otevřená okna do appky uživatele.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // uložená místa a nastavení
            // Appka leží v balíčku, ne na síti. Cache WebView by po aktualizaci
            // servírovala STAROU verzi webu — poučení z Gulpky.
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null) webView.loadUrl(startUrl)
    }

    /** Bez tohohle by se po otočení displeje appka načetla od začátku. */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }

    companion object {
        /** Stabilní původ, na kterém appka běží (viz `startUrl`). */
        private const val HOSTITEL = "appassets.androidplatform.net"
        private const val PUVOD = "https://$HOSTITEL"

        /** Hrubá poloha stačí — appka ukazuje počasí, ne navigaci po metrech. */
        private val POLOHA = arrayOf(
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_FINE_LOCATION,
        )

        /** Kde si obal pamatuje, že se na polohu už jednou ptal (viz `stavPolohy`). */
        private const val PAMET_POLOHY = "poloha"
        private const val KLIC_PTALI_SE = "ptali_se"
    }
}
