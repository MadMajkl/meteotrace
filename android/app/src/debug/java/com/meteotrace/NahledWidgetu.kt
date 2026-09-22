package com.meteotrace

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * LADICÍ náhled widgetu (`R29`) — jen v ladicím sestavení, do Play nejde.
 *
 *     adb shell am start -n com.meteotrace/.NahledWidgetu --es vzorky 0,1 --ez stare false
 *
 * Vykreslí vzorky z `widget-vzorky.json` (vyrábí `tools/widget-vzorky.mjs`
 * skutečnou funkcí serveru) ve všech čtyřech velikostech, přes TYTÉŽ
 * `RemoteViews` jako widget na ploše (`PocasiWidget.nahled`).
 *
 * ⚠️ Pozadí obrazovky je tmavé „tapeta", ne bílé: widget na ploše visí
 * na tapetě a na bílém by vypadal jinak, než jak ho uvidí uživatel.
 */
class NahledWidgetu : Activity() {

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

    /**
     * `--ez export true --es vzorky 0`: vykreslí velký widget do PRŮHLEDNÉHO
     * PNG — náhled pro výběr widgetů na Androidu < 12 (`previewImage`).
     * Skutečné vykreslení, ne ruční obrázek: náhled nesmí slibovat jiný vzhled.
     *
     *     adb pull /sdcard/Android/data/com.meteotrace/files/widget_nahled.png
     */
    private fun exportuj(data: JSONObject, vzorek: JSONObject) {
        val w = dp(360f); val h = dp(190f)
        val rv = PocasiWidget.nahled(this, 0, data, vzorek.optString("misto"), System.currentTimeMillis() - 5 * 60 * 1000L, 360f, 190f)
        val box = FrameLayout(this)
        val pohled = rv.apply(this, box)
        pohled.measure(android.view.View.MeasureSpec.makeMeasureSpec(w, android.view.View.MeasureSpec.EXACTLY),
            android.view.View.MeasureSpec.makeMeasureSpec(h, android.view.View.MeasureSpec.EXACTLY))
        pohled.layout(0, 0, w, h)
        val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
        pohled.draw(android.graphics.Canvas(bmp))
        java.io.File(getExternalFilesDir(null), "widget_nahled.png").outputStream().use {
            bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val vzorky = JSONArray(assets.open("widget-vzorky.json").bufferedReader().readText())
        val vybrane = intent.getStringExtra("vzorky")?.split(',')?.mapNotNull { it.trim().toIntOrNull() }
            ?: (0 until vzorky.length()).toList()
        val stare = intent.getBooleanExtra("stare", false)
        val ted = System.currentTimeMillis()
        // Stará data: načtená před čtyřmi hodinami (práh je tři).
        val nacteno = if (stare) ted - 4 * 60 * 60 * 1000L else ted - 5 * 60 * 1000L

        val sloupec = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14f), dp(36f), dp(14f), dp(24f))
        }

        for (i in vybrane) {
            val v = vzorky.optJSONObject(i) ?: continue
            val data = JSONObject(v.getJSONObject("data").toString())
            // Vzorky se stavěly k pevnému dni; hodiny se posunou tak, aby
            // první byla za hodinu — jinak by je obal zahodil jako uplynulé.
            val hodiny = data.optJSONArray("hodiny")
            if (hodiny != null && hodiny.length() > 0) {
                val posun = ted + 60 * 60 * 1000L - hodiny.getJSONObject(0).getLong("ms")
                for (k in 0 until hodiny.length()) {
                    val h = hodiny.getJSONObject(k)
                    h.put("ms", h.getLong("ms") + posun)
                }
                // ⚠️ I platnost věty — jinak by ji obal u vzorků ze září schoval.
                if (data.has("vetaDo")) data.put("vetaDo", data.getLong("vetaDo") + posun)
            }
            if (intent.getBooleanExtra("export", false)) {
                exportuj(data, v)
                finish()
                return
            }
            sloupec.addView(TextView(this).apply {
                text = v.optString("nazev") + if (stare) "  (stará data)" else ""
                setTextColor(Color.parseColor("#B0FFFFFF"))
                textSize = 12f
                setPadding(0, dp(10f), 0, dp(4f))
            })
            // Velký a úzký přes celou šířku, malý a drobný vedle sebe.
            sloupec.addView(widget(0, data, v, nacteno, 360f, 190f))
            sloupec.addView(widget(2, data, v, nacteno, 360f, 76f))
            val radek = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            radek.addView(widget(1, data, v, nacteno, 175f, 175f))
            radek.addView(widget(3, data, v, nacteno, 160f, 70f))
            sloupec.addView(radek)
        }

        setContentView(ScrollView(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#2B3A4A"), Color.parseColor("#141821"), Color.parseColor("#3A2B3F")),
            )
            addView(sloupec)
        })
    }

    private fun widget(varianta: Int, data: JSONObject, vzorek: JSONObject, nacteno: Long, w: Float, h: Float): FrameLayout {
        val box = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(w), dp(h)).apply { setMargins(0, dp(6f), dp(8f), dp(6f)) }
        }
        val rv = PocasiWidget.nahled(this, varianta, data, vzorek.optString("misto"), nacteno, w, h)
        val pohled = rv.apply(this, box)
        box.addView(pohled, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return box
    }
}
