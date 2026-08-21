/**
 * Kontrola rozvržení na úzkých displejích.
 *
 * Spustí `test/layout.html` v headless Chromu — ta stránka pustí appku
 * v rámech o skutečných šířkách displeje a změří, jestli něco přetéká.
 *
 * Spuštění:  npm run selftest:layout      (vývojový server musí běžet)
 *
 * ⚠️ Tenhle test POTŘEBUJE síť a běžící server, takže NENÍ součástí
 *    `npm run selftest`. Ta sada musí zůstat offline a okamžitá.
 *
 * PROČ VÍC ŠÍŘEK: poučení z Gulpky — pozvánka do Play byla odladěná
 * na Pixelu 7 a vypadala dobře, ale na iPhonu SE, iPhonu 12/13, Pixelu 5
 * i Galaxy S20 začínala až za spodní hranou. Jedna šířka nestačí.
 */

import { evaluateInPage } from './browser.mjs';

const PORT = process.env.PORT || 8099;
const URL = `http://127.0.0.1:${PORT}/test/layout.html`;

// Stránka si výsledek uloží do `window.__layoutResult`, jakmile doměří.
const READ = `
  new Promise((resolve) => {
    const check = () => {
      if (window.__layoutResult) resolve(window.__layoutResult);
      else setTimeout(check, 200);
    };
    check();
  })
`;

try {
  const result = await evaluateInPage(URL, READ, { timeoutMs: 60000 });

  for (const r of result.cases) {
    console.log(`  ${String(r.width).padStart(4)} px  ${r.ok ? '✓ vejde se' : `✕ ${r.detail}`}`);
  }

  const bad = result.cases.filter((r) => !r.ok).length;
  console.log(bad
    ? `\n✕ ${bad} z ${result.cases.length} šířek přetéká.`
    : `\n✓ Všech ${result.cases.length} šířek se vejde bez vodorovného rolování.`);

  process.exit(bad ? 1 : 0);
} catch (e) {
  console.error(`Kontrola neproběhla: ${e.message}`);
  console.error('Běží vývojový server? (npm run dev)');
  process.exit(2);
}
