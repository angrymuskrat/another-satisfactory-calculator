import { describe, expect, it } from 'vitest';
import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyBatch, batchEstimate } from '../packages/domain/batch';
import { BatchEditor, BatchResult } from '../apps/web/src/Batch';
import type { Catalog, Plan, Result } from '../packages/domain/types';

const catalog: Catalog = {
  version: 'test',
  provenance: { source: 'test', commit: 'test', importedAt: '2026-09-06', verified: true, notes: [] },
  items: [
    { id: 'assembly-part', name: 'Деталь сборки', nameEn: 'Assembly Part', category: 'test', fluid: false, raw: false, sinkable: true },
    { id: 'ready-part', name: 'Готовая деталь', nameEn: 'Ready Part', category: 'test', fluid: false, raw: false, sinkable: true },
  ],
  buildings: [], recipes: [], miners: [], belts: [], pipes: [], categories: [],
};

function findElement(node: ReactNode, predicate: (props: Record<string, unknown>) => boolean): any {
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (predicate(props)) return node;
    for (const child of Children.toArray(props.children as ReactNode)) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

function plan(): Plan {
  return {
    schemaVersion: 1,
    catalogVersion: 'test',
    name: 'Партия деталей лифта',
    mode: 'maximize',
    policy: 'weighted',
    targets: [{ itemId: 'old-target', rate: 999, weight: 7, scale: 3, minRate: 8, maxRate: 10 }],
    sources: [],
    settings: {
      enabledRecipeIds: [], enabledBuildingIds: [], beltId: 'belt', pipeId: 'pipe', clock: 100,
      resourcePolicy: 'listed-only', objective: 'power', powerLimit: null, outputSlack: 0,
      allowSink: false, resourceWeights: {},
    },
    batch: {
      minutes: 30,
      items: [
        { itemId: 'assembly-part', required: 100, stock: 40 },
        { itemId: 'ready-part', required: 20, stock: 25 },
      ],
    },
  };
}

function result(products: Result['products']): Result {
  return {
    status: 'optimal', message: '', products, steps: [], resources: [], surplus: [], power: 0,
    productionPower: 0, extractionPower: 0, sinkPower: 0, installedPower: 0, objectiveValue: 0,
    warnings: [], diagnostics: [], maxBalanceError: 0,
  };
}

describe('производственная партия', () => {
  it('превращает остаток 100 − 40 за 30 минут в цель 2/мин и обнуляет готовую позицию', () => {
    const input = plan();

    const applied = applyBatch(input);

    expect(applied.mode).toBe('target');
    expect(applied.policy).toBe('weighted');
    expect(applied.targets).toEqual([
      { itemId: 'assembly-part', rate: 2, weight: 1, scale: 1 },
      { itemId: 'ready-part', rate: 0, weight: 1, scale: 1, minRate: 0, maxRate: 0 },
    ]);
    expect(applied.batch).toEqual(input.batch);
    expect(input.mode).toBe('maximize');
    expect(input.targets[0].rate).toBe(999);
  });

  it('повторное применение не вычитает запас второй раз', () => {
    const once = applyBatch(plan());
    const twice = applyBatch(once);

    expect(twice.targets).toEqual(once.targets);
    expect(twice.targets[0].rate).toBe(2);
  });

  it('оценивает время по фактическому стационарному выпуску и готовые позиции считает нулевыми', () => {
    const estimate = batchEstimate(plan(), result([
      { itemId: 'assembly-part', rate: 3 },
      { itemId: 'ready-part', rate: 0 },
    ]));

    expect(estimate).toEqual({
      items: [
        { itemId: 'assembly-part', required: 100, stock: 40, remaining: 60, rate: 3, minutes: 20 },
        { itemId: 'ready-part', required: 20, stock: 25, remaining: 0, rate: 0, minutes: 0 },
      ],
      minutes: 20,
    });
  });

  it('явно отмечает отсутствующий поток бесконечностью и неизвестное общее время null', () => {
    const estimate = batchEstimate(plan(), result([]));

    expect(estimate?.items[0].minutes).toBe(Number.POSITIVE_INFINITY);
    expect(estimate?.items[1].minutes).toBe(0);
    expect(estimate?.minutes).toBeNull();
  });

  it('без описания партии ничего не преобразует и не оценивает', () => {
    const input = plan();
    delete input.batch;

    expect(applyBatch(input)).toBe(input);
    expect(batchEstimate(input, result([]))).toBeNull();
  });

  it('переключатель сохраняет новую партию отдельно от стационарных целей', () => {
    const input = plan();
    delete input.batch;
    let changed: Plan | undefined;
    const editor = BatchEditor({ catalog, plan: input, setPlan: next => { changed = next; } });
    const toggle = findElement(editor, props => props['aria-label'] === 'Режим партии');

    toggle.props.onChange({ target: { checked: true } });

    expect(changed?.batch).toEqual({ minutes: 60, items: [{ itemId: 'assembly-part', required: 100, stock: 0 }] });
    expect(changed?.mode).toBe('maximize');
    expect(changed?.targets).toEqual(input.targets);
  });

  it('редактор и результат имеют доступные поля и явно показывают готовую позицию', () => {
    const input = plan();
    const editor = renderToStaticMarkup(createElement(BatchEditor, { catalog, plan: input, setPlan: () => undefined }));
    const shown = renderToStaticMarkup(createElement(BatchResult, { catalog, plan: input, result: result([
      { itemId: 'assembly-part', rate: 3 },
    ]) }));

    expect(editor).toContain('aria-label="Режим партии"');
    expect(editor).toContain('aria-label="Желаемое время партии, минут"');
    expect(editor).toContain('aria-label="Требуется: Деталь сборки"');
    expect(editor).toContain('aria-label="На складе: Деталь сборки"');
    expect(shown).toContain('Оценка партии');
    expect(shown).toContain('20 мин');
    expect(shown).toContain('Готовая деталь');
    expect(shown).toContain('производство не требуется');
    expect(shown).toContain('после выхода фабрики на режим');
  });
});
