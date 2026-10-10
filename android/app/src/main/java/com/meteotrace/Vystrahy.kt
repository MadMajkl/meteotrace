package com.meteotrace

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Upozornění na meteo výstrahy a na bouřku z radaru (`R17`, `R37`).
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
 *   · **je to bouřka a jde sem?** — taky server (`storm-watch.js`), i s větou;
 *   · **od jaké závažnosti zvonit** — posílá se serveru jako parametr,
 *     takže tabulka stupňů je taky jen na jednom místě;
 *   · tady zbývá: zavolat, porovnat řetězce (a u bouřky čas) a zazvonit.
 *
 * ⚠️ Kdyby sem někdy přibylo cokoli, co rozhoduje o počasí, patří to na
 * server nebo do `web/lib/` — ne sem.
 * ────────────────────────────────────────────────────────────────────────
 */
object Vystrahy {

    private const val KANAL = "vystrahy"
    private const val PRACE = "meteotrace-vystrahy"
    private const val PRACE_HNED = "meteotrace-vystrahy-hned"
    private const val PREFS = "meteotrace-hlidani"

    /** Id upozornění. 2 a 3 patří ranní a večerní zprávě (`Zpravy`). */
    private const val ID_VYSTRAHA = 1
    private const val ID_BOURKA = 4

    /** Id budíku (`PendingIntent`). Jiné než budíky zpráv (2, 3). */
    private const val ID_BUDIKU = 10

    /* Klíče v paměti. ⚠️ Čte je i `StavNaPozadi` — stav, který člověk
       uvidí v nastavení, se nesmí počítat jinde než tady. */
    private const val KLIC_KONTROLA = "kontrolaMs"
    private const val KLIC_BOURKA_VIDENA = "bourkaVidenaMs"
    private const val KLIC_BOURKA_OHLASENA = "bourkaOhlasenaMs"

    /**
     * Jak často se kontroluje.
     *
     * ⚠️ Kratší interval Android stejně nepřijme — 15 minut je jeho tvrdé
     * minimum u periodické práce. Psát sem menší číslo by jen vypadalo,
     * že appka kontroluje častěji, než doopravdy kontroluje.
     */
    private const val INTERVAL_MIN = 15L

    /**
     * Za kolik minut se nasadí další budík.
     *
     * ⚠️ Ne 15. Nepřesný budík si Android smí posunout o 75 % zbývající doby —
     * na emulátoru `dumpsys alarm` ukázal u 15 minut `window=+11m15s`, tedy
     * kontrolu až po 26 minutách. Deset minut dá 10–17,5, což je zhruba
     * slíbených 15. Rychleji to nejde: v hlubokém spánku pouští Android
     * tyhle budíky nanejvýš jednou za 9 minut.
     */
    private const val BUDIK_MIN = 10L

    /**
     * Kontrola mladší než tohle se nezopakuje. Budík i periodická práce by
     * se jinak ptaly serveru dvakrát za pár minut — dvojnásobek volání
     * (a nákladů na serveru) bez jediné informace navíc.
     *
     * ⚠️ Počítá se od poslední ÚSPĚŠNÉ kontroly. Kdyby se počítalo od
     * pokusu, zablokovalo by to opakování po výpadku sítě (`Result.retry`).
     */
    private const val NEJMENSI_ODSTUP_MIN = 8L

    /** Dva pracovníci naráz (budík + periodická práce) nesmí zazvonit dvakrát. */
    private val ZAMEK = Any()

    /**
     * Co se hlídá. `null` = nic; pak se práce vůbec neplánuje.
     *
     * 🚨 Nadpisy jsou HOTOVÝ TEXT Z WEBU, ne `R.string`. Jazyk appky je volba
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
        /** Nadpis upozornění na bouřku z radaru — taky hotový z webu (`R37`). */
        val nadpisBourka: String,
        /** Hlídat i bouřky z radaru? Vypnout jde zvlášť od výstrah (`R37`). */
        val bourky: Boolean,
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
            .putString("nadpisBourka", co.nadpisBourka)
            .putBoolean("bourky", co.bourky)
            .apply()

        // Kanál hned, ne až při prvním zvonění: dokud neexistuje, nejde
        // v Androidu najít ani vypnout — a nastavení appky by o něm nevědělo.
        kanal(ctx)

        val prace = PeriodicWorkRequestBuilder<Kontrola>(INTERVAL_MIN, TimeUnit.MINUTES)
            // Bez sítě se stejně nedá nic zjistit; budit kvůli tomu telefon
            // by byla jen spotřebovaná baterie.
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()

        WorkManager.getInstance(ctx)
            .enqueueUniquePeriodicWork(PRACE, ExistingPeriodicWorkPolicy.UPDATE, prace)

        naplanujBudik(ctx)
    }

    /** Vypne hlídání. Zapomene se i to, o čem už se zvonilo. */
    fun nehlidej(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(PRACE)
        WorkManager.getInstance(ctx).cancelUniqueWork(PRACE_HNED)
        ctx.getSystemService(AlarmManager::class.java)?.cancel(budik(ctx))
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun hlidaSe(ctx: Context): Boolean = hlidane(ctx) != null

    private fun hlidane(ctx: Context): Hlidane? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!p.contains("lat")) return null
        return Hlidane(
            lat = p.getFloat("lat", 0f).toDouble(),
            lon = p.getFloat("lon", 0f).toDouble(),
            nadpis = p.getString("nadpis", "") ?: "",
            lang = p.getString("lang", "cs") ?: "cs",
            prah = p.getString("prah", "Moderate") ?: "Moderate",
            nadpisBourka = p.getString("nadpisBourka", "") ?: "",
            // ⚠️ Výchozí ANO: kdo zapnul upozornění ve starší verzi, chtěl
            // upozornění na bouřku — jen je appka neuměla (`R37`).
            bourky = p.getBoolean("bourky", true),
        )
    }

    /** Kdy naposledy prošla celá kontrola (výstrahy i bouřka). 0 = ještě ne. */
    fun posledniKontrola(ctx: Context): Long =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KLIC_KONTROLA, 0L)

    /** Kdy naposledy přišlo upozornění na bouřku. 0 = ještě ne. */
    fun posledniBourka(ctx: Context): Long =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KLIC_BOURKA_OHLASENA, 0L)

    /* ── budík, který projde hlubokým spánkem (R37) ───────────────────── */

    private fun budik(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, ID_BUDIKU,
        Intent(ctx, BudikVystrah::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /**
     * Další kontrola za 15 minut — i v hlubokém spánku telefonu.
     *
     * 🚨 Periodická práce (`WorkManager`) sama NESTAČÍ. V Doze ji Android
     * odkládá do údržbových oken — u telefonu ležícího na stole klidně o hodinu
     * a víc. Bouřka se ohlašuje s předstihem kolem 38 minut (`R37`); kontrola
     * o hodinu později ji ohlásí, až když leje.
     *
     * 🚨 `setAndAllowWhileIdle`, ne přesný budík: ten chce oprávnění, které
     * Google dává jen budíkům a kalendářům (stejně jako u zpráv, `R28`).
     * Pár minut sem tam je u předstihu 38 minut jedno.
     *
     * ⚠️ Vždy jen jeden budík dopředu; další nasadí příjemce. Periodická
     * práce zůstává jako pojistka, kdyby se řetěz přetrhl (vynucené zastavení
     * appky budíky zahodí a znovu je nasadí až web při dalším otevření).
     */
    fun naplanujBudik(ctx: Context) {
        if (hlidane(ctx) == null) return
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        am.setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + TimeUnit.MINUTES.toMillis(BUDIK_MIN),
            budik(ctx),
        )
    }

    /**
     * Kontrola teď, z budíku.
     *
     * ⚠️ Práci dělá worker, ne příjemce budíku: `onReceive` má na všechno
     * deset sekund a server s rozbalováním radaru tolik potřebovat může.
     * `KEEP`: čeká-li už jedna kontrola na síť, druhou nepřidávat.
     */
    fun zkontrolujHned(ctx: Context) {
        val prace = OneTimeWorkRequestBuilder<Kontrola>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(PRACE_HNED, ExistingWorkPolicy.KEEP, prace)
    }

    /* ── kontrola ─────────────────────────────────────────────────────── */

    class Kontrola(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

        override suspend fun doWork(): Result {
            val ctx = applicationContext
            val co = hlidane(ctx) ?: return Result.success()
            val ted = System.currentTimeMillis()

            if (ted - posledniKontrola(ctx) in 0 until TimeUnit.MINUTES.toMillis(NEJMENSI_ODSTUP_MIN)) {
                return Result.success()
            }

            // Síť MIMO zámek — zámek drží jen rozhodnutí a zápis.
            val vystrahy = stahni(adresaVystrah(co))
            val bourka = if (co.bourky) stahni(adresaBourky(co)) else null
            val vsechnoDoslo = vystrahy != null && (!co.bourky || bourka != null)

            synchronized(ZAMEK) {
                val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                if (vystrahy != null) zpracujVystrahy(ctx, co, vystrahy)
                if (bourka != null) zpracujBourku(ctx, co, bourka, ted)
                // 🚨 Čas kontroly se zapíše, jen když dorazilo VŠECHNO, co se
                // hlídá. Kdyby stačila půlka, ukazovalo by nastavení „poslední
                // kontrola před chvílí", zatímco bouřka by se dávno nehlídala.
                if (vsechnoDoslo) prefs.edit().putLong(KLIC_KONTROLA, ted).apply()
            }
            return if (vsechnoDoslo) Result.success() else Result.retry()
        }

        private fun zpracujVystrahy(ctx: Context, co: Hlidane, telo: String) {
            val vystrahy = try {
                JSONObject(telo).optJSONArray("warnings")
            } catch (e: Exception) {
                null
            } ?: return

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

            if (nove.isEmpty()) return

            // 🚨 První jev se POJMENUJE i tehdy, když jich je víc. „2 výstrahy"
            // bez jediného jména nutí otevřít appku jen proto, aby se člověk
            // dozvěděl, jestli má odklidit trampolínu.
            //
            // ⚠️ Zbytek je „+N", ne věta. Věta by potřebovala množné číslo, a to
            // je vlastnost JAZYKA APPKY, ne jazyka telefonu — skládat ji tady by
            // znamenalo českou appku s anglickou notifikací. „+2" rozumí každý
            // a nepotřebuje překlad.
            val prvni = nove.first().second
            val text = if (nove.size > 1) "$prvni +${nove.size - 1}" else prvni
            zazvon(ctx, ID_VYSTRAHA, co.nadpis, text)
        }

        /**
         * Bouřka z radaru (`R37`).
         *
         * 🚨 JEDNA BOUŘKA = JEDNO UPOZORNĚNÍ. Ticho se počítá od POSLEDNÍHO
         * hlášení bouřky ze serveru, ne od zazvonění: dokud ji radar hlásí,
         * mlčí se, a nová se ohlásí až po `tichoMin` klidu. Hodnotu posílá
         * server — obal o počasí nic nerozhoduje, jen porovná čas.
         */
        private fun zpracujBourku(ctx: Context, co: Hlidane, telo: String, ted: Long) {
            val o = try { JSONObject(telo) } catch (e: Exception) { return }
            if (o.optString("stav") != "bourka") return
            val text = o.optJSONObject("bourka")?.optString("text")
                ?.takeIf { it.isNotEmpty() && it != "null" } ?: return
            val ticho = TimeUnit.MINUTES.toMillis(o.optLong("tichoMin", 120L).coerceIn(0L, 24 * 60L))

            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val naposledy = prefs.getLong(KLIC_BOURKA_VIDENA, 0L)
            prefs.edit().putLong(KLIC_BOURKA_VIDENA, ted).apply()
            if (ted - naposledy <= ticho) return

            if (zazvon(ctx, ID_BOURKA, co.nadpisBourka, text)) {
                prefs.edit().putLong(KLIC_BOURKA_OHLASENA, ted).apply()
            }
        }

        /**
         * ⚠️ `minSeverity` řeší SERVER. Kdyby se filtrovalo tady, byla by
         * tabulka stupňů závažnosti na dvou místech a při první opravě by
         * se rozešly.
         */
        private fun adresaVystrah(co: Hlidane): String =
            BuildConfig.API_BASE.trimEnd('/') +
                "/api/warnings?lat=${co.lat}&lon=${co.lon}" +
                "&lang=${URLEncoder.encode(co.lang, "UTF-8")}" +
                "&minSeverity=${URLEncoder.encode(co.prah, "UTF-8")}"

        private fun adresaBourky(co: Hlidane): String =
            BuildConfig.API_BASE.trimEnd('/') +
                "/api/storm?lat=${co.lat}&lon=${co.lon}" +
                "&lang=${URLEncoder.encode(co.lang, "UTF-8")}"

        private fun stahni(adresa: String): String? = try {
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
     * ⚠️ Kanál se zakládá při KAŽDÉM zvonění (a při zapnutí hlídání), ne
     * jednou při startu. Je to levné a idempotentní — a zakládat ho jen
     * v `onCreate` by znamenalo, že po restartu telefonu (kdy appka neběžela)
     * notifikace tiše zmizí.
     *
     * Bouřka z radaru jde týmž kanálem: je to stejná třída zprávy („hrozí
     * nebezpečí") a vypnout ji jde v appce zvlášť.
     */
    fun kanal(ctx: Context) {
        val kanal = NotificationChannel(
            KANAL,
            ctx.getString(R.string.kanal_vystrahy),
            // HIGH: výstraha má právo vyrušit. Nižší důležitost by ji
            // schovala do tichého seznamu, kam se člověk podívá pozdě.
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = ctx.getString(R.string.kanal_vystrahy_popis) }

        ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(kanal)
    }

    /** @return zda se upozornění opravdu poslalo */
    private fun zazvon(ctx: Context, id: Int, nadpis: String, text: String): Boolean {
        kanal(ctx)

        // ⚠️ Bez povolení se nic neposílá. Od Androidu 13 ho uživatel dává
        // ručně a `notify()` by jinak tiše selhalo.
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return false

        val otevri = PendingIntent.getActivity(
            ctx, id,
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

        // ⚠️ Pevné id podle druhu: novější výstraha NAHRADÍ starší (deset
        // zpráv o téže bouřce pod sebou je způsob, jak si člověk kanál
        // vypne), ale bouřka z radaru výstrahu nepřepíše — jsou to dvě zprávy.
        return try {
            NotificationManagerCompat.from(ctx).notify(id, zprava)
            true
        } catch (e: SecurityException) {
            // Povolení mezitím odebrané. Není co dělat a spadnout se nesmí.
            false
        }
    }
}

/**
 * Příjemce budíku výstrah: pustí kontrolu a **hned nasadí další budík**.
 *
 * 🚨 Bez přeplánování by se budík spustil jednou a dál by kontroly hlídala
 * jen periodická práce — ta, kterou Android v hlubokém spánku odkládá.
 */
class BudikVystrah : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Vystrahy.zkontrolujHned(ctx)
        Vystrahy.naplanujBudik(ctx)
    }
}
