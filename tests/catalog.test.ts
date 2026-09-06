import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Catalog, Ingredient } from '../packages/domain/types';

const path = 'packages/game-data/catalog.json';
const read = (): Catalog => JSON.parse(readFileSync(path, 'utf8'));
describe('официальный каталог', () => {
  it('импортирован из закреплённых источников', () => {
    expect(existsSync(path)).toBe(true);
    const c = read();
    expect(c.provenance.commit).toBe('c5664fc8fba4ff7dcb3f29f84f74278f497e9bb6');
    expect(c.recipes.length).toBeGreaterThan(250);
  });
  it('содержит согласованные ссылки, уникальные ID и положительные циклы', () => {
    const c = read(), ids = new Set(c.items.map(i => i.id)), buildings = new Set(c.buildings.map(b => b.id));
    expect(ids.size).toBe(c.items.length);
    expect(new Set(c.recipes.map(r => r.id)).size).toBe(c.recipes.length);
    for (const r of c.recipes) {
      expect(buildings.has(r.buildingId)).toBe(true);
      expect(r.seconds).toBeGreaterThan(0);
      expect(r.outputs.length).toBeGreaterThan(0);
      for (const i of [...r.inputs, ...r.outputs]) {
        expect(ids.has(i.itemId), `${r.id}: ${i.itemId}`).toBe(true);
        expect(i.amount).toBeGreaterThan(0);
      }
    }
  });
  it('сохраняет материальные количества, нормализует литры в м³', () => {
    const c = read();
    const plate = c.recipes.find(r => r.id === 'iron-plate')!;
    expect(plate.inputs).toEqual([{ itemId: 'iron-ingot', amount: 3 }]);
    expect(plate.outputs).toEqual([{ itemId: 'iron-plate', amount: 2 }]);
    expect(plate.seconds).toBe(6);
    const pure = c.recipes.find(r => r.id === 'alt-pure-iron-ingot')!;
    expect(pure.inputs.find(i => i.itemId === 'water')?.amount).toBe(4);
  });
  it('не разрешает утилизировать жидкости и радиоактивные отходы', () => {
    const c = read();
    for (const id of ['water', 'uranium-waste', 'plutonium-waste']) expect(c.items.find(i => i.id === id)?.sinkable).toBe(false);
    expect(c.items.find(i => i.id === 'iron-plate')?.sinkable).toBe(true);
    expect(c.buildings.find(b => b.id === 'awesome-sink')?.power).toBe(30);
  });
  it('использует русскую локализацию и реальные ограничения добытчиков', () => {
    const c = read();
    expect(c.items.find(i => i.id === 'iron-ore')?.name).toBe('Железная руда');
    expect(c.miners.find(m => m.id === 'miner-mk1')?.rate).toBe(60);
    expect(c.miners.find(m => m.id === 'water-extractor')?.resourceIds).toEqual(['water']);
    expect(c.belts.map(b => b.rate)).toEqual([60,120,270,480,780,1200]);
    expect(c.pipes.map(p => p.rate)).toEqual([300,600]);
  });
  it('учитывает рецептную мощность и исключает генерацию', () => {
    const c = read();
    expect(c.recipes.find(r => r.id === 'nuclear-pasta')?.powerMax).toBe(1500);
    expect(c.recipes.find(r => r.id === 'diamonds')?.powerMax).toBe(750);
    expect(c.recipes.some(r => r.buildingId === 'nuclear-power-plant')).toBe(false);
    expect(c.provenance.notes.some(n => n.includes('крив'))).toBe(true);
  });
  it('соблюдает игровые приоритеты рецептов внутри группы', () => {
    const c = read();
    const audit = JSON.parse(readFileSync('packages/game-data/audit-report.json', 'utf8'));
    const game = JSON.parse(gunzipSync(readFileSync('packages/game-data/source/Docs-en-US.json.gz')).toString('utf16le').replace(/^\uFEFF/, ''));
    const priorities = new Map<string, number>(game.flatMap((g: { Classes: Array<{ ClassName: string; mManufacturingMenuPriority?: string }> }) => g.Classes.map(r => [r.ClassName, Number(r.mManufacturingMenuPriority)])));
    for (const category of c.categories) {
      const values = c.recipes.filter(r => r.category === category).map(r => priorities.get(audit.recipeClasses[r.id])!);
      expect(values, category).toEqual([...values].sort((a, b) => a-b));
    }
  });
});

// Локальный тип позволяет проверять импорт до параллельного изменения domain.
type P1Catalog = Catalog & {
  buildings: Array<Catalog['buildings'][number] & { buildCost?: Ingredient[] }>;
  miners: Array<Catalog['miners'][number] & { buildCost?: Ingredient[] }>;
  unlocks?: Array<{ id: string; name: string; kind: string; tier?: number; recipeIds: string[];
    buildingIds: string[]; beltIds: string[]; pipeIds: string[]; overclock: boolean; prerequisiteIds: string[];
    minerIds?: string[]; schematicIds?: string[]; prerequisiteGroups?: string[][]; prerequisitesKnown?: boolean }>;
};
const readP1 = (): P1Catalog => JSON.parse(readFileSync(path, 'utf8'));
const readProgression = () => {
  expect(existsSync('packages/game-data/progression.json'), 'результат офлайн-импорта схем').toBe(true);
  return JSON.parse(readFileSync('packages/game-data/progression.json', 'utf8'));
};
describe('P1: исходные стоимости и открытия', () => {
  it('не путает Foundry со Smelter по имени Recipe_SmelterMk1 и сохраняет стоимость Sink', () => {
    const c = readP1();
    expect(c.buildings.find(b => b.id === 'smelter')?.buildCost).toEqual([
      { itemId: 'iron-rod', amount: 5 }, { itemId: 'wire', amount: 8 },
    ]);
    expect(c.buildings.find(b => b.id === 'foundry')?.buildCost).toEqual([
      { itemId: 'modular-frame', amount: 10 }, { itemId: 'rotor', amount: 10 }, { itemId: 'concrete', amount: 20 },
    ]);
    expect(c.buildings.find(b => b.id === 'awesome-sink')?.buildCost).toEqual([
      { itemId: 'reinforced-iron-plate', amount: 15 }, { itemId: 'cable', amount: 30 }, { itemId: 'concrete', amount: 45 },
    ]);
  });
  it('считает стоимость нового бура, включая переносные буры, а не разницу апгрейда', () => {
    const c = readP1();
    expect(c.miners.find(m => m.id === 'miner-mk1')?.buildCost).toEqual([
      { itemId: 'portable-miner', amount: 1 }, { itemId: 'iron-plate', amount: 10 }, { itemId: 'concrete', amount: 10 },
    ]);
    expect(c.miners.find(m => m.id === 'miner-mk3')?.buildCost).toEqual([
      { itemId: 'portable-miner', amount: 3 }, { itemId: 'steel-pipe', amount: 50 },
      { itemId: 'supercomputer', amount: 5 }, { itemId: 'fused-modular-frame', amount: 10 }, { itemId: 'turbo-motor', amount: 3 },
    ]);
  });
  it('сверяет все 17 стоимостей с ингредиентами закреплённых build recipes', () => {
    const c = readP1();
    const audit = JSON.parse(readFileSync('packages/game-data/audit-report.json', 'utf8'));
    const docs = JSON.parse(gunzipSync(readFileSync('packages/game-data/source/Docs-en-US.json.gz')).toString('utf16le').replace(/^\uFEFF/, ''));
    const recipes = docs.flatMap((g: { Classes: Array<{ ClassName: string; mProducedIn?: string; mProduct?: string; mIngredients?: string }> }) => g.Classes);
    const machines = [...c.buildings, ...c.miners];
    expect(machines).toHaveLength(17);
    for (const machine of machines) {
      expect(machine.buildCost?.length ?? 0, machine.id).toBeGreaterThan(0);
      const evidence = audit.buildCosts.entries.find((e: { id: string }) => e.id === machine.id);
      const source = recipes.find((r: { ClassName: string }) => r.ClassName === evidence.recipeClass);
      expect(source.mProducedIn).toContain('BP_BuildGun_C');
      expect(source.mProduct).toContain(`.${evidence.descriptorClass}'\",Amount=1`);
      // Независимая проверка: обход исходных tuple, без функций импортёра.
      const tuples = source.mIngredients.slice(2, -2).split('),(');
      expect(machine.buildCost).toHaveLength(tuples.length);
      for (const tuple of tuples) {
        const className = tuple.split("'\",Amount=")[0].split('.').at(-1);
        const itemId = Object.keys(audit.itemClasses).find(id => audit.itemClasses[id] === className);
        expect(itemId).toBeDefined();
        expect(machine.buildCost).toContainEqual({ itemId, amount: Number(tuple.split('Amount=')[1]) });
      }
      for (const ingredient of machine.buildCost!) expect(c.items.some(i => i.id === ingredient.itemId)).toBe(true);
    }
  });
  it('импортирует реальные HUB/MAM эффекты и русское имя разгона', () => {
    const c = readP1();
    expect(c.unlocks?.length ?? 0).toBeGreaterThan(100);
    expect(c.unlocks!.find(u => u.id === 'Research_PowerSlugs_2_C')).toMatchObject({
      name: 'Разгон производства', kind: 'mam', overclock: true, prerequisiteIds: [],
    });
    expect(c.unlocks!.find(u => u.id === 'Schematic_3-1_C')).toMatchObject({ kind: 'hub', tier: 3, pipeIds: ['pipe1'] });
    expect(c.unlocks!.find(u => u.id === 'Schematic_2-5_C')?.buildingIds).toContain('awesome-sink');
    expect(c.unlocks!.find(u => u.id === 'Schematic_StartingRecipes_C')?.recipeIds).toContain('iron-ingot');
  });
  it('сохраняет граф источника без выдуманных названий и требований MAM', () => {
    const p = readProgression();
    expect(p.schematics).toHaveLength(574);
    const clock = p.schematics.find((s: { id: string }) => s.id === 'Research_PowerSlugs_2_C');
    expect(clock.dependencies).toEqual([]);
    expect(p.coverage.researchTreeExported).toBe(false);
    expect(p.coverage.prerequisitesComplete).toBe(false);
    expect(p.schematics.find((s: { id: string }) => s.id === 'Schematic_4-1_C').minerIds).toEqual(['miner-mk2']);
    expect(p.schematics.find((s: { id: string }) => s.id === 'Schematic_5-1_C').schematicIds).toContain('Schematic_5-1-1_C');
    expect(readP1().unlocks?.some(u => u.id === 'Research_Sulfur_3_2_C')).toBe(false);
  });
  it('не превращает OR-зависимость в обязательное открытие обеих схем', () => {
    const p = readProgression();
    const s = p.schematics.find((s: { id: string }) => s.id === 'CustomizerUnlock_PipelineSwatch_C');
    expect(s.prerequisiteIds).toEqual([]);
    expect(s.dependencies[0].mRequireAllSchematicsToBePurchased).toBe('False');
    expect(s.dependencies[0].mSchematics).toContain('Schematic_3-1_C');
    expect(s.dependencies[0].mSchematics).toContain('Schematic_2-5_C');
    expect(readP1().unlocks!.find(u => u.id === 'Schematic_Tutorial1_5_C')?.prerequisiteIds).toEqual(['Schematic_Tutorial1_C']);
    expect(p.coverage.missingSchematicReferences).toEqual(['Research_Caterium_6_1_C', 'Schematic_6-4_C']);
  });
  it('передаёт miners и все транзитивные child schemes непосредственно в Catalog.unlocks', () => {
    const c = readP1(), p = readProgression();
    const unlocks = c.unlocks!;
    expect(unlocks.find(u => u.id === 'Schematic_4-1_C')?.minerIds).toEqual(['miner-mk2']);
    expect(unlocks.find(u => u.id === 'Schematic_5-1_C')?.schematicIds).toEqual(['Schematic_5-1-1_C']);
    const byId = new Map(unlocks.map(u => [u.id, u]));
    const reached = new Set<string>();
    for (const root of unlocks) {
      const pending = [root.id];
      while (pending.length) {
        const id = pending.pop()!;
        if (reached.has(id)) continue;
        reached.add(id);
        const u = byId.get(id);
        expect(u, `child ${id}`).toBeDefined();
        const source = p.schematics.find((s: { id: string }) => s.id === id);
        expect(u!.schematicIds).toEqual(source.schematicIds);
        expect(u!.minerIds).toEqual(source.minerIds);
        pending.push(...u!.schematicIds!);
      }
    }
    expect(unlocks.reduce((n, u) => n + u.schematicIds!.length, 0)).toBe(15);
    expect(new Set(unlocks.flatMap(u => u.minerIds!))).toEqual(new Set(c.miners.map(m => m.id)));
  });
  it('выражает purchased dependencies как AND групп с OR внутри и не объявляет полный доступ', () => {
    const unlocks = readP1().unlocks!;
    expect(unlocks.find(u => u.id === 'CustomizerUnlock_PipelineSwatch_C')?.prerequisiteGroups).toEqual([
      ['Schematic_3-1_C', 'Schematic_2-5_C'],
    ]);
    expect(unlocks.find(u => u.id === 'Schematic_Tutorial1_5_C')?.prerequisiteGroups).toEqual([['Schematic_Tutorial1_C']]);
    expect(unlocks.find(u => u.id === 'Schematic_Alternate_EnrichedCoal_C')?.prerequisiteGroups).toEqual([
      ['Schematic_3-1_C'], ['Research_Sulfur_0_C'],
    ]);
    for (const u of unlocks) {
      expect(u.prerequisitesKnown, u.id).toBe(false);
      expect(Array.isArray(u.prerequisiteGroups), u.id).toBe(true);
      for (const group of u.prerequisiteGroups!) {
        expect(group.length).toBeGreaterThan(0);
        for (const id of group) expect(unlocks.some(s => s.id === id)).toBe(true);
      }
    }
    expect(unlocks.find(u => u.id === 'Research_PowerSlugs_2_C')?.prerequisiteGroups).toEqual([]);
  });
  it('замыкает несколько уровней child schemes с циклом и отклоняет отсутствующего ребёнка', async () => {
    const { importP1Data } = await import('../scripts/' + 'import-p1-game-data.mjs');
    // Синтетические схемы проверяют алгоритм, в игровые данные они не записываются.
    const schematic = (id: string, child: string, type = 'EST_Custom') => ({
      ClassName: id, nativeClass: "/Script/FactoryGame.FGSchematic'", mDisplayName: id,
      mType: type, mTechTier: '0', mIncludeInBuilds: 'IIB_PublicBuilds', mRelevantEvents: '',
      mSchematicDependencies: [], mUnlocks: [{ Class: 'BP_UnlockSchematic_C', mSchematics: `("/Game/Test.${child}'")` }],
    });
    const en = [schematic('Root_C', 'Child_C', 'EST_Milestone'), schematic('Child_C', 'Grandchild_C'), schematic('Grandchild_C', 'Child_C')];
    const run = (source: typeof en) => {
      const catalog = { version: 'test', buildings: [], miners: [], belts: [], pipes: [], recipes: [], unlocks: [] as Array<{ id: string }> };
      importP1Data({ en: source, ru: new Map(en.map(s => [s.ClassName, s])), catalog,
        report: { recipeClasses: {}, itemClasses: {} }, machineClasses: {}, transportClasses: {},
        parseIngredients: () => [], hashes: {}, pinned: { game: {} },
      });
      return catalog;
    };
    expect(run(en).unlocks.map(s => s.id)).toEqual(['Root_C', 'Child_C', 'Grandchild_C']);
    expect(() => run(en.slice(0, 2))).toThrow(/Grandchild_C/);
  });
  it('сохраняет все исходные эффекты и связывает каждое открытие с Docs en-US/ru', () => {
    type DocSchematic = { ClassName: string; mDisplayName: string; mType: string; mTechTier: string;
      mUnlocks: Array<{ Class: string; mRecipes?: string }>; mSchematicDependencies: unknown[] };
    const docs = (lang: string): DocSchematic[] => JSON.parse(gunzipSync(readFileSync(`packages/game-data/source/Docs-${lang}.json.gz`)).toString('utf16le').replace(/^\uFEFF/, ''))
      .filter((g: { NativeClass: string }) => g.NativeClass.endsWith(".FGSchematic'"))
      .flatMap((g: { Classes: DocSchematic[] }) => g.Classes);
    const en = docs('en-US'), ru = new Map(docs('ru').map(s => [s.ClassName, s]));
    const p = readProgression(), c = readP1();
    const audit = JSON.parse(readFileSync('packages/game-data/audit-report.json', 'utf8'));
    for (const s of en) {
      const evidence = p.schematics.find((r: { id: string }) => r.id === s.ClassName);
      expect(evidence.rawUnlocks, s.ClassName).toEqual(s.mUnlocks);
      expect(evidence.dependencies, s.ClassName).toEqual(s.mSchematicDependencies);
      const projected = c.unlocks!.find(u => u.id === s.ClassName);
      if (!projected) continue;
      expect(projected.name).toBe(ru.get(s.ClassName)?.mDisplayName);
      expect(projected.tier).toBe(Number(s.mTechTier));
      expect(projected.kind).toBe(['EST_Milestone', 'EST_Tutorial'].includes(s.mType) ? 'hub' : s.mType === 'EST_MAM' ? 'mam' : 'other');
      const originalRecipes = s.mUnlocks.filter(u => u.Class === 'BP_UnlockRecipe_C').map(u => u.mRecipes).join(',');
      expect(new Set(projected.recipeIds)).toEqual(new Set(c.recipes.filter(r => originalRecipes.includes(`.${audit.recipeClasses[r.id]}'`)).map(r => r.id)));
      for (const id of projected.buildingIds) {
        const source = audit.buildCosts.entries.find((e: { id: string }) => e.id === id);
        expect(originalRecipes).toContain(`.${source.recipeClass}'`);
      }
      expect(projected.overclock).toBe(s.mUnlocks.some(u => u.Class === 'BP_UnlockBuildOverclock_C'));
      for (const id of projected.prerequisiteIds) expect(c.unlocks!.some(u => u.id === id)).toBe(true);
    }
    expect(new Set(c.unlocks!.map(u => u.id)).size).toBe(c.unlocks!.length);
    for (const [key, items] of Object.entries({ recipes: c.recipes, buildings: c.buildings, miners: c.miners, belts: c.belts, pipes: c.pipes })) {
      expect(p.coverage[key]).toEqual({ total: items.length, covered: items.length, missingIds: [] });
    }
    const pinned = JSON.parse(readFileSync('packages/game-data/source/provenance.json', 'utf8'));
    for (const [file, hash] of Object.entries(p.provenance.sha256)) {
      expect(hash).toBe(pinned.sha256[file]);
      expect(createHash('sha256').update(readFileSync(`packages/game-data/source/${file}`)).digest('hex')).toBe(hash);
    }
  });
});
