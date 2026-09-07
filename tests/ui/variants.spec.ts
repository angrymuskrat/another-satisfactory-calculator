import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const plan = createDefaultPlan(catalog);
plan.targets = [{ itemId: 'modular-frame', rate: 1, weight: 1, scale: 1 }];
plan.sources = ['iron-ore', 'copper-ore'].map((itemId, index) => ({ id: itemId, itemId, kind: 'flow', limit: index ? 60 : 120, count: 1, purity: 1, minerId: 'miner-mk1', clock: 100 }));
plan.settings.enabledRecipeIds = ['iron-ingot', 'copper-ingot', 'iron-plate', 'iron-rod', 'wire', 'screw', 'reinforced-iron-plate', 'modular-frame', 'alt-modular-frame2', 'alt-stitched-iron-plate', 'alt-screw', 'alt-iron-wire', 'alt-bolted-iron-plate'];
plan.settings.beltId = 'belt2';

test('выбор экономичного варианта сохраняет его настройки и открывает именно его схему', async ({ page }) => {
  await page.addInitScript(value => { if (!localStorage.getItem('seeded')) { localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)); localStorage.setItem('seeded', '1'); } }, plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Варианты производства', exact: true })).toBeVisible();
  const maximum = page.getByRole('article', { name: 'Максимальный выпуск', exact: true });
  const economy = page.getByRole('article', { name: 'Экономия энергии', exact: true });
  await expect(maximum).toContainText('8,888', { timeout: 30000 });
  await expect(economy.getByRole('button', { name: 'Использовать вариант', exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Построить', exact: true })).toHaveCount(0);
  const power = await economy.locator('[data-metric="power"]').innerText();
  // Loading a solver again would fail: selection must use the completed result.
  await page.route(/\/solver\.worker/, route => route.abort());
  await economy.getByRole('button', { name: 'Использовать вариант', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.kpi').filter({ hasText: 'Средняя мощность' })).toContainText(power);
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
  await expect(page.locator('.construction')).toContainText('сборный каркас');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!));
  expect(saved.settings.outputSlack).toBe(10);
  expect(saved.settings.smoothPowerExtraMachines).toBe(0);
  await page.getByRole('button', { name: 'Вернуться к вариантам', exact: true }).click();
  await maximum.getByRole('button', { name: 'Использовать вариант', exact: true }).click();
  await expect(page.locator('.kpi').first()).toContainText('8,888');
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.outputSlack)).toBe(0);
});

test('изменённые настройки запрещают выбор старого варианта; настройки сравнения сохраняются', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.getByRole('article').first().getByRole('button', { name: 'Использовать вариант' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
  await page.getByRole('textbox', { name: 'Потеря выпуска для экономии', exact: true }).fill('7');
  await page.getByRole('textbox', { name: 'Дополнительные машины для экономии', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Результаты', exact: true }).click();
  await expect(page.getByText('Требуется пересчёт', { exact: true })).toBeVisible();
  for (const button of await page.getByRole('button', { name: 'Использовать вариант' }).all()) await expect(button).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Потеря выпуска для экономии' })).toHaveValue('7');
  await expect(page.getByRole('textbox', { name: 'Дополнительные машины для экономии' })).toHaveValue('2');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
