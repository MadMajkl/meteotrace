package com.meteotrace

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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
import androidx.core.content.ContextCompat
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
    }

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

            // Vlastní obsah zůstává uvnitř. Cizí odkazy tu zatím nejsou žádné —
            // až budou (dary, licence), otevřou se v prohlížeči jako u Gulpky.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean = request.url.host != HOSTITEL
        }


        /**
         * Poloha: dvoje dveře, ne jedny.
         *
         * ⚠️ Ptá se JEN naše stránka. `origin` se proto porovnává — kdyby
         * appka někdy načetla cizí obsah, nesmí se jím dát vydat za nás.
         *
         * ⚠️ `retain = true` znamená „pamatuj si to pro tenhle původ", takže
         * se člověk neptá znovu při každém klepnutí na tlačítko polohy.
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
                    callback.invoke(origin, true, true)
                    return
                }
                cekaNaPolohu = { povoleno -> callback.invoke(origin, povoleno, povoleno) }
                zadostOPolohu.launch(POLOHA)
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
            MostDoWebu(applicationContext) {
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
            "MeteoTraceObal",
        )

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
    }
}
