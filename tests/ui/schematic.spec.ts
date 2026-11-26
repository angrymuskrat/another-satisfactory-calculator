import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog, Plan } from '../../packages/domain/types';
import type { Locator } from '@playwright/test';

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

const closeView = (graph: Locator) => graph.getByRole('button', { name: 'Масштаб 100 процентов', exact: true }).click();

test('схема групп сохраняет количество, частоту и долю работы', async ({ page }) => {
  await calculate(page);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const group = graph.locator('.schematic-node[data-building-id="assembler"]');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('×2');
  await closeView(graph);
  await expect(group).toContainText('Частота 75%');
  await group.locator('.schematic-node-button').click();
  await expect(graph.locator('.schematic-details')).toContainText('Частота 75% · Работа 100% времени');
  await expect(graph.locator('.schematic-node[data-kind="split"], .schematic-node[data-kind="merge"]')).toHaveCount(0);
  await expect(graph.locator('.schematic-edges text').first()).toBeAttached();
  await expect(graph.locator('.schematic-notes').first()).toContainText('Связи идут напрямую от поставщиков к потребителям');
  for (const note of await graph.locator('.schematic-notes').all()) await expect(note).not.toContainText('условн');
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

test('конструкторы пластин и прутов показаны разными группами', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const plan = createDefaultPlan(catalog); plan.mode = 'target';
  plan.targets = ['iron-plate', 'iron-rod'].map(itemId => ({ itemId, rate: 20, weight: 1, scale: 1 }));
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  await expect(page.locator('.schematic-node[data-building-id="constructor"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Схема строительства', exact: true });
  await dialog.getByRole('button', { name: 'Уместить', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/schematic-recipe-branches.png' });
});

test('малый положительный выпуск не превращается в ноль в карточке и соединениях', async ({ page }) => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.objective = 'smooth-power';
  plan.targets = [{ itemId: 'iron-ingot', rate: .0002, weight: 1, scale: 1 }];
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await closeView(graph);
  await expect(graph.locator('.schematic-node[data-kind="product"] .schematic-flows strong')).toContainText('2.000e-4');
  await graph.locator('.schematic-node[data-kind="product"] .schematic-node-button').click();
  await expect(graph.locator('.schematic-connections')).toContainText('2.000e-4 шт/мин');
});

test('разная доля работы одного типа явно подписана как средняя при одинаковой частоте', async ({ page }) => {
  const plan = smelters([1, 1], [6, 24]);
  plan.lines!.forEach((line, i) => { line.clock = 100; line.duty = [.2, .8][i]; });
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const node = page.locator('.schematic-node[data-building-id="smelter"]');
  await node.locator('.schematic-node-button').click();
  await expect(page.locator('.schematic-details')).toContainText('Средняя доля работы 50%');
  await expect(page.locator('.schematic-details')).toContainText('Настройки различаются');
  await expect(page.locator('.schematic-configurations')).toContainText('работа 20% времени');
  await expect(page.locator('.schematic-configurations')).toContainText('работа 80% времени');
});

test('стройка связывает поставку, группу зданий и инструкцию', async ({ page }) => {
  await calculate(page, 'target', smelters([4], [120]));
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства' });
  const smelter = graph.locator('[data-building-id="smelter"]');
  await expect(smelter).toHaveAttribute('data-progress', 'waiting');
  await expect(smelter).toHaveClass(/(^| )waiting( |$)/);
  await closeView(graph);
  await smelter.getByRole('button', { name: /^Ждёт/ }).click();
  const source = graph.locator('[data-kind="source"]');
  await expect(source.locator('.schematic-node-button')).toBeFocused();
  await source.getByRole('checkbox').check();
  await graph.getByLabel('Подсветить: можно строить', { exact: true }).check();
  await expect(graph.locator('[data-building-id="smelter"][data-progress="ready"]')).toHaveCount(1);
  await smelter.getByRole('checkbox').check();
  await expect(smelter).toContainText('Построено 4 из 4');
  await page.getByRole('button', { name: 'Инструкция', exact: true }).click();
  const group = page.getByRole('checkbox', { name: /^Построено: Плавильная линия/ });
  await expect(group).toBeChecked();
  await group.uncheck();
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  await closeView(graph);
  await expect(graph.locator('[data-building-id="smelter"]')).toContainText('Построено 0 из 4');
});

test('подробности узла видны от 100%, а флажок близкого узла меняет счётчик инструкции', async ({ page }) => {
  await calculate(page, 'target', smelters([4], [120]));
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства' });
  const smelter = graph.locator('[data-building-id="smelter"]');
  await expect(graph.getByRole('button', { name: 'Масштаб 100 процентов', exact: true })).toHaveText('90%');
  await expect(smelter).toContainText('×4');
  await expect(smelter).not.toContainText('⚡');
  await expect(smelter).not.toContainText('Построено');
  await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await expect(graph.getByRole('button', { name: 'Масштаб 100 процентов', exact: true })).toHaveText('100%');
  await expect(smelter).toContainText('⚡');
  await expect(smelter).toContainText('Построено 0 из 4');
  await smelter.getByRole('checkbox', { name: /^Построено/ }).check();
  await expect(smelter).toContainText('Построено 4 из 4');
  await page.getByRole('button', { name: 'Инструкция', exact: true }).click();
  await expect(page.getByText('Построено: Плавильная линия 1 · 4 из 4')).toBeVisible();
});

test('боковая панель отмечает первые n зданий узла, а близкая карточка и инструкция видят то же', async ({ page }) => {
  await calculate(page, 'target', smelters([4], [120]));
  const types = page.getByRole('button', { name: 'Схема', exact: true });
  await types.click();
  const graph = page.getByRole('region', { name: 'Схема строительства' });
  const smelter = graph.locator('[data-building-id="smelter"]'), details = graph.locator('.schematic-details');
  await smelter.locator('.schematic-node-button').click();
  const count = details.getByRole('spinbutton', { name: /^Построено зданий/ }), all = details.getByRole('checkbox', { name: /^Построено/ });
  await expect(count).toHaveValue('0');
  await expect(details.locator('.schematic-progress')).toContainText('из 4');
  await count.fill('3');
  await expect(count).toHaveValue('3');
  await expect(all).toHaveJSProperty('indeterminate', true);
  await details.getByRole('button', { name: /^Добавить одно здание/ }).click();
  await expect(count).toHaveValue('4');
  await expect(all).toBeChecked();
  await details.getByRole('button', { name: /^Убрать одно здание/ }).click();
  await expect(count).toHaveValue('3');
  await closeView(graph);
  await expect(smelter).toContainText('Построено 3 из 4');
  await page.getByRole('button', { name: 'Инструкция', exact: true }).click();
  await expect(page.getByText('Построено: Плавильная линия 1 · 3 из 4')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Построено: Плавильная линия/ })).toHaveJSProperty('indeterminate', true);
  await types.click();
  await smelter.locator('.schematic-node-button').click();
  await expect(count).toHaveValue('3');
  await all.check();
  await expect(count).toHaveValue('4');
});

test('ручка двигает карточку мышью и клавиатурой, сохраняет положение и обновляет стрелку', async ({ page }) => {
  await calculate(page, 'target', smelters([1], [30]));
  const types = page.getByRole('button', { name: 'Схема', exact: true });
  await types.click();
  const graph = page.getByRole('region', { name: 'Схема строительства' });
  const card = graph.locator('[data-building-id="smelter"]'), handle = card.getByRole('button', { name: /^Переместить/ });
  const position = () => card.evaluate(n => Number.parseFloat(n.style.left));
  await handle.scrollIntoViewIfNeeded();
  const initial = await position();
  const edge = graph.locator('g[data-item-id="ore"], g[data-item-id="iron-ore"]').first().locator('path').first();
  const original = await edge.getAttribute('d');
  await handle.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(position).toBe(initial + 12);
  await expect(edge).not.toHaveAttribute('d', original!);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await expect.poll(position).toBeCloseTo(initial + 62);
  await expect.poll(position).toBeCloseTo(initial + 62);
  await page.reload();
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
  await types.click();
  await expect.poll(position).toBeCloseTo(initial + 62);
  await graph.getByRole('button', { name: 'Вернуть автораскладку' }).click();
  await expect.poll(position).toBe(initial);
  await expect(edge).toHaveAttribute('d', original!);
});

test('ссылка из ожидания выбирает поставщика на той же схеме', async ({ page }) => {
  const plan = smelters([50], [1500]);
  plan.targets = [{ itemId: 'iron-plate', rate: 1000, weight: 1, scale: 1 }];
  plan.lines!.push({ id: 'plates', name: 'Пластины', count: 50, clock: 100, recipeId: 'iron-plate', somersloops: 0, locked: true, duty: 1 });
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства' });
  await closeView(graph);
  await graph.locator('[data-kind="building"][data-building-id="constructor"]').getByRole('button', { name: /^Ждёт/ }).click();
  const selected = graph.locator('[data-building-id="smelter"].selected');
  await expect(selected).toHaveCount(1);
  await expect(selected.locator('.schematic-node-button')).toBeFocused();
});

test('ссылка у НПЗ выводит из полноэкранной схемы к переработке его мазута', async ({ page }) => {
  const plan = createDefaultPlan(catalog);
  plan.mode = 'target';
  plan.targets = [{ itemId: 'plastic', rate: 20, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'oil', itemId: 'crude-oil', kind: 'flow', limit: 30, count: 1, purity: 1, clock: 100, minerId: '' }];
  plan.exports = [{ itemId: 'heavy-oil-residue', limit: 10, name: 'Топливный цех' }];
  plan.settings.enabledRecipeIds = ['plastic'];
  plan.settings.enabledBuildingIds = ['oil-refinery'];
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'Схема' }).click();
  await page.getByRole('button', { name: 'На весь экран' }).click();
  const dialog = page.getByRole('dialog', { name: 'Схема строительства' });
  await dialog.locator('[data-building-id="oil-refinery"] .schematic-node-button').click();
  const link = dialog.getByRole('link', { name: 'Подобрать переработку — Мазут' });
  await expect(link).toHaveAttribute('href', '#residue-heavy-oil-residue');
  await link.click();
  await expect(dialog).not.toBeVisible();
  const residue = page.getByRole('combobox', { name: 'Побочный продукт', exact: true });
  await expect(residue).toBeFocused();
  await expect(residue).toHaveValue('heavy-oil-residue');
});

test('полный экран, клавиатура, список соединений и устаревание', async ({ page }) => {
  await calculate(page, 'maximize');
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
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
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await graph.scrollIntoViewIfNeeded();
  await expect(graph.getByRole('button', { name: 'Уменьшить масштаб', exact: true })).toBeVisible();
  await graph.getByRole('button', { name: 'Уменьшить масштаб', exact: true }).click();
  await expect.poll(() => graph.locator('.schematic-viewport').evaluate(viewport => {
    const frame = viewport.getBoundingClientRect();
    return [...viewport.querySelectorAll('.schematic-node')].some(node => {
      const rect = node.getBoundingClientRect();
      return rect.top < frame.bottom - 50 && rect.bottom > frame.top + 50 && rect.left < frame.right && rect.right > frame.left;
    });
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => graph.locator('.schematic-viewport').evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/schematic-mobile.png' });
});

// Six products share the last column, so the close layout overflows the viewport vertically.
function wideFactory() {
  const plan = createDefaultPlan(catalog); plan.mode = 'target';
  plan.targets = ['iron-plate', 'iron-rod', 'screw', 'reinforced-iron-plate', 'rotor', 'modular-frame'].map(itemId => ({ itemId, rate: 1, weight: 1, scale: 1 }));
  return plan;
}

test('перетаскивание мышью перемещает полотно и не выбирает здание после жеста', async ({ page }) => {
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  await viewport.scrollIntoViewIfNeeded();
  for (let i = 0; i < 6; i++) await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await expect(graph.getByRole('button', { name: 'Масштаб 100 процентов', exact: true })).toHaveText('150%');
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

test('вся карточка выделяет здание, а перетаскивание за её нижнюю часть не выделяет', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await calculate(page);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph.locator('.schematic-canvas')).toHaveAttribute('data-layout', 'elk');
  await closeView(graph);
  const card = graph.locator('.schematic-node[data-kind="building"]').first();
  for (const selector of ['.schematic-settings', '.schematic-flows', '.schematic-power']) {
    const part = card.locator(selector).first();
    await part.scrollIntoViewIfNeeded();
    const box = (await part.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(card.locator('.schematic-node-button')).toHaveAttribute('aria-pressed', 'true');
    await graph.getByRole('button', { name: 'Снять выделение', exact: true }).click();
  }
  const footer = card.locator('.schematic-power');
  await footer.scrollIntoViewIfNeeded();
  const box = (await footer.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 45, { steps: 6 });
  await page.mouse.up();
  await expect(graph.locator('.schematic-node.selected')).toHaveCount(0);
  const button = card.locator('.schematic-node-button');
  await button.focus(); await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await graph.getByRole('button', { name: 'На весь экран', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Схема строительства', exact: true });
  await dialog.getByRole('button', { name: 'Уместить', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/schematic-elk-fit.png' });
});

test('при переходе через 100% выбранный узел остаётся на месте экрана', async ({ page }) => {
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const node = graph.locator('.schematic-node[data-building-id="assembler"]').first();
  await node.scrollIntoViewIfNeeded();
  const scrolled = await graph.locator('.schematic-viewport').evaluate(n => n.scrollLeft);
  await node.locator('.schematic-node-button').click();
  const before = (await node.boundingBox())!;
  await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await expect(graph.locator('.schematic-canvas')).toHaveAttribute('data-level', 'close');
  const after = (await node.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(3);
  expect(await graph.locator('.schematic-viewport').evaluate(n => n.scrollLeft)).toBeGreaterThan(scrolled);
  // Scroll stops at 0 and at the bottom; vertically the node stays put only when neither limit is hit.
  const free = await graph.locator('.schematic-viewport').evaluate(n => n.scrollTop > 0 && n.scrollTop < n.scrollHeight - n.clientHeight);
  if (free) expect(Math.abs(after.y - before.y)).toBeLessThan(3);
});

test('при уменьшении через 100% выбранный узел остаётся на месте экрана', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  await closeView(graph);
  await expect(graph.locator('.schematic-canvas')).toHaveAttribute('data-level', 'close');
  await viewport.scrollIntoViewIfNeeded();
  await viewport.evaluate(n => n.scrollTo((n.scrollWidth - n.clientWidth) / 2, (n.scrollHeight - n.clientHeight) / 2));
  // The fully visible card nearest to the centre of the canvas.
  const id = await viewport.evaluate(n => {
    const frame = n.getBoundingClientRect(), right = frame.left + n.clientWidth, bottom = frame.top + n.clientHeight;
    const x = frame.left + n.clientWidth / 2, y = frame.top + n.clientHeight / 2;
    const inside = [...n.querySelectorAll<HTMLElement>('[data-node-id]')].map(e => ({ id: e.dataset.nodeId!, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.left > frame.left && r.right < right && r.top > frame.top && r.bottom < bottom);
    const distance = (r: DOMRect) => Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
    return inside.sort((a, b) => distance(a.r) - distance(b.r))[0].id;
  });
  const node = graph.locator(`[data-node-id=${JSON.stringify(id)}]`);
  await node.locator('.schematic-node-button').click();
  const before = (await node.boundingBox())!;
  await graph.getByRole('button', { name: 'Уменьшить масштаб', exact: true }).click();
  await expect(graph.locator('.schematic-canvas')).toHaveAttribute('data-level', 'medium');
  const after = (await node.boundingBox())!;
  const free = await viewport.evaluate(n => ({ x: n.scrollLeft > 0 && n.scrollLeft < n.scrollWidth - n.clientWidth, y: n.scrollTop > 0 && n.scrollTop < n.scrollHeight - n.clientHeight }));
  expect(free.x || free.y).toBe(true);
  if (free.x) expect(Math.abs(after.x - before.x)).toBeLessThan(4);
  if (free.y) expect(Math.abs(after.y - before.y)).toBeLessThan(4);
});

test('колесо меняет масштаб вокруг указателя без прокрутки страницы и соблюдает пределы', async ({ page }) => {
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  const x = 140, y = 180;
  const position = () => viewport.evaluate((n, p) => {
    const scale = new DOMMatrix(getComputedStyle(n.querySelector('.schematic-canvas')!).transform).a;
    return { scale, x: (n.scrollLeft + p.x) / scale, y: (n.scrollTop + p.y) / scale, pageY: window.scrollY };
  }, { x, y });
  // Start at 120%: the wheel step stays within the close layout, which then overflows vertically.
  await closeView(graph);
  for (let i = 0; i < 2; i++) await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await expect(graph.getByRole('button', { name: 'Масштаб 100 процентов', exact: true })).toHaveText('120%');
  // Measured after the toolbar clicks: the full-height canvas makes them scroll the page.
  await viewport.scrollIntoViewIfNeeded();
  const box = (await viewport.boundingBox())!;
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
  // The lower limit is the medium «Уместить» zoom: the whole factory fits and fills one side, capped at 90% and never below 10%.
  for (let i = 0; i < 16; i++) await page.mouse.wheel(0, 600);
  await expect.poll(() => viewport.evaluate(n => {
    const canvas = n.querySelector<HTMLElement>('.schematic-canvas')!, scale = new DOMMatrix(getComputedStyle(canvas).transform).a;
    const width = Number.parseFloat(canvas.style.width) * scale, height = Number.parseFloat(canvas.style.height) * scale;
    const filled = n.clientWidth - width < 2 || n.clientHeight - height < 2 || Math.abs(scale - .9) < 1e-6 || Math.abs(scale - .1) < 1e-6;
    return canvas.dataset.level === 'medium' && width <= n.clientWidth && height <= n.clientHeight && filled;
  })).toBe(true);
  await expect(graph.getByRole('button', { name: 'Уменьшить масштаб', exact: true })).toBeDisabled();
});

test('при переходе колесом через 100% узел под указателем остаётся на месте экрана', async ({ page }) => {
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  await expect(graph.locator('.schematic-canvas')).toHaveAttribute('data-level', 'medium');
  await viewport.scrollIntoViewIfNeeded();
  // The rightmost fully visible card leaves room to scroll after the switch.
  const id = await viewport.evaluate(n => {
    const frame = n.getBoundingClientRect(), right = frame.left + n.clientWidth, bottom = frame.top + n.clientHeight;
    const inside = [...n.querySelectorAll<HTMLElement>('[data-node-id]')].map(e => ({ id: e.dataset.nodeId!, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.left > frame.left && r.right < right && r.top > frame.top && r.bottom < bottom);
    return inside.sort((a, b) => b.r.left - a.r.left || b.r.top - a.r.top)[0].id;
  });
  const node = graph.locator(`[data-node-id=${JSON.stringify(id)}]`);
  await expect(graph.locator('.schematic-node.selected')).toHaveCount(0);
  const before = (await node.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.wheel(0, -120);
  await expect(graph.locator('.schematic-canvas')).toHaveAttribute('data-level', 'close');
  const after = (await node.boundingBox())!;
  const free = await viewport.evaluate(n => ({ x: n.scrollLeft > 0 && n.scrollLeft < n.scrollWidth - n.clientWidth, y: n.scrollTop > 0 && n.scrollTop < n.scrollHeight - n.clientHeight }));
  expect(free.x || free.y).toBe(true);
  if (free.x) expect(Math.abs(after.x - before.x)).toBeLessThan(4);
  if (free.y) expect(Math.abs(after.y - before.y)).toBeLessThan(4);
  await expect(graph.locator('.schematic-node.selected')).toHaveCount(0);
});

test('на 1440×900 полотно выше 600 px, панель справа, а «Уместить» показывает все узлы', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport'), details = graph.locator('.schematic-details');
  await expect(graph.locator('.schematic-node').first()).toBeVisible();
  expect(await viewport.evaluate(n => n.clientHeight)).toBeGreaterThan(600);
  await expect(details).toHaveText('Выберите узел, чтобы увидеть подробности.');
  const [canvasBox, panelBox] = [(await viewport.boundingBox())!, (await details.boundingBox())!];
  expect(Math.abs(panelBox.width - 280)).toBeLessThan(2);
  expect(panelBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width - 1);
  await expect(graph.locator('.schematic-hint')).toHaveCount(0);
  await expect(graph.getByRole('button', { name: 'Только схема', exact: true })).toHaveCount(0);
  for (const note of await graph.locator('.schematic-notes').all()) await expect(note).not.toHaveAttribute('open');
  await graph.getByRole('button', { name: 'Уместить', exact: true }).click();
  await expect.poll(() => viewport.evaluate(n => {
    const frame = n.getBoundingClientRect(), right = frame.left + n.clientLeft + n.clientWidth, bottom = frame.top + n.clientTop + n.clientHeight;
    return [...n.querySelectorAll('[data-node-id]')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.left < frame.left - 1 || r.top < frame.top - 1 || r.right > right + 1 || r.bottom > bottom + 1;
    }).length;
  })).toBe(0);
  await graph.locator('.schematic-help summary').click();
  await expect(graph.locator('.schematic-help')).toContainText('Колесо меняет масштаб.');
  await page.screenshot({ path: 'output/playwright/schematic-1440-fit.png' });
});

test('Enter в поиске выделяет совпадения по очереди и прокручивает к ним', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  for (let i = 0; i < 6; i++) await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await expect(graph.getByRole('button', { name: 'Масштаб 100 процентов', exact: true })).toHaveText('150%');
  await viewport.evaluate(n => n.scrollTo(0, 0));
  const search = graph.getByRole('searchbox', { name: 'Найти на схеме', exact: true }), count = graph.locator('.schematic-search-count');
  await search.fill('модульный каркас');
  await expect(count).toHaveText(/^0 из [2-9]$/);
  const total = Number((await count.textContent())!.split(' из ')[1]);
  const visible = () => viewport.evaluate(n => {
    const frame = n.getBoundingClientRect(), node = n.querySelector('.schematic-node.selected')!.getBoundingClientRect();
    return node.left >= frame.left - 1 && node.top >= frame.top - 1 && node.right <= frame.left + n.clientWidth + 1 && node.bottom <= frame.top + n.clientHeight + 1;
  });
  const seen = new Set<string>();
  for (let i = 1; i <= total; i++) {
    await search.press('Enter');
    await expect(count).toHaveText(`${i} из ${total}`);
    const selected = graph.locator('.schematic-node.selected');
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText('Модульный каркас');
    expect(await visible()).toBe(true);
    seen.add((await selected.getAttribute('data-node-id'))!);
  }
  expect(seen.size).toBe(total);
  expect(await viewport.evaluate(n => n.scrollLeft)).toBeGreaterThan(0);
  await expect(search).toBeFocused();
  await search.press('Enter');
  await expect(count).toHaveText(`1 из ${total}`);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(count).toHaveCount(0);
});

test('Escape в поиске полноэкранной схемы очищает запрос и не закрывает окно', async ({ page }) => {
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Схема строительства', exact: true });
  const search = dialog.getByRole('searchbox', { name: 'Найти на схеме', exact: true });
  await search.fill('модульный каркас');
  await expect(dialog.locator('.schematic-search-count')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(dialog.locator('.schematic-search-count')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await search.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('щелчок и перетаскивание по мини-карте двигают полотно, колесо над ней меняет масштаб', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await calculate(page, 'target', wideFactory());
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport');
  for (let i = 0; i < 6; i++) await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await viewport.evaluate(n => n.scrollTo(0, 0));
  const map = graph.locator('.schematic-minimap svg');
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(181); expect(box.height).toBeLessThanOrEqual(121);
  const frame = (await viewport.boundingBox())!;
  expect(box.x - frame.x).toBeLessThan(40); expect(frame.y + frame.height - box.y - box.height).toBeLessThan(40);
  const scroll = () => viewport.evaluate(n => ({ x: n.scrollLeft, y: n.scrollTop }));
  const end = await viewport.evaluate(n => ({ x: n.scrollWidth - n.clientWidth, y: n.scrollHeight - n.clientHeight }));
  expect(end.x).toBeGreaterThan(0);
  // The bottom-right corner of the map is the end of the canvas on both axes.
  await page.mouse.click(box.x + box.width - 1, box.y + box.height - 1);
  await expect.poll(scroll).toEqual(end);
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2, box.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(scroll).toEqual({ x: 0, y: 0 });
  const pageY = await page.evaluate(() => scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 240);
  await expect(graph.getByRole('button', { name: 'Масштаб 100 процентов', exact: true })).not.toHaveText('150%');
  expect(await page.evaluate(() => scrollY)).toBe(pageY);
});

test('на телефоне выбор узла открывает нижний лист, а полотно остаётся прокручиваемым', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await calculate(page);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const viewport = graph.locator('.schematic-viewport'), details = graph.locator('.schematic-details');
  await expect(graph.locator('.schematic-node').first()).toBeVisible();
  await expect(details).toBeHidden();
  await graph.locator('.schematic-node-button').first().click();
  await expect(details).toBeVisible();
  await expect(details).toContainText('Соединения выбранного узла');
  const sheet = (await details.boundingBox())!;
  expect(sheet.height).toBeLessThanOrEqual(844 / 2 + 1);
  expect(Math.abs(sheet.y + sheet.height - 844)).toBeLessThan(2);
  expect(sheet.width).toBeGreaterThan(380);
  await expect.poll(() => viewport.evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
  expect(await viewport.evaluate(n => { n.scrollLeft = 80; return n.scrollLeft; })).toBeGreaterThan(0);
  await page.screenshot({ path: 'output/playwright/schematic-mobile-sheet.png' });
  await details.getByRole('button', { name: 'Снять выделение', exact: true }).click();
  await expect(details).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('полноэкранная схема отдаёт полотну оставшуюся высоту и закрывается Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await calculate(page);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const expand = page.getByRole('button', { name: 'На весь экран', exact: true });
  await expand.click();
  const dialog = page.getByRole('dialog', { name: 'Схема строительства', exact: true });
  const viewport = dialog.locator('.schematic-viewport');
  await expect(viewport).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Только схема', exact: true })).toHaveCount(0);
  const [frame, canvas] = [(await dialog.boundingBox())!, (await viewport.boundingBox())!];
  expect(canvas.height).toBeGreaterThan(600);
  const notes = (await dialog.locator('.schematic-notes').last().boundingBox())!;
  expect(notes.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
  expect(frame.y + frame.height - (notes.y + notes.height)).toBeLessThan(40);
  await page.screenshot({ path: 'output/playwright/schematic-dialog-full-height.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(expand).toBeFocused();
});

test('пока раскладка считается, схема показывает «Раскладываю схему…» и затем узлы', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/schematicLayout\.worker/, async route => { await gate; await route.continue(); });
  await calculate(page, 'target', smelters([4], [120]));
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const pending = graph.getByRole('status').filter({ hasText: 'Раскладываю схему…' });
  await expect(pending).toBeVisible();
  await expect(graph.locator('.schematic-node')).toHaveCount(0);
  release();
  await expect(graph.locator('.schematic-node').first()).toBeVisible();
  await expect(pending).toHaveCount(0);
});

test('при ошибке раскладки схема сообщает «Не удалось разложить схему.», а инструкция работает', async ({ page }) => {
  await page.route(/schematicLayout\.worker/, route => route.abort());
  await calculate(page, 'target', smelters([4], [120]));
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph.getByRole('alert').filter({ hasText: 'Не удалось разложить схему.' })).toBeVisible();
  await expect(graph.locator('.schematic-node')).toHaveCount(0);
  await page.getByRole('button', { name: 'Инструкция', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Инструкция для строительства', exact: true })).toBeVisible();
  await expect(graph).toHaveCount(0);
});

test('«Нужны поставщики» выделяет поставщика на том же полотне без смены страницы', async ({ page }) => {
  await calculate(page, 'target', smelters([4], [120]));
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  const url = page.url();
  await graph.locator('[data-building-id="smelter"] .schematic-node-button').click();
  const blockers = graph.locator('.schematic-blockers');
  await expect(blockers.getByRole('heading', { name: 'Нужны поставщики', exact: true })).toBeVisible();
  await blockers.getByRole('button').first().click();
  const selected = graph.locator('.schematic-node.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('data-kind', 'source');
  await expect(selected.locator('.schematic-node-button')).toBeFocused();
  await expect(graph.locator('.schematic-details')).toContainText(await selected.locator('.schematic-node-title strong').innerText());
  await expect(graph.locator('.schematic-pagination, .schematic-page-link')).toHaveCount(0);
  expect(page.url()).toBe(url);
});
