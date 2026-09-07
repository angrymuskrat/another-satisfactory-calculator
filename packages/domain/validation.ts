import { z } from 'zod';
import type { Plan } from './types';
import { validatePlanSharedResources } from './sharedResources';
const id = z.string().min(1).max(200);
const quantity = z.number().finite().min(0).max(1e9);
const positive = quantity.gt(0);
const uniqueIds = z.array(id).max(5000).refine(ids => new Set(ids).size === ids.length, 'Повторяющиеся идентификаторы');
export const worldSnapshotSchema = z.strictObject({
  id, revision: z.number().int().min(1), unlockedRecipeIds: uniqueIds, unlockedBuildingIds: uniqueIds,
  beltId: id, pipeId: id, overclockUnlocked: z.boolean(), unlockedMilestoneIds: uniqueIds,
  resourceNodes: z.array(z.strictObject({ id, name: z.string().trim().min(1).max(120), itemId: id, limit: quantity }))
    .max(1000).refine(nodes => new Set(nodes.map(node => node.id)).size === nodes.length, 'Повторяющиеся общие узлы').optional(),
});
export const planSchema = z.strictObject({
  batch: z.strictObject({ minutes: positive, items: z.array(z.strictObject({ itemId: id, required: quantity, stock: quantity })).min(1).max(256).refine(items => new Set(items.map(i => i.itemId)).size === items.length, 'Повтор позиции партии') }).optional(),
  lines: z.array(z.strictObject({ id, name: z.string().max(120), recipeId: id, count: z.number().int().min(1).max(1000000), clock: z.number().finite().min(1).max(250), somersloops: z.number().int().min(0).max(4), duty: z.number().finite().min(0).max(1), locked: z.boolean() })).max(512).refine(lines => new Set(lines.map(l => l.id)).size === lines.length, 'Повтор линии').optional(),
  expansion: z.enum(['keep', 'add', 'rebuild']).optional(),
  somersloopBudget: z.number().int().min(0).max(1000000).optional(),
  exports: z.array(z.strictObject({ itemId: id, limit: quantity, name: z.string().max(120) })).max(256).refine(items => new Set(items.map(i => i.itemId)).size === items.length, 'Повтор экспорта').optional(),
  world: worldSnapshotSchema.optional(),
  schemaVersion: z.literal(1), catalogVersion: id, name: z.string().min(1).max(120),
  mode: z.enum(['maximize', 'target']), policy: z.enum(['proportional', 'priority', 'weighted']),
  targets: z.array(z.strictObject({ itemId: id, rate: quantity, weight: positive, scale: positive,
    minRate: quantity.optional(), maxRate: quantity.nullable().optional(),
  }).refine(t => t.maxRate == null || (t.minRate ?? 0) <= t.maxRate, 'Минимум превышает максимум')).min(1).max(256)
    .refine(targets => new Set(targets.map(t => t.itemId)).size === targets.length, 'Продукт указан дважды'),
  sources: z.array(z.strictObject({
    id, name: z.string().max(120).optional(), notes: z.string().max(2000).optional(), reserve: quantity.optional(), sharedNodeId: id.optional(), importPower: quantity.nullable().optional(),
    well: z.strictObject({ satellites: z.array(z.strictObject({ purity: z.union([z.literal(0.5), z.literal(1), z.literal(2)]), count: z.number().int().min(1).max(100) })).min(1).max(32) }).optional(),
    itemId: id, kind: z.enum(['flow', 'node', 'well']), limit: quantity.nullable(),
    count: z.number().int().min(1).max(10000), purity: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
    minerId: z.string().max(200), clock: z.number().finite().min(1).max(250),
  })).max(512).refine(sources => new Set(sources.map(s => s.id)).size === sources.length, 'Повторяющиеся источники'),
  settings: z.strictObject({
    enabledRecipeIds: uniqueIds, enabledBuildingIds: uniqueIds, beltId: id, pipeId: id,
    clock: z.number().finite().min(1).max(250),
    resourcePolicy: z.enum(['listed-only', 'unlimited-unlisted']), objective: z.enum(['power', 'resources', 'buildings']),
    peakPowerLimit: quantity.nullable().optional(), powerReserve: quantity.optional(),
    buildingLimits: z.record(id, z.number().int().min(0).max(1000000)).refine(values => Object.keys(values).length <= 1000).optional(),
    powerLimit: quantity.nullable(), outputSlack: z.number().finite().min(0).max(100), allowSink: z.boolean(),
    resourceWeights: z.record(id, positive).refine(values => Object.keys(values).length <= 1000),
  }),
}).superRefine((plan, context) => {
  plan.sources.forEach((source, index) => {
    if (source.kind === 'well' && !source.well) context.addIssue({ code: 'custom', path: ['sources', index, 'well'], message: 'Для скважины нужны спутники.' });
    if (source.kind !== 'well' && source.well) context.addIssue({ code: 'custom', path: ['sources', index, 'well'], message: 'Спутники разрешены только для скважины.' });
    if (source.kind === 'well' && !['water', 'crude-oil', 'nitrogen-gas'].includes(source.itemId)) context.addIssue({ code: 'custom', path: ['sources', index, 'itemId'], message: 'Скважина не поддерживает этот ресурс.' });
  });
  if (!plan.batch) plan.targets.forEach((target, index) => {
    if (target.rate === 0) context.addIssue({ code: 'custom', path: ['targets', index, 'rate'], message: 'Нулевая скорость цели разрешена только для готовой позиции партии.' });
  });
});
export function parsePlan(value: unknown): Plan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Некорректный план: ${first.path.join('.') || 'структура файла'}. ${first.message}`);
  }
  validatePlanSharedResources(parsed.data);
  return parsed.data;
}
