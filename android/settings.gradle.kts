pluginManagement {
    repositories {
        google {
            // Hranaté závorky místo zpětných lomítek: v Kotlin skriptu je "\." chyba
            // a v regulárním výrazu dělá "[.]" totéž.
            content {
                includeGroupByRegex("com[.]android.*")
                includeGroupByRegex("com[.]google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MeteoTrace"
include(":app")
