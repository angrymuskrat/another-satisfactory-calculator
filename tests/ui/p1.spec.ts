import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';
const catalogJson = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });

test('границы продукта, сеть и именованные источники сохраняются в черновике', async ({ page }) => {
  const plan = createDefaultPlan(catalogJson as Catalog); plan.settings.objective = 'power';
  plan.mode = 'target'; plan.targets[0].rate = 7.5;
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByLabel('Название источника 1', { exact: true }).fill('Железо у озера');
  await page.getByLabel('Минимум продукта 1', { exact: true }).fill('5');
  await page.getByLabel('Без максимума продукта 1', { exact: true }).uncheck();
  await page.getByLabel('Максимум продукта 1', { exact: true }).fill('10');
  await expect(page.getByText('Доступно:', { exact: false }).first()).toContainText('120');
  await page.locator('summary').filter({ hasText: 'Цели и ограничения' }).click();
  await page.getByLabel('Без ограничения максимальной нагрузки', { exact: true }).uncheck();
  await page.getByLabel('Максимальная нагрузка сети', { exact: true }).fill('70');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заказ невыполним', exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Максимальная нагрузка сети', { exact: true }).fill('100');
  await page.getByLabel('Резерв сети', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.locator('.results-heading').getByText('Оптимум найден', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.results-column')).toContainText('Железо у озера');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!));
  expect(saved.targets[0]).toMatchObject({ minRate: 5, maxRate: 10 });
  expect(saved.settings).toMatchObject({ peakPowerLimit: 100, powerReserve: 5 });
  expect(saved.sources[0].name).toBe('Железо у озера');
});

test('одна цель не показывает распределение; новая цель получает обязательный минимум', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Распределение между продуктами')).toHaveCount(0);
  await expect(page.getByLabel('Количество продукта 1', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Активные ограничения')).toContainText('Максимум выпуска');
  await page.getByRole('button', { name: 'Добавить продукт', exact: true }).click();
  await page.getByLabel('Распределение между продуктами').selectOption('weighted');
  await expect(page.getByLabel('Минимум продукта 2', { exact: true })).toBeVisible();
  await page.getByLabel('Минимум продукта 2', { exact: true }).fill('5');
  await page.getByLabel('Без максимума продукта 2', { exact: true }).uncheck();
  await page.getByLabel('Максимум продукта 2', { exact: true }).fill('2');
  await expect(page.getByRole('alert')).toContainText('Минимум превышает максимум');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ошибка расчёта', exact: true })).toBeVisible({ timeout: 30000 });
});

test('лимит другого здания не включает неявный лимит конструктора', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Технологии', exact: true }).click();
  const smelter = catalogJson.buildings.find(b => b.id === 'smelter')!.name;
  const constructor = catalogJson.buildings.find(b => b.id === 'constructor')!.name;
  await page.getByRole('checkbox', { name: `Ограничить количество: ${smelter}`, exact: true }).check();
  await page.getByLabel(`Лимит зданий: ${smelter}`, { exact: true }).fill('2');
  await expect(page.getByRole('checkbox', { name: `Ограничить количество: ${constructor}`, exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: `Ограничить количество: ${smelter}`, exact: true }).uncheck();
  await expect(page.getByRole('checkbox', { name: `Ограничить количество: ${constructor}`, exact: true })).not.toBeChecked();
});
