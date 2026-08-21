/**
 * Vygeneruje wordovou podobu dokumentace z Markdownu.
 *
 * Spuštění:  npm run docx
 *
 * Dokumentace žije MIMO repo (`../dokumentace/`), ale tenhle skript patří do repa —
 * je to postup, ne obsah, a má být verzovaný. Vzor: mailniño má `docx/` jako podadresář
 * dokumentace a docx se z MD jen generují.
 *
 * ⚠️ DOCX SE NIKDY NEEDITUJE RUČNĚ. Zdroj pravdy je Markdown; docx je výstup.
 *    Ruční úprava se při příštím generování ztratí.
 *
 * Skript navíc OVĚŘÍ, že se obrázky do dokumentu opravdu dostaly. Pandoc na chybějící
 * obrázek jen varuje a pokračuje — dokument vznikne, jen v něm diagram chybí. To se
 * pozná až ve chvíli, kdy ho někdo otevře, což bývá pozdě.
 */

import { readdir, readFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = fileURLToPath(new URL('../../dokumentace/', import.meta.url));
const OUT = join(DOCS, 'docx');

/** Počet obrázků, na které se Markdown odkazuje. */
function countImageRefs(md) {
  return (md.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
}

/**
 * Počet obrázků uvnitř docx.
 *
 * Docx je ZIP a jména souborů v něm jsou v centrálním adresáři uložená jako čitelný
 * text — takže se dají spočítat bez rozbalování a bez knihovny na ZIP.
 */
function countEmbeddedImages(buf) {
  const text = buf.toString('latin1');
  return new Set(text.match(/word\/media\/[^\s"']{1,64}?\.(png|jpe?g|svg|gif)/gi) || []).size;
}

/** Je soubor otevřený v LibreOffice/Wordu? Ten by zápis odmítl. */
async function isLocked(path) {
  const lock = join(OUT, '.~lock.' + basename(path) + '#');
  try { await stat(lock); return true; } catch { return false; }
}

await mkdir(OUT, { recursive: true });

const sources = (await readdir(DOCS))
  .filter((f) => extname(f) === '.md')
  .sort();

let failed = 0;

for (const file of sources) {
  const src = join(DOCS, file);
  const dst = join(OUT, basename(file, '.md') + '.docx');

  if (await isLocked(dst)) {
    console.log(`  ⏭  ${file} — cíl je otevřený v editoru, přeskakuji`);
    continue;
  }

  // --resource-path: relativní cesty k obrázkům (diagramy/…) se hledají vůči dokumentaci.
  const res = spawnSync('pandoc', [src, '-o', dst, '--resource-path', DOCS], {
    encoding: 'utf8',
  });

  if (res.error || res.status !== 0) {
    console.log(`  ✕  ${file} — pandoc selhal: ${res.error?.message || res.stderr.trim()}`);
    failed++;
    continue;
  }

  const wanted = countImageRefs(await readFile(src, 'utf8'));
  const got = countEmbeddedImages(await readFile(dst));
  const size = Math.round((await stat(dst)).size / 1024);

  if (wanted !== got) {
    console.log(`  ✕  ${file} — odkazuje na ${wanted} obrázků, v docx jich je ${got} (${size} kB)`);
    if (res.stderr.trim()) console.log(`     pandoc: ${res.stderr.trim().split('\n')[0]}`);
    failed++;
  } else {
    const note = wanted ? `${wanted} obrázků` : 'bez obrázků';
    console.log(`  ✓  ${file} → ${basename(dst)}  (${size} kB, ${note})`);
  }
}

console.log(failed
  ? `\n${failed} dokument(ů) neprošlo.`
  : `\nHotovo — ${sources.length} dokumentů, obrázky sedí.`);

process.exit(failed ? 1 : 0);
