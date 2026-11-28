import { catalog } from './catalog';
import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Plan } from '../../packages/domain/types';
import { largeOrder } from '../largeOrderFixture';

const order = () => { const plan = createDefaultPlan(catalog); plan.settings.objective = 'smooth-power'; plan.mode = 'target'; plan.targets[0].rate = 7.5; return plan; };
async function solve(page: Page, plan: Plan) {
  await page.addInitScript(value => { if (!localStorage.getItem('ficsit-plan-v1')) localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)); }, plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  await expect(page.getByRole('region', { name: 'Табло результата', exact: true })).toBeVisible({ timeout: 60000 });
}
const board = (page: Page) => page.getByRole('region', { name: 'Табло результата', exact: true });
const markReady = (page: Page) => board(page).getByRole('button', { name: 'Отметить построенными', exact: true });
async function openLargeOrder(page: Page) {
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), largeOrder(catalog));
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await page.getByRole('region', { name: 'Рабочие планы', exact: true }).getByRole('button', { name: 'Открыть рабочий план' }).first().click({ timeout: 20000 });
  await expect(board(page)).toBeVisible({ timeout: 60000 });
}

test('1920×1080: цель, «Дальше строим», «Построено», энергия и сырьё помещаются на первом экране', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await solve(page, order());
  await page.evaluate(() => scrollTo(0, 0));
  for (const panel of ['.board-goal', '.board-next', '.board-built', '.board-energy', '.board-raw']) {
    const box = (await page.locator(panel).boundingBox())!;
    expect(box.y, panel).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, panel).toBeLessThanOrEqual(1080);
  }
  await expect(page.locator('.board-goal')).toContainText('7,5');
  await expect(page.locator('.board-goal')).toContainText('заказ 7,5 · выполнен');
  await expect(page.locator('.board-next')).toContainText('Буровая установка');
  await expect(page.locator('.board-built')).toContainText('0/ 14');
  await expect(page.locator('.board-energy')).toContainText('65,64');
  await expect(page.locator('.board-raw')).toContainText('90 / 120 шт/мин');
});

test('блоки прежнего обзора доступны в разделах под табло, «Построить» открыт первым', async ({ page }) => {
  await solve(page, order());
  const sections = page.locator('.result-sections > details');
  await expect(sections.locator('> summary h3')).toHaveText(['Построить', 'Сводка фабрики', 'Готовая продукция', 'Загрузка источников', 'Энергия']);
  await expect(sections.first()).toHaveAttribute('open', '');
  for (const heading of ['Инструкция для строительства', 'Этапы производства', 'Добытчики', 'Материалы зданий']) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  const energy = sections.filter({ has: page.getByRole('heading', { name: 'Энергия', exact: true }) });
  await expect(energy.getByText('Консервативный пик физических машин')).toBeHidden();
  await energy.locator('> summary').click();
  await expect(energy.getByText('Консервативный пик физических машин')).toBeVisible();
  const summary = sections.filter({ has: page.getByRole('heading', { name: 'Сводка фабрики', exact: true }) });
  await summary.locator('> summary').click();
  await expect(summary.getByText('Разных рецептов')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обзор', exact: true })).toHaveCount(0);
});

test('большая фабрика: «Построено» — сегментная полоса без ячейки на машину', async ({ page }) => {
  test.setTimeout(120000);
  await openLargeOrder(page);
  const total = Number((await page.locator('.board-built-count small').innerText()).replace(/\D/g, ''));
  expect(total).toBeGreaterThan(120);
  await expect(page.locator('.board-segments')).toBeVisible();
  await expect(page.locator('.board-cells i')).toHaveCount(0);
  await expect(page.locator('.board-goal')).toContainText('Ещё 9 — в разделе «Готовая продукция».');
});

test('цель на табло читается по режиму: максимум, заказ, партия', async ({ page }) => {
  await solve(page, createDefaultPlan(catalog));
  await expect(page.locator('.board-goal')).toContainText('максимум из доступного сырья');
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
  await page.getByLabel('Режим партии', { exact: true }).check();
  await page.getByLabel('Желаемое время партии, минут').fill('30');
  await page.getByLabel(/^Требуется:/).fill('100');
  await page.getByLabel(/^На складе:/).fill('40');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  await expect(page.locator('.board-goal')).toContainText('нужно 100 шт · в запасе 40 шт · 30 мин', { timeout: 60000 });
});

test('Парето: табло показывает выбранную точку', async ({ page }) => {
  test.setTimeout(90000);
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.pareto = true;
  plan.targets = [{ itemId: 'wire', rate: 30, weight: 1, scale: 1 }];
  plan.settings.enabledRecipeIds = ['iron-ingot', 'copper-ingot', 'wire', 'alt-iron-wire'];
  plan.sources = ['iron-ore', 'copper-ore'].map(itemId => ({ id: itemId, itemId, kind: 'flow' as const, limit: 100, count: 1, purity: 1 as const, minerId: '', clock: 100 }));
  await page.addInitScript(value => { if (!localStorage.getItem('ficsit-plan-v1')) localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)); }, plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await page.getByRole('region', { name: 'Компромиссы по ресурсам и энергии' }).getByRole('button', { name: /^Использовать:/ }).first().click({ timeout: 65000 });
  await expect(page.locator('.board-goal')).toContainText('заказ 30 · выполнен');
  await expect(page.locator('.board-next')).toContainText('Внешняя поставка');
  const supplied = board(page).getByRole('button', { name: 'Отметить готовой', exact: true });
  for (let i = 0; i < 4 && await supplied.count(); i++) await supplied.click();
  await expect(page.locator('.board-next')).toContainText('Готово к постройке');
  await expect(page.locator('.board-built-count')).toContainText('0/');
});

test('390×844: порядок «Цель → Дальше строим → Энергия → Сырьё», отметка с клавиатуры', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await solve(page, order());
  const tops = [];
  for (const panel of ['.board-goal', '.board-next', '.board-energy', '.board-raw']) tops.push((await page.locator(panel).boundingBox())!.y);
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await markReady(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.board-built-count')).toContainText('1/ 14');
  await page.keyboard.press('Tab');
  await expect(board(page).getByRole('button', { name: 'Показать на схеме', exact: true })).toBeFocused();
});

test('отметка с табло видна в инструкции и схеме, отметка в инструкции меняет «Дальше строим»', async ({ page }) => {
  await solve(page, order());
  const next = page.locator('.board-next');
  await expect(next).toContainText('Буровая установка');
  await markReady(page).click();
  await expect(page.locator('.board-built-count')).toContainText('1/ 14');
  await expect(next).toContainText('Плавильня');
  await expect(next).toContainText('3из 3');
  const miner = page.getByRole('checkbox', { name: 'Построено: Железная руда', exact: true });
  await expect(miner).toBeChecked();
  await page.getByRole('group', { name: 'Вид строительства' }).getByRole('button', { name: 'Схема', exact: true }).click();
  await expect(page.locator('.schematic-node[data-progress="built"]')).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('.schematic-node.next')).toContainText('Плавильня');
  await page.getByRole('group', { name: 'Вид строительства' }).getByRole('button', { name: 'Инструкция', exact: true }).click();
  await miner.uncheck();
  await expect(next).toContainText('Буровая установка');
  await expect(page.locator('.board-built-count')).toContainText('0/ 14');
});

test('все машины отмечены → «Фабрика собрана»', async ({ page }) => {
  await solve(page, order());
  for (let i = 0; i < 20 && await markReady(page).count(); i++) await markReady(page).click();
  await expect(page.locator('.board-next')).toContainText('Фабрика собрана');
  await expect(page.locator('.board-built-count')).toContainText('14/ 14');
  await expect(page.locator('.board-cells i.is-built')).toHaveCount(14);
});

test('«Показать на схеме» открывает схему и выбирает узел с меткой «Дальше»', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await solve(page, order());
  await board(page).getByRole('button', { name: 'Показать на схеме', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Вид строительства' }).getByRole('button', { name: 'Схема', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const node = page.locator('.schematic-node.next');
  await expect(node).toHaveClass(/selected/, { timeout: 30000 });
  await expect(node.locator('.schematic-next-tag')).toHaveText('Дальше');
  await expect(node).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Подробности узла' })).toContainText('Буровая установка');
});

test('схема при отдалении упрощает карточки, ручная позиция сохраняется', async ({ page }) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openLargeOrder(page);
  await page.getByRole('group', { name: 'Вид строительства' }).getByRole('button', { name: 'Схема', exact: true }).click();
  const first = page.locator('.schematic-node[data-kind="building"]').first();
  await expect(first).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Масштаб 100 процентов', exact: true }).click();
  await expect(page.locator('.schematic-node.simple')).toHaveCount(0);
  const handle = first.getByRole('button', { name: /^Переместить:/ });
  const saved = () => page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => key.startsWith('satisfactory:schematic-layout:v2:'))));
  const untouched = await saved();
  await handle.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(saved).not.toBe(untouched);
  const before = await saved();
  await page.getByRole('button', { name: 'Уместить', exact: true }).click();
  await expect(first).toHaveClass(/simple/);
  await expect(first.locator('.schematic-node-title b')).toBeVisible();
  await expect(page.locator('.schematic-edges text')).toHaveCount(0);
  await page.getByRole('button', { name: 'Масштаб 100 процентов', exact: true }).click();
  await expect(page.locator('.schematic-node.simple')).toHaveCount(0);
  expect(await saved()).toBe(before);
});
