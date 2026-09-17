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

import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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

/** Adresa ostrého serveru. Balíček pro Play jinam mířit nesmí. */
const OSTRA_API = 'https://meteotrace.com';

/**
 * Kontroly před sestavením balíčku pro Google Play.
 *
 * 🚨 Všechno, co tady selže, by jinak prošlo TIŠE: Gradle umí sestavit
 * nepodepsaný balíček, balíček mířící na místní síť i balíček podepsaný
 * jiným klíčem — a každá z těch chyb se pozná až v Play konzoli, nebo
 * hůř, u testera v terénu („Data se nepodařilo načíst").
 */
function kontrolaVydani(api) {
  const props = join(ANDROID, 'keystore.properties');
  if (!existsSync(props)) {
    throw new Error('Chybí android/keystore.properties — bez něj by vznikl NEPODEPSANÝ balíček, '
      + 'který Play nepřijme. Viz dokumentace/KEYSTORE-meteotrace.md.');
  }
  const obsah = readFileSync(props, 'utf8');
  const soubor = /^storeFile=(.+)$/m.exec(obsah)?.[1]?.trim();
  if (!soubor || !existsSync(soubor)) {
    throw new Error(`Klíč z keystore.properties neexistuje: ${soubor || '(nevyplněno)'}`);
  }
  if (api !== OSTRA_API) {
    throw new Error(`Balíček pro Play musí mířit na ${OSTRA_API}, ne na ${api || '(výchozí místní síť)'}. `
      + 'Jinak by appka u testerů hlásila „Data se nepodařilo načíst".');
  }
  return soubor;
}

/**
 * Otisk certifikátu, kterým je balíček podepsaný.
 *
 * ⚠️ Ověřuje se PO sestavení a jinou cestou než podpis: `keytool` čte hotový
 * soubor. Kdyby Gradle vzal jiný klíč (jiný `keystore.properties`, ladicí
 * klíč), sestavení by prošlo a Play by balíček odmítl až po nahrání.
 */
function otiskBalicku(jdk, soubor) {
  const r = spawnSync(join(jdk, 'bin', 'keytool.exe'), ['-printcert', '-jarfile', soubor], { encoding: 'utf8' });
  return /SHA256:\s*([0-9A-F:]+)/i.exec(r.stdout || '')?.[1] || null;
}

/**
 * Otisk upload klíče z keystoru.
 *
 * ⚠️ Heslo jde do `keytool` přes proměnnou prostředí, ne v argumentech —
 * v argumentech by bylo vidět ve výpisu procesů i v logu sestavení.
 */
function otiskKlice(jdk, jks) {
  const heslo = /^storePassword=(.+)$/m.exec(readFileSync(join(ANDROID, 'keystore.properties'), 'utf8'))?.[1]?.trim();
  const r = spawnSync(join(jdk, 'bin', 'keytool.exe'),
    ['-list', '-v', '-keystore', jks, '-storepass:env', 'MT_HESLO'],
    { encoding: 'utf8', env: { ...process.env, MT_HESLO: heslo || '' } });
  return /SHA256:\s*([0-9A-F:]+)/i.exec(r.stdout || '')?.[1] || null;
}

async function main() {
  const jdk = najdi(JDK_KANDIDATI, 'JDK (Android Studio)');
  const sdk = najdi(SDK_KANDIDATI, 'Android SDK');
  const vydani = process.argv.includes('--release');
  /**
   * `--bundle` = balíček pro Google Play (.aab).
   *
   *     npm run android -- --bundle
   *
   * ⚠️ Adresa serveru je tady VÝCHOZÍ ostrá, ne místní síť — a jinou to ani
   * nepřijme. Balíček pro Play, který míří na vývojový počítač, nemá žádné
   * použití a snadno by se omylem nahrál.
   */
  const balicek = process.argv.includes('--bundle');

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
  const api = (process.argv.find((a) => a.startsWith('--api=')) || '').slice('--api='.length)
    || (balicek ? OSTRA_API : '');
  const klic = balicek ? kontrolaVydani(api) : null;
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
    balicek ? 'bundleRelease' : vydani ? 'assembleRelease' : 'assembleDebug',
    ...(api ? [`-Pmeteotrace.apiBase=${api}`] : []),
    '--console=plain',
  ], env);

  if (balicek) {
    const aab = join(ANDROID, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
    if (!existsSync(aab)) throw new Error(`Sestavení prošlo, ale balíček není na místě: ${aab}`);

    // 🚨 Adresa serveru se ověřuje v tom, z čeho se zkompilovala — ne
    // v tom, co jsme Gradlu předali. Předaná vlastnost se dá přebít
    // (`gradle.properties`, proměnná prostředí) a nikdo by to nepoznal.
    const bc = join(ANDROID, 'app', 'build', 'generated', 'source', 'buildConfig', 'release', 'com', 'meteotrace', 'BuildConfig.java');
    const zapeceno = existsSync(bc) ? /API_BASE\s*=\s*"([^"]*)"/.exec(readFileSync(bc, 'utf8'))?.[1] : null;
    if (zapeceno !== OSTRA_API) {
      throw new Error(`Balíček míří na ${zapeceno ?? '(nezjištěno)'}, ne na ${OSTRA_API}. NENAHRÁVAT.`);
    }

    const podpis = otiskBalicku(jdk, aab);
    const ocekavany = otiskKlice(jdk, klic);
    if (!podpis || podpis !== ocekavany) {
      throw new Error(`Balíček je podepsaný jiným klíčem (${podpis ?? 'žádným'}), než je upload klíč (${ocekavany}). NENAHRÁVAT.`);
    }

    const verze = readFileSync(join(ANDROID, 'version.properties'), 'utf8');
    const jmeno = /versionName=(.+)/.exec(verze)?.[1]?.trim();
    const kod = /versionCode=(.+)/.exec(verze)?.[1]?.trim();
    console.log(`\nHotovo → ${aab}`);
    console.log(`  verze ${jmeno}, versionCode ${kod}`);
    console.log(`  server ${zapeceno} ✓ (ověřeno v BuildConfig)`);
    console.log(`  podpis ${podpis} ✓ (upload klíč)`);
    return;
  }

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
