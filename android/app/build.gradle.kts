import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Podpis vydání: hesla leží v android/keystore.properties (mimo git). Vzor: Gulpka.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { stream -> this.load(stream) }
}

/**
 * Kam appka posílá dotazy na data (`/api/…`).
 *
 * ⚠️ Ve WebView neběží žádná proxy — nativní vrstva je jen POTRUBÍ na náš
 * server (viz `ApiPathHandler`). Adresa se proto musí nastavit zvenčí:
 *
 *     ./gradlew assembleDebug -Pmeteotrace.apiBase=http://192.168.1.150:8099
 *
 * Bez nastavení se použije adresa vývojového serveru na téhle síti — což je
 * pro ladění to nejčastější, ale ve vydání se MUSÍ přebít ostrou doménou.
 */
val apiBase = (project.findProperty("meteotrace.apiBase") as String?) ?: "http://192.168.1.150:8099"

android {
    namespace = "com.meteotrace"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.meteotrace"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.0"    // držet synchronně s verzí webu

        buildConfigField("String", "API_BASE", "\"$apiBase\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.isNotEmpty()) {
                storeFile = file(keystoreProps["storeFile"] as String)
                storePassword = keystoreProps["storePassword"] as String
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
            }
        }
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.webkit)
}
