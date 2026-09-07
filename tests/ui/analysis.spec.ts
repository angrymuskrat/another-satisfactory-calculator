import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog, Plan } from '../../packages/domain/types';

const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
async function openPlan(page: Page, plan: Plan) {
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Спланируйте следующую фабрику' })).toBeVisible();
}
async function selectChecks(page: Page, names: RegExp[]) {
  await page.getByText(/^Проверить полезное расширение ·/).click();
  await page.getByRole('button', { name: 'Снять выбор проверок' }).click();
  for (const name of names) await page.getByRole('checkbox', { name }).check();
  await page.getByRole('button', { name: 'Проверить выбранные изменения' }).click();
  await expect(page.getByRole('heading', { name: 'Результаты сравнения', exact: true })).toBeVisible({ timeout: 25000 });
}

test('F04: области русского поиска, сворачивание клавиатурой, единицы и сравнение цепочки без изменения плана', async ({ page }) => {
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'power'; plan.mode = 'target'; plan.targets[0].rate = 10;
  await openPlan(page, plan);
  await page.getByRole('button', { name: 'Рецепты', exact: true }).click();
  await page.getByLabel('Поиск рецептов', { exact: true }).fill('винт');
  const all = await page.locator('.recipe-card').count();
  await page.getByLabel('Область поиска рецептов').selectOption('produces');
  const produces = await page.locator('.recipe-card').count();
  expect(produces).toBeGreaterThan(1); expect(produces).toBeLessThan(all);
  await page.getByLabel('Область поиска рецептов').selectOption('uses');
  expect(await page.locator('.recipe-card').count()).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: catalog.recipes.find(r => r.id === 'alt-screw')!.name, exact: true })).toHaveCount(0);
  await page.getByLabel('Область поиска рецептов').selectOption('produces');
  const summary = page.locator('.catalog-view > details > summary').first();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.recipe-card').first()).not.toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.recipe-card').first()).toBeVisible();
  await page.getByLabel('Единицы карточек рецептов').selectOption('minute');
  await page.getByLabel('Частота предпросмотра рецептов').fill('50');
  const screwName = catalog.recipes.find(r => r.id === 'screw')!.name;
  const card = page.locator('.recipe-card').filter({ has: page.getByRole('heading', { name: screwName, exact: true }) });
  await expect(card).toContainText('20 шт/мин');
  await page.getByLabel('Единицы карточек рецептов').selectOption('unit');
  await expect(card).toContainText('На 1 шт');
  const before = await page.evaluate(() => localStorage.getItem('ficsit-plan-v1'));
  const altName = catalog.recipes.find(r => r.id === 'alt-screw')!.name;
  await page.getByRole('button', { name: `Сравнить для моей фабрики: ${altName}`, exact: true }).click();
  const report = page.getByRole('region', { name: 'Результаты анализа', exact: true });
  await expect(report).toContainText('-10,4', { timeout: 25000 });
  await expect(report).toContainText('Изменённые рецепты');
  await expect(report).toContainText('Добытчики');
  expect(await page.evaluate(() => localStorage.getItem('ficsit-plan-v1'))).toBe(before);
  await page.getByLabel(`Включить рецепт ${altName}`, { exact: true }).check();
  await expect(report).toHaveCount(0);
});

test('F06: отсутствующая медь предлагается конечным внешним источником и подтверждается пересчётом', async ({ page }) => {
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
  plan.targets = [{ itemId: 'copper-ingot', rate: 10, weight: 1, scale: 1 }];
  await openPlan(page, plan);
  await selectChecks(page, [/Добавить Медная руда: внешний поток 60/]);
  const report = page.getByRole('region', { name: 'Результаты анализа', exact: true });
  await expect(report).toContainText('Нет производственного пути при текущих ограничениях');
  await expect(report).toContainText('Подтверждён рост выпуска');
  await expect(report).toContainText('энергия поставки неизвестна и исключена');
  const output = report.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Выпуск: Медный слиток,/ }) });
  await expect(output).toContainText('60');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ficsit-plan-v1')))!).sources).toHaveLength(1);
});

test('F06: одиночное насыщение двух ограничений не выдается за доказательство, совместное расширение проверено', async ({ page }) => {
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
  plan.targets = [{ itemId: 'iron-ingot', rate: 10, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'iron-flow', name: 'Подача железа', itemId: 'iron-ore', kind: 'flow', limit: 30, count: 1, purity: 1, minerId: '', clock: 100 }];
  plan.settings.powerLimit = 4;
  await openPlan(page, plan);
  await selectChecks(page, [/Подача железа: лимит 30/, /^Средняя мощность: 4/]);
  const report = page.getByRole('region', { name: 'Результаты анализа', exact: true });
  await expect(report.getByText('Улучшения не обнаружено', { exact: true })).toHaveCount(2);
  await expect(report.getByText('Подтверждён рост выпуска', { exact: true })).toHaveCount(1);
  await expect(report).toContainText('Необходимость каждого из них по отдельности не доказана');
});

test('worker анализа отменяется; поздний ответ старого плана не показывается', async ({ page }) => {
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
  await openPlan(page, plan);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/analysis\.worker.*\.js/, async route => { await pending; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Сравнить цели оптимизации' }).click();
  await expect(page.getByRole('button', { name: 'Отменить анализ' })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить анализ' }).click();
  await expect(page.getByText('Анализ отменён.', { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('region', { name: 'Результаты анализа' })).toHaveCount(0);
  await page.unroute(/analysis\.worker.*\.js/);
  // A separate in-flight run is terminated when its input changes.
  const secondPending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/analysis\.worker.*\.js/, async route => { await secondPending; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Сравнить цели оптимизации' }).click();
  await expect(page.getByRole('button', { name: 'Отменить анализ' })).toBeVisible();
  await page.getByLabel('Название плана', { exact: true }).fill('Изменён во время анализа');
  release();
  await expect(page.getByRole('button', { name: 'Отменить анализ' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Результаты анализа' })).toHaveCount(0);
  await page.unroute(/analysis\.worker.*\.js/);
  await page.getByRole('button', { name: 'Сравнить цели оптимизации' }).click();
  await expect(page.getByRole('heading', { name: 'Результаты сравнения', exact: true })).toBeVisible({ timeout: 25000 });
});
