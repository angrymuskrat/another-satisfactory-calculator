import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../packages/domain/types';

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
