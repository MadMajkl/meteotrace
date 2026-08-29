/**
 * Sestaví Android balíček.
 *
 *     npm run android            # nasype web a sestaví APK pro ladění
 *     npm run android -- --tiles=https://dlazdice.example/cz.pmtiles
 *
 * ⚠️ Nejdřív VŽDYCKY nasype web (`android-sync.mjs`). Sestavit balíček ze
 * staré kopie webu je nejsnazší způsob, jak strávit hodinu hledáním chyby,
 * která je dávno opravená.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TENHLE SKRIPT VŮBEC JE
 *
 * Sestavení potřebuje dvě věci, které na tomhle stroji nejsou v `PATH`:
 * **JDK** (bere se ten z Android Studia) a **Android SDK**. Kdo to neví,
 * dostane od Gradle hlášku, ze které to nevyčte. Tahle znalost patří do
 * repa, ne do hlavy.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const zde = dirname(fileURLToPath(import.meta.url));
const KOREN = join(zde, '..');
const ANDROID = join(KOREN, 'android');

/** JDK z Android Studia — samostatnou Javu tenhle stroj nemá. */
const JDK_KANDIDATI = [
  process.env.JAVA_HOME,
  'C:/Program Files/Android/Android Studio/jbr',
  'C:/Program Files/Android/Android Studio1/jbr',
].filter(Boolean);

const SDK_KANDIDATI = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
].filter(Boolean);

function najdi(kandidati, popis) {
  const nalezeny = kandidati.find((c) => existsSync(c));
  if (!nalezeny) {
    throw new Error(`Nenašel jsem ${popis}. Zkoušel jsem:\n  ${kandidati.join('\n  ')}`);
  }
  return nalezeny;
}

/**
 * ⚠️ Bez `shell: true`. Cesta k JDK má v sobě mezeru („Program Files") a shell
 * ji rozsekne na dva kusy — chyba se pak tváří jako „C:Program není příkaz",
 * což nikoho nenapadne spojit s Javou. Dávkový soubor Gradle se proto pouští
 * přes `cmd /c`, ne přes shell.
 */
function spust(prikaz, args, env) {
  return new Promise((res, rej) => {
    const p = spawn(prikaz, args, { cwd: ANDROID, stdio: 'inherit', env });
    p.on('error', rej);
    p.on('close', (kod) => (kod === 0 ? res() : rej(new Error(`sestavení skončilo s kódem ${kod}`))));
  });
}

async function main() {
  const jdk = najdi(JDK_KANDIDATI, 'JDK (Android Studio)');
  const sdk = najdi(SDK_KANDIDATI, 'Android SDK');
  const vydani = process.argv.includes('--release');

  console.log(`JDK: ${jdk}`);
  console.log(`SDK: ${sdk}`);

  // Web se nasype vždycky, ať balíček nikdy nenese starou kopii.
  const tiles = process.argv.find((a) => a.startsWith('--tiles=')) || '';
  await spust(process.execPath, [join(zde, 'android-sync.mjs'), tiles].filter(Boolean), process.env);

  /**
   * Kam má appka chodit pro data.
   *
   * 🚨 BEZ TOHOHLE PŘEPÍNAČE JE APK POUŽITELNÉ JEN DOMA. Výchozí adresa
   * míří na vývojový počítač v místní síti (`192.168.1.150:8099`), takže
   * v terénu appka nastartuje, ukáže podkladovou mapu — ta jde napřímo
   * z Cloudflare R2 — a u všeho ostatního napíše „Data se nepodařilo
   * načíst" i s tou lokální adresou. Michal 29. 8. 2026: *„vidím
   * v chybovce lokální IP."*
   *
   *     npm run android -- --api=https://meteotrace.netlify.app
   *
   * ⚠️ Adresa se zapéká do balíčku (`BuildConfig.API_BASE`), nedá se změnit
   * za běhu. Je to schválně: kdyby ji šlo přepsat v nastavení, dal by se
   * appce podstrčit cizí server — a s ním i cizí předpověď.
   */
  const api = (process.argv.find((a) => a.startsWith('--api=')) || '').slice('--api='.length);
  if (api) {
    if (!/^https?:\/\//i.test(api)) throw new Error(`--api musí být celá adresa včetně http(s): ${api}`);
    // ⚠️ Nešifrované spojení projde jen na adresy vyjmenované v
    // `network_security_config.xml`. Jinak Android dotaz zahodí a v appce
    // z toho bude „Data se nepodařilo načíst" bez dalšího vysvětlení.
    if (/^http:\/\//i.test(api)) {
      console.warn(`⚠️  ${api} je bez šifrování — musí být v network_security_config.xml, jinak to Android zahodí.`);
    }
    console.log(`API: ${api}`);
  } else {
    console.log('API: (výchozí z build.gradle.kts — POUZE MÍSTNÍ SÍŤ)');
  }

  const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk };
  await spust('cmd.exe', [
    '/c', join(ANDROID, 'gradlew.bat'),
    vydani ? 'assembleRelease' : 'assembleDebug',
    ...(api ? [`-Pmeteotrace.apiBase=${api}`] : []),
    '--console=plain',
  ], env);

  const apk = join(ANDROID, 'app', 'build', 'outputs', 'apk', vydani ? 'release' : 'debug',
    vydani ? 'app-release.apk' : 'app-debug.apk');
  console.log(`\nHotovo → ${apk}`);
  console.log('Do telefonu: přenes soubor a otevři ho, nebo připoj kabel a pusť');
  console.log(`  "${join(sdk, 'platform-tools', 'adb.exe')}" install -r "${apk}"`);
}

main().catch((e) => {
  console.error('CHYBA:', e.message);
  process.exit(1);
});
