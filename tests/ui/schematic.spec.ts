import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog, Plan } from '../../packages/domain/types';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
async function calculate(page: Page, mode: 'target' | 'maximize' = 'target', configured?: Plan) {
  const plan = configured ?? createDefaultPlan(catalog);
  if (!configured) { plan.mode = mode; plan.settings.objective = 'smooth-power'; plan.targets[0].rate = 7.5; }
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  const fixed = plan.expansion === 'keep' && plan.lines?.every(line => line.locked);
  await expect(page.locator(fixed ? '.status-badge.optimal' : '.status-badge.approximate').first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
}

test('схема групп и отдельных машин сохраняет количество, частоту и долю работы', async ({ page }) => {
  await calculate(page);
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const group = graph.locator('.schematic-node[data-building-id="assembler"]');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('×2');
  await expect(group).toContainText('100%');
  await expect(group).toContainText('75%');
  const counts = await graph.locator('.schematic-node[data-kind="building"]').evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('data-count'))));
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  await expect(graph.locator('.schematic-node[data-building-id="assembler"]')).toHaveCount(2);
  await expect(graph.locator('.schematic-node[data-kind="building"]')).toHaveCount(counts.reduce((s, n) => s + n, 0));
  await expect(graph.locator('.schematic-node[data-kind="split"]').first()).toContainText('Разделитель');
  await expect(graph.locator('.schematic-edges text').first()).toBeAttached();
  await page.getByRole('button', { name: 'Инструкция', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Инструкция для строительства', exact: true })).toBeVisible();
  await expect(graph).toHaveCount(0);
});

function smelters(counts: number[], rates: number[]) {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.objective = 'smooth-power'; plan.expansion = 'keep';
  plan.targets = [{ itemId: 'iron-ingot', rate: rates.reduce((s, r) => s + r, 0), weight: 1, scale: 1 }];
  plan.sources = [{ id: 'ore', name: 'Общая руда', kind: 'flow', itemId: 'iron-ore', limit: 2000, count: 1, purity: 1, clock: 100, minerId: '' }];
  plan.lines = counts.map((count, i) => ({ id: `line${i}`, name: `Плавильная линия ${i + 1}`, count, clock: rates[i] / (count * 30) * 100, recipeId: 'iron-ingot', somersloops: 0, duty: 1, locked: true }));
  return plan;
}

test('четыре неравные ветви подписаны расходами и долями, переход показывает нужную машину', async ({ page }) => {
  await calculate(page, 'target', smelters([1, 1, 1, 1], [40, 30, 20, 10]));
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph.locator('.schematic-node[data-kind="building"]')).toHaveCount(4);
  await graph.locator('.schematic-node[data-kind="split"] .schematic-node-button').click();
  for (const rate of [40, 30, 20, 10]) await expect(graph.locator('.schematic-connections')).toContainText(`${rate} шт/мин · ${rate}%`);
  await graph.locator('.schematic-connections button').filter({ hasText: '40 шт/мин · 40%' }).click();
  await expect(graph.locator('.schematic-node.selected')).toContainText('133,333%');
});

test('страницы отдельных машин сохраняют общее количество и переходы', async ({ page }) => {
  await calculate(page, 'target', smelters([50], [1005]));
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph).toContainText('всего 50 зданий');
  await expect(graph.locator('.schematic-node[data-kind="building"]')).toHaveCount(48);
  await expect(graph.locator('.schematic-node[data-kind="continuation"]')).toContainText('×2');
  await graph.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(graph.locator('.schematic-node[data-kind="building"]')).toHaveCount(2);
  await expect(graph.locator('.schematic-node[data-kind="continuation"]')).toContainText('×48');
  await graph.getByRole('button', { name: 'К этим зданиям · стр. 1', exact: true }).click();
  await expect(graph.locator('.schematic-node[data-kind="building"]')).toHaveCount(48);
  await expect(graph.locator('.schematic-viewport')).toBeFocused();
});

test('малый положительный выпуск не превращается в ноль в карточке и соединениях', async ({ page }) => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.objective = 'smooth-power';
  plan.targets = [{ itemId: 'iron-ingot', rate: .0002, weight: 1, scale: 1 }];
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph.locator('.schematic-node[data-kind="product"] .schematic-flows strong')).toContainText('2.000e-4');
  await graph.locator('.schematic-node[data-kind="product"] .schematic-node-button').click();
  await expect(graph.locator('.schematic-connections')).toContainText('2.000e-4 шт/мин');
});

test('разная доля работы одного типа явно подписана как средняя при одинаковой частоте', async ({ page }) => {
  const plan = smelters([1, 1], [6, 24]);
  plan.lines!.forEach((line, i) => { line.clock = 100; line.duty = [.2, .8][i]; });
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  const node = page.locator('.schematic-node[data-building-id="smelter"]');
  await expect(node).toContainText('Средняя доля работы 50%');
  await expect(node).toContainText('Настройки различаются');
  await node.locator('button').click();
  await expect(page.locator('.schematic-configurations')).toContainText('работа 20% времени');
  await expect(page.locator('.schematic-configurations')).toContainText('работа 80% времени');
});

test('полный экран, клавиатура, список соединений и устаревание', async ({ page }) => {
  await calculate(page, 'maximize');
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  const expand = page.getByRole('button', { name: 'На весь экран', exact: true });
  await expand.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Схема строительства', exact: true });
  await expect(dialog).toBeVisible();
  const first = dialog.locator('.schematic-node-button').first();
  await first.focus(); await page.keyboard.press('Enter');
  await expect(dialog.getByRole('heading', { name: 'Соединения выбранного узла', exact: true })).toBeVisible();
  await expect(dialog.locator('.schematic-connections button').first()).toBeVisible();
  await page.screenshot({ path: 'output/playwright/schematic-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); await expect(expand).toBeFocused();
  await page.getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
  await page.getByLabel('Минимум продукта 1', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Результаты', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Схема строительства', exact: true })).toHaveCount(0);
  await expect(page.getByText('Требуется пересчёт', { exact: true })).toBeVisible();
});

test('мобильная схема прокручивается внутри полотна и сохраняет доступные элементы управления', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await calculate(page);
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await graph.scrollIntoViewIfNeeded();
  await expect(graph.getByRole('button', { name: 'Уменьшить масштаб', exact: true })).toBeVisible();
  await graph.getByRole('button', { name: 'Уменьшить масштаб', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => graph.locator('.schematic-viewport').evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/schematic-mobile.png' });
});

test('перетаскивание мышью перемещает полотно и не выбирает здание после жеста', async ({ page }) => {
  await calculate(page);
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  await viewport.scrollIntoViewIfNeeded();
  const button = graph.locator('.schematic-node-button').first();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const bounds = (await viewport.boundingBox())!;
  // Releasing just outside the viewport before crossing the drag threshold must not leave a pending gesture.
  await page.mouse.move(bounds.x + 1, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 1, bounds.y + 30);
  await page.mouse.up();
  await page.mouse.move(bounds.x + 45, bounds.y + 30);
  await expect(viewport).not.toHaveClass(/is-dragging/);
  const initialScroll = await viewport.evaluate(n => n.scrollLeft);
  await page.mouse.move(bounds.x + bounds.width - 25, bounds.y + 40);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x - 30, bounds.y + 50, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => viewport.evaluate(n => n.scrollLeft)).toBeGreaterThan(initialScroll + 100);
  await expect(viewport).not.toHaveClass(/is-dragging/);
  const stopped = await viewport.evaluate(n => n.scrollLeft);
  await page.mouse.move(bounds.x + 20, bounds.y + 40);
  expect(await viewport.evaluate(n => n.scrollLeft)).toBe(stopped);
  await graph.getByRole('button', { name: 'Снять выделение', exact: true }).click();
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  const before = await viewport.evaluate(n => ({ x: n.scrollLeft, y: n.scrollTop }));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 85, box.y + box.height / 2 - 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate(n => n.scrollLeft)).toBeGreaterThan(before.x + 70);
  await expect.poll(() => viewport.evaluate(n => n.scrollTop)).toBeGreaterThan(before.y + 45);
  await expect(graph.locator('.schematic-node.selected')).toHaveCount(0);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('колесо меняет масштаб вокруг указателя без прокрутки страницы и соблюдает пределы', async ({ page }) => {
  await calculate(page);
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  await viewport.scrollIntoViewIfNeeded();
  const box = (await viewport.boundingBox())!;
  const x = 140, y = 180;
  const position = () => viewport.evaluate((n, p) => {
    const scale = new DOMMatrix(getComputedStyle(n.querySelector('.schematic-canvas')!).transform).a;
    return { scale, x: (n.scrollLeft + p.x) / scale, y: (n.scrollTop + p.y) / scale, pageY: window.scrollY };
  }, { x, y });
  const before = await position();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await position()).scale).toBeGreaterThan(before.scale);
  const after = await position();
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  expect(after.pageY).toBe(before.pageY);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await position()).scale).toBeLessThan(after.scale);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -600);
  await expect.poll(async () => (await position()).scale).toBe(1.5);
  for (let i = 0; i < 16; i++) await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await position()).scale).toBe(.25);
});

test('только схема занимает весь диалог, сохраняет масштаб и возвращает панели через Escape', async ({ page }) => {
  await calculate(page);
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  const expand = page.getByRole('button', { name: 'На весь экран', exact: true });
  await expand.click();
  const dialog = page.getByRole('dialog', { name: 'Схема строительства', exact: true });
  await expect(dialog.getByRole('button', { name: 'Показать панели', exact: true })).toBeHidden();
  await dialog.getByRole('button', { name: 'Масштаб 100 процентов', exact: true }).click();
  await dialog.getByRole('button', { name: 'Только схема', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Показать панели', exact: true })).toBeFocused();
  await expect(dialog.locator('.schematic-controls')).toBeHidden();
  await expect(dialog.locator('.schematic-heading')).toBeHidden();
  await expect(dialog.locator('.schematic-details')).toBeHidden();
  await expect(dialog.locator('.schematic-notes').first()).toBeHidden();
  await expect.poll(() => dialog.locator('.schematic-viewport').evaluate(n => Math.abs(n.clientHeight - innerHeight))).toBeLessThan(3);
  await page.screenshot({ path: 'output/playwright/schematic-canvas-only.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Только схема', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Масштаб 100 процентов', exact: true })).toHaveText('100%');
  await dialog.getByRole('button', { name: 'Только схема', exact: true }).click();
  await dialog.getByRole('button', { name: 'Показать панели', exact: true }).click();
  await expect(dialog.locator('.schematic-controls')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(expand).toBeFocused();
});
