// Словари игровых названий по языкам из закреплённых Docs и assets той же сборки.
// Запускается последним в import-game-data.mjs и отдельно: node scripts/import-locales.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { decodeDocs } from './gameDocs.mjs';
import { minerClasses, beltClass, pipeClass } from './game-classes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = p => resolve(root, p);
const json = p => JSON.parse(readFileSync(path(p), 'utf8'));
const write = (p, value) => writeFileSync(path(p), JSON.stringify(value, null, 2) + '\n');
const sourcePath = 'packages/game-data/source/';
const dataPath = 'packages/game-data/';

const catalog = json(dataPath + 'catalog.json');
const progression = json(dataPath + 'progression.json');
const generators = json(dataPath + 'power-generators.json').generators;
const menu = json(sourcePath + 'menu-assets.json');
const research = json(sourcePath + 'research-assets.json');
const overrides = json(dataPath + 'overrides.json');
const en = new Map(decodeDocs(readFileSync(path(sourcePath + 'Docs-en-US.json.gz'))).map(c => [c.ClassName, c]));

const names = { ru: {}, en: {} };
const manualNames = [];
const put = (kind, id, ru, enName) => {
  if (!ru?.trim() || !enName?.trim()) throw new Error(`Нет названия: ${kind}.${id}`);
  (names.ru[kind] ??= {})[id] = ru;
  (names.en[kind] ??= {})[id] = enName;
};
const docsName = (className, id) => {
  const name = en.get(className)?.mDisplayName;
  if (!name) throw new Error(`Нет английского названия класса ${className} (${id})`);
  return name;
};

for (const kind of ['item', 'recipe', 'building']) for (const e of catalog[kind + 's']) put(kind, e.id, e.name, e.nameEn);
catalog.miners.forEach(m => put('miner', m.id, m.name, docsName(minerClasses[m.id], m.id)));
catalog.belts.forEach((b, i) => put('belt', b.id, b.name, docsName(beltClass(i), b.id)));
catalog.pipes.forEach((p, i) => put('pipe', p.id, p.name, docsName(pipeClass(i), p.id)));

const categoryEn = new Map(menu.categories.map(c => [c.name, c.nameEn]));
for (const category of catalog.categories) {
  let enName = categoryEn.get(category);
  if (!enName) {
    enName = overrides.manualNames?.en?.category?.[category];
    if (enName) manualNames.push({ kind: 'category', id: category, en: enName });
  }
  put('category', category, category, enName);
}

// У девяти схем в Docs пусто и русское, и английское название; одно пустое из двух — ошибка данных.
for (const s of progression.schematics) if (s.name?.trim() || s.nameEn?.trim()) put('schematic', s.id, s.name, s.nameEn);
for (const t of research.trees) put('researchTree', t.className, t.name, t.nameEn);
for (const p of research.phases) put('gamePhase', p.className, p.name, p.nameEn);
for (const g of generators) put('generator', g.id, g.name, g.nameEn);

const sorted = dict => Object.fromEntries(Object.entries(dict).map(([kind, entries]) => [kind, Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))]));
mkdirSync(path(dataPath + 'locales'), { recursive: true });
for (const lang of ['ru', 'en']) write(`${dataPath}locales/${lang}.json`, sorted(names[lang]));

const report = json(dataPath + 'audit-report.json');
if (manualNames.length) report.verification.manualNames = manualNames;
else delete report.verification.manualNames;
write(dataPath + 'audit-report.json', report);
console.log(JSON.stringify({ locales: Object.fromEntries(Object.entries(names.en).map(([k, v]) => [k, Object.keys(v).length])), manualNames: manualNames.length }));
