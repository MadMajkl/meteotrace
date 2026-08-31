/**
 * Samotest prahů závažnosti.
 *
 * 🚨 TENHLE MODUL ROZHODUJE, JESTLI SE NA BOUŘKU ZAZVONÍ. Doteď byl jako
 * jediný v `web/lib/` úplně bez testu — našla to revize dokumentace proti
 * zdrojáku 31. 8. 2026. A je to nejhorší možné místo pro chybějící kontrolu:
 * vada by se neprojevila ničím. Appka by se tvářila stejně, jen by jednou
 * nezazvonila.
 *
 * Testy proto míří na hranice a na PORUCHOVÉ hodnoty, ne na šťastnou cestu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { staciNa, STUPNE, VYCHOZI_PRAH } from '../web/lib/severity.js';

test('stupnice jde od nejhoršího k nejmírnějšímu', () => {
  // Na pořadí stojí celé porovnávání — obrácené by tiše převrátilo význam
  // prahu a upozorňovalo by se přesně naopak.
  assert.deepEqual(STUPNE, ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
});

test('výchozí práh je Moderate, ne Minor', () => {
  // ⚠️ Rozhodnutí, ne lenost: ČHMÚ vydává nízké stupně skoro obden a
  // upozornění, které otravuje, si člověk vypne — a pak nedostane ani to,
  // kvůli čemu to vzniklo.
  assert.equal(VYCHOZI_PRAH, 'Moderate');
});

test('při výchozím prahu projde bouřka, drobnost ne', () => {
  assert.equal(staciNa('Extreme'), true);
  assert.equal(staciNa('Severe'), true);
  assert.equal(staciNa('Moderate'), true);
  assert.equal(staciNa('Minor'), false, 'náledí a riziko požárů nemá budit');
});

test('práh se dá posunout oběma směry', () => {
  assert.equal(staciNa('Moderate', 'Severe'), false, 'přísnější práh silné bouřky propustí, mírné ne');
  assert.equal(staciNa('Severe', 'Severe'), true);
  assert.equal(staciNa('Minor', 'Minor'), true, 'kdo chce všechno, dostane všechno');
  assert.equal(staciNa('Extreme', 'Extreme'), true);
  assert.equal(staciNa('Severe', 'Extreme'), false);
});

test('🚨 Unknown propadne VŽDYCKY, i tím nejpřísnějším prahem', () => {
  // Neznámá závažnost není nízká závažnost. Zahodit ji tiše by znamenalo
  // mlčet právě tam, kde nevíme, oč jde.
  for (const prah of STUPNE) {
    assert.equal(staciNa('Unknown', prah), true, `práh ${prah}`);
  }
});

test('🚨 chybějící závažnost se taky propustí', () => {
  // Výstraha bez stupně je pořád výstraha. Kdyby propadla sítem, zmizela by
  // beze stopy.
  for (const nic of [undefined, null, '']) {
    assert.equal(staciNa(nic), true, String(nic));
  }
});

test('🚨 pokažený práh upozornění NEVYPNE', () => {
  // Nesmyslná hodnota v nastavení (import z jiné verze, překlep) by jinak
  // upozorňování potichu vypnula — a to je nejhorší způsob, jak přijít
  // o výstrahu: nikde se to neprojeví.
  for (const spatny of ['moderate', 'SEVERE', 'nesmysl', '', null, undefined, 42, {}]) {
    assert.equal(staciNa('Severe', spatny), true, `práh ${JSON.stringify(spatny)}`);
  }
});

test('🚨 neznámý stupeň závažnosti se taky propustí', () => {
  // Kdyby ČHMÚ jednou přidal stupeň, který neznáme, nesmí kvůli tomu
  // výstraha zmizet. Radši zazvonit zbytečně než mlčet o neznámém.
  assert.equal(staciNa('Katastrofa', 'Moderate'), true);
});

test('porovnání je na přesnou shodu, ne na podřetězec', () => {
  // „Severe" a „SevereX" nejsou totéž; kdyby se porovnávalo volně, tabulka
  // by se rozjela a práh by přestal platit.
  assert.equal(staciNa('Sever', 'Moderate'), true, 'neznámý stupeň → propustit');
  assert.equal(STUPNE.indexOf('Sever'), -1);
});
