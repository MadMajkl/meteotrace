package com.meteotrace

import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
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
     * Stránka běží na stabilním `https` původu, ne na `file://`.
     *
     * Bez toho by neplatilo úložiště prohlížeče mezi verzemi (uložená místa!)
     * a řada webových rozhraní by byla zakázaná.
     */
    private val startUrl = "https://appassets.androidplatform.net/assets/www/index.html"

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
            ): Boolean = request.url.host != "appassets.androidplatform.net"
        }

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
}
