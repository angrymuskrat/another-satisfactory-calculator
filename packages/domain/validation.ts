import { z } from 'zod';
import type { Plan } from './types';
const id = z.string().min(1).max(200);
const quantity = z.number().finite().min(0).max(1e9);
const positive = quantity.gt(0);
const uniqueIds = z.array(id).max(5000).refine(ids => new Set(ids).size === ids.length, 'Повторяющиеся идентификаторы');
export const planSchema = z.strictObject({
  schemaVersion: z.literal(1), catalogVersion: id, name: z.string().min(1).max(120),
  mode: z.enum(['maximize', 'target']), policy: z.enum(['proportional', 'priority', 'weighted']),
  targets: z.array(z.strictObject({ itemId: id, rate: positive, weight: positive, scale: positive })).min(1).max(256)
    .refine(targets => new Set(targets.map(t => t.itemId)).size === targets.length, 'Продукт указан дважды'),
  sources: z.array(z.strictObject({
    id, itemId: id, kind: z.enum(['flow', 'node']), limit: quantity.nullable(),
    count: z.number().int().min(1).max(10000), purity: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
    minerId: z.string().max(200), clock: z.number().finite().min(1).max(250),
  })).max(512).refine(sources => new Set(sources.map(s => s.id)).size === sources.length, 'Повторяющиеся источники'),
  settings: z.strictObject({
    enabledRecipeIds: uniqueIds, enabledBuildingIds: uniqueIds, beltId: id, pipeId: id,
    clock: z.number().finite().min(1).max(250),
    resourcePolicy: z.enum(['listed-only', 'unlimited-unlisted']), objective: z.enum(['power', 'resources']),
    powerLimit: quantity.nullable(), outputSlack: z.number().finite().min(0).max(100), allowSink: z.boolean(),
    resourceWeights: z.record(id, positive).refine(values => Object.keys(values).length <= 1000),
  }),
});
export function parsePlan(value: unknown): Plan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Некорректный план: ${first.path.join('.') || 'структура файла'}. Проверьте значения и формат.`);
  }
  return parsed.data;
}
