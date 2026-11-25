import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Catalog, Plan } from '../../packages/domain/types';
import { largeOrder } from '../largeOrderFixture';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;

test('заказ на 14 продуктов показывает отсутствующий катерий и открывает схему после подтверждения источника', async ({ page }) => {
  test.setTimeout(90_000);
  const plan = largeOrder(catalog);
  plan.sources = plan.sources.filter(s => s.itemId !== 'caterium-ore');
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const gap = page.getByRole('region', { name: 'Недостающее снабжение' });
  const oreName = catalog.items.find(i => i.id === 'caterium-ore')!.name;
  await expect(gap).toContainText(oreName, { timeout: 35_000 });
  await gap.getByRole('button', { name: 'Добавить источник…' }).click();
  const source = gap.locator('.supply-proposal').filter({ hasText: oreName });
  await source.getByRole('combobox', { name: /Источник/ }).selectOption('');
  await source.getByLabel(/Дополнительный поток —/).fill('600');
  await gap.getByRole('button', { name: 'Проверить снабжение' }).click();
  await expect(gap).toContainText('С предложенным снабжением подтверждён выпуск.', { timeout: 30_000 });
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!) as Plan);
  expect((await draft()).sources).toHaveLength(9);
  await gap.getByRole('button', { name: 'Применить снабжение' }).click();
  await expect(gap).toBeHidden();
  expect((await draft()).sources.find(s => s.itemId === 'caterium-ore')).toMatchObject({ kind: 'flow', limit: 600 });
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const open = page.getByRole('button', { name: 'Открыть рабочий план' }).first();
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(page.getByRole('heading', { name: 'Загрузка источников' })).toBeVisible();
  expect((await draft()).settings.enabledRecipeIds).toHaveLength(141);
});
