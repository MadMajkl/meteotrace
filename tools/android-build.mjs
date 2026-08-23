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

  const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk };
  await spust('cmd.exe', ['/c', join(ANDROID, 'gradlew.bat'), vydani ? 'assembleRelease' : 'assembleDebug', '--console=plain'], env);

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
