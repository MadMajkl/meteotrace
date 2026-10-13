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
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Calendar
import java.util.TimeZone

/**
 * Hlídaná cesta (`R41`): „Domov → Plzeň, ve všední dny v 7:15" — hodinu
 * před odjezdem upozornění, co čeká po cestě a kdy vyrazit líp.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ROZDĚLENÍ PRÁCE — STEJNÉ JAKO U RANNÍ ZPRÁVY (`R28`)
 *
 *   · **web** spočítá trasu JEDNOU (při zapnutí) a pošle navzorkované body
 *     s časem od odjezdu, hotový nadpis a jazyk (`zapisCesty` v app.js),
 *   · **server** stáhne předpověď pro body a složí VĚTU
 *     (`server/route-watch.js` nad čistou `web/lib/route-watch.js`),
 *   · **obal** jen budí, ptá se a zvoní. Nic nepočítá (`R13`).
 *
 * ⚠️ Na router se odsud nesahá: kvóta openrouteservice je společná všem
 * uživatelům a ranní kontroly by ji snědly.
 * ────────────────────────────────────────────────────────────────────────
 */
object Cesty {

    private const val KANAL = "cesty"
    private const val PREFS = "meteotrace-cesty"

    /** O kolik před odjezdem se upozorní. Musí sedět na `PREDSTIH_MIN` ve `web/lib/route-watch.js`. */
    const val PREDSTIH_MIN = 60

    /** Nejvýš tolik hlídaných cest — každá má vlastní budík. */
    const val MAX_CEST = 10

    /**
     * Id upozornění a budíků: 200 + pořadí. (1 a 4 staré výstrahy, 2–3
     * zprávy, od 1000 hlídaná místa — viz `Vystrahy`.)
     *
     * 🚨 POD 1000, ne 3000: místa mají id 1000 + 3 × (0…16 383) — upozornění
     * cesty se stejným číslem by v liště přepsalo výstrahu nějakého místa.
     */
    private const val ID_ZAKLAD = 200

    data class Cesta(
        /** Klíč uložené trasy — podle něj se drží stav, ne podle pořadí. */
        val klic: String,
        /** Hotový nadpis z webu, v jazyce appky (`R17`). */
        val nadpis: String,
        /** Odjezd v minutách od půlnoci. */
        val casMin: Int,
        /** Dny podle ISO: 1 = pondělí … 7 = neděle. */
        val dny: Set<Int>,
        /** `true` = při klidu mlčet. */
        val jen: Boolean,
        /** Body cesty pro server, tak jak je poslal web. */
        val body: String,
    )

    data class Zadani(val lang: String, val units: String, val cesty: List<Cesta>)

    /**
     * Zadání z webu. Nečitelné → `null` (a most hlídání vypne).
     *
     * ⚠️ Jedna vadná cesta vypadne, ostatní zůstanou — na rozdíl od bodů
     * jedné cesty (tam by vynechaný bod posunul časy) jsou cesty nezávislé.
     */
    fun zJson(text: String?): Zadani? = try {
        val o = JSONObject(text ?: "")
        val pole = o.optJSONArray("cesty") ?: JSONArray()
        val cesty = mutableListOf<Cesta>()
        for (i in 0 until minOf(pole.length(), MAX_CEST)) {
            val c = pole.optJSONObject(i) ?: continue
            val cas = c.optInt("cas", -1)
            val dnyPole = c.optJSONArray("dny") ?: JSONArray()
            val dny = (0 until dnyPole.length()).map { dnyPole.optInt(it, 0) }.filter { it in 1..7 }.toSet()
            val klic = c.optString("klic")
            val body = c.optString("body")
            if (klic.isEmpty() || body.isEmpty() || cas !in 0 until 24 * 60 || dny.isEmpty()) continue
            cesty.add(Cesta(klic, c.optString("nadpis"), cas, dny, c.optBoolean("jen", false), body))
        }
        Zadani(o.optString("lang", "cs"), o.optString("units", "metric"), cesty)
    } catch (e: Exception) {
        null
    }

    private fun ulozene(ctx: Context): Zadani? =
        zJson(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("zadani", null))

    /* ── plánování ────────────────────────────────────────────────────── */

    fun hlidej(ctx: Context, co: Zadani) {
        zrusBudiky(ctx)
        val zapis = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("zadani", JSONObject()
                .put("lang", co.lang)
                .put("units", co.units)
                .put("cesty", JSONArray(co.cesty.map { c ->
                    JSONObject().put("klic", c.klic).put("nadpis", c.nadpis).put("cas", c.casMin)
                        .put("dny", JSONArray(c.dny.sorted())).put("jen", c.jen).put("body", c.body)
                }))
                .toString())
            .putInt("pocet", co.cesty.size)
        zapis.apply()
        // Kanál hned, ne až při prvním upozornění: dokud neexistuje, nejde
        // v Androidu najít ani vypnout a stav v nastavení appky by o něm lhal.
        kanal(ctx)
        naplanuj(ctx)
    }

    fun nehlidej(ctx: Context) {
        zrusBudiky(ctx)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun zrusBudiky(ctx: Context) {
        val budik = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pocet = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("pocet", 0)
        for (i in 0 until maxOf(pocet, MAX_CEST)) budik.cancel(zamer(ctx, i))
    }

    /**
     * Naplánuje u každé cesty nejbližší upozornění: hodinu před nejbližším
     * odjezdem v povolený den.
     *
     * 🚨 `setAndAllowWhileIdle`, ne přesný budík — ten chce od Androidu 12
     * zvlášť oprávnění, které Google dává jen budíkům a kalendářům (`R25`).
     * Android ho může o pár minut posunout; hodina předstihu to unese.
     *
     * ⚠️ Plánuje se vždycky jen NEJBLIŽŠÍ výskyt a další se nasadí, až ten
     * odejde (`BudikCesty`). Opakující se budík Android ve spánku sráží.
     */
    fun naplanuj(ctx: Context) {
        val co = ulozene(ctx) ?: return
        val budik = ctx.getSystemService(AlarmManager::class.java) ?: return
        val ted = System.currentTimeMillis()
        val zapis = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        co.cesty.forEachIndexed { i, c ->
            val odjezd = dalsiOdjezd(c.casMin, c.dny, ted)
            if (odjezd == null) {
                zapis.remove("dalsi_${c.klic}").remove("odjezd_${c.klic}")
                return@forEachIndexed
            }
            val kdy = odjezd - PREDSTIH_MIN * 60_000L
            budik.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, kdy, zamer(ctx, i))
            // Pro stav v nastavení (`R37`) a pro dotaz: KTERÝ odjezd se hlídá.
            zapis.putLong("dalsi_${c.klic}", kdy).putLong("odjezd_${c.klic}", odjezd)
        }
        zapis.apply()
    }

    /**
     * Nejbližší odjezd v povolený den, jehož upozornění je ještě před námi.
     *
     * ⚠️ Rozhoduje čas UPOZORNĚNÍ, ne odjezdu: kdo zapne hlídání v 6:30 na
     * odjezd v 7:00, dnešní upozornění v 6:00 už propásl — a budík v minulosti
     * by zazvonil hned a o odjezdu, na který se člověk zrovna chystá, by
     * řekl to, co už ví. Přijde až příští povolený den.
     */
    fun dalsiOdjezd(casMin: Int, dny: Set<Int>, ted: Long): Long? {
        for (k in 0..7) {
            val c = Calendar.getInstance()
            c.timeInMillis = ted
            c.add(Calendar.DAY_OF_YEAR, k)
            c.set(Calendar.HOUR_OF_DAY, casMin / 60)
            c.set(Calendar.MINUTE, casMin % 60)
            c.set(Calendar.SECOND, 0)
            c.set(Calendar.MILLISECOND, 0)
            // Calendar: neděle = 1 … sobota = 7. ISO: pondělí = 1 … neděle = 7.
            val den = c.get(Calendar.DAY_OF_WEEK)
            val iso = if (den == Calendar.SUNDAY) 7 else den - 1
            if (iso in dny && c.timeInMillis - PREDSTIH_MIN * 60_000L > ted) return c.timeInMillis
        }
        return null
    }

    private fun zamer(ctx: Context, poradi: Int): PendingIntent = PendingIntent.getBroadcast(
        ctx,
        ID_ZAKLAD + poradi,
        Intent(ctx, BudikCesty::class.java).setAction("cesta:$poradi"),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /* ── vyzvednutí a zazvonění ───────────────────────────────────────── */

    /**
     * Budík zazvonil u cesty v tomhle pořadí. Práci dělá `WorkManager`:
     * `onReceive` má na všechno deset sekund a síť tolik trvat může.
     */
    fun vyzvedni(ctx: Context, poradi: Int) {
        val c = ulozene(ctx)?.cesty?.getOrNull(poradi) ?: return
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val odjezd = p.getLong("odjezd_${c.klic}", 0L)
        if (odjezd <= 0L) return
        p.edit().putLong("budik_${c.klic}", System.currentTimeMillis()).apply()
        val prace = OneTimeWorkRequestBuilder<Poslat>()
            .setInputData(Data.Builder().putString("klic", c.klic).putLong("odjezd", odjezd).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("meteotrace-cesta-$poradi", ExistingWorkPolicy.REPLACE, prace)
    }

    class Poslat(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
        override suspend fun doWork(): Result {
            val ctx = applicationContext
            val klic = inputData.getString("klic") ?: return Result.success()
            val odjezd = inputData.getLong("odjezd", 0L)
            val co = ulozene(ctx) ?: return Result.success()
            val poradi = co.cesty.indexOfFirst { it.klic == klic }
            if (poradi < 0) return Result.success()      // mezitím se přestala hlídat
            val c = co.cesty[poradi]

            // 🚨 Odjezd už minul (síť přišla pozdě, telefon spal) — upozornění
            // o cestě, která už běží, je k ničemu a mátlo by.
            if (odjezd < System.currentTimeMillis()) {
                zapisVysledek(ctx, klic, "pozde")
                return Result.success()
            }

            val enc = { s: String -> URLEncoder.encode(s, "UTF-8") }
            val adresa = BuildConfig.API_BASE.trimEnd('/') +
                "/api/cesta?body=${enc(c.body)}&odjezd=$odjezd" +
                "&lang=${enc(co.lang)}&units=${enc(co.units)}&jen=${if (c.jen) "1" else "0"}" +
                // Pásmo TELEFONU v čase odjezdu: časy ve větě se píšou v něm,
                // protože v něm si člověk odjezd zadal.
                "&posun=${TimeZone.getDefault().getOffset(odjezd) / 60_000}"

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
            } ?: run {
                zapisVysledek(ctx, klic, "sit")
                return Result.retry()      // výpadek sítě není chyba appky
            }

            // `text: null` = „nemám co říct" — při „jen když něco hrozí" je
            // klid, jinak chybí předpověď. NEZVONÍ se.
            val text = try {
                JSONObject(telo).optString("text").takeIf { it.isNotEmpty() && it != "null" }
            } catch (e: Exception) {
                null
            } ?: run {
                zapisVysledek(ctx, klic, "prazdne")
                return Result.success()
            }

            val poslano = zazvon(ctx, ID_ZAKLAD + poradi, c.nadpis, text)
            zapisVysledek(ctx, klic, if (poslano) "ok" else "zakazano")
            return Result.success()
        }
    }

    /**
     * ⚠️ `IMPORTANCE_DEFAULT`: upozornění k cestě není výstraha a nemá právo
     * vyrušit přes celou obrazovku. Vlastní kanál, ať jde vypnout zvlášť.
     */
    fun kanal(ctx: Context) {
        val kanal = NotificationChannel(
            KANAL,
            ctx.getString(R.string.kanal_cesty),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = ctx.getString(R.string.kanal_cesty_popis) }
        ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(kanal)
    }

    /** @return zda se upozornění opravdu poslalo */
    private fun zazvon(ctx: Context, id: Int, nadpis: String, text: String): Boolean {
        kanal(ctx)
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return false

        val otevri = PendingIntent.getActivity(
            ctx, id,
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val zprava = NotificationCompat.Builder(ctx, KANAL)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle(nadpis)
            .setContentText(text)
            // Věta s radou se do jednoho řádku nevejde — rozbalená se přečte celá.
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(otevri)
            .build()

        return try {
            NotificationManagerCompat.from(ctx).notify(id, zprava)
            true
        } catch (e: SecurityException) {
            false
        }
    }

    /* ── stav pro nastavení appky (R37) ───────────────────────────────── */

    /** Jak dopadl pokus: `ok` · `zakazano` · `prazdne` · `sit` · `pozde`. */
    private fun zapisVysledek(ctx: Context, klic: String, vysledek: String) {
        val zapis = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("vysledek_$klic", vysledek)
        if (vysledek == "ok") zapis.putLong("zprava_$klic", System.currentTimeMillis())
        zapis.apply()
    }

    /**
     * Co telefon OPRAVDU hlídá — pro nastavení appky. Časy v ms, 0 = ještě ne.
     * ⚠️ Obal jen vypisuje; co z toho říct, skládá web (`vypisStavNaPozadi`).
     */
    fun stav(ctx: Context): JSONArray {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val out = JSONArray()
        for (c in ulozene(ctx)?.cesty ?: emptyList()) {
            out.put(JSONObject()
                .put("nadpis", c.nadpis)
                .put("dalsi", p.getLong("dalsi_${c.klic}", 0L))
                .put("budik", p.getLong("budik_${c.klic}", 0L))
                .put("zprava", p.getLong("zprava_${c.klic}", 0L))
                .put("vysledek", p.getString("vysledek_${c.klic}", "") ?: ""))
        }
        return out
    }
}

/**
 * Příjemce budíku hlídané cesty: pustí dotaz a **hned naplánuje další**.
 *
 * 🚨 Bez přeplánování by upozornění přišlo jednou a pak už nikdy — a nikdo
 * by si toho nevšiml, protože chybějící upozornění nevypadá jako chyba.
 */
class BudikCesty : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val poradi = intent.action?.removePrefix("cesta:")?.toIntOrNull() ?: return
        Cesty.vyzvedni(ctx, poradi)
        Cesty.naplanuj(ctx)
    }
}
