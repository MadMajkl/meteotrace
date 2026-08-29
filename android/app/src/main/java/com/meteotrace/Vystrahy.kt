package com.meteotrace

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.app.PendingIntent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Upozornění na meteo výstrahy.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO JE V KOTLINU, KDYŽ „NATIVNÍ VRSTVA NIC NEROZHODUJE" (R13)
 *
 * Protože web na pozadí neběží. Zavřená appka nemá JS, service worker
 * v obalu schválně není (servíruje se z balíčku) a bez serveru není push.
 * Kontrolu, která má chodit i ve chvíli, kdy appka není otevřená, umí
 * jedině systémový plánovač.
 *
 * Rozhodování je proto rozdělené tak, aby tu nevznikla druhá pravda:
 *
 *   · **co je výstraha**, koho se týká, co je prošlé a jakou má totožnost
 *     — dělá SERVER (`trimWarnings`, `filtrujPodleMista`), má samotest;
 *   · **od jaké závažnosti zvonit** — posílá se serveru jako parametr,
 *     takže tabulka stupňů je taky jen na jednom místě;
 *   · tady zbývá: zavolat, porovnat řetězce a zazvonit.
 *
 * ⚠️ Kdyby sem někdy přibylo cokoli, co rozhoduje o počasí, patří to na
 * server nebo do `web/lib/` — ne sem.
 * ────────────────────────────────────────────────────────────────────────
 */
object Vystrahy {

    private const val KANAL = "vystrahy"
    private const val PRACE = "meteotrace-vystrahy"
    private const val PREFS = "meteotrace-hlidani"

    /**
     * Jak často se kontroluje.
     *
     * ⚠️ Kratší interval Android stejně nepřijme — 15 minut je jeho tvrdé
     * minimum u periodické práce. Psát sem menší číslo by jen vypadalo,
     * že appka kontroluje častěji, než doopravdy kontroluje.
     */
    private const val INTERVAL_MIN = 15L

    /**
     * Co se hlídá. `null` = nic; pak se práce vůbec neplánuje.
     *
     * 🚨 `nadpis` je HOTOVÝ TEXT Z WEBU, ne `R.string`. Jazyk appky je volba
     * uživatele (`R10`), kdežto `strings.xml` se řídí jazykem SYSTÉMU —
     * kdo má appku česky a telefon anglicky, dostal by českou appku
     * a anglické upozornění. Web jazyk zná, tak ať větu dodá.
     *
     * ⚠️ Jméno kanálu v systémovém nastavení naopak `R.string` zůstává:
     * tam se člověk dívá do nastavení ANDROIDU a tam patří jazyk systému.
     */
    data class Hlidane(
        val lat: Double,
        val lon: Double,
        val nadpis: String,
        val lang: String,
        val prah: String,
    )

    /* ── plánování ────────────────────────────────────────────────────── */

    /**
     * Zapne hlídání jednoho bodu. Volá se z webu přes most (`MostDoWebu`).
     *
     * ⚠️ `UPDATE` schválně: uživatel si mění místo klidně desetkrát denně
     * a KEEP by nechal běžet hlídání toho prvního. Upozornění na místo,
     * které si člověk dávno přepnul, je horší než žádné — vypadá jako vada.
     */
    fun hlidej(ctx: Context, co: Hlidane) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putFloat("lat", co.lat.toFloat())
            .putFloat("lon", co.lon.toFloat())
            .putString("nadpis", co.nadpis)
            .putString("lang", co.lang)
            .putString("prah", co.prah)
            .apply()

        val prace = PeriodicWorkRequestBuilder<Kontrola>(INTERVAL_MIN, TimeUnit.MINUTES)
            // Bez sítě se stejně nedá nic zjistit; budit kvůli tomu telefon
            // by byla jen spotřebovaná baterie.
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()

        WorkManager.getInstance(ctx)
            .enqueueUniquePeriodicWork(PRACE, ExistingPeriodicWorkPolicy.UPDATE, prace)
    }

    /** Vypne hlídání. Zapomene se i to, o čem už se zvonilo. */
    fun nehlidej(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(PRACE)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun hlidane(ctx: Context): Hlidane? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!p.contains("lat")) return null
        return Hlidane(
            lat = p.getFloat("lat", 0f).toDouble(),
            lon = p.getFloat("lon", 0f).toDouble(),
            nadpis = p.getString("nadpis", "") ?: "",
            lang = p.getString("lang", "cs") ?: "cs",
            prah = p.getString("prah", "Moderate") ?: "Moderate",
        )
    }

    /* ── kontrola ─────────────────────────────────────────────────────── */

    class Kontrola(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

        override suspend fun doWork(): Result {
            val ctx = applicationContext
            val co = hlidane(ctx) ?: return Result.success()

            val telo = stahni(co) ?: return Result.retry()

            val vystrahy = try {
                JSONObject(telo).optJSONArray("warnings")
            } catch (e: Exception) {
                null
            } ?: return Result.success()

            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val znam = prefs.getStringSet("oznamene", emptySet()) ?: emptySet()

            val platne = mutableListOf<Pair<String, String>>()   // id → jev
            for (i in 0 until vystrahy.length()) {
                val w = vystrahy.optJSONObject(i) ?: continue
                val id = w.optString("id").takeIf { it.isNotEmpty() } ?: continue
                platne += id to w.optString("event")
            }

            val nove = platne.filter { it.first !in znam }

            // 🚨 Pamatují se VŠECHNY platné, ne jen ty nové — a jen platné.
            // Server prošlé nevrací, takže se paměť sama čistí a nemůže růst
            // donekonečna. Kdyby tatáž výstraha byla vydána znovu, ozve se:
            // je to nová situace, ne opakování téže.
            prefs.edit().putStringSet("oznamene", platne.map { it.first }.toSet()).apply()

            if (nove.isNotEmpty()) zazvon(ctx, co.nadpis, nove.map { it.second })
            return Result.success()
        }

        /**
         * ⚠️ `minSeverity` řeší SERVER. Kdyby se filtrovalo tady, byla by
         * tabulka stupňů závažnosti na dvou místech a při první opravě by
         * se rozešly.
         */
        private fun stahni(co: Vystrahy.Hlidane): String? = try {
            val adresa = BuildConfig.API_BASE.trimEnd('/') +
                "/api/warnings?lat=${co.lat}&lon=${co.lon}" +
                "&lang=${URLEncoder.encode(co.lang, "UTF-8")}" +
                "&minSeverity=${URLEncoder.encode(co.prah, "UTF-8")}"

            (URL(adresa).openConnection() as HttpURLConnection).run {
                requestMethod = "GET"
                connectTimeout = 12_000
                readTimeout = 12_000
                setRequestProperty("Accept", "application/json")
                if (responseCode in 200..299) inputStream.bufferedReader().readText() else null
            }
        } catch (e: Exception) {
            null       // výpadek sítě není chyba appky; zkusí se za chvíli znovu
        }
    }

    /* ── notifikace ───────────────────────────────────────────────────── */

    /**
     * ⚠️ Kanál se zakládá při KAŽDÉM zvonění, ne jednou při startu. Je to
     * levné a idempotentní — a zakládat ho jen v `onCreate` by znamenalo,
     * že po restartu telefonu (kdy appka neběžela) notifikace tiše zmizí.
     */
    private fun kanal(ctx: Context) {
        val kanal = NotificationChannel(
            KANAL,
            ctx.getString(R.string.kanal_vystrahy),
            // HIGH: výstraha má právo vyrušit. Nižší důležitost by ji
            // schovala do tichého seznamu, kam se člověk podívá pozdě.
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = ctx.getString(R.string.kanal_vystrahy_popis) }

        ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(kanal)
    }

    private fun zazvon(ctx: Context, nadpis: String, jevy: List<String>) {
        kanal(ctx)

        // ⚠️ Bez povolení se nic neposílá. Od Androidu 13 ho uživatel dává
        // ručně a `notify()` by jinak tiše selhalo.
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return

        // 🚨 První jev se POJMENUJE i tehdy, když jich je víc. „2 výstrahy"
        // bez jediného jména nutí otevřít appku jen proto, aby se člověk
        // dozvěděl, jestli má odklidit trampolínu.
        //
        // ⚠️ Zbytek je „+N", ne věta. Věta by potřebovala množné číslo, a to
        // je vlastnost JAZYKA APPKY, ne jazyka telefonu — skládat ji tady by
        // znamenalo českou appku s anglickou notifikací. „+2" rozumí každý
        // a nepotřebuje překlad.
        val prvni = jevy.firstOrNull().orEmpty()
        val text = if (jevy.size > 1) "$prvni +${jevy.size - 1}" else prvni

        val otevri = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val zprava = NotificationCompat.Builder(ctx, KANAL)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle(nadpis)
            .setContentText(text)
            // Dlouhý název jevu se do jednoho řádku nevejde a uřízlá výstraha
            // je k ničemu — rozbalená se přečte celá.
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(otevri)
            .build()

        // ⚠️ Pevné id: novější upozornění NAHRADÍ starší. Deset zpráv o téže
        // bouřce pod sebou je způsob, jak si člověk kanál vypne.
        try {
            NotificationManagerCompat.from(ctx).notify(1, zprava)
        } catch (e: SecurityException) {
            // Povolení mezitím odebrané. Není co dělat a spadnout se nesmí.
        }
    }
}
