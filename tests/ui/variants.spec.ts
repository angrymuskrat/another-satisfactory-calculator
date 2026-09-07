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
  await page.screenshot({ path: 'output/playwright/production-variants-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/production-variants-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Loading a solver again would fail: selection must use the completed result.
  await page.route(/\/solver\.worker/, route => route.abort());
  await economy.getByRole('button', { name: 'Использовать вариант', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.kpi').filter({ hasText: 'Средняя мощность' })).toContainText(power);
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
  await expect(page.locator('.construction-panel')).toContainText('сборный каркас');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!));
  expect(saved.settings.outputSlack).toBe(10);
  expect(saved.settings.smoothPowerExtraMachines).toBe(0);
  await page.getByRole('button', { name: 'Вернуться к вариантам', exact: true }).click();
  await maximum.getByRole('button', { name: 'Использовать вариант', exact: true }).click();
  await expect(page.locator('.kpi').first()).toContainText('8,888');
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.outputSlack)).toBe(0);
});

test('ошибки обоих вариантов остаются видимыми отдельно', async ({ page }) => {
  const invalid = structuredClone(plan); invalid.mode = 'target'; invalid.targets[0].rate = 1000000;
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), invalid);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(2, { timeout: 30000 });
  await expect(cards.nth(0)).toContainText('Ошибка расчёта');
  await expect(cards.nth(1)).toContainText('Ошибка расчёта');
  await expect(page.getByRole('button', { name: 'Использовать вариант' })).toHaveCount(0);
});

test('малые потоки в разных карточках не округляются в одинаковый выпуск', async ({ page }) => {
  const small = createDefaultPlan(catalog);
  small.targets = [{ itemId: 'iron-ingot', rate: 1, weight: 1, scale: 1 }];
  small.settings.enabledRecipeIds = ['iron-ingot'];
  small.sources = [{ ...plan.sources[0], limit: 0.000001 }];
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), small);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Экономия энергии', exact: true })).toContainText(/e-7/, { timeout: 10000 });
});

test('изменение плана во время расчёта отменяет запрос и исключает поздний ответ', async ({ page }) => {
  await page.goto('/');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const workerRoute = /\/solver\.worker/;
  await page.route(workerRoute, async route => { await pending; await route.continue().catch(() => {}); });
  try {
    await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
    await page.getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
    await page.getByRole('textbox', { name: 'Потеря выпуска для экономии' }).fill('7');
    await expect(page.getByRole('button', { name: 'Отменить расчёт' })).toHaveCount(0);
    release();
    await page.getByRole('button', { name: 'Результаты', exact: true }).click();
    await expect(page.getByText('Настройки изменились. Запустите подбор вариантов заново.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Использовать вариант' })).toHaveCount(0);
    await expect(page.locator('.kpi')).toHaveCount(0);
  } finally { release(); await page.unroute(workerRoute); }
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
