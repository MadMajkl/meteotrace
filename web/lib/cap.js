/**
 * CAP — čtení výstrah přímo od ČHMÚ.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě, bez knihovny. Dostane text XML
 * a vrátí datovou strukturu; stahování dělá `server/chmi-warnings.js`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ VLASTNÍ ČTENÍ A NE XML KNIHOVNA
 *
 * `R0`: co nejmíň cizího kódu. CAP je navíc formát, který se nemění
 * (OASIS 1.2 z roku 2010) a ČHMÚ ho vydává strojově — je pravidelný až
 * nudný. Nepotřebujeme obecný parser XML, potřebujeme přečíst osm značek.
 *
 * 🚨 ZÁMĚRNĚ SE NEROZEBÍRÁ CELÉ XML. Kdyby se sem někdy dostal dokument
 * s jinou strukturou, tenhle kód z něj prostě nic nevytáhne a vrátí
 * prázdno — nikdy ne nesmysl vydávaný za výstrahu. To je u varování před
 * bouřkou správnější než chytrost.
 * ────────────────────────────────────────────────────────────────────────
 *
 * TVAR VÝSTUPU je schválně týž, jaký posílá MeteoAlarm:
 * `{ warnings: [{ alert: { info: [...] } }] }`. Díky tomu na výměnu zdroje
 * nemusí sáhnout `trimWarnings()`, přiřazení podle ORP ani obrazovka —
 * je to adaptér, ne přepis (`R0`).
 */

'use strict';

/** Znakové entity, které se v CAP od ČHMÚ vyskytují. */
function rozkoduj(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // ⚠️ `&amp;` až nakonec, jinak by se z `&amp;lt;` stalo `<`.
    .replace(/&amp;/g, '&');
}

/** Obsah první značky daného jména, nebo `null`. */
function znacka(zdroj, jmeno) {
  const m = zdroj.match(new RegExp(`<${jmeno}>([\\s\\S]*?)</${jmeno}>`));
  return m ? rozkoduj(m[1]).trim() : null;
}

/** Všechny bloky dané značky. */
function bloky(zdroj, jmeno) {
  return [...zdroj.matchAll(new RegExp(`<${jmeno}>([\\s\\S]*?)</${jmeno}>`, 'g'))].map((m) => m[1]);
}

/**
 * Oblasti jednoho `<info>`.
 *
 * ⚠️ Bere se OBOJÍ — `areaDesc` i geokódy. Jméno území nese seznam ORP
 * v závorce („Plzeňský kraj (Domažlice, …)") a podle něj se dnes přiřazuje
 * (`R11`); kódy `CISORP` jsou strojová podoba téhož a je jich přesně tolik,
 * kolik jmen v závorce. Držet obojí stojí pár bajtů a dává to volnost
 * přejít na kódy, až na to bude převodník.
 */
function oblasti(infoBlok) {
  return bloky(infoBlok, 'area').map((a) => ({
    areaDesc: znacka(a, 'areaDesc') || '',
    geocode: [...a.matchAll(/<geocode>([\s\S]*?)<\/geocode>/g)].map(([, g]) => ({
      valueName: znacka(g, 'valueName') || '',
      value: znacka(g, 'value') || '',
    })),
  }));
}

/** Jeden `<info>` na tvar, jaký zná zbytek appky. */
function jedenInfo(blok) {
  return {
    language: znacka(blok, 'language') || '',
    event: znacka(blok, 'event') || '',
    severity: znacka(blok, 'severity') || 'Unknown',
    onset: znacka(blok, 'onset'),
    expires: znacka(blok, 'expires'),
    description: znacka(blok, 'description') || '',
    instruction: znacka(blok, 'instruction') || '',
    area: oblasti(blok),
  };
}

/**
 * Klíč, podle kterého se k sobě hledají jazykové verze TÉŽE výstrahy.
 *
 * 🚨 MUSÍ BÝT NEZÁVISLÝ NA JAZYKU. Název jevu je přeložený („Silné bouřky"
 * vs „Moderate Thunderstorm Warning"), takže podle něj se párovat nedá.
 * Závažnost, časy a kódy území jsou v obou verzích totožné.
 *
 * ⚠️ Nepáruje se podle POŘADÍ, přestože ČHMÚ posílá bloky ve dvojicích
 * (cs, en, cs, en…). Pořadí je vlastnost dnešního vydavatele, ne formátu —
 * a kdyby se změnilo, tiše by se spároval český text s cizím územím.
 */
function klicVystrahy(info) {
  const kody = info.area
    .flatMap((a) => a.geocode.filter((g) => g.valueName === 'CISORP').map((g) => g.value))
    .sort()
    .join(',');
  return [info.severity, info.onset || '', info.expires || '', kody].join('|');
}

/**
 * Přečte CAP dokument.
 *
 * @param {string} xml
 * @returns {{sent: string|null, sender: string|null, status: string|null,
 *            warnings: Array<{alert: {info: Array}}>}}
 */
export function parseCap(xml) {
  const text = String(xml || '');
  const prazdno = { sent: null, sender: null, status: null, warnings: [] };
  if (!text.includes('<alert')) return prazdno;

  // ⚠️ `sent` se čte z HLAVIČKY dokumentu, ne z `<info>`. Je to čas vydání
  // celé zprávy a stojí na něm hlídání stáří zdroje — kdyby se bralo
  // odjinud, mohl by mrtvý feed vypadat čerstvě.
  const hlavicka = text.slice(0, text.indexOf('<info>') === -1 ? text.length : text.indexOf('<info>'));

  const infos = bloky(text, 'info').map(jedenInfo);

  // Jazykové verze téže výstrahy k sobě.
  const skupiny = new Map();
  for (const info of infos) {
    const k = klicVystrahy(info);
    if (!skupiny.has(k)) skupiny.set(k, []);
    skupiny.get(k).push(info);
  }

  return {
    sent: znacka(hlavicka, 'sent'),
    sender: znacka(hlavicka, 'sender'),
    status: znacka(hlavicka, 'status'),
    warnings: [...skupiny.values()].map((info) => ({ alert: { info } })),
  };
}

/**
 * Který soubor v adresáři ČHMÚ je nejnovější?
 *
 * 🚨 Jména se OPAKUJÍ. `alert_cap_50_300811.xml` je „den 30, čas 08:11" —
 * a přepíše se za měsíc znovu. Podle jména se tedy nejnovější soubor určit
 * NEDÁ; pozná se jen podle času úpravy ve výpisu adresáře. Kdo by řadil
 * podle jména, dostal by klidně soubor z března.
 *
 * ⚠️ Rozebírat výpis adresáře je křehké — je to HTML pro lidi, ne rozhraní.
 * Proto se při neúspěchu vrací `null` a volající sáhne po záloze, místo aby
 * hádal.
 *
 * @param {string} html  výpis adresáře
 * @returns {{jmeno: string, kdy: number}|null}
 */
export function nejnovejsiSoubor(html) {
  const radky = [...String(html || '').matchAll(
    /([A-Za-z0-9_.-]+\.xml)<\/a>\s+(\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2})/g,
  )];
  let nej = null;
  for (const [, jmeno, datum] of radky) {
    const kdy = Date.parse(datum.replace(/-/g, ' '));
    if (!Number.isFinite(kdy)) continue;
    if (!nej || kdy > nej.kdy) nej = { jmeno, kdy };
  }
  return nej;
}

/**
 * Je zpráva dost čerstvá, aby se z jejího mlčení dalo číst „nic nehrozí"?
 *
 * 🚨 TOHLE JE CELÝ SMYSL HLÍDÁNÍ STÁŘÍ. Prázdný seznam výstrah znamená buď
 * klid, nebo mrtvý zdroj — a to jsou dvě úplně jiné zprávy. Bez času vydání
 * se nedají odlišit a appka by mlčky tvrdila klid o něčem, o čem nic neví.
 *
 * ⚠️ Práh je 12 hodin. ČHMÚ vydává i „žádná výstraha" nejméně jednou denně,
 * takže půl dne bez zprávy už není normální provoz.
 */
export const NEJSTARSI_ZPRAVA_MS = 12 * 3600 * 1000;

export function zpravaJeCerstva(sent, nowMs = Date.now()) {
  const kdy = Date.parse(sent || '');
  if (!Number.isFinite(kdy)) return false;
  return nowMs - kdy <= NEJSTARSI_ZPRAVA_MS && kdy <= nowMs + 3600_000;
}

/** Stáří zprávy v sekundách, nebo `null`. */
export function stariZpravyS(sent, nowMs = Date.now()) {
  const kdy = Date.parse(sent || '');
  if (!Number.isFinite(kdy)) return null;
  return Math.max(0, Math.round((nowMs - kdy) / 1000));
}
