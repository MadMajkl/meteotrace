/**
 * Most do headless Chromu přes ladicí protokol (CDP).
 *
 * ⚠️ ŽÁDNÉ ZÁVISLOSTI. Node 22+ má `WebSocket` vestavěný, takže se nic
 * neinstaluje — a `fetch` taky. Puppeteer by sem přitáhl stovky megabajtů
 * a vlastní binárku prohlížeče; my použijeme ten Chrome, co v systému
 * stejně je (`R0`).
 *
 * ⚠️ CHYTÁK, KTERÝ STÁL ČAS: `--dump-dom` v téhle verzi Chromu vrací
 *    NULA BAJTŮ. Vypadá to, že se nic nenačetlo, ale načetlo — jen ten
 *    přepínač nefunguje. Proto se čte přes CDP, ne z výstupu příkazu.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/**
 * Otevře stránku, počká na výsledek a vrátí, co vyhodnotí `readResult`.
 *
 * @param {string} url
 * @param {string} readResult   JS vyhodnocený ve stránce; smí vracet Promise
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.port]
 * @returns {Promise<any>}
 */
export async function evaluateInPage(url, readResult, opts = {}) {
  const port = opts.port || 9333;
  const timeoutMs = opts.timeoutMs || 45000;
  // Vlastní dočasný profil — jinak by se headless připojil k běžícímu Chromu
  // uživatele a ladicí port by vůbec neotevřel.
  const profile = mkdtempSync(join(tmpdir(), 'mt-chrome-'));

  const chrome = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    url,
  ], { stdio: 'ignore' });

  try {
    const target = await waitForTarget(port, url, timeoutMs);
    return await runOnTarget(target.webSocketDebuggerUrl, readResult, timeoutMs);
  } finally {
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* uklidí se příště */ }
  }
}

async function waitForTarget(port, url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith(url.split('?')[0]));
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* prohlížeč ještě nenaběhl */ }
    await wait(150);
  }
  throw new Error('Chrome neotevřel ladicí port včas.');
}

function runOnTarget(wsUrl, expression, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('Vypršel čas na výsledek.')); }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text || 'Chyba ve stránce'));
      } else {
        resolve(msg.result?.result?.value);
      }
    });

    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Spojení s prohlížečem selhalo.')); });
  });
}
