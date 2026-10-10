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
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Upozornění na meteo výstrahy a na bouřku z radaru (`R17`, `R37`) —
 * pro každé hlídané místo zvlášť (`R38`).
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

    /**
     * Id upozornění hlídaných míst: každé místo má dvojici — výstraha
     * (sudé) a bouřka (liché, o jedno víc). 2 a 3 patří ranní a večerní
     * zprávě (`Zpravy`); 1 a 4 byly výstraha a bouřka jediného místa
     * do 0.28.0.
     *
     * 🚨 VLASTNÍ ID PRO KAŽDÉ MÍSTO (`R38`). Se společným id by výstraha
     * pro Plzeň nahradila v liště tu pro Horšovský Týn — a o té doma by se
     * člověk nedozvěděl.
     */
    private const val ID_MISTA_OD = 1000

    /** Id budíku (`PendingIntent`). Jiné než budíky zpráv (2, 3). */
    private const val ID_BUDIKU = 10

    /**
     * Kolik míst jde hlídat naráz. ⚠️ Totéž číslo je ve webu
     * (`MAX_HLIDANYCH`) i na serveru — hlídá `selftest-obal.mjs`.
     */
    const val MAX_MIST = 5

    /* Klíče v paměti. ⚠️ Čte je i `StavNaPozadi` — stav, který člověk
       uvidí v nastavení, se nesmí počítat jinde než tady. */
    private const val KLIC_HLIDANI = "hlidani"
    private const val KLIC_KONTROLA = "kontrolaMs"
    private const val KLIC_BOURKA_OHLASENA = "bourkaOhlasenaMs"

    /* Paměť KAŽDÉHO MÍSTA zvlášť: `oznamene@49.530,12.944`. Výstraha
       ohlášená pro domov není ohlášená pro Plzeň. */
    private const val PAMET_VYSTRAH = "oznamene@"
    private const val PAMET_BOURKY = "bourkaVidenaMs@"

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
     * Jedno hlídané místo.
     *
     * 🚨 Nadpisy jsou HOTOVÝ TEXT Z WEBU, ne `R.string`. Jazyk appky je volba
     * uživatele (`R10`), kdežto `strings.xml` se řídí jazykem SYSTÉMU —
     * kdo má appku česky a telefon anglicky, dostal by českou appku
     * a anglické upozornění. Web jazyk zná, tak ať větu dodá.
     *
     * ⚠️ Jméno kanálu v systémovém nastavení naopak `R.string` zůstává:
     * tam se člověk dívá do nastavení ANDROIDU a tam patří jazyk systému.
     */
    data class Misto(
        val lat: Double,
        val lon: Double,
        /** Jméno místa — jen pro stav v nastavení, upozornění nesou nadpisy. */
        val jmeno: String,
        val nadpis: String,
        /** Nadpis upozornění na bouřku z radaru — taky hotový z webu (`R37`). */
        val nadpisBourka: String,
    )

    /** Co se hlídá. `null` = nic; pak se práce vůbec neplánuje. */
    data class Hlidane(
        /** Hlídaná místa (`R38`), nejvýš [MAX_MIST], v pořadí z webu. */
        val mista: List<Misto>,
        val lang: String,
        val prah: String,
        /** Hlídat i bouřky z radaru? Vypnout jde zvlášť od výstrah (`R37`). */
        val bourky: Boolean,
    )

    /**
     * Zadání z webu (`MostDoWebu.hlidejMista`) i z paměti → [Hlidane].
     * Nesmysl nebo prázdný seznam → `null`.
     *
     * ⚠️ Vadné místo se VYNECHÁ, ne celé zadání: tady se odpověď s místy
     * nepáruje (to až po dotazu, podle seznamu, který z tohohle vyjde).
     */
    fun zJson(text: String?): Hlidane? {
        val o = try { JSONObject(text ?: return null) } catch (e: Exception) { return null }
        val pole = o.optJSONArray("mista") ?: return null
        val mista = mutableListOf<Misto>()
        for (i in 0 until pole.length()) {
            val m = pole.optJSONObject(i) ?: continue
            val lat = m.optDouble("lat", Double.NaN)
            val lon = m.optDouble("lon", Double.NaN)
            if (!lat.isFinite() || !lon.isFinite() || abs(lat) > 90 || abs(lon) > 180) continue
            mista += Misto(
                lat = lat,
                lon = lon,
                jmeno = m.optString("jmeno"),
                nadpis = m.optString("nadpis"),
                nadpisBourka = m.optString("nadpisBourka"),
            )
            if (mista.size >= MAX_MIST) break
        }
        if (mista.isEmpty()) return null
        return Hlidane(
            mista = mista,
            lang = o.optString("lang").ifEmpty { "cs" },
            prah = o.optString("prah").ifEmpty { "Moderate" },
            // ⚠️ Výchozí ANO: kdo zapnul upozornění ve starší verzi, chtěl
            // upozornění na bouřku — jen je appka neuměla (`R37`).
            bourky = o.optBoolean("bourky", true),
        )
    }

    private fun doJson(co: Hlidane): String = JSONObject()
        .put("lang", co.lang)
        .put("prah", co.prah)
        .put("bourky", co.bourky)
        .put("mista", JSONArray().apply {
            for (m in co.mista) put(JSONObject()
                .put("lat", m.lat).put("lon", m.lon).put("jmeno", m.jmeno)
                .put("nadpis", m.nadpis).put("nadpisBourka", m.nadpisBourka))
        })
        .toString()

    /**
     * Klíč místa v paměti — tatáž mřížka jako `placeKey` ve webu (~110 m).
     * ⚠️ `Locale.ROOT`: česká čárka místo tečky by klíč rozbila.
     */
    internal fun klicMista(m: Misto): String =
        String.format(Locale.ROOT, "%.3f,%.3f", m.lat, m.lon)

    /**
     * Id upozornění pro každé místo (výstraha; bouřka = +1).
     *
     * Odvozené z klíče místa, ne z pořadí: kdyby se bralo pořadí, přidání
     * nového místa by posunulo ostatní a upozornění jednoho místa by
     * v liště přepsalo upozornění jiného. Srážka dvou klíčů se rozstrčí.
     */
    internal fun idUpozorneni(mista: List<Misto>): List<Int> {
        val pouzite = mutableSetOf<Int>()
        return mista.map { m ->
            var id = ID_MISTA_OD + (klicMista(m).hashCode() and 0x3fff) * 2
            while (id in pouzite) id += 2
            pouzite += id
            id
        }
    }

    /* ── plánování ────────────────────────────────────────────────────── */

    /**
     * Zapne hlídání míst. Volá se z webu přes most (`MostDoWebu`).
     *
     * ⚠️ `UPDATE` schválně: seznam se mění (zvonek u místa, přejmenování,
     * jazyk) a KEEP by nechal běžet hlídání podle starého. Upozornění na
     * místo, které si člověk dávno vypnul, je horší než žádné.
     */
    fun hlidej(ctx: Context, co: Hlidane) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prevedStare(prefs)
        val e = prefs.edit().putString(KLIC_HLIDANI, doJson(co))
        // Paměť míst, která se už nehlídají, se zahodí. Nehlídané místo,
        // které se zase zapne, je nová situace — platná výstraha se ohlásí.
        val klice = co.mista.map(::klicMista).toSet()
        for (k in prefs.all.keys) {
            val misto = when {
                k.startsWith(PAMET_VYSTRAH) -> k.removePrefix(PAMET_VYSTRAH)
                k.startsWith(PAMET_BOURKY) -> k.removePrefix(PAMET_BOURKY)
                else -> continue
            }
            if (misto !in klice) e.remove(k)
        }
        e.apply()

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

    /** Jména hlídaných míst — pro stav v nastavení (`StavNaPozadi`). */
    fun hlidanaJmena(ctx: Context): List<String> = hlidane(ctx)?.mista?.map { it.jmeno } ?: emptyList()

    private fun hlidane(ctx: Context): Hlidane? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prevedStare(p)
        return zJson(p.getString(KLIC_HLIDANI, null))
    }

    /**
     * Hlídání z verze do 0.28.0 (jedno místo v samostatných klíčích) →
     * seznam míst. Volá se při každém čtení, převede se jednou.
     *
     * 🚨 Bez převodu by po aktualizaci hlídání STÁLO, dokud člověk appku
     * neotevře — obal by v paměti nenašel nic, co umí přečíst. A paměť
     * ohlášených výstrah se přenese k tomu místu, jinak by se po aktualizaci
     * znovu ohlásilo všechno, co zrovna platí.
     */
    private fun prevedStare(p: android.content.SharedPreferences) {
        if (p.contains(KLIC_HLIDANI) || !p.contains("lat")) return
        val m = Misto(
            lat = p.getFloat("lat", 0f).toDouble(),
            lon = p.getFloat("lon", 0f).toDouble(),
            jmeno = "",
            nadpis = p.getString("nadpis", "") ?: "",
            nadpisBourka = p.getString("nadpisBourka", "") ?: "",
        )
        val co = Hlidane(
            mista = listOf(m),
            lang = p.getString("lang", "cs") ?: "cs",
            prah = p.getString("prah", "Moderate") ?: "Moderate",
            bourky = p.getBoolean("bourky", true),
        )
        val klic = klicMista(m)
        val e = p.edit().putString(KLIC_HLIDANI, doJson(co))
        p.getStringSet("oznamene", null)?.let { e.putStringSet(PAMET_VYSTRAH + klic, it) }
        if (p.contains("bourkaVidenaMs")) e.putLong(PAMET_BOURKY + klic, p.getLong("bourkaVidenaMs", 0L))
        for (k in listOf("lat", "lon", "nadpis", "lang", "prah", "nadpisBourka", "bourky", "oznamene", "bourkaVidenaMs")) {
            e.remove(k)
        }
        e.commit()
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
            // 🚨 VŠECHNA MÍSTA JEDNÍM DOTAZEM na výstrahy a jedním na bouřky
            // (`R38`) — ne dotaz za každé místo. Kontrola jede každých ~10
            // minut v každém telefonu; server čte radar i výstrahy stejně
            // jednou pro všechny.
            val vystrahy = odpovediMist(stahni(adresaVystrah(co)), co.mista.size)
            val bourky = if (co.bourky) odpovediMist(stahni(adresaBourky(co)), co.mista.size) else null
            val vsechnoDoslo = vystrahy != null && (!co.bourky || bourky != null)

            synchronized(ZAMEK) {
                val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                val id = idUpozorneni(co.mista)
                co.mista.forEachIndexed { i, m ->
                    vystrahy?.optJSONObject(i)?.let { zpracujVystrahy(ctx, m, id[i], it) }
                    bourky?.optJSONObject(i)?.let { zpracujBourku(ctx, m, id[i] + 1, it, ted) }
                }
                // 🚨 Čas kontroly se zapíše, jen když dorazilo VŠECHNO, co se
                // hlídá. Kdyby stačila půlka, ukazovalo by nastavení „poslední
                // kontrola před chvílí", zatímco bouřka by se dávno nehlídala.
                if (vsechnoDoslo) prefs.edit().putLong(KLIC_KONTROLA, ted).apply()
            }
            return if (vsechnoDoslo) Result.success() else Result.retry()
        }

        /**
         * Odpověď serveru → odpovědi pro jednotlivá místa, v pořadí dotazu.
         *
         * 🚨 Jiný počet než míst = jako by nedošlo nic. Párovat napůl by
         * znamenalo přiřadit výstrahu jednoho místa jinému.
         */
        private fun odpovediMist(telo: String?, pocet: Int): JSONArray? {
            val pole = try { JSONObject(telo ?: return null).optJSONArray("mista") } catch (e: Exception) { null }
            return pole?.takeIf { it.length() == pocet }
        }

        private fun zpracujVystrahy(ctx: Context, m: Misto, id: Int, odpoved: JSONObject) {
            val vystrahy = odpoved.optJSONArray("warnings") ?: return

            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val pamet = PAMET_VYSTRAH + klicMista(m)
            val znam = prefs.getStringSet(pamet, emptySet()) ?: emptySet()

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
            prefs.edit().putStringSet(pamet, platne.map { it.first }.toSet()).apply()

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
            zazvon(ctx, id, m.nadpis, text)
        }

        /**
         * Bouřka z radaru (`R37`).
         *
         * 🚨 JEDNA BOUŘKA = JEDNO UPOZORNĚNÍ. Ticho se počítá od POSLEDNÍHO
         * hlášení bouřky ze serveru, ne od zazvonění: dokud ji radar hlásí,
         * mlčí se, a nová se ohlásí až po `tichoMin` klidu. Hodnotu posílá
         * server — obal o počasí nic nerozhoduje, jen porovná čas.
         */
        private fun zpracujBourku(ctx: Context, m: Misto, id: Int, o: JSONObject, ted: Long) {
            if (o.optString("stav") != "bourka") return
            val text = o.optJSONObject("bourka")?.optString("text")
                ?.takeIf { it.isNotEmpty() && it != "null" } ?: return
            val ticho = TimeUnit.MINUTES.toMillis(o.optLong("tichoMin", 120L).coerceIn(0L, 24 * 60L))

            // ⚠️ Ticho se počítá pro každé místo zvlášť. Bouřka, která
            // přejde přes Plzeň a za hodinu dorazí domů, jsou dvě zprávy.
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val pamet = PAMET_BOURKY + klicMista(m)
            val naposledy = prefs.getLong(pamet, 0L)
            prefs.edit().putLong(pamet, ted).apply()
            if (ted - naposledy <= ticho) return

            // ⚠️ Hlídání převedené z 0.27.0 nadpis bouřky nemá (tehdy bouřky
            // nebyly) a dostane ho až s prvním otevřením appky. Do té doby
            // nadpis výstrahy — nese aspoň jméno místa; prázdný nadpis ne.
            if (zazvon(ctx, id, m.nadpisBourka.ifBlank { m.nadpis }, text)) {
                prefs.edit().putLong(KLIC_BOURKA_OHLASENA, ted).apply()
            }
        }

        /** `49.5302,12.9441;49.7384,13.3736` — tvar čte `mistaZDotazu` na serveru. */
        private fun mista(co: Hlidane): String = URLEncoder.encode(
            co.mista.joinToString(";") { String.format(Locale.ROOT, "%.4f,%.4f", it.lat, it.lon) },
            "UTF-8",
        )

        /**
         * ⚠️ `minSeverity` řeší SERVER. Kdyby se filtrovalo tady, byla by
         * tabulka stupňů závažnosti na dvou místech a při první opravě by
         * se rozešly.
         */
        private fun adresaVystrah(co: Hlidane): String =
            BuildConfig.API_BASE.trimEnd('/') +
                "/api/warnings?mista=${mista(co)}" +
                "&lang=${URLEncoder.encode(co.lang, "UTF-8")}" +
                "&minSeverity=${URLEncoder.encode(co.prah, "UTF-8")}"

        private fun adresaBourky(co: Hlidane): String =
            BuildConfig.API_BASE.trimEnd('/') +
                "/api/storm?mista=${mista(co)}" +
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

        // ⚠️ Pevné id podle místa a druhu: novější výstraha téhož místa
        // NAHRADÍ starší (deset zpráv o téže bouřce pod sebou je způsob, jak
        // si člověk kanál vypne), ale bouřka z radaru výstrahu nepřepíše
        // a jedno místo nepřepíše druhé (`idUpozorneni`).
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
