import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';
import { chooseMaximum } from './chooseVariant';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const plan = createDefaultPlan(catalog);
plan.mode = 'target';
plan.targets = [{ itemId: 'iron-ingot', rate: 30, weight: 1, scale: 1 }];
plan.sources = [{ id: 'iron', itemId: 'iron-ore', kind: 'flow', limit: 120, count: 1, purity: 1, minerId: 'miner-mk1', clock: 100 }];
plan.settings.enabledRecipeIds = ['iron-ingot'];
plan.settings.powerReserve = 10;

test('справка «Чем покрыть» показывает генераторы для средней мощности и пика с резервом', async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  const block = page.locator('.energy-panel details').filter({ hasText: 'Чем покрыть' });
  await block.locator('summary').click();
  await expect(block.getByRole('columnheader', { name: 'Пик + резерв' })).toBeVisible();
  await expect(block.getByRole('row', { name: /Угольный генератор/ })).toContainText('1 шт.');
  await expect(block.getByRole('row', { name: /Топливный генератор/ })).toContainText('1 шт.');
  await expect(block).toContainText('генерация не входит в оптимизацию');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await block.screenshot({ path: 'output/playwright/power-coverage-mobile.png' });
});
