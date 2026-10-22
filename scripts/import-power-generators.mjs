// Производное закреплённых игровых Docs. См. THIRD_PARTY_NOTICES.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const pinned = JSON.parse(readFileSync(new URL('packages/game-data/source/provenance.json', root), 'utf8'));
const docs = name => {
  const raw = readFileSync(new URL(`packages/game-data/source/${name}`, root));
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== pinned.sha256[name]) throw new Error(`Изменились исходные ${name}.`);
  return { sha256, classes: JSON.parse(gunzipSync(raw).toString('utf16le').replace(/^﻿/, '')).flatMap(g => g.Classes.map(c => ({ ...c, nativeClass: g.NativeClass }))) };
};
const en = docs('Docs-en-US.json.gz'), ru = docs('Docs-ru.json.gz');
const catalog = JSON.parse(readFileSync(new URL('packages/game-data/catalog.json', root), 'utf8'));
const report = JSON.parse(readFileSync(new URL('packages/game-data/audit-report.json', root), 'utf8'));
const itemIds = new Map(Object.entries(report.itemClasses).map(([id, cls]) => [cls, id]));
const item = className => {
  const id = itemIds.get(className), entry = catalog.items.find(i => i.id === id), doc = en.classes.find(c => c.ClassName === className);
  if (!entry || !doc) throw new Error(`Не сопоставлен предмет: ${className}`);
  if (entry.fluid !== (doc.mForm !== 'RF_SOLID')) throw new Error(`Не совпадает форма предмета: ${className}`);
  return { entry, doc };
};
const generators = Object.entries({ 'coal-generator': 'Build_GeneratorCoal_C', 'fuel-generator': 'Build_GeneratorFuel_C' }).map(([id, className]) => {
  const c = en.classes.find(c => c.ClassName === className), name = ru.classes.find(c => c.ClassName === className)?.mDisplayName;
  if (!c || !c.nativeClass.endsWith(".FGBuildableGeneratorFuel'") || !name) throw new Error(`Не найден генератор: ${className}`);
  const power = Number(c.mPowerProduction);
  if (!(power > 0)) throw new Error(`Некорректная мощность: ${className}`);
  const fuels = c.mFuel.map(f => {
    const { entry, doc } = item(f.mFuelClass), energy = Number(doc.mEnergyValue) * (entry.fluid ? 1000 : 1);
    if (!(energy > 0)) throw new Error(`Некорректная энергия топлива: ${f.mFuelClass}`);
    return { itemId: entry.id, energy };
  });
  let supplemental = null;
  if (c.mRequiresSupplementalResource === 'True') {
    const classes = [...new Set(c.mFuel.map(f => f.mSupplementalResourceClass))];
    if (classes.length !== 1) throw new Error(`Разные вспомогательные ресурсы: ${className}`);
    const perMJ = Number(c.mSupplementalToPowerRatio) / 1000;
    if (!(perMJ > 0)) throw new Error(`Некорректный расход вспомогательного ресурса: ${className}`);
    supplemental = { itemId: item(classes[0]).entry.id, perMJ };
  }
  return { id, className, name, nameEn: c.mDisplayName, power, fuels, supplemental };
});
const data = { provenance: { catalogVersion: catalog.version, source: 'source/Docs-en-US.json.gz', sha256: en.sha256, ruSource: 'source/Docs-ru.json.gz', ruSha256: ru.sha256, importedAt: '2026-10-22',
  verification: 'Генераторы и энергоёмкость топлива из закреплённых Docs. Жидкости: mEnergyValue на 1/1000 м³. Сверено с игрой: угольный 15 угля и 45 м³ воды, топливный 20 м³ топлива в минуту.' }, generators };
writeFileSync(new URL('packages/game-data/power-generators.json', root), JSON.stringify(data, null, 2) + '\n');
