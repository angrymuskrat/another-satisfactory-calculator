import { gzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { createOrderLink, readOrderLink } from '../apps/web/src/orderLink';
import { createDefaultPlan } from '../packages/domain/defaults';
import type { Catalog } from '../packages/domain/types';
import { createWorld, snapshotWorld } from '../packages/domain/worlds';
import catalogJson from '../packages/game-data/catalog.json';
import { largeOrder } from './largeOrderFixture';

const catalog = catalogJson as Catalog;
const base = 'https://user:password@example.test/planner/?session=private#old';
const plainHash = (value: unknown) => '#order=1.json.' + Buffer.from(JSON.stringify(value)).toString('base64url');

afterEach(() => vi.unstubAllGlobals());

it('передаёт прежний план V1 без необязательных полей и убирает параметры и старый фрагмент адреса', async () => {
  const plan = createDefaultPlan(catalog);
  const link = await createOrderLink(plan, base);
  expect(link).toMatch(/^https:\/\/example\.test\/planner\/#order=1\.gz\.[A-Za-z0-9_-]+$/);
  expect(await readOrderLink(new URL(link).hash, catalog)).toStrictEqual(plan);
});

it('сжимает заказ на 14 продуктов и сохраняет весь снимок, включая мир и физические ограничения', async () => {
  const plan = largeOrder(catalog);
  plan.name = 'Партия № 3 — ⅓ склада';
  plan.batch = { minutes: 20, items: plan.targets.map(({ itemId, rate }) => ({ itemId, required: 20 * rate + 10, stock: 10 })) };
  plan.targets[0].minRate = 120;
  plan.sources[0].notes = 'Внешняя подача со станции';
  plan.settings.inputLimits = { 'iron-ore': 100, 'copper-ore': 0 };
  plan.settings.beltRouting = { enabled: true, maxDepth: 2 };
  plan.settings.buildingLimits = { smelter: 12 };
  plan.settings.peakPowerLimit = 450;
  plan.settings.pareto = true;
  plan.recipeProgress = { unlockIds: [catalog.unlocks![0].id] };
  plan.lines = [{ id: 'line', name: 'Резерв', recipeId: 'iron-plate', clock: 90, duty: 0.5, count: 1, locked: true, somersloops: 0 }];
  plan.world = snapshotWorld(createWorld(catalog, 'Мир', 'world-1', plan));
  expect(plan.settings.enabledRecipeIds).toHaveLength(141);
  const hash = new URL(await createOrderLink(plan, base)).hash;
  expect(hash.length).toBeLessThan(plainHash(plan).length / 2);
  expect(await readOrderLink(hash, catalog)).toStrictEqual(plan);
});

it('обрабатывает отсутствие поддержки сжатия у отправителя или получателя', async () => {
  const plan = createDefaultPlan(catalog);
  const compressed = new URL(await createOrderLink(plan, base)).hash;
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('DecompressionStream', undefined);
  const plain = new URL(await createOrderLink(plan, base)).hash;
  expect(plain).toMatch(/^#order=1\.json\./);
  expect(await readOrderLink(plain, catalog)).toStrictEqual(plan);
  await expect(readOrderLink(compressed, catalog)).rejects.toThrow(/браузер не поддерживает сжатые ссылки/i);
});

it('отклоняет повреждённые данные, неизвестную версию и посторонние фрагменты', async () => {
  const valid = new URL(await createOrderLink(createDefaultPlan(catalog), base)).hash;
  await expect(readOrderLink(valid.slice(0, -8), catalog)).rejects.toThrow(/повреждена/i);
  await expect(readOrderLink('#order=1.json.____', catalog)).rejects.toThrow(/повреждена/i);
  await expect(readOrderLink(valid + '&other=1', catalog)).rejects.toThrow(/повреждена/i);
  await expect(readOrderLink(valid.replace('#order=1.', '#order=42.'), catalog)).rejects.toThrow(/версия ссылки/i);
  await expect(readOrderLink('#something-else', catalog)).rejects.toThrow(/отсутствует заказ/i);
});

it('проверяет версию каталога, его идентификаторы и совместимость цели на полученной ссылке', async () => {
  const plan = createDefaultPlan(catalog);
  const hash = new URL(await createOrderLink(plan, base)).hash;
  await expect(readOrderLink(hash, { ...catalog, version: 'other-build' })).rejects.toThrow(/версия каталога/i);
  plan.targets[0].itemId = 'unknown-item';
  await expect(readOrderLink(plainHash(plan), catalog)).rejects.toThrow(/неизвестн/i);
  plan.settings.objective = 'resources';
  await expect(readOrderLink(plainHash(plan), catalog)).rejects.toThrow(/прежнюю цель/i);
  await expect(createOrderLink(plan, base)).rejects.toThrow(/прежнюю цель/i);
});

it('ограничивает размер фрагмента до декодирования и размер распаковываемого снимка', async () => {
  await expect(readOrderLink('#order=1.json.' + 'A'.repeat(65537), catalog)).rejects.toThrow(/слишком большой/i);
  const compressed = gzipSync(Buffer.alloc(1024 * 1024 + 1, 32)).toString('base64url');
  await expect(readOrderLink('#order=1.gz.' + compressed, catalog)).rejects.toThrow(/слишком большой/i);
});
