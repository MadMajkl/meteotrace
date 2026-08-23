package com.meteotrace

import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Nativní potrubí pro `/api/…`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ JE TO JEN POTRUBÍ A NE DRUHÁ PROXY
 *
 * `R2` počítalo s tím, že v appce poběží **druhá implementace proxy** —
 * nativní. Jenže od té doby proxy zhoustla: katalog zdrojů, cache, ořez
 * výstrah, hranice ORP a přiřazení podle jmen. Napsat to celé podruhé
 * v Kotlinu by znamenalo **dvě pravdy o tomtéž**, které se rozejdou při
 * první opravě — a testy máme jen k té jedné.
 *
 * Nativní vrstva proto **nic nerozhoduje**. Vezme dotaz, pošle ho na náš
 * server a vrátí odpověď. Zůstává tím zachované všechno podstatné z `R2`:
 *
 *   · stránka ve WebView volá jen svůj vlastní původ → **žádný CORS**,
 *   · klíč k routeru zůstává na serveru a **do JS se nikdy nedostane**,
 *   · výměna poskytovatele je pořád změna na serveru, ne v appce.
 *
 * Viz `R13`.
 * ────────────────────────────────────────────────────────────────────────
 */
object ApiPipe {

    /** Kolik sekund se čeká na náš server, než to vzdáme. Stejně jako na webu. */
    private const val TIMEOUT_S = 12

    /**
     * Přenese jeden dotaz.
     *
     * ⚠️ `cesta` MUSÍ přijít i s dotazovací částí (`?lat=…&lon=…`).
     * `WebViewAssetLoader` ji zahazuje — proto se `/api/` obsluhuje
     * v `shouldInterceptRequest`, kde je celá adresa k dispozici.
     * Bez dotazovací části by se každý dotaz zeptal na něco jiného, než
     * o co appka žádala, a nikdo by nepoznal proč.
     */
    fun forward(base: String, cestaSDotazem: String): WebResourceResponse {
        return try {
            val spojeni = (URL(base.trimEnd('/') + cestaSDotazem).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_S * 1000
                readTimeout = TIMEOUT_S * 1000
                setRequestProperty("Accept", "application/json")
            }

            val stav = spojeni.responseCode
            // Chybové odpovědi mají tělo v `errorStream`. Kdyby se zahodilo,
            // uživatel by místo vysvětlení dostal prázdno.
            val telo = (if (stav >= 400) spojeni.errorStream else spojeni.inputStream)
                ?.readBytes() ?: ByteArray(0)

            val typ = spojeni.contentType?.substringBefore(';')?.trim() ?: "application/json"

            WebResourceResponse(
                typ,
                "utf-8",
                stav,
                popisStavu(stav),
                hlavicky(spojeni),
                ByteArrayInputStream(telo),
            )
        } catch (e: Exception) {
            // Výpadek sítě není důvod k pádu appky — ale ani k mlčení.
            // Klient dostane týž tvar chyby jako z webové proxy, takže
            // obrazovka umí říct, co se stalo.
            val zprava = """{"error":"Spojení se serverem selhalo: ${e.message}","status":502}"""
            WebResourceResponse(
                "application/json",
                "utf-8",
                502,
                "Bad Gateway",
                mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream(zprava.toByteArray()),
            )
        }
    }

    /**
     * Hlavičky, které se propouštějí zpátky do stránky.
     *
     * ⚠️ Prochází jen to, co appka opravdu čte. `X-MeteoTrace-Stale` a `Age`
     * nesou informaci, že data jsou stará — kdyby se ztratily, tvářila by se
     * prošlá předpověď jako čerstvá.
     */
    private fun hlavicky(spojeni: HttpURLConnection): Map<String, String> {
        val out = mutableMapOf<String, String>()
        for (jmeno in listOf("Cache-Control", "X-MeteoTrace-Stale", "Age")) {
            spojeni.getHeaderField(jmeno)?.let { out[jmeno] = it }
        }
        return out
    }

    private fun popisStavu(stav: Int): String = when (stav) {
        200 -> "OK"
        400 -> "Bad Request"
        404 -> "Not Found"
        500 -> "Internal Server Error"
        502 -> "Bad Gateway"
        else -> "Status $stav"
    }
}
