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
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.RemoteViews
import android.widget.TextView
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
import java.util.concurrent.Executors
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
        // Kreslení (s měřením písma) běží na pozadí; `goAsync` drží proces
        // naživu, dokud nedoběhne.
        val hotovo = goAsync()
        Widget.prekresli(ctx, ids) { hotovo.finish() }
        Widget.planuj(ctx)
        // Po přidání widgetu na plochu nečekat půl hodiny na první data.
        if (Widget.zastarale(ctx, Widget.CERSTVE_MS)) Widget.obnovHned(ctx)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: Bundle) {
        // Změna velikosti: jiné rozvržení, jiné písmo a jinak velké pozadí.
        val hotovo = goAsync()
        Widget.prekresli(ctx, intArrayOf(id)) { hotovo.finish() }
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
                    // Bez `w_maxmin`: po zvětšení písma se na jeden řádek
                    // vejde buď věta o dešti, nebo max/min — a rozhoduje se
                    // podle věty (23. 9. 2026).
                    setOf(R.id.w_misto, R.id.w_cas, R.id.w_ikona, R.id.w_teplota, R.id.w_veta),
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
            velikosti(mgr, id).firstOrNull()?.let { return it }
            val o = mgr.getAppWidgetOptions(id)
            // Na výšku: šířka je ta menší, výška ta větší (tak to launchery hlásí).
            return SizeF(
                o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250).toFloat(),
                o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 150).toFloat(),
            )
        }

        /**
         * Všechny velikosti, ve kterých launcher widget ukazuje (Android 12+):
         * typicky dvě — telefon na výšku a na šířku. Prázdné, když je nehlásí.
         */
        private fun velikosti(mgr: AppWidgetManager, id: Int): List<SizeF> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyList()
            @Suppress("DEPRECATION")
            return mgr.getAppWidgetOptions(id)
                .getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
                ?.filter { it.width > 0f && it.height > 0f }?.distinct()?.take(8) ?: emptyList()
        }

        /* ── velikost písma podle skutečné velikosti widgetu ──────────── */

        /*
         * 🚨 PÍSMO SE NEVOLÍ, MĚŘÍ SE (Michal 25. 9. 2026: „chtěl bych, aby to
         * bylo co největší… úplně nejvíc optimální velikost fontu").
         *
         * Velikosti v XML jsou jen POMĚRY mezi texty. Skutečné měřítko se
         * najde tak, že se rozvržení nafoukne v paměti přesně v té velikosti,
         * jakou widgetu přidělil launcher, a půlením intervalu se hledá největší
         * měřítko, při kterém je všechno celé vidět. Proto sedí na každém
         * telefonu a v každé velikosti — pevné `sp` sedělo jen na jedné buňce
         * a všude jinde nechávalo prázdné místo.
         *
         * „Celé vidět" = žádný text nevyleze z widgetu, nic se neusekne a nic
         * se nezkrátí na tři tečky. Výjimkou jsou jen JMÉNO MÍSTA a VĚTA
         * O DEŠTI, a i ty jen tehdy, když se nevešly už v základní velikosti —
         * zvětšení písma nesmí zkrátit nic, co předtím bylo celé.
         */

        /** Texty, které smí mít tři tečky (když je měly už v základu). */
        private val SMI_ZKRATIT = setOf(R.id.w_misto, R.id.w_veta)

        /** Texty, které se smí zalomit na víc řádků. Všechno ostatní na jeden. */
        private val VICERADKOVE = setOf(R.id.w_popis, R.id.w_veta)

        /**
         * Hlavní dvojice: číslo a ikona. Po prvním kroku zůstávají, jak jsou,
         * a ve druhém se zvětšuje už jen zbytek (viz `meritko`).
         */
        private val HLAVNI = setOf(R.id.w_teplota, R.id.w_ikona)

        /** Rozsah měřítka: pod 0,6 je text nečitelný, nad 3,2 už nic nepřidá. */
        private const val MERITKO_MIN = 0.6f
        private const val MERITKO_MAX = 3.2f

        /** Jak moc smí ostatní texty ve druhém kroku přerůst hlavní dvojici. */
        private const val DOROVNANI_MAX = 1.8f

        /**
         * Rezerva na zaokrouhlení: launcher hlásí velikost v celých dp a písmo
         * se vykresluje s vyhlazením, takže úplně na hranu se nejde.
         */
        private const val REZERVA = 0.97f

        /**
         * Měřítko písma proti XML.
         * @param s všechno (první krok)
         * @param k zvětšení navíc pro jednotlivé texty (druhý krok); teplota
         *          a ikona v něm nikdy nejsou
         */
        private class Meritko(val s: Float, val k: Map<Int, Float> = emptyMap()) {
            fun pro(id: Int) = s * (k[id] ?: 1f)
        }

        private val ZAKLADNI = Meritko(1f)

        /** Buňka hodiny roste jako celek — čas, ikona a teplota pod sebou. */
        private val HODINA = setOf(R.id.w_h_cas, R.id.w_h_ikona, R.id.w_h_teplota)

        private fun skupina(id: Int): Set<Int> = if (id in HODINA) HODINA else setOf(id)

        /** Základní velikosti písma (px) z XML, pro každé rozvržení jednou. */
        private val ZAKLAD = HashMap<Int, Map<Int, Float>>()

        private fun zaklad(ctx: Context, layout: Int): Map<Int, Float> = ZAKLAD.getOrPut(layout) {
            val m = HashMap<Int, Float>()
            fun projdi(v: View) {
                if (v is TextView && v.id != View.NO_ID) m[v.id] = v.textSize
                if (v is ViewGroup) for (i in 0 until v.childCount) projdi(v.getChildAt(i))
            }
            projdi(LayoutInflater.from(ctx).inflate(layout, FrameLayout(ctx), false))
            m
        }

        /** Které texty jsou zkrácené nebo useknuté (prázdná množina = vše celé). */
        private fun zkracene(root: View, w: Int, h: Int): Set<Int> {
            val vysledek = HashSet<Int>()
            // 🚨 Písmo nesmí až na hranu widgetu (4 dp): rohy jsou zaoblené a text má stín.
            // Na úzkém 4 × 1 jinak spodek „déšť" ořízl roh (25. 9. 2026).
            val okraj = (4 * root.resources.displayMetrics.density).roundToInt()
            fun projdi(v: View, x: Int, y: Int) {
                if (v.visibility != View.VISIBLE) return
                val l = x + v.left
                val t = y + v.top
                if (v is TextView && v.text.isNotEmpty()) {
                    val lay = v.layout
                    val klic = if (v.id != View.NO_ID) v.id else -1
                    if (lay == null) { vysledek.add(klic); return }
                    val vnitrniSirka = v.width - v.totalPaddingLeft - v.totalPaddingRight
                    val tecky = (0 until lay.lineCount).any { lay.getEllipsisCount(it) > 0 }
                    // ⚠️ `getLineMax`, ne `getLineWidth`: to druhé počítá i mezeru
                    // na konci zalomeného řádku a „Slunce přes vysokou␣" by pak
                    // vypadalo, že přetéká, i když se vejde.
                    val preteka = (0 until lay.lineCount).any { lay.getLineMax(it) > vnitrniSirka + 1 }
                    // 🚨 Zlomená teplota („16" a pod tím „°") nic nepřetéká ani
                    // neusekne — jen odsune zbytek. Jednořádkové texty se proto
                    // hlídají zvlášť (zjištěno na čtverci 2 × 2, 25. 9. 2026).
                    val zlomene = lay.lineCount > 1 && v.id !in VICERADKOVE
                    // 🚨 Výška se měří podle NAKRESLENÉHO písma, ne podle řádku.
                    // Řádek počítá i s místem na dotahy („g", „j"), které „17°"
                    // nemá — a teplota by pak vycházela zbytečně malá.
                    // ⚠️ Emoji (ikona počasí) hlásí rámeček celého čtverce emoji
                    // písma, ne nakreslené sluníčko — u nich se výška neměří.
                    // Sedí v řádku s teplotou, která ji omezí stejně.
                    val emoji = v.id == R.id.w_ikona || v.id == R.id.w_h_ikona
                    val ramec = android.graphics.Rect()
                    var nizke = false
                    for (i in 0 until if (emoji) 0 else lay.lineCount) {
                        val konec = lay.getLineEnd(i) - lay.getEllipsisCount(i)
                        if (konec <= lay.getLineStart(i)) continue
                        v.paint.getTextBounds(v.text, lay.getLineStart(i), konec, ramec)
                        val zaklad = v.totalPaddingTop + lay.getLineBaseline(i)
                        val nahore = zaklad + ramec.top
                        val dole = zaklad + ramec.bottom
                        // Uvnitř vlastního prvku (ten kreslení ořízne) i celého widgetu.
                        if (nahore < -1 || dole > v.height + 1 || t + nahore < okraj || t + dole > h - okraj) nizke = true
                    }
                    val venku = l < -1 || l + v.width > w + 1
                    if (tecky || preteka || zlomene || nizke || venku) vysledek.add(klic)
                }
                if (v is ViewGroup) for (i in 0 until v.childCount) projdi(v.getChildAt(i), l, t)
            }
            projdi(root, 0, 0)
            return vysledek
        }

        /** Nafoukne variantu v daném měřítku do velikosti `w × h` px a řekne, co je zkrácené. */
        /**
         * Widget nafouknutý JEDNOU; každý další pokus jen přenastaví velikosti
         * písma na hotových pohledech. Nafukovat celý widget i se šesti buňkami
         * hodin pro každý krok půlení trvalo vteřiny (46 kroků × ~50 ms).
         */
        private class Mereni(ctx: Context, va: Varianta, st: Widget.Stav) {
            val pohled: View = naplnVariantu(ctx, va, st, null, ZAKLADNI).apply(ctx, FrameLayout(ctx))
            /** Každý text s id a jeho základní velikostí (px) — buňky hodin jsou tu šestkrát. */
            val texty = ArrayList<Pair<TextView, Float>>()
            init {
                fun projdi(v: View) {
                    if (v is TextView && v.id != View.NO_ID) texty.add(v to v.textSize)
                    if (v is ViewGroup) for (i in 0 until v.childCount) projdi(v.getChildAt(i))
                }
                projdi(pohled)
            }
        }

        private fun zmer(mr: Mereni, m: Meritko, w: Int, h: Int): Set<Int>? = try {
            for ((tv, px) in mr.texty) tv.setTextSize(TypedValue.COMPLEX_UNIT_PX, px * m.pro(tv.id))
            val pohled = mr.pohled
            pohled.measure(
                View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY),
            )
            pohled.layout(0, 0, w, h)
            zkracene(pohled, w, h)
        } catch (e: Exception) {
            null
        }

        /** Největší hodnota z `od..do`, pro kterou `vejde` platí (půlení intervalu). */
        private fun nejvic(od: Float, doHodnoty: Float, vejde: (Float) -> Boolean): Float {
            var lo = od
            var hi = doHodnoty
            if (!vejde(lo)) return lo
            if (vejde(hi)) return hi
            // 7 kroků půlení = přesnost ~2 % z rozsahu. Víc oko nepozná a každý
            // krok je jedno nafouknutí celého widgetu.
            repeat(7) {
                val m = (lo + hi) / 2f
                if (vejde(m)) lo = m else hi = m
            }
            return lo
        }

        /**
         * Největší písmo, při kterém je ve widgetu dané velikosti (dp) všechno
         * vidět. ⚠️ Volá se z vlákna kreslení (`Widget.prekresli`), NE z hlavního:
         * nafukuje desítky pohledů a trvá to stovky milisekund.
         *
         * Dva kroky:
         *   1. všechno stejně — najde se strop, na který narazí první text
         *      (typicky teplota, která se nesmí zlomit),
         *   2. teplota a ikona zůstanou a zvětšuje se zbytek, dokud je kam.
         *      Bez toho zůstávalo na čtverci pod popisem prázdné místo, protože
         *      strop určila šířka řádku s teplotou, ne výška (25. 9. 2026).
         */
        private fun meritko(ctx: Context, va: Varianta, st: Widget.Stav, v: SizeF): Meritko {
            val hustota = ctx.resources.displayMetrics.density
            val w = (v.width * hustota).roundToInt()
            val h = (v.height * hustota).roundToInt()
            if (w <= 0 || h <= 0) return ZAKLADNI
            // Stejný obsah ve stejné velikosti se neměří znovu (překreslení
            // po otevření appky, na výšku/na šířku, opakovaná obnova).
            val klic = klicMereni(va, st, w, h)
            synchronized(NAMERENO) { NAMERENO[klic] }?.let { return it }
            return zmerMeritko(ctx, va, st, v, w, h).also { synchronized(NAMERENO) { NAMERENO[klic] = it } }
        }

        /** Posledních pár naměřených měřítek (nejdéle používané vypadne). */
        private val NAMERENO = object : LinkedHashMap<String, Meritko>(16, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Meritko>?) = size > 24
        }

        /**
         * Co všechno ovlivní výsledek měření: rozvržení, velikost, texty
         * (celá data), stáří (ukáže se čas) a které hodiny jsou ještě před námi.
         */
        private fun klicMereni(va: Varianta, st: Widget.Stav, w: Int, h: Int): String {
            val ted = System.currentTimeMillis()
            val stare = ted - st.nacteno > Widget.STARE_MS
            val hodiny = st.data.optJSONArray("hodiny")
            var prvni = 0L
            if (hodiny != null) for (i in 0 until hodiny.length()) {
                val ms = hodiny.optJSONObject(i)?.optLong("ms") ?: continue
                if (ms > ted) { prvni = ms; break }
            }
            val veta = ted < st.data.optLong("vetaDo", Long.MAX_VALUE)
            return "${va.layout}|$w×$h|${st.misto}|$stare|$prvni|$veta|${st.data}"
        }

        private fun zmerMeritko(ctx: Context, va: Varianta, st: Widget.Stav, v: SizeF, w: Int, h: Int): Meritko {
            val zacatek = System.nanoTime()
            var mereni = 0
            // Co bylo zkrácené už v základní velikosti, smí zůstat zkrácené.
            val mr = try { Mereni(ctx, va, st) } catch (e: Exception) { return ZAKLADNI }
            val vZakladu = zmer(mr, ZAKLADNI, w, h) ?: return ZAKLADNI
            val povoleno = vZakladu.filter { it in SMI_ZKRATIT }.toSet()
            fun vejde(m: Meritko): Boolean { mereni++; return zmer(mr, m, w, h)?.all { it in povoleno } ?: false }

            val s = nejvic(MERITKO_MIN, MERITKO_MAX) { vejde(Meritko(it)) } * REZERVA

            // Druhý krok jako „nalévání vody": ostatní texty rostou SPOLEČNĚ;
            // který narazí, ten se zastaví, a zbytek roste dál. Jinak by
            // „↑18° ↓1°" vedle ikony (kde místo není) zastavilo i popis
            // a větu pod ní (kde místo je).
            // ⚠️ Co má tři tečky už v základu, neroste — bylo by z něj vidět ještě míň.
            val kandidati = zaklad(ctx, va.layout).keys
                .filter { it in va.ids && it !in HLAVNI && it !in povoleno }.toMutableSet()
            if (R.id.w_hodiny in va.ids) kandidati += HODINA
            val zmrazene = HashMap<Int, Float>()
            var k = 1f
            while (kandidati.isNotEmpty()) {
                fun sestav(x: Float) = Meritko(s, zmrazene + kandidati.associateWith { x })
                val nove = nejvic(k, DOROVNANI_MAX) { vejde(sestav(it)) }
                // Kdo brzdí? Každý rostoucí text (skupina) se zkusí zvětšit
                // SÁM o kousek. 🚨 Nestačí se podívat, co se rozbilo: rozbije
                // se často jiný text, než který roste — „↑18° ↓1°" zúží
                // sloupec a zlomí se teplota, která už neroste.
                val brzdi = if (nove >= DOROVNANI_MAX) emptyList()
                else kandidati.map { skupina(it) }.distinct().filter { sk ->
                    val zkus = Meritko(s, zmrazene + kandidati.associateWith { if (it in sk) nove * 1.04f else nove })
                    !vejde(zkus)
                }.flatten().filter { it in kandidati }
                if (brzdi.isEmpty()) {
                    // Až na strop, nebo brzdí už zastavený text: konec pro všechny.
                    kandidati.forEach { zmrazene[it] = nove }
                    break
                }
                brzdi.forEach { zmrazene[it] = nove; kandidati.remove(it) }
                k = nove
            }
            val narust = zmrazene.mapValues { (_, f) -> max(1f, f * 0.98f) }

            // 🚨 POŘADÍ VELIKOSTÍ Z NÁVRHU ZŮSTÁVÁ. Co bylo v XML menší, nesmí
            // přerůst to větší — jinak na čtverci vyrostla věta o dešti nad
            // popis počasí a hierarchie se obrátila (25. 9. 2026). Proto se
            // výsledné velikosti srovnají shora: nikdo není větší než text,
            // který byl v návrhu větší nebo stejný.
            val zakladPx = zaklad(ctx, va.layout).filterKeys { it in va.ids } +
                (if (R.id.w_hodiny in va.ids) zaklad(ctx, R.layout.widget_pocasi_hodina) else emptyMap())
            // Stejně velké texty (popis a „↑18° ↓1°", obojí 13 sp) se navzájem
            // neomezují — strop dávají jen texty v návrhu VĚTŠÍ.
            var strop = Float.MAX_VALUE
            val dorovnani = HashMap<Int, Float>()
            for ((_, stejne) in zakladPx.entries.groupBy { it.value }.toSortedMap(compareByDescending { it })) {
                var nejmensi = Float.MAX_VALUE
                for ((id, px) in stejne) {
                    val smi = min(px * s * (narust[id] ?: 1f), strop)
                    nejmensi = min(nejmensi, smi)
                    val f = smi / (px * s)
                    if (f > 1f) dorovnani[id] = f
                }
                strop = nejmensi
            }
            if (BuildConfig.DEBUG) {
                android.util.Log.d("MeteoTraceWidget", "meritko ${ctx.resources.getResourceEntryName(va.layout)} " +
                    "${v.width}x${v.height}dp ($mereni měření, ${(System.nanoTime() - zacatek) / 1_000_000} ms) → s=${"%.2f".format(s)} " +
                    dorovnani.entries.joinToString { "${ctx.resources.getResourceEntryName(it.key)}×${"%.2f".format(it.value)}" })
            }
            return Meritko(s, dorovnani)
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
                val obloha = stav.data.optJSONObject("pozadi")
                val presne = velikosti(mgr, id)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && presne.isNotEmpty()) {
                    // Android 12+: pro KAŽDOU velikost, ve které launcher widget
                    // ukazuje (na výšku, na šířku), vlastní rozvržení se změřeným
                    // písmem a vlastním pozadím. Launcher si pak vybere sám.
                    RemoteViews(presne.associateWith { sz ->
                        val va = vyber(sz.width, sz.height)
                        naplnVariantu(ctx, va, stav, pozadi(ctx, sz, obloha), meritko(ctx, va, stav, sz))
                    })
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // Launcher velikosti (zatím) nehlásí: varianty podle nejmenší
                    // velikosti a základní písmo. Přijde `onAppWidgetOptionsChanged`.
                    val pozadi = pozadi(ctx, velikost(mgr, id), obloha)
                    RemoteViews(VARIANTY.associate { it.od to naplnVariantu(ctx, it, stav, pozadi, ZAKLADNI) })
                } else {
                    val v = velikost(mgr, id)
                    val va = vyber(v.width, v.height)
                    naplnVariantu(ctx, va, stav, pozadi(ctx, v, obloha), meritko(ctx, va, stav, v))
                }
            }
            try {
                mgr.updateAppWidget(id, views)
            } catch (e: Exception) {
                // Příliš velká bitmapa nebo launcher, který mezitím widget zahodil.
                // Widget zůstane ve starém stavu; spadnout kvůli tomu nesmí.
            }
        }

        /**
         * @param pozadi obloha; `null` jen při měření (bitmapa by nafoukla výšku)
         * @param m      měřítko písma proti XML (viz `meritko`)
         */
        private fun naplnVariantu(ctx: Context, va: Varianta, st: Widget.Stav, pozadi: Bitmap?, m: Meritko): RemoteViews {
            val d = st.data
            val v = RemoteViews(ctx.packageName, va.layout)
            fun text(id: Int, co: String) {
                if (id !in va.ids) return
                v.setTextViewText(id, co)
                v.setViewVisibility(id, if (co.isEmpty()) View.GONE else View.VISIBLE)
            }

            if (pozadi != null) v.setImageViewBitmap(R.id.w_pozadi, pozadi)
            // ⚠️ V px, ne v sp: měřítko se našlo měřením v px, takže už v sobě
            // má i systémové zvětšení písma. V sp by se započítalo dvakrát.
            for ((id, px) in zaklad(ctx, va.layout)) {
                if (id in va.ids) v.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_PX, px * m.pro(id))
            }
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
                // 2 × 2 taky: po zvětšení písma (23. 9. 2026) se dlouhý popis
                // zalomí na dva řádky a řádek navíc už se nevejde. Čas je
                // z toho, co je na čtverci vidět, nejmíň důležitý — DOKUD
                // nezestárne. Pak se ukáže, protože to je celý jeho smysl.
                if (va.layout == R.layout.widget_pocasi_maly) {
                    v.setViewVisibility(R.id.w_cas, if (stare) View.VISIBLE else View.GONE)
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
                    for ((idH, px) in zaklad(ctx, R.layout.widget_pocasi_hodina)) {
                        bunka.setTextViewTextSize(idH, TypedValue.COMPLEX_UNIT_PX, px * m.pro(idH))
                    }
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
            val sz = SizeF(sirkaDp, vyskaDp)
            val va = VARIANTY[varianta]
            return naplnVariantu(ctx, va, st, pozadi(ctx, sz, data.optJSONObject("pozadi")), meritko(ctx, va, st, sz))
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

    /**
     * Překreslí widgety — 🚨 NA POZADÍ, na jednom vlastním vlákně.
     *
     * Kreslení si měří písmo nafukováním pohledů (`PocasiWidget.meritko`),
     * a to trvá stovky milisekund až vteřiny. Volá se i z mostu do webu,
     * když je appka otevřená — na hlavním vlákně by appka zamrzla.
     * Nafouknout pohled mimo hlavní vlákno jde (tak funguje i
     * `AsyncLayoutInflater`), jen se nesmí nikam připojit — a my ho jen měříme.
     * ⚠️ Jedno vlákno, ne víc: dvě kreslení téhož widgetu naráz by se
     * předbíhala a vyhrálo by to pomalejší, tedy klidně to se starými daty.
     *
     * @param jen   jen tyto widgety (změna velikosti), jinak všechny
     * @param hotovo zavolá se po dokreslení (`goAsync` v obsluze widgetu)
     */
    fun prekresli(ctx: Context, jen: IntArray? = null, hotovo: (() -> Unit)? = null) {
        val app = ctx.applicationContext
        KRESLENI.execute {
            try {
                val mgr = AppWidgetManager.getInstance(app)
                for (id in jen ?: ids(app)) PocasiWidget.vykresli(app, mgr, id)
            } catch (e: Exception) {
                // Widget zůstane ve starém stavu; spadnout kvůli tomu nesmí.
            } finally {
                hotovo?.invoke()
            }
        }
    }

    private val KRESLENI = Executors.newSingleThreadExecutor()

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
