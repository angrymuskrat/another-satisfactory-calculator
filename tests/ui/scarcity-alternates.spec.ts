import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';
import { chooseMaximum } from './chooseVariant';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const plan = createDefaultPlan(catalog);
plan.mode = 'target';
plan.targets[0].rate = 10;
const seed = (page: import('@playwright/test').Page) => page.addInitScript(value => {
  if (!localStorage.getItem('seeded')) { localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)); localStorage.setItem('seeded', '1'); }
}, plan);

test('веса по редкости карты по умолчанию и переключение наборов', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.locator('summary').filter({ hasText: 'Энергия и ограничения' }).click();
  await page.locator('summary').filter({ hasText: 'Веса первичного сырья' }).click();
  const uranium = page.getByLabel('Вес сырья Уран', { exact: true });
  await expect(uranium).toHaveValue('43.857');
  await expect(page.getByText('запас карты 2 100 шт/мин')).toBeVisible();
  await page.getByRole('button', { name: 'Все равны 1', exact: true }).click();
  await expect(uranium).toHaveValue('1');
  await page.getByRole('button', { name: 'По редкости карты', exact: true }).click();
  await expect(uranium).toHaveValue('43.857');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.resourceWeights.uranium)).toBe(43.857);
});

test('третья карточка и рейтинг альтернатив с разрешением рецепта', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const resources = page.getByRole('article', { name: 'Экономия редкого сырья', exact: true });
  await expect(resources.or(page.getByText('Все режимы дали одинаковый план', { exact: false })).or(page.getByText('«Экономия редкого сырья» совпадает', { exact: false })).first()).toBeVisible({ timeout: 30000 });
  await chooseMaximum(page);
  const ranking = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Что дадут альтернативы', exact: true }) });
  await ranking.getByRole('button', { name: /Проверить альтернативы/ }).click();
  const screw = ranking.getByRole('row').filter({ hasText: 'Альт.: литой винт' });
  await expect(screw).toContainText('Дешевле по порядку целей', { timeout: 60000 });
  await page.screenshot({ path: 'output/playwright/alternates-ranking.png', fullPage: true });
  await screw.getByRole('button', { name: 'Разрешить в плане', exact: true }).click();
  await expect(page.locator('.status-badge').filter({ hasText: 'Требуется пересчёт' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.enabledRecipeIds.includes('alt-screw'))).toBe(true);
});
