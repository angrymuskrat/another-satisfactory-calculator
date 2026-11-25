import { catalog } from './catalog';
import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Plan } from '../../packages/domain/types';

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
  await expect(graph.locator('.schematic-node[data-kind="split"], .schematic-node[data-kind="merge"]')).toHaveCount(0);
  expect(await graph.locator('.schematic-edges g.flow').evaluateAll(nodes => nodes.every(n => Number(n.getAttribute('data-rate')) <= 120))).toBe(true);
  expect(await graph.locator('.schematic-edges g path').evaluateAll(nodes => nodes.every(n => !/[CQ]/.test(n.getAttribute('d')!)))).toBe(true);
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
  await graph.locator('.schematic-node[data-kind="source"] .schematic-node-button').click();
  for (const rate of [40, 30, 20, 10]) await expect(graph.locator('.schematic-connections')).toContainText(`${rate} шт/мин · ${rate}%`);
  await graph.locator('.schematic-connections button').filter({ hasText: '40 шт/мин · 40%' }).click();
  await expect(graph.locator('.schematic-node.selected')).toContainText('133,333%');
});

test('поток 224 разделён на прямые связи до 120, а карточки ветвей не перекрываются', async ({ page }) => {
  const plan = smelters([5], [224]); plan.settings.beltId = 'belt2';
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph.locator('.schematic-node[data-kind="building"]')).toHaveCount(5);
  const rates = await graph.locator('.schematic-edges g.flow').evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('data-rate'))));
  expect(rates.every(rate => rate > 0 && rate <= 120)).toBe(true);
  expect(rates.reduce((s, rate) => s + rate, 0)).toBeCloseTo(448, 8);
  await expect(graph.locator('.schematic-node.junction')).toHaveCount(0);
  expect(await graph.locator('.schematic-node').evaluateAll(nodes => {
    const rects = nodes.map(n => n.getBoundingClientRect());
    return rects.every((a, i) => rects.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
  })).toBe(true);
});

test('конструкторы пластин и прутов показаны разными группами', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const plan = createDefaultPlan(catalog); plan.mode = 'target';
  plan.targets = ['iron-plate', 'iron-rod'].map(itemId => ({ itemId, rate: 20, weight: 1, scale: 1 }));
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  await expect(page.locator('.schematic-node[data-building-id="constructor"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Схема строительства', exact: true });
  await dialog.getByRole('button', { name: 'Уместить', exact: true }).click();
  await dialog.getByRole('button', { name: 'Только схема', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/schematic-recipe-branches.png' });
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

test('схема скрывает связи ниже 0,01 процента, сохраняя данные карточек', async ({ page }) => {
  const plan = smelters([1, 1], [30, .001]);
  plan.lines![1].clock = 1; plan.lines![1].duty = .001 / .3;
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph.locator('.schematic-node[data-kind="building"]')).toHaveCount(2);
  await expect(graph.locator('.schematic-hint')).toContainText('Связи меньше 0,01%');
  const rates = await graph.locator('.schematic-edges g.flow').evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('data-rate'))));
  expect(rates.length).toBeGreaterThan(0);
  expect(rates.every(rate => rate >= 30.001 * .0001)).toBe(true);
  expect(await graph.locator('.schematic-node[data-kind="building"]').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('0,001')]));
});

test('разная доля работы одного типа явно подписана как средняя при одинаковой частоте', async ({ page }) => {
  const plan = smelters([1, 1], [6, 24]);
  plan.lines!.forEach((line, i) => { line.clock = 100; line.duty = [.2, .8][i]; });
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  const node = page.locator('.schematic-node[data-building-id="smelter"]');
  await expect(node).toContainText('Средняя доля работы 50%');
  await expect(node).toContainText('Настройки различаются');
  await node.locator('.schematic-node-button').click();
  await expect(page.locator('.schematic-configurations')).toContainText('работа 20% времени');
  await expect(page.locator('.schematic-configurations')).toContainText('работа 80% времени');
});

test('стройка связывает поставку, отдельные плавильни, группу и инструкцию', async ({ page }) => {
  await calculate(page, 'target', smelters([4], [120]));
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства' });
  const machines = graph.locator('[data-building-id="smelter"]');
  await expect(machines.first()).toHaveAttribute('data-progress', 'waiting');
  await machines.first().getByRole('button', { name: /^Ждёт/ }).click();
  const source = graph.locator('[data-kind="source"]');
  await expect(source.locator('.schematic-node-button')).toBeFocused();
  await source.getByRole('checkbox').check();
  await graph.getByLabel('Можно строить дальше', { exact: true }).check();
  await expect(graph.locator('[data-building-id="smelter"][data-progress="ready"]')).toHaveCount(4);
  await machines.nth(2).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  await expect(graph.locator('[data-building-id="smelter"]')).toContainText('Построено · 1 из 4');
  await page.getByRole('button', { name: 'Инструкция', exact: true }).click();
  const group = page.getByRole('checkbox', { name: /^Построено: Плавильная линия/ });
  await expect(group).toBeChecked({ indeterminate: true });
  await group.check();
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  await expect(graph.locator('[data-building-id="smelter"][data-progress="built"]')).toHaveCount(4);
});

test('ручка двигает карточку мышью и клавиатурой, сохраняет положение и обновляет стрелку', async ({ page }) => {
  await calculate(page, 'target', smelters([1], [30]));
  const types = page.getByRole('button', { name: 'По типам зданий', exact: true });
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
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  await expect(graph.getByRole('button', { name: 'Вернуть автораскладку' })).toBeDisabled();
  await types.click();
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

test('ссылка из ожидания находит конкретную плавильню на другой странице', async ({ page }) => {
  const plan = smelters([50], [1500]);
  plan.targets = [{ itemId: 'iron-plate', rate: 1000, weight: 1, scale: 1 }];
  plan.lines!.push({ id: 'plates', name: 'Пластины', count: 50, clock: 100, recipeId: 'iron-plate', somersloops: 0, locked: true, duty: 1 });
  await calculate(page, 'target', plan);
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства' });
  await graph.getByRole('button', { name: 'Далее', exact: true }).click();
  await graph.getByRole('button', { name: 'Далее', exact: true }).click();
  await graph.locator('[data-kind="building"][data-building-id="constructor"]').last().getByRole('button', { name: /^Ждёт/ }).click();
  const selected = graph.locator('[data-building-id="smelter"].selected');
  await expect(selected).toContainText('№50');
  await expect(selected.locator('.schematic-node-button')).toBeFocused();
  await expect(graph.getByRole('navigation', { name: 'Страницы зданий' })).toContainText('Страница 2 из 3');
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
  await page.getByRole('button', { name: 'По типам зданий' }).click();
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

test('вся карточка выделяет здание, а перетаскивание за её нижнюю часть не выделяет', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await calculate(page);
  await page.getByRole('button', { name: 'По отдельным зданиям', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await expect(graph.locator('.schematic-canvas')).toHaveAttribute('data-layout', 'short-links');
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
  await dialog.getByRole('button', { name: 'Только схема', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/schematic-short-links.png' });
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
