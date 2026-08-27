/**
 * Umí tenhle hosting sloužit podkladovou mapu?
 *
 *     npm run tiles:check https://muj-server.cz/cz.pmtiles
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TENHLE NÁSTROJ EXISTUJE
 *
 * 🚨 Michal 27. 8. 2026: *„a kdybych měl vlastní obyč hosting na svém serveru,
 * abych nemusel platit cloudflare?"* Odpověď „ano, když umí to a to" je k ničemu,
 * dokud si to nemá jak ověřit. Tohle to změří.
 *
 * Archiv `.pmtiles` není obrázek, který se stáhne celý — prohlížeč si z něj bere
 * kousky. Hosting proto musí umět **částečné stahování** (`Range`). To zvládne
 * skoro každý statický server; nezvládne to leda hosting, který soubory posílá
 * přes vlastní skript.
 *
 * ⚠️ CDN NENÍ POTŘEBA. Bez ní jen roste odezva podle toho, jak daleko server je.
 * Pro české uživatele a český server je to úplně jedno.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

const adresa = process.argv[2];
if (!adresa) {
  console.error('Použití: npm run tiles:check <adresa .pmtiles>');
  process.exit(1);
}

/** Odkud se appka na mapu ptá. Rozhoduje o tom, jestli je CORS vůbec ve hře. */
const PUVOD = process.argv[3] || 'https://meteotrace.com';

let chyb = 0;
let varovani = 0;

const ok = (co, detail = '') => console.log(`  ✓ ${co}${detail ? `  ${detail}` : ''}`);
const spatne = (co, rada) => { chyb += 1; console.log(`  ✗ ${co}\n      → ${rada}`); };
const pozor = (co, rada) => { varovani += 1; console.log(`  ⚠️ ${co}\n      → ${rada}`); };

console.log(`\nKontroluju ${adresa}\n`);

/* ── 1. Je tam vůbec soubor? ─────────────────────────────────────────── */
let delka = 0;
try {
  const r = await fetch(adresa, { method: 'HEAD' });
  if (!r.ok) {
    spatne(`Soubor neodpovídá (HTTP ${r.status})`, 'Zkontroluj adresu a veřejné čtení.');
  } else {
    delka = Number(r.headers.get('content-length') || 0);
    ok('soubor je dostupný', delka ? `${(delka / 1024 / 1024 / 1024).toFixed(2)} GB` : '');
    if (!delka) {
      pozor('server neposlal délku souboru',
        'Bez `content-length` si knihovna neumí říct o správné kousky.');
    }
  }
} catch (e) {
  spatne(`Nešlo se připojit: ${e.message}`, 'Adresa, HTTPS, firewall?');
}

/* ── 2. Částečné stahování — bez něj nic nepojede ────────────────────── */
try {
  const r = await fetch(adresa, { headers: { Range: 'bytes=0-126' } });
  const buf = new Uint8Array(await r.arrayBuffer());
  if (r.status !== 206) {
    spatne(`Částečné stahování nefunguje (vrátil ${r.status} místo 206)`,
      'TOHLE JE ZÁSADNÍ: server posílá celý soubor místo kousku. U statického\n'
      + '        souboru to umí nginx, Apache i IIS; nezvládá to hosting, který\n'
      + '        soubory servíruje přes vlastní skript.');
  } else if (buf.length !== 127) {
    spatne(`Kousek má ${buf.length} bajtů místo 127`, 'Server rozsahy počítá špatně.');
  } else {
    ok('částečné stahování (Range) funguje', '206, 127 B');
  }
} catch (e) {
  spatne(`Kousek se nepodařilo stáhnout: ${e.message}`, 'Viz výše.');
}

/* ── 3. Rozsah od KONCE — klasický kámen úrazu ───────────────────────── */
try {
  const r = await fetch(adresa, { headers: { Range: 'bytes=-500' } });
  const buf = new Uint8Array(await r.arrayBuffer());
  if (r.status === 206 && buf.length === 500) {
    ok('rozsah od konce souboru funguje', '206, 500 B');
  } else {
    pozor(`Rozsah „posledních 500 bajtů" vrátil ${r.status} a ${buf.length} B`,
      '`bytes=-500` znamená POSLEDNÍCH 500 bajtů. Některé servery to čtou jako\n'
      + '        „od bajtu 500 dál" a pošlou celý zbytek souboru — u dvougigového\n'
      + '        archivu je to pár gigabajtů místo půl kilobajtu.');
  }
} catch (e) {
  pozor(`Rozsah od konce selhal: ${e.message}`, 'Viz výše.');
}

/* ── 4. CORS — jen když mapa leží jinde než appka ────────────────────── */
try {
  const domenaMapy = new URL(adresa).origin;
  const domenaAppky = new URL(PUVOD).origin;

  if (domenaMapy === domenaAppky) {
    ok('mapa leží na téže doméně jako appka', 'CORS se vůbec neuplatní');
  } else {
    const r = await fetch(adresa, { headers: { Range: 'bytes=0-16', Origin: domenaAppky } });
    const povoleno = r.headers.get('access-control-allow-origin');
    if (!povoleno) {
      spatne(`Chybí hlavička CORS pro ${domenaAppky}`,
        'Mapa je na jiné doméně než appka, takže prohlížeč bez povolení nevezme nic.\n'
        + '        Server musí posílat: Access-Control-Allow-Origin: <doména appky>\n'
        + '        (Preflight potřeba není — prostý rozsah bajtů si o něj neříká.)');
    } else if (povoleno === '*' || povoleno === domenaAppky) {
      ok('CORS povoluje přístup', povoleno);
    } else {
      spatne(`CORS povoluje ${povoleno}, ale appka běží na ${domenaAppky}`,
        'Doplň doménu appky mezi povolené.');
    }
  }
} catch (e) {
  pozor(`CORS se nepodařilo ověřit: ${e.message}`, '');
}

/* ── 5. Je to opravdu PMTiles, a co je uvnitř? ───────────────────────── */
try {
  const r = await fetch(adresa, { headers: { Range: 'bytes=0-126' } });
  const ab = await r.arrayBuffer();
  const znacka = new TextDecoder().decode(new Uint8Array(ab, 0, 7));
  if (znacka !== 'PMTiles') {
    spatne(`Na začátku souboru není „PMTiles" (je tam „${znacka}")`,
      'Buď to není ten soubor, nebo se cestou poškodil.');
  } else {
    const dv = new DataView(ab);
    const stupne = (o) => (dv.getInt32(o, true) / 10_000_000).toFixed(1);
    ok('je to archiv PMTiles', `verze ${dv.getUint8(7)}`);
    ok('detail do úrovně', String(dv.getUint8(101)));
    ok('pokrývá', `${stupne(102)}–${stupne(110)}° v. d., ${stupne(106)}–${stupne(114)}° s. š.`);
  }
} catch (e) {
  pozor(`Hlavičku archivu nešlo přečíst: ${e.message}`, '');
}

/* ── 6. Odezva — místo CDN rozhoduje vzdálenost ──────────────────────── */
try {
  const casy = [];
  for (let i = 0; i < 5; i += 1) {
    const zacatek = Date.now();
    // Pokaždé jiný kousek, ať se neměří cache.
    await fetch(adresa, { headers: { Range: `bytes=${1000 + i * 977}-${1500 + i * 977}` } });
    casy.push(Date.now() - zacatek);
  }
  casy.sort((a, b) => a - b);
  const stred = casy[Math.floor(casy.length / 2)];
  const hodnoceni = stred < 120 ? 'svižné' : (stred < 350 ? 'použitelné' : 'pomalé');
  ok('odezva na jeden kousek', `${stred} ms (${hodnoceni})`);
  if (stred >= 350) {
    pozor('Odezva přes 350 ms se na mapě pozná',
      'Jeden pohled si řekne o několik kousků. Tady pomůže CDN — ale je to\n'
      + '        pohodlí, ne podmínka.');
  }
} catch (e) {
  pozor(`Odezvu nešlo změřit: ${e.message}`, '');
}

/* ── Závěr ───────────────────────────────────────────────────────────── */
console.log('');
if (chyb) {
  // Čeština má tři tvary a „3 vážných nálezů" tahá za oči i v nástroji.
  const nalezy = (n) => (n === 1 ? '1 vážný nález' : (n < 5 ? `${n} vážné nálezy` : `${n} vážných nálezů`));
  console.log(`❌ Takhle to nepojede: ${nalezy(chyb)}`
    + `${varovani ? `, k tomu ${varovani} varování` : ''}.\n`);
  process.exit(1);
}
console.log(varovani
  ? `✅ Pojede to, ale mrkni na ${varovani} varování.\n`
  : '✅ Tenhle hosting na podkladovou mapu stačí.\n');
