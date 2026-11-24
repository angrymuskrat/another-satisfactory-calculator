import { describe, expect, it } from 'vitest';
import { createDefaultPlan } from '../packages/domain/defaults';
import { parsePlan } from '../packages/domain/validation';
import { parseCatalogPlan } from '../apps/web/src/planStorage';
import type { Catalog } from '../packages/domain/types';
import catalogJson from '../packages/game-data/catalog.json';

const catalog = catalogJson as Catalog;
const withRouting = (beltRouting: unknown) => {
  const plan = createDefaultPlan(catalog);
  return { ...plan, settings: { ...plan.settings, beltRouting } };
};

describe('настройки распределения конвейеров', () => {
  it('читает старый план без добавления настройки или изменения исходного объекта', () => {
    const old = createDefaultPlan(catalog);
    const original = JSON.stringify(old);
    const parsed = parsePlan(old);
    expect(parsed.settings).not.toHaveProperty('beltRouting');
    expect(JSON.stringify(parsed)).toBe(original);
    expect(JSON.stringify(old)).toBe(original);
  });

  it.each([true, false])('сохраняет глубины 1–4 при enabled=%s через JSON и импорт', enabled => {
    for (const maxDepth of [1, 2, 3, 4]) {
      const input = withRouting({ enabled, maxDepth });
      const parsed = parsePlan(JSON.parse(JSON.stringify(input)));
      expect(parsed.settings).toHaveProperty('beltRouting', { enabled, maxDepth });
      expect(parseCatalogPlan(parsed, catalog).settings).toHaveProperty('beltRouting', { enabled, maxDepth });
    }
  });

  it.each([0, 5, 1.5, '2', null, undefined, NaN, Infinity])('отклоняет глубину %s даже при выключенном учёте', maxDepth => {
    expect(() => parsePlan(withRouting({ enabled: false, maxDepth }))).toThrow(/settings\.beltRouting/);
  });

  it.each(['true', 1, null, undefined])('отклоняет enabled=%s без приведения типа', enabled => {
    expect(() => parsePlan(withRouting({ enabled, maxDepth: 2 }))).toThrow(/settings\.beltRouting/);
  });

  it.each([null, true, [], {}, { enabled: true, maxDepth: 2, extra: true }])('отклоняет неполный или нестрогий объект %j', routing => {
    expect(() => parsePlan(withRouting(routing))).toThrow(/settings\.beltRouting/);
  });
});
