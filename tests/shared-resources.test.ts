import { describe, expect, it } from 'vitest';
import catalogJson from '../packages/game-data/catalog.json';
import { createDefaultPlan } from '../packages/domain/defaults';
import type { Catalog, Plan } from '../packages/domain/types';
import { parsePlan } from '../packages/domain/validation';
import { parseCatalogPlan } from '../packages/domain/worldPlanValidation';
import { applyWorldUpdate, createFactory, createWorld, emptyWorkspace, mergeWorkspace, parseWorkspace, previewWorldUpdate } from '../packages/domain/worlds';
import { effectivePlan } from '../packages/domain/availability';

const catalog = catalogJson as Catalog;
const node = { id: 'shared-iron', name: 'Северное железо', itemId: 'iron-ore', limit: 120 };

function sharedPlan(worldId = 'world-1', quota = 60): Plan {
  const base = createDefaultPlan(catalog);
  const world = { ...createWorld(catalog, 'Мир', worldId, base), resourceNodes: [{ ...node }] };
  return {
    ...base,
    world,
    sources: [{ id: 'quota', name: 'Квота железа', itemId: node.itemId, kind: 'flow', limit: quota,
      count: 1, purity: 1, minerId: '', clock: 100, sharedNodeId: node.id, importPower: null }],
  };
}

function sharedWorkspace(first = 60, second = 40) {
  const plan = sharedPlan('world-1', first);
  const world = { ...createWorld(catalog, 'Мир', 'world-1', plan), resourceNodes: [{ ...node }] };
  const one = createFactory(plan, 'factory-1', world);
  const two = createFactory({ ...sharedPlan('world-1', second), name: 'Вторая фабрика' }, 'factory-2', world);
  return { ...emptyWorkspace(catalog.version), worlds: [world], factories: [one, two] };
}

describe('общие конечные ресурсы мира', () => {
  it('мир из автономного плана сохраняет доступность использованных механик P2', () => {
    const plan = createDefaultPlan(catalog);
    plan.lines = [{ id: 'old', name: '', recipeId: 'iron-rod', count: 1, clock: 250, duty: 1, somersloops: 1, locked: true }];
    plan.somersloopBudget = 1;
    plan.sources = [{ id: 'well', kind: 'well', itemId: 'water', count: 1, purity: 1, clock: 100, minerId: '', limit: null, well: { satellites: [{ purity: 1, count: 1 }] } }];
    const world = createWorld(catalog, 'P2', 'p2-world', plan);
    expect(world.overclockUnlocked).toBe(true);
    expect(world.unlockedMilestoneIds).toEqual(expect.arrayContaining(['p2:resource-wells', 'p2:production-amplifier']));
    expect(() => effectivePlan(catalog, createFactory(plan, 'factory', world).plan)).not.toThrow();
  });
  it('не позволяет двум источникам одного черновика повторно выделить узел', () => {
    const plan = sharedPlan('world-1', 80); plan.sources.push({ ...plan.sources[0], id: 'duplicate-allocation' });
    expect(() => effectivePlan(catalog, plan)).toThrow(/квот.*лимит/i);
  });
  it('сохраняет квоты разных фабрик, пока их сумма не превышает лимит узла', () => {
    expect(parseWorkspace(sharedWorkspace()).factories.map(f => f.plan.sources[0].limit)).toEqual([60, 40]);
    const decimals = sharedWorkspace(0.1, 0.2);
    decimals.worlds[0].resourceNodes![0].limit = 0.3;
    decimals.factories.forEach(factory => { factory.plan.world!.resourceNodes![0].limit = 0.3; });
    expect(parseWorkspace(decimals).factories).toHaveLength(2);
    expect(() => parseWorkspace(sharedWorkspace(80, 50))).toThrow(/квот.*лимит/i);
  });

  it('отклоняет ссылку без мира, отсутствующий узел и несовместимый источник', () => {
    const standalone = sharedPlan(); delete standalone.world;
    expect(() => parseWorkspace({ ...emptyWorkspace(catalog.version), factories: [createFactory(standalone, 'standalone')] })).toThrow(/общий узел.*мир/i);

    const missing = sharedWorkspace(); missing.factories[0].plan.sources[0].sharedNodeId = 'missing';
    expect(() => parseWorkspace(missing)).toThrow(/общий узел.*отсутствует/i);

    const wrongItem = sharedWorkspace(); wrongItem.factories[0].plan.sources[0].itemId = 'copper-ore';
    expect(() => parseWorkspace(wrongItem)).toThrow(/ресурс.*узла/i);

    const unlimited = sharedWorkspace(); unlimited.factories[0].plan.sources[0].limit = null;
    expect(() => parseWorkspace(unlimited)).toThrow(/конечн.*квот/i);

    const mined = sharedWorkspace(); mined.factories[0].plan.sources[0].kind = 'node';
    expect(() => parseWorkspace(mined)).toThrow(/внешн.*поток/i);
  });

  it('не применяет уменьшение лимита мира ниже уже сохранённых квот', () => {
    const workspace = sharedWorkspace(70, 40);
    const preview = previewWorldUpdate(workspace, { ...workspace.worlds[0], resourceNodes: [{ ...node, limit: 100 }] });
    expect(preview.resources.changed[0]).toMatchObject({ before: { limit: 120 }, after: { limit: 100 } });
    expect(() => applyWorldUpdate(workspace, preview)).toThrow(/квот.*лимит/i);
    expect(workspace.worlds[0].resourceNodes?.[0].limit).toBe(120);
  });

  it('при импорте remap-ит ID узла и ссылки фабрик на одну новую копию', () => {
    const original = sharedWorkspace();
    let serial = 0;
    const merged = mergeWorkspace(emptyWorkspace(catalog.version), original, () => `copy-${++serial}`);
    const copiedNode = merged.worlds[0].resourceNodes![0];
    expect(copiedNode.id).not.toBe(node.id);
    expect(merged.factories.map(f => f.plan.sources[0].sharedNodeId)).toEqual([copiedNode.id, copiedNode.id]);
    expect(parseWorkspace(merged)).toEqual(merged);
  });
});

describe('граница импорта новых полей P2', () => {
  it('проверяет ссылки batch, exports и lines по текущему каталогу', () => {
    const base = createDefaultPlan(catalog);
    expect(() => parseCatalogPlan({ ...base, batch: { minutes: 10, items: [{ itemId: 'missing', required: 1, stock: 0 }] } }, catalog)).toThrow(/неизвестн/i);
    expect(() => parseCatalogPlan({ ...base, exports: [{ itemId: 'missing', limit: 1, name: 'X' }] }, catalog)).toThrow(/неизвестн/i);
    expect(() => parseCatalogPlan({ ...base, lines: [{ id: 'line', name: 'X', recipeId: 'missing', count: 1, clock: 100, somersloops: 0, duty: 1, locked: true }] }, catalog)).toThrow(/неизвестн/i);
  });

  it('разрешает структуру спутников только поддерживаемой скважине', () => {
    const base = createDefaultPlan(catalog);
    const source = { id: 'well', itemId: 'water', kind: 'well', limit: null, count: 1, purity: 1, minerId: '', clock: 100 } as const;
    expect(() => parsePlan({ ...base, sources: [source] })).toThrow(/скважин/i);
    expect(() => parsePlan({ ...base, sources: [{ ...source, kind: 'node', well: { satellites: [{ purity: 1, count: 1 }] } }] })).toThrow(/скважин/i);
    expect(() => parsePlan({ ...base, sources: [{ ...source, itemId: 'iron-ore', well: { satellites: [{ purity: 1, count: 1 }] } }] })).toThrow(/скважин/i);
    expect(parsePlan({ ...base, sources: [{ ...source, well: { satellites: [{ purity: 1, count: 1 }] } }] }).sources[0].well).toBeDefined();
  });

  it('сохраняет нулевую скорость только у цели операции партии', () => {
    const base = createDefaultPlan(catalog);
    const zero = { ...base, targets: [{ ...base.targets[0], rate: 0 }] };
    expect(() => parsePlan(zero)).toThrow(/нулев/i);
    expect(parsePlan({ ...zero, batch: { minutes: 10, items: [{ itemId: base.targets[0].itemId, required: 4, stock: 4 }] } }).targets[0].rate).toBe(0);
  });
});
