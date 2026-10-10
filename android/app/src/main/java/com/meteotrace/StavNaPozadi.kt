package com.meteotrace

import android.app.ActivityManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Co se s upozorněními a zprávami děje na pozadí — pro nastavení appky (`R37`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ
 *
 * Ranní a večerní zprávy Michalovi dvakrát (23. 9. a 9. 10. 2026) nechodily
 * a nedalo se zjistit proč: řetěz na emulátoru fungoval, server odpovídal,
 * a co dělal telefon, nebylo vidět. **Tichá porucha se od tiché funkce nedá
 * odlišit.** Tohle je odpověď na otázku „funguje to?" přímo v telefonu.
 * ────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ Obal jen VYPISUJE fakta (časy, přepínače Androidu). Co z nich říct
 * a jak, skládá web v jazyce appky (`vypisStavNaPozadi`).
 */
object StavNaPozadi {

    fun json(ctx: Context): String {
        val o = JSONObject()
        o.put("upozorneni", NotificationManagerCompat.from(ctx).areNotificationsEnabled())

        // Kanály. Neexistující kanál (ještě nikdy nevznikl) se počítá jako
        // zapnutý — vypnout ho člověk nemohl.
        val kanaly = JSONArray()
        val nm = ctx.getSystemService(NotificationManager::class.java)
        for ((id, jmeno) in listOf("vystrahy" to R.string.kanal_vystrahy, "zpravy" to R.string.kanal_zpravy)) {
            val zapnuto = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm?.getNotificationChannel(id)?.importance != NotificationManager.IMPORTANCE_NONE
            } else {
                true
            }
            kanaly.put(JSONObject().put("id", id).put("jmeno", ctx.getString(jmeno)).put("zapnuto", zapnuto))
        }
        o.put("kanaly", kanaly)

        o.put("hlida", Vystrahy.hlidaSe(ctx))
        // Co telefon OPRAVDU hlídá (`R38`) — ne co si myslí web. Rozejít se
        // to může (starší zadání po aktualizaci, nepřijatý zápis) a bez
        // tohohle by se to nedalo poznat.
        o.put("mista", JSONArray(Vystrahy.hlidanaJmena(ctx)))
        o.put("kontrolaMs", Vystrahy.posledniKontrola(ctx))
        o.put("bourkaMs", Vystrahy.posledniBourka(ctx))
        o.put("zpravy", Zpravy.stav(ctx))

        // Šetření baterie. `setreni` = Android smí appku na pozadí brzdit
        // (výchozí stav většiny appek). `omezeno` = uživatel nebo systém jí
        // běh na pozadí zakázal úplně — pak nepřijde nic.
        val pm = ctx.getSystemService(PowerManager::class.java)
        o.put("setreni", pm?.isIgnoringBatteryOptimizations(ctx.packageName) == false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val am = ctx.getSystemService(ActivityManager::class.java)
            o.put("omezeno", am?.isBackgroundRestricted == true)
            // Skupina podle používání: 10 aktivní … 40 vzácná, 45 omezená.
            val usm = ctx.getSystemService(UsageStatsManager::class.java)
            o.put("skupina", usm?.appStandbyBucket ?: 0)
        }
        return o.toString()
    }
}
