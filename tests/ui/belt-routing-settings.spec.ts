import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;

test('учёт конвейеров сохраняет глубину при выключении и перезагрузке и доступен с клавиатуры', async ({ page }) => {
  await page.addInitScript(plan => {
    if (!localStorage.getItem('belt-routing-seeded')) {
      localStorage.setItem('ficsit-plan-v1', JSON.stringify(plan));
      localStorage.setItem('belt-routing-seeded', '1');
    }
  }, createDefaultPlan(catalog));
  await page.goto('/');
  const enabled = page.getByRole('checkbox', { name: 'Учитывать схемы разделителей и соединителей', exact: true });
  const depth = page.getByRole('combobox', { name: 'Максимальная глубина', exact: true });
  await expect(enabled).not.toBeChecked();
  await expect(depth).toBeDisabled();
  await expect(depth).toHaveValue('4');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.beltRouting)).toBeUndefined();

  await enabled.focus();
  await page.keyboard.press('Space');
  await expect(depth).toBeEnabled();
  await page.keyboard.press('Tab');
  await expect(depth).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(depth).toHaveValue('2');
  await enabled.focus();
  await page.keyboard.press('Space');
  await expect(depth).toBeDisabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.beltRouting)).toEqual({ enabled: false, maxDepth: 2 });

  await page.reload();
  await expect(enabled).not.toBeChecked();
  await expect(depth).toBeDisabled();
  await expect(depth).toHaveValue('2');
  await enabled.focus();
  await page.keyboard.press('Space');
  await expect(depth).toBeEnabled();
  await expect(depth).toHaveValue('2');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.beltRouting)).toEqual({ enabled: true, maxDepth: 2 });
});
