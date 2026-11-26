import { catalog } from './catalog';
import { expect, test } from '@playwright/test';
import { createDefaultPlan } from '../../packages/domain/defaults';

test('нулевой выпуск пластика объясняется проверенным отводом, а выбранный получатель применяется после просмотра', async ({ page }) => {
  const plan = createDefaultPlan(catalog);
  plan.targets = [{ itemId: 'plastic', rate: 20, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'oil', itemId: 'crude-oil', kind: 'flow', limit: 30, count: 1, purity: 1, clock: 100, minerId: '' }];
  plan.settings.enabledRecipeIds = ['plastic'];
  plan.settings.enabledBuildingIds = ['oil-refinery'];
  await page.addInitScript(p => localStorage.setItem('ficsit-plan-v1', JSON.stringify(p)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const help = page.getByRole('region', { name: 'Назначение побочных продуктов' });
  await expect(help.getByRole('heading', { name: 'Что мешает выпуску?' })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => { location.hash = 'residue-heavy-oil-residue'; });
  await expect(help.getByRole('combobox', { name: 'Побочный продукт' })).toBeFocused();
  await help.getByRole('button', { name: 'Подобрать переработку' }).click();
  await expect(help.getByText(/При отводе 10 м³\/мин.*20 шт\/мин/)).toBeVisible({ timeout: 30_000 });
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!));
  expect((await draft()).exports).toBeUndefined();
  await help.getByLabel('Постоянный получатель').fill('Соседняя фабрика');
  await expect(help.getByText(/При отводе/)).toHaveCount(0);
  await help.getByRole('button', { name: 'Подобрать переработку' }).click();
  const route = help.locator('details.source-card').filter({ has: page.locator('summary', { hasText: 'Отгрузка — Соседняя фабрика' }) });
  await route.getByText('Изменения настроек перед применением').click({ timeout: 30_000 });
  expect((await draft()).exports).toBeUndefined();
  await route.getByRole('button', { name: 'Применить настройки варианта' }).click();
  await expect.poll(async () => (await draft()).exports?.[0]?.name).toBe('Соседняя фабрика');
  expect((await draft()).targets).toEqual(plan.targets);
});

test('два источника канистр суммируются для упаковки и показывают цену экономии относительно кокса', async ({ page }) => {
  const plan = createDefaultPlan(catalog);
  plan.mode = 'target';
  plan.targets = [{ itemId: 'plastic', rate: 20, weight: 1, scale: 1 }];
  plan.sources = [
    { id: 'oil', itemId: 'crude-oil', limit: 30 }, { id: 'cans-a', itemId: 'empty-canister', limit: 3 }, { id: 'cans-b', itemId: 'empty-canister', limit: 7 },
  ].map(s => ({ ...s, kind: 'flow', count: 1, purity: 1, clock: 100, minerId: '' }));
  plan.settings.enabledBuildingIds = ['oil-refinery', 'packager', 'awesome-sink'];
  plan.settings.enabledRecipeIds = ['plastic', 'petroleum-coke', 'packaged-heavy-oil-residue'];
  await page.addInitScript(p => localStorage.setItem('ficsit-plan-v1', JSON.stringify(p)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const help = page.getByRole('region', { name: 'Назначение побочных продуктов' });
  await help.getByRole('button', { name: 'Подобрать переработку' }).click({ timeout: 30_000 });
  await help.getByLabel('С чем сравнить затраты').selectOption('recipe:petroleum-coke:sink', { timeout: 30_000 });
  const packaging = help.locator('details.source-card').filter({ has: page.locator('summary', { hasText: 'Бочка мазута с ЧУДО-утилизатором' }) });
  await expect(packaging).toContainText(/14,7\d МДж/);
  await packaging.getByText('Сырьё, расходники и материалы строительства').click();
  await expect(packaging.getByRole('listitem').filter({ hasText: /Канистр.*10 шт\/мин \(\+10\)/i })).toHaveCount(1);
});
