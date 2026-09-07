import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Catalog } from '../../packages/domain/types';
import { createDefaultPlan } from '../../packages/domain/defaults';
import { createWorld, snapshotWorld } from '../../packages/domain/worlds';
const catalogJson = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });

test('ветки MAM, неизвестные координаты и фазы HUB остаются справочными', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Миры и фабрики', exact: true }).click();
  await page.getByRole('button', { name: 'Создать пустой мир', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить прогресс Новое прохождение', exact: true }).click();
  const guide = page.locator('.research-guide');
  await guide.locator(':scope > summary').click();
  await guide.locator('summary').filter({ hasText: /^Кварц ·/ }).click();
  const quartz = catalogJson.researchTrees!.find(t => t.id === 'BPD_ResearchTree_Quartz_C')!;
  const name = quartz.nodes.find(n => n.schematicId === 'Research_Quartz_2_C')!.name;
  await guide.locator('summary').filter({ hasText: new RegExp(`^${name}$`) }).click();
  const node = guide.locator('details').filter({ has: page.locator(':scope > summary').filter({ hasText: new RegExp(`^${name}( · завершено)?$`) }) });
  await expect(node).toContainText('неизвестная связь');
  await expect(node).toContainText('Они не считаются выполненными');
  await node.getByRole('button', { name: `Отметить завершённым: ${name}`, exact: true }).click();
  await expect(node.getByRole('button', { name: `Отметить завершённым: ${name}`, exact: true })).toBeDisabled();
  await guide.getByText('Фазы проекта и уровни HUB', { exact: true }).click();
  await expect(guide.getByRole('table', { name: 'Фазы проекта' })).toContainText('Распределительная платформа');
  await expect(guide).toContainText('предки автоматически не отмечаются');
  await page.getByRole('button', { name: 'Просмотреть изменения мира', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Просмотр изменений мира' });
  await expect(preview).toContainText(`Исследования: добавить ${name}; убрать —`);
});

test('закрытый рецепт показывает цепочку MAM и HUB без изменения мира', async ({ page }) => {
  const catalog = catalogJson as Catalog;
  const plan = createDefaultPlan(catalog);
  plan.world = snapshotWorld(createWorld(catalog, 'Закрытый мир', 'research-world'));
  await page.addInitScript(plan => localStorage.setItem('ficsit-plan-v1', JSON.stringify(plan)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рецепты', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск рецептов' }).fill('Кремнезём');
  const recipe = page.locator('.recipe-card').filter({ has: page.getByRole('heading', { name: 'Кремнезём', exact: true }) });
  await expect(recipe).toContainText('Исследование «Кремнезём»');
  await expect(recipe).toContainText('родители:');
  await expect(recipe).toContainText('фаза:');
  await expect(recipe).toContainText('справочная цепочка');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!));
  expect(saved.world.unlockedMilestoneIds).toEqual([]);
  expect(saved.world.unlockedRecipeIds).toEqual([]);
});
