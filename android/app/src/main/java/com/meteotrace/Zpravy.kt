package com.meteotrace

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Calendar

/**
 * Ranní a večerní zpráva o počasí (`R25`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * ROZDĚLENÍ PRÁCE — STEJNÉ JAKO U VÝSTRAH (R17)
 *
 *   · **server** složí VĚTU v jazyce appky (`server/brief.js` nad čistou
 *     `web/lib/brief.js`, obojí se samotestem),
 *   · **obal** zavolá, dostane hotový text a zazvoní. Nic nepočítá.
 *
 * ⚠️ Kdyby si text skládal obal, musel by znát kódy počasí, jednotky
 * i jazyk — tři tabulky, které se při první opravě rozejdou s appkou.
 *
 * 🚨 POLOHA SE TADY NEZJIŠŤUJE. Z pozadí by to chtělo
 * `ACCESS_BACKGROUND_LOCATION`, což je na Play zvlášť posuzované oprávnění
 * (`R25`). Souřadnice posílá web, když je appka otevřená, a obal si je
 * pamatuje. Proto zpráva vždycky nese JMÉNO MÍSTA — kdo odjel a appku
 * neotevřel, dostane zprávu pro to staré a musí to poznat.
 * ────────────────────────────────────────────────────────────────────────
 */
object Zpravy {

    private const val KANAL = "zpravy"
    private const val PREFS = "meteotrace-zpravy"

    /** Druhy zpráv. Musí sedět na `KINDS` ve `web/lib/brief.js`. */
    const val RANO = "morning"
    const val VECER = "evening"

    /**
     * Id upozornění. 🚨 RŮZNÁ pro ráno a večer — se shodným id by večerní
     * zpráva přepsala ranní a kdo se ráno nepodíval, o ni přišel.
     * (1 patří výstrahám, viz `Vystrahy`.)
     */
    private const val ID_RANO = 2
    private const val ID_VECER = 3

    data class Nastaveni(
        val lat: Double,
        val lon: Double,
        /** Hotové nadpisy z webu — jazyk appky, ne systému. Viz `R17`. */
        val nadpisRano: String,
        val nadpisVecer: String,
        val lang: String,
        val units: String,
        /** Minuty od půlnoci. */
        val ranoMin: Int,
        val vecerMin: Int,
    )

    /* ── plánování ────────────────────────────────────────────────────── */

    fun nastav(ctx: Context, co: Nastaveni) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putFloat("lat", co.lat.toFloat())
            .putFloat("lon", co.lon.toFloat())
            .putString("nadpisRano", co.nadpisRano)
            .putString("nadpisVecer", co.nadpisVecer)
            .putString("lang", co.lang)
            .putString("units", co.units)
            .putInt("ranoMin", co.ranoMin)
            .putInt("vecerMin", co.vecerMin)
            .putBoolean("zapnuto", true)
            .apply()
        naplanuj(ctx)
    }

    fun vypni(ctx: Context) {
        val budik = ctx.getSystemService(AlarmManager::class.java)
        for (druh in listOf(RANO, VECER)) budik?.cancel(zamer(ctx, druh))
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun zapnuto(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("zapnuto", false)

    /**
     * Naplánuje nejbližší ráno a nejbližší večer.
     *
     * 🚨 `setAndAllowWhileIdle`, ne `setExactAndAllowWhileIdle`. Přesný budík
     * chce od Androidu 12 zvlášť oprávnění, které Google dává jen budíkům
     * a kalendářům — a u ranní zprávy o počasí je pár minut sem tam jedno.
     * Obyčejný `set` by naopak v hlubokém spánku telefonu neprošel vůbec
     * a zpráva by přišla až dopoledne, kdy už je k ničemu.
     *
     * ⚠️ Plánuje se VŽDYCKY jen nejbližší výskyt a další se nasadí, až ten
     * odejde (`Budik.onReceive`). Opakující se budík Android v spánku sráží
     * na nejvýš jedno spuštění za devět minut a časem se rozjede.
     */
    fun naplanuj(ctx: Context) {
        if (!zapnuto(ctx)) return
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val budik = ctx.getSystemService(AlarmManager::class.java) ?: return

        for ((druh, minuty) in listOf(RANO to p.getInt("ranoMin", 6 * 60 + 30), VECER to p.getInt("vecerMin", 20 * 60))) {
            budik.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dalsi(minuty), zamer(ctx, druh))
        }
    }

    /** Nejbližší okamžik, kdy bude `minuty` od půlnoci — dnes, nebo zítra. */
    private fun dalsi(minuty: Int): Long {
        val c = Calendar.getInstance()
        c.set(Calendar.HOUR_OF_DAY, minuty / 60)
        c.set(Calendar.MINUTE, minuty % 60)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        // ⚠️ Rovnost se počítá jako „už bylo": budík nastavený na tutéž
        // minutu, ve které se plánuje, by se spustil okamžitě a zpráva by
        // přišla dvakrát.
        if (c.timeInMillis <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }

    private fun zamer(ctx: Context, druh: String): PendingIntent = PendingIntent.getBroadcast(
        ctx,
        if (druh == VECER) ID_VECER else ID_RANO,
        Intent(ctx, BudikZprav::class.java).setAction(druh),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /* ── vyzvednutí a zazvonění ───────────────────────────────────────── */

    /**
     * Práci dělá `WorkManager`, ne přímo příjemce budíku.
     *
     * 🚨 `onReceive` má na všechno **deset sekund** a síť tolik trvat může.
     * Stažení proto přebírá worker, který má vlastní čas a při výpadku sítě
     * počká, až bude.
     */
    fun vyzvedni(ctx: Context, druh: String) {
        val prace = OneTimeWorkRequestBuilder<Poslat>()
            .setInputData(Data.Builder().putString("druh", druh).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            // Zpráva má smysl teď, ne za hodinu. Nevejde-li se do zrychlené
            // fronty, Android ji spustí obyčejně — o to se stará knihovna.
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("meteotrace-zprava-$druh", ExistingWorkPolicy.REPLACE, prace)
    }

    class Poslat(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
        override suspend fun doWork(): Result {
            val ctx = applicationContext
            val druh = inputData.getString("druh") ?: return Result.success()
            if (!zapnuto(ctx)) return Result.success()

            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (!p.contains("lat")) return Result.success()

            val adresa = BuildConfig.API_BASE.trimEnd('/') +
                "/api/brief?lat=${p.getFloat("lat", 0f)}&lon=${p.getFloat("lon", 0f)}" +
                "&kind=${URLEncoder.encode(druh, "UTF-8")}" +
                "&lang=${URLEncoder.encode(p.getString("lang", "cs") ?: "cs", "UTF-8")}" +
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
            } ?: return Result.retry()      // výpadek sítě není chyba appky

            // 🚨 `text: null` znamená „nemáme co říct" (chybí předpověď na ten
            // den). NEZVONÍ se: prázdná zpráva vypadá jako vada appky.
            val text = try {
                JSONObject(telo).optString("text").takeIf { it.isNotEmpty() && it != "null" }
            } catch (e: Exception) {
                null
            } ?: return Result.success()

            val nadpis = p.getString(if (druh == VECER) "nadpisVecer" else "nadpisRano", "") ?: ""
            zazvon(ctx, if (druh == VECER) ID_VECER else ID_RANO, nadpis, text)
            return Result.success()
        }
    }

    /**
     * ⚠️ Kanál se zakládá při každém zvonění — je to levné a idempotentní.
     * Zakládat ho jen při startu appky by znamenalo, že po restartu telefonu
     * (kdy appka neběžela) upozornění tiše zmizí.
     *
     * ⚠️ `IMPORTANCE_DEFAULT`, ne `HIGH`. Ranní předpověď není výstraha
     * a nemá právo vyrušit zvukem přes celou obrazovku — od výstrah se
     * navíc musí dát odlišit, proto vlastní kanál, který jde vypnout zvlášť.
     */
    private fun kanal(ctx: Context) {
        val kanal = NotificationChannel(
            KANAL,
            ctx.getString(R.string.kanal_zpravy),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = ctx.getString(R.string.kanal_zpravy_popis) }
        ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(kanal)
    }

    private fun zazvon(ctx: Context, id: Int, nadpis: String, text: String) {
        kanal(ctx)
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return

        val otevri = PendingIntent.getActivity(
            ctx, id,
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val zprava = NotificationCompat.Builder(ctx, KANAL)
            .setSmallIcon(android.R.drawable.ic_menu_day)
            .setContentTitle(nadpis)
            .setContentText(text)
            // Věta se do jednoho řádku nevejde vždycky a uřízlá předpověď
            // je k ničemu — rozbalená se přečte celá.
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(otevri)
            .build()

        try {
            NotificationManagerCompat.from(ctx).notify(id, zprava)
        } catch (e: SecurityException) {
            // Povolení mezitím odebrané. Není co dělat a spadnout se nesmí.
        }
    }
}

/**
 * Příjemce budíku: pustí stažení a **hned naplánuje další den**.
 *
 * 🚨 Bez přeplánování by zpráva přišla jednou a pak už nikdy — a nikdo by
 * si toho nevšiml, protože chybějící upozornění nevypadá jako chyba.
 */
class BudikZprav : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val druh = intent.action ?: Zpravy.RANO
        Zpravy.vyzvedni(ctx, druh)
        Zpravy.naplanuj(ctx)
    }
}

/**
 * Po restartu telefonu se budíky ztrácejí — Android je nedrží.
 *
 * ⚠️ Výstrahy si `WorkManager` obnoví sám, budíky ne. Bez tohohle by ranní
 * zpráva po každém restartu tiše přestala chodit.
 */
class PoRestartu : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) Zpravy.naplanuj(ctx)
    }
}
