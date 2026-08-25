/**
 * Most do headless Chromu přes ladicí protokol (CDP).
 *
 * ⚠️ ŽÁDNÉ ZÁVISLOSTI. Node 22+ má `WebSocket` i `fetch` vestavěné, takže se
 * nic neinstaluje. Puppeteer by sem přitáhl stovky megabajtů a vlastní
 * binárku prohlížeče; my použijeme ten Chrome, co v systému stejně je (`R0`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 TŘI CHYTÁKY, KTERÉ STÁLY VEČER LADĚNÍ. Každý z nich vypadal jako chyba
 *    v aplikaci, a přitom byl v tomhle nástroji.
 *
 * 1. ADRESA SE NEPŘEDÁVÁ NA PŘÍKAZOVÉ ŘÁDCE.
 *    Kdo Chrome spustí rovnou s URL, připojí se k cíli, který ještě drží
 *    PRÁZDNOU stránku před navigací. `1+1` tam vyjde, ale `document` je
 *    prázdný a knihovny `undefined`. A pojistka „počkej na readyState"
 *    NEPOMŮŽE: prázdná stránka je `complete` okamžitě.
 *    Proto se startuje na `about:blank`, naváže spojení a teprve pak se
 *    naviguje přes `Page.navigate` a čeká na `Page.loadEventFired`.
 *
 * 2. LADICÍ PORT MUSÍ BÝT VOLNÝ, JINAK SE PŘIPOJÍŠ K CIZÍMU PROHLÍŽEČI.
 *    Zbylý Chrome z minulého běhu port drží, nový se na něj nenaváže —
 *    a nástroj se tiše připojí k tomu starému. Pak se měří úplně jiná
 *    stránka. Proto se port hledá dynamicky.
 *
 * 3. `Page.captureScreenshot` BEZ `Page.enable` vrátí prázdno bez chyby.
 *    A `--screenshot` s `--virtual-time-budget` na stránce s nekonečnou
 *    animací (radar) nevyrobí nic — v zrychleném čase se smyčka protočí
 *    donekonečna. Proto se fotí přes protokol ve skutečném čase.
 *
 * Bonus: `--dump-dom` v téhle verzi Chromu vrací nula bajtů.
 * ────────────────────────────────────────────────────────────────────────
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome',
];

export function findChrome() {
  const found = CANDIDATES.find((p) => p && existsSync(p));
  if (!found) throw new Error('Chrome nenalezen — projdi seznam v tools/browser.mjs');
  return found;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Volný port — viz chyták 2. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/* ============================================================
   RELACE
   ============================================================ */

/**
 * Otevře prohlížeč, nanaviguje na adresu a předá relaci obsluze.
 *
 * @param {string} url
 * @param {(session: {send: Function, eval: Function}) => Promise<any>} work
 * @param {object} [opts]
 */
export async function withPage(url, work, opts = {}) {
  const port = await freePort();
  const timeoutMs = opts.timeoutMs || 60000;
  // Vlastní dočasný profil — bez něj se headless připojí k běžícímu Chromu
  // uživatele a ladicí port vůbec neotevře.
  const profile = mkdtempSync(join(tmpdir(), 'mt-chrome-'));

  const args = [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${opts.width || 900},${opts.height || 1400}`,
  ];
  // WebGL (mapa) potřebuje softwarové vykreslování; s --disable-gpu se
  // MapLibre vůbec nespustí.
  if (opts.webgl !== false) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  args.push('about:blank');                       // ⚠️ viz chyták 1

  const chrome = spawn(findChrome(), args, { stdio: 'ignore' });
  let ws = null;

  try {
    const target = await waitForBlankTarget(port, timeoutMs);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    const session = await openSession(ws, timeoutMs);

    await session.send('Page.enable');
    const loaded = session.once('Page.loadEventFired', timeoutMs);
    await session.send('Page.navigate', { url });
    await loaded;                                  // teprve teď existuje stránka

    return await work(session);
  } finally {
    try { ws?.close(); } catch { /* už zavřené */ }
    zabijStrom(chrome, profile);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* uklidí se příště */ }
  }
}

/**
 * 🚨 UKONČIT CELÝ STROM PROCESŮ, NE JEN RODIČE.
 *
 * Chrome se rozpadá na desítky procesů (renderer, GPU, síť) a `kill()` na
 * Windows sundá jen toho, kterého jsme spustili — děti zůstanou viset.
 * Změřeno 25. 8. 2026: po dni ladění běželo na Michalově počítači **172
 * procesů Chromu**, z toho 156 mých. Nepadá kvůli tomu nic, jen se počítač
 * plní pamětí a další spuštění pak neotevře ladicí port včas — což vypadá
 * jako vada appky nebo vývojového serveru.
 *
 * ⚠️ `taskkill /T` bere celý strom podle PID. Nikdy nesmí sáhnout na Chrome,
 * ve kterém si Michal prohlíží web — proto jen podle PID toho našeho, ne
 * podle jména procesu.
 */
function zabijStrom(child, profile) {
  try {
    if (process.platform !== 'win32' || !child.pid) {
      child.kill();
      return;
    }
    // ⚠️ SYNCHRONNĚ. Když se kill jen odpálí a nepočká, skončí Node dřív
    // a část stromu přežije.
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });

    // 🚨 A ještě jednou podle PROFILU. Chrome si drží procesy, které v našem
    // stromu nejsou (síťová a GPU služba), takže po každém běhu zůstávaly
    // dva. Profil je pro každý běh jiný (`mt-chrome-…`), takže tenhle úklid
    // NIKDY nesáhne na prohlížeč, ve kterém si Michal prohlíží web.
    if (profile) {
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | `
        // ⚠️ Zpětná lomítka se tu NEZDVOJUJÍ. PowerShellový `-like` je nebere
        // jako únikový znak, takže zdvojená se hledají doslova — vzor se pak
        // netrefí a úklid tiše neudělá nic. (Spadl jsem do toho 25. 8. 2026.)
        + `Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | `
        + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
      ], { stdio: 'ignore' });
    }
  } catch { /* už není co zabíjet */ }
}

async function waitForBlankTarget(port, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* prohlížeč ještě nenaběhl */ }
    await wait(120);
  }
  throw new Error('Chrome neotevřel ladicí port včas.');
}

function openSession(ws, defaultTimeout) {
  return new Promise((resolve, reject) => {
    const pending = new Map();
    const waiters = new Map();
    let nextId = 1;

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method && waiters.has(msg.method)) {
        waiters.get(msg.method)();
        waiters.delete(msg.method);
      }
    });
    ws.addEventListener('error', () => reject(new Error('Spojení s prohlížečem selhalo.')));

    ws.addEventListener('open', () => resolve({
      send: (method, params) => new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      }),

      once: (event, timeoutMs = defaultTimeout) => new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`Událost ${event} nedorazila.`)), timeoutMs);
        waiters.set(event, () => { clearTimeout(timer); res(); });
      }),

      /** Vyhodnotí výraz ve stránce; smí vracet Promise. */
      async eval(expression) {
        const out = await this.send('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true,
        });
        if (out.exceptionDetails) {
          throw new Error(out.exceptionDetails.text || 'Chyba ve stránce');
        }
        return out.result?.value;
      },
    }));
  });
}

/* ============================================================
   HOTOVÉ ÚLOHY
   ============================================================ */

/** Otevře stránku a vrátí, co vyhodnotí výraz. */
export function evaluateInPage(url, expression, opts = {}) {
  return withPage(url, (s) => s.eval(expression), opts);
}

/** Uloží snímek stránky. */
export function screenshot(url, outPath, opts = {}) {
  return withPage(url, async (s) => {
    // Nech stránku dojít do stavu, který chceme vyfotit.
    if (opts.waitFor) await s.eval(opts.waitFor);
    const { data } = await s.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: opts.fullPage !== false,
    });
    if (!data) throw new Error('Prohlížeč snímek nevrátil.');
    writeFileSync(outPath, Buffer.from(data, 'base64'));
    return outPath;
  }, opts);
}
