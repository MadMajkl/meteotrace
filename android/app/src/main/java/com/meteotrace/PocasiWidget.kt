package com.meteotrace

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Date
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Widget na ploše (`R29`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * ROZDĚLENÍ PRÁCE — STEJNÉ JAKO U VÝSTRAH A ZPRÁV (R17, R28)
 *
 *   · **server** složí obsah v jazyce appky: čísla, slova, ikony i BARVY
 *     OBLOHY (`server/widget.js` nad `web/lib/widget.js`, obojí se samotestem),
 *   · **obal** zavolá, uloží a nakreslí. O počasí nic neví.
 *
 * ⚠️ I barvy chodí ze serveru. Rozhodnout „při dešti tmavě modrá" je
 * rozhodnutí o počasí, a obal by k tomu potřeboval tabulku kódů.
 *
 * 🚨 POLOHA SE TADY NEZJIŠŤUJE (`R25`). Souřadnice a jméno místa posílá web,
 * když je appka otevřená. Proto je JMÉNO MÍSTA ve widgetu vždycky — kdo
 * odjel a appku neotevřel, vidí počasí pro to staré místo a musí to poznat.
 *
 * 🚨 A STÁŘÍ DAT TAKY. Widget visí na ploše celé dny; když telefon nemá
 * síť, zůstane v něm poslední stav. Čas načtení je proto vždycky vidět
 * a po třech hodinách se obarví — staré číslo bez varování vypadá jako
 * dnešní („mlčící správné chování").
 * ────────────────────────────────────────────────────────────────────────
 *
 * Kreslení je opsané z Gulpky (`GulpkaWidget.kt`): čisté `RemoteViews`
 * a pozadí nakreslené do bitmapy. Žádná knihovna navíc (`R0`).
 */
class PocasiWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) vykresli(ctx, mgr, id)
        Widget.planuj(ctx)
        // Po přidání widgetu na plochu nečekat půl hodiny na první data.
        if (Widget.zastarale(ctx, Widget.CERSTVE_MS)) Widget.obnovHned(ctx)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: Bundle) {
        // Změna velikosti: jiné rozvržení a jinak velké pozadí.
        vykresli(ctx, mgr, id)
    }

    override fun onEnabled(ctx: Context) = Widget.planuj(ctx)

    /** Poslední widget z plochy pryč → nic se nestahuje. */
    override fun onDisabled(ctx: Context) = Widget.zrus(ctx)

    companion object {

        /* ── rozvržení podle velikosti ────────────────────────────────── */

        /**
         * Jedna varianta rozvržení.
         * @param od  nejmenší velikost (dp), od které se varianta hodí
         * @param ids prvky, které v ní jsou — 🚨 na prvek, který v rozvržení
         *            chybí, se NESMÍ nic nastavit, jinak launcher ukáže
         *            „Widget nelze načíst" místo celého widgetu
         */
        private class Varianta(val layout: Int, val od: SizeF, val ids: Set<Int>, val hodin: Int)

        private val VARIANTY by lazy {
            listOf(
                Varianta(
                    R.layout.widget_pocasi_velky, SizeF(250f, 150f),
                    setOf(R.id.w_misto, R.id.w_cas, R.id.w_ikona, R.id.w_teplota, R.id.w_popis,
                        R.id.w_pocitove, R.id.w_maxmin, R.id.w_veta, R.id.w_hodiny),
                    hodin = 6,
                ),
                Varianta(
                    R.layout.widget_pocasi_maly, SizeF(110f, 110f),
                    setOf(R.id.w_misto, R.id.w_cas, R.id.w_ikona, R.id.w_teplota, R.id.w_popis,
                        R.id.w_maxmin, R.id.w_veta),
                    hodin = 0,
                ),
                Varianta(
                    R.layout.widget_pocasi_uzky, SizeF(200f, 50f),
                    setOf(R.id.w_misto, R.id.w_cas, R.id.w_ikona, R.id.w_teplota, R.id.w_maxmin, R.id.w_veta),
                    hodin = 0,
                ),
                Varianta(
                    R.layout.widget_pocasi_drobny, SizeF(40f, 40f),
                    setOf(R.id.w_misto, R.id.w_cas, R.id.w_ikona, R.id.w_teplota),
                    hodin = 0,
                ),
            )
        }

        /**
         * Která varianta se vejde do dané velikosti (dp) — pro Android < 12,
         * kde si launcher neumí vybrat sám.
         *
         * ⚠️ Pořadí VARIANT je od největší: vyhraje první, která se vejde.
         * Maly (2 × 2) je před úzkým (4 × 1) schválně — čtverec by se do úzkého
         * nevešel na výšku, ale úzký se do čtverce nevejde na šířku.
         */
        private fun vyber(sirka: Float, vyska: Float): Varianta =
            VARIANTY.firstOrNull { sirka >= it.od.width && vyska >= it.od.height } ?: VARIANTY.last()

        /** Skutečná velikost widgetu v dp. */
        private fun velikost(mgr: AppWidgetManager, id: Int): SizeF {
            val o = mgr.getAppWidgetOptions(id)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                @Suppress("DEPRECATION")
                val velikosti = o.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
                velikosti?.firstOrNull()?.let { return it }
            }
            // Na výšku: šířka je ta menší, výška ta větší (tak to launchery hlásí).
            return SizeF(
                o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250).toFloat(),
                o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 150).toFloat(),
            )
        }

        /* ── kreslení ─────────────────────────────────────────────────── */

        fun vykresli(ctx: Context, mgr: AppWidgetManager, id: Int) {
            val stav = Widget.stav(ctx)
            val views = if (stav == null) {
                RemoteViews(ctx.packageName, R.layout.widget_pocasi_prazdny).also {
                    // ⚠️ Místo už známe, jen data ještě nedorazila (třeba bez
                    // sítě). „Zjisti polohu" by pak byla nepravda — ukáže se
                    // jméno místa a tři tečky, žádný překlad k tomu netřeba.
                    Widget.misto(ctx)?.takeIf { m -> m.isNotEmpty() }?.let { m ->
                        it.setTextViewText(R.id.w_prazdny_text, "$m · …")
                    }
                    it.setOnClickPendingIntent(android.R.id.background, otevri(ctx))
                }
            } else {
                val v = velikost(mgr, id)
                val pozadi = pozadi(ctx, v, stav.data.optJSONObject("pozadi"))
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // Android 12+: launcher si variantu vybere sám podle skutečné
                    // velikosti — i při změně velikosti bez dalšího volání appky.
                    RemoteViews(VARIANTY.associate { it.od to naplnVariantu(ctx, it, stav, pozadi) })
                } else {
                    naplnVariantu(ctx, vyber(v.width, v.height), stav, pozadi)
                }
            }
            try {
                mgr.updateAppWidget(id, views)
            } catch (e: Exception) {
                // Příliš velká bitmapa nebo launcher, který mezitím widget zahodil.
                // Widget zůstane ve starém stavu; spadnout kvůli tomu nesmí.
            }
        }

        private fun naplnVariantu(ctx: Context, va: Varianta, st: Widget.Stav, pozadi: Bitmap): RemoteViews {
            val d = st.data
            val v = RemoteViews(ctx.packageName, va.layout)
            fun text(id: Int, co: String) {
                if (id !in va.ids) return
                v.setTextViewText(id, co)
                v.setViewVisibility(id, if (co.isEmpty()) View.GONE else View.VISIBLE)
            }

            v.setImageViewBitmap(R.id.w_pozadi, pozadi)
            text(R.id.w_misto, st.misto)
            text(R.id.w_ikona, d.optString("ikona"))
            text(R.id.w_teplota, d.optString("teplota"))
            text(R.id.w_popis, d.optString("popis"))
            text(R.id.w_pocitove, d.optString("pocitove"))
            text(R.id.w_maxmin, d.optString("maxMin"))
            // 🚨 Věta o srážkách platí jen do `vetaDo`. „Od 15:00 déšť" z ranních
            // dat se v šest večer neopakuje — bez sítě by tam jinak viselo dál.
            val vetaDo = d.optLong("vetaDo", Long.MAX_VALUE)
            text(R.id.w_veta, if (System.currentTimeMillis() < vetaDo) d.optString("veta") else "")

            // 🚨 Čas načtení. Po třech hodinách zlatě a s výstrahou: widget
            // na ploše nesmí vydávat ranní číslo za odpolední.
            if (R.id.w_cas in va.ids) {
                val cas = android.text.format.DateFormat.getTimeFormat(ctx).format(Date(st.nacteno))
                val stare = System.currentTimeMillis() - st.nacteno > Widget.STARE_MS
                v.setTextViewText(R.id.w_cas, if (stare) "⚠ $cas" else "↻ $cas")
                v.setTextColor(R.id.w_cas, if (stare) Color.parseColor("#FFD36A") else Color.WHITE)
                // Nejmenší varianta čas ukazuje JEN u starých dat — místo nemá.
                if (va.layout == R.layout.widget_pocasi_drobny) {
                    v.setViewVisibility(R.id.w_cas, if (stare) View.VISIBLE else View.GONE)
                    v.setViewVisibility(R.id.w_misto, if (stare) View.GONE else View.VISIBLE)
                }
            }

            if (R.id.w_hodiny in va.ids) {
                v.removeAllViews(R.id.w_hodiny)
                // ⚠️ Uplynulé hodiny se zahazují. Server jich posílá dvanáct,
                // ukáže se prvních šest, které jsou ještě před námi.
                val ted = System.currentTimeMillis()
                val hodiny = d.optJSONArray("hodiny") ?: JSONArray()
                var pridano = 0
                for (i in 0 until hodiny.length()) {
                    if (pridano >= va.hodin) break
                    val h = hodiny.optJSONObject(i) ?: continue
                    if (h.optLong("ms") <= ted) continue
                    val bunka = RemoteViews(ctx.packageName, R.layout.widget_pocasi_hodina)
                    bunka.setTextViewText(R.id.w_h_cas, h.optString("cas"))
                    bunka.setTextViewText(R.id.w_h_ikona, h.optString("ikona"))
                    bunka.setTextViewText(R.id.w_h_teplota, h.optString("teplota"))
                    v.addView(R.id.w_hodiny, bunka)
                    pridano++
                }
                v.setViewVisibility(R.id.w_hodiny, if (pridano > 0) View.VISIBLE else View.GONE)
            }

            v.setContentDescription(
                android.R.id.background,
                listOf(st.misto, d.optString("teplota"), d.optString("popis"), d.optString("veta"))
                    .filter { it.isNotEmpty() }.joinToString(", "),
            )
            v.setOnClickPendingIntent(android.R.id.background, otevri(ctx))
            return v
        }

        /**
         * Pro ladicí náhled (`src/debug/…/NahledWidgetu`): TATÁŽ cesta jako na
         * ploše — varianta, pozadí i plnění. Náhled, který by kreslil jinak,
         * by chválil vzhled, který na ploše nikdy nebude.
         *
         * @param varianta index do `VARIANTY` (0 velký, 1 malý, 2 úzký, 3 drobný)
         */
        internal fun nahled(
            ctx: Context, varianta: Int, data: JSONObject, misto: String,
            nacteno: Long, sirkaDp: Float, vyskaDp: Float,
        ): RemoteViews {
            val st = Widget.Stav(data, misto, nacteno)
            val pozadi = pozadi(ctx, SizeF(sirkaDp, vyskaDp), data.optJSONObject("pozadi"))
            return naplnVariantu(ctx, VARIANTY[varianta], st, pozadi)
        }

        private fun otevri(ctx: Context): PendingIntent = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        /**
         * Obloha do bitmapy: přechod, záře (slunce, měsíc, blesk) a dole jemné
         * ztmavnutí pod pruh hodin. ⚠️ Žádné tečky (hvězdy) — vedle čísel se
         * čtou jako desetinná čárka (viz `SKY` ve `web/lib/widget.js`).
         *
         * ⚠️ Rozlišení nejvýš 2,5× — přechod jemnější být nemusí a bitmapy
         * widgetu mají v Androidu strop na paměť (a s Androidem 12 jsou tu
         * čtyři varianty rozvržení).
         */
        private fun pozadi(ctx: Context, v: SizeF, p: JSONObject?): Bitmap {
            val hustota = min(ctx.resources.displayMetrics.density, 2.5f)
            val w = (v.width * hustota).roundToInt().coerceIn(40, 1500)
            val h = (v.height * hustota).roundToInt().coerceIn(40, 1100)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)

            // Rohy jako systém (Android 12+), aby widget ve stohu seděl
            // k ostatním; na starších 24 dp jako Gulpka.
            val polomerDp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                ctx.resources.getDimension(android.R.dimen.system_app_widget_background_radius) /
                    ctx.resources.displayMetrics.density
            } else 24f
            val r = polomerDp * hustota
            c.clipPath(Path().apply { addRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), r, r, Path.Direction.CW) })

            val od = barva(p?.optString("od"), "#1B63C6")
            val dolu = barva(p?.optString("do"), "#358AD4")
            paint.shader = LinearGradient(0f, 0f, w * 0.35f, h.toFloat(), od, dolu, Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)

            val zare = p?.optString("zare")?.takeIf { it.startsWith("#") }
            if (zare != null) {
                val z = barva(zare, "#FFD36A")
                paint.shader = RadialGradient(
                    w * 0.9f, h * 0.02f, max(w, h) * 0.6f,
                    intArrayOf(sAlfou(z, 0x99), sAlfou(z, 0x2E), Color.TRANSPARENT),
                    floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP,
                )
                // 🚨 SCREEN, ne obyčejná průhlednost. Zlatá přes modrou se
                // obyčejně smíchá do olivově šedé (vidět na náhledu 22. 9. 2026);
                // „screen" jen zesvětluje, takže záře svítí, a nešpiní.
                paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SCREEN)
                c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)
                paint.xfermode = null
            }

            // Jemný lesk nahoře a stín dole, pod pruhem hodin.
            paint.shader = LinearGradient(0f, 0f, 0f, h * 0.3f, Color.argb(0x1F, 255, 255, 255), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, w.toFloat(), h * 0.3f, paint)
            paint.shader = LinearGradient(0f, h * 0.5f, 0f, h.toFloat(), Color.TRANSPARENT, Color.argb(0x38, 0, 0, 0), Shader.TileMode.CLAMP)
            c.drawRect(0f, h * 0.5f, w.toFloat(), h.toFloat(), paint)
            return bmp
        }

        private fun sAlfou(barva: Int, alfa: Int) = Color.argb(alfa, Color.red(barva), Color.green(barva), Color.blue(barva))

        private fun barva(hex: String?, zaloha: String): Int = try {
            Color.parseColor(hex?.takeIf { it.startsWith("#") } ?: zaloha)
        } catch (e: Exception) {
            Color.parseColor(zaloha)
        }
    }
}

/**
 * Data a obnova widgetu.
 *
 * ⚠️ Stahuje se JEN, když je nějaký widget na ploše. Kdo widget nemá,
 * nesmí kvůli němu platit baterií ani daty.
 */
object Widget {

    private const val PREFS = "meteotrace-widget"
    private const val PRACE = "meteotrace-widget-obnova"
    private const val PRACE_HNED = "meteotrace-widget-hned"

    /** Jak často se widget obnovuje. Víc by bylo o baterii, míň o čerstvosti. */
    private const val INTERVAL_MIN = 30L

    /** Od kdy se data berou jako stará a čas se obarví (viz `PocasiWidget`). */
    const val STARE_MS = 3 * 60 * 60 * 1000L

    /** Do kdy se po otevření appky znovu nestahuje — data jsou dost čerstvá. */
    const val CERSTVE_MS = 15 * 60 * 1000L

    class Stav(val data: JSONObject, val misto: String, val nacteno: Long)

    /** Poslední platný obsah, nebo `null`, když widget ještě nic nemá. */
    fun stav(ctx: Context): Stav? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val json = p.getString("data", null) ?: return null
        return try {
            Stav(JSONObject(json), p.getString("misto", "") ?: "", p.getLong("nacteno", 0L))
        } catch (e: Exception) {
            null
        }
    }

    /** Jméno místa, jakmile ho web poslal — i když data ještě nedorazila. */
    fun misto(ctx: Context): String? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return if (p.contains("lat")) p.getString("misto", "") else null
    }

    fun zastarale(ctx: Context, starsiNez: Long): Boolean {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return System.currentTimeMillis() - p.getLong("nacteno", 0L) > starsiNez
    }

    /**
     * Pro jaké místo widget ukazuje — posílá web (`R25`).
     *
     * ⚠️ Stahuje se jen při ZMĚNĚ (místo, jazyk, jednotky) nebo když jsou data
     * starší než čtvrt hodiny. Web to volá při každém startu appky a při každé
     * poloze; bez téhle brzdy by se widget stahoval při každém otevření appky.
     */
    fun nastav(ctx: Context, lat: Double, lon: Double, misto: String, lang: String, units: String) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val zmena = p.getFloat("lat", Float.NaN) != lat.toFloat() ||
            p.getFloat("lon", Float.NaN) != lon.toFloat() ||
            p.getString("lang", null) != lang ||
            p.getString("units", null) != units
        val e = p.edit()
            .putFloat("lat", lat.toFloat())
            .putFloat("lon", lon.toFloat())
            .putString("misto", misto)
            .putString("lang", lang)
            .putString("units", units)
        // 🚨 Při změně místa se staré počasí zahodí: pod novým jménem by
        // ukazovalo cizí město, dokud nedorazí nová data.
        if (zmena) e.remove("data").remove("nacteno")
        e.apply()

        if (!maWidgety(ctx)) return
        prekresli(ctx)                              // jméno místa hned
        if (zmena || zastarale(ctx, CERSTVE_MS)) obnovHned(ctx)
    }

    fun maWidgety(ctx: Context): Boolean = ids(ctx).isNotEmpty()

    private fun ids(ctx: Context): IntArray =
        AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, PocasiWidget::class.java))

    fun prekresli(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        for (id in ids(ctx)) PocasiWidget.vykresli(ctx, mgr, id)
    }

    private fun sit() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Pravidelná obnova. `KEEP`: opakované volání nesmí odpočet posouvat. */
    fun planuj(ctx: Context) {
        val prace = PeriodicWorkRequestBuilder<ObnovaWidgetu>(INTERVAL_MIN, TimeUnit.MINUTES)
            .setConstraints(sit())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PRACE, ExistingPeriodicWorkPolicy.KEEP, prace)
    }

    fun obnovHned(ctx: Context) {
        val prace = OneTimeWorkRequestBuilder<ObnovaWidgetu>()
            .setConstraints(sit())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(PRACE_HNED, ExistingWorkPolicy.REPLACE, prace)
    }

    fun zrus(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(PRACE)
        WorkManager.getInstance(ctx).cancelUniqueWork(PRACE_HNED)
    }

    class ObnovaWidgetu(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
        override suspend fun doWork(): Result {
            val ctx = applicationContext
            if (!maWidgety(ctx)) return Result.success()
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (!p.contains("lat")) {
                prekresli(ctx)                      // prázdný stav řekne, co dělat
                return Result.success()
            }

            val adresa = BuildConfig.API_BASE.trimEnd('/') +
                "/api/widget?lat=${p.getFloat("lat", 0f)}&lon=${p.getFloat("lon", 0f)}" +
                "&lang=${URLEncoder.encode(p.getString("lang", "en") ?: "en", "UTF-8")}" +
                "&units=${URLEncoder.encode(p.getString("units", "metric") ?: "metric", "UTF-8")}"

            val telo = try {
                (URL(adresa).openConnection() as HttpURLConnection).run {
                    requestMethod = "GET"
                    connectTimeout = 12_000
                    readTimeout = 12_000
                    setRequestProperty("Accept", "application/json")
                    if (responseCode in 200..299) inputStream.bufferedReader().readText() else null
                }
            } catch (e: Exception) {
                null
            } ?: return Result.retry()              // výpadek sítě není chyba appky

            // ⚠️ `widget: null` = server nemá co ukázat. Zůstává poslední stav
            // i s časem načtení, takže je vidět, jak je starý.
            val obsah = try {
                JSONObject(telo).optJSONObject("widget")
            } catch (e: Exception) {
                null
            } ?: return Result.success()

            p.edit()
                .putString("data", obsah.toString())
                .putLong("nacteno", System.currentTimeMillis())
                .apply()
            prekresli(ctx)
            return Result.success()
        }
    }
}
