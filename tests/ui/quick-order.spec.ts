import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
test.use({ baseURL });

test('быстрый заказ показывает сырьё и постройку, затем открывается в отдельном редакторе', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const name = page.getByRole('textbox', { name: 'Название плана' });
  await name.fill('Моя текущая фабрика');
  const open = page.getByRole('button', { name: 'Рассчитать по продукту' });
  await open.focus();
  await page.keyboard.press('Enter');
  const quick = page.getByRole('region', { name: 'Рассчитать по продукту' });
  await expect(page.getByRole('button', { name: 'Поделиться заказом' })).toHaveCount(1);
  await quick.getByRole('button', { name: 'Рассчитать заказ' }).click();
  const result = quick.getByRole('region', { name: 'Результат заказа' });
  await expect(result.getByRole('heading', { name: 'Первый производственный блок' })).toBeVisible();
  await expect(result).toContainText('20 шт/мин');
  await expect(result).toContainText('30 шт/мин');
  await expect(result).toContainText(/плавильн/i);
  const rate = quick.getByRole('textbox', { name: 'Выпуск в минуту' });
  await rate.fill('');
  await expect(result).toHaveCount(0);
  await expect(quick.getByRole('button', { name: 'Рассчитать заказ' })).toBeDisabled();
  await rate.fill('12,5');
  await quick.getByRole('button', { name: 'Расширенные настройки' }).click();
  await expect(name).toHaveValue('Железная пластина');
  await expect(page.getByRole('textbox', { name: 'Количество продукта 1' })).toHaveValue('12.5');
  await name.fill('Временный заказ');
  await expect(page.getByRole('complementary', { name: 'Активные ограничения' })).toContainText('Заданный заказ');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).name)).toBe('Моя текущая фабрика');
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true);
  await page.getByRole('button', { name: 'Вернуться к своей фабрике' }).click();
  await expect(name).toHaveValue('Моя текущая фабрика');
});

test('ссылка переносит выпуск, рецепт и лимиты в чистый браузер без записи черновика', async ({ page, browser }) => {
  const plan = createDefaultPlan(catalog);
  plan.name = 'Линия пластин';
  plan.mode = 'target';
  plan.targets = [{ itemId: 'iron-plate', rate: 20, weight: 1, scale: 1 }];
  plan.sources[0].limit = 38;
  plan.settings.inputLimits = { 'iron-ore': 33 };
  plan.settings.enabledRecipeIds = ['iron-plate', 'iron-ingot'];
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Поделиться заказом' }).click();
  const field = page.getByRole('textbox', { name: 'Ссылка на заказ' });
  await expect(field).toHaveValue(/#order=1\./);
  const url = await field.inputValue();
  const receiver = await browser.newContext();
  try {
    const other = await receiver.newPage();
    const api: string[] = [];
    other.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) api.push(req.url()); });
    await other.goto(url);
    await expect(other.getByRole('heading', { level: 1 })).toHaveText(plan.name);
    await expect(other.getByText('Версия каталога · ' + catalog.version)).toBeVisible();
    await other.getByText('Лимиты сырья', { exact: true }).click();
    await expect(other.getByText(/суммарно до 33/)).toBeVisible();
    await expect(other.getByRole('region', { name: 'Результат заказа' })).toContainText('30 шт/мин');
    await other.getByRole('button', { name: 'Расширенные настройки' }).click();
    await expect(other.getByRole('complementary', { name: 'Активные ограничения' })).toContainText('Рецептов: 2 /');
    await other.locator('.skip-link').focus();
    await other.keyboard.press('Enter');
    await expect(other.locator('#main-content')).toBeFocused();
    await expect(other).toHaveURL(url);
    await other.getByRole('textbox', { name: 'Название плана' }).fill('Копия');
    expect(await other.evaluate(() => localStorage.getItem('ficsit-plan-v1'))).toBeNull();
    expect(api).toEqual([]);
    await other.reload();
    await expect(other.getByRole('heading', { level: 1 })).toHaveText(plan.name);
    const personal = await receiver.newPage();
    await personal.goto(baseURL);
    await personal.getByRole('textbox', { name: 'Название плана' }).fill('Обновлено в другой вкладке');
    await other.getByRole('button', { name: 'Вернуться к своей фабрике' }).click();
    await expect(other.getByRole('textbox', { name: 'Название плана' })).toHaveValue('Обновлено в другой вкладке');
    expect(new URL(other.url()).hash).toBe('');
  } finally {
    await receiver.close();
  }
});

test('повреждённая ссылка оставляет имеющийся черновик доступным', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Название плана' }).fill('Личная фабрика');
  await page.evaluate(() => { location.hash = 'order=1.gz.bad'; });
  await expect(page.getByRole('alert')).toContainText('повреждена');
  await page.getByRole('button', { name: 'Вернуться к своей фабрике' }).click();
  await expect(page.getByRole('textbox', { name: 'Название плана' })).toHaveValue('Личная фабрика');
});
