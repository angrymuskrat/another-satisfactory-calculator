import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const reinforced = catalog.recipes.find(r => r.id === 'reinforced-iron-plate')!.name;
const copy = (page: Page, suffix: string) => page.getByRole('button', { name: `Скопировать: ${reinforced}: ${suffix}`, exact: true });
async function seed(page: Page) {
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'smooth-power'; plan.mode = 'target'; plan.targets[0].rate = 7.5;
  plan.settings.peakPowerLimit = 100; plan.settings.powerReserve = 5;
  await page.addInitScript(value => {
    if (!localStorage.getItem('ficsit-plan-v1')) localStorage.setItem('ficsit-plan-v1', JSON.stringify(value));
  }, plan);
  await page.goto('/');
}
async function build(page: Page, approximate = false) {
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  await expect(page.locator(approximate ? '.status-badge.approximate' : '.status-badge.approximate').first()).toHaveText(approximate ? 'Допустимое приближение' : 'Допустимое приближение', { timeout: 30000 });
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Инструкция для строительства', exact: true })).toBeVisible();
}

test('7,5 пластин: две машины на 75%, работа 100%, независимые потоки, MW и материалы', async ({ page }) => {
  await seed(page); await build(page);
  await expect(copy(page, 'число машин')).toHaveText('2');
  await expect(copy(page, 'частота')).toHaveText('75 %');
  await expect(copy(page, 'активная доля времени')).toHaveText('100 %');
  // Два сборщика по 15 МВт на 75%: 30 × 0.75^log2(2.5).
  for (const label of ['средняя мощность', 'пиковая мощность']) {
    const power = Number((await copy(page, label).innerText()).replace(' МВт', '').replace(',', '.'));
    expect(power).toBeCloseTo(30 * .75 ** Math.log2(2.5), 5);
  }
  const product = catalog.items.find(i => i.id === 'reinforced-iron-plate')!.name;
  await expect(copy(page, `Выход, ${product}, одна активная машина`)).toHaveText('3,75 шт/мин');
  await expect(copy(page, `Выход, ${product}, группа в среднем`)).toHaveText('7,5 шт/мин');
  await expect(page.locator('.kpi').filter({ hasText: 'Средняя мощность' })).toContainText('65,64');
  await expect(page.locator('.energy-panel')).toContainText('100 − 5 − 69,39 = 25,61 МВт');
  const bill = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Материалы зданий', exact: true }) });
  await expect(bill).toContainText('Известна стоимость 14 из 14 физических машин');
  await expect(bill).toContainText('Все показанные здания учтены');
  // Eight constructors cost 16 plates; two assemblers cost another 16.
  await expect(bill.getByRole('button', { name: 'Скопировать: Материалы: ' + catalog.items.find(i => i.id === 'reinforced-iron-plate')!.name, exact: true })).toHaveText('32 шт');
});

test('ровная нагрузка сохраняется, подбирает частоту и устраняет простои без изменения заказа', async ({ page }) => {
  await seed(page);
  await page.getByText('Энергия и ограничения', { exact: true }).click();
  await expect(page.locator('.objective-description')).toContainText('Подбор частот для непрерывной работы');
  await expect(page.getByRole('combobox', { name: 'Порядок целей после выпуска', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Активные ограничения' })).toContainText('здания → энергия с подбором частот');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.objective)).toBe('smooth-power');
  await page.reload();
  await page.getByText('Энергия и ограничения', { exact: true }).click();
  await expect(page.locator('.objective-description')).toContainText('Подбор частот для непрерывной работы');
  await build(page, true);
  await expect(copy(page, 'частота')).toHaveText('75 %');
  await expect(copy(page, 'активная доля времени')).toHaveText('100 %');
  await expect(page.locator('.energy-panel')).toContainText('Незагруженная мощность производств');
  await expect(page.getByLabel('Количество продукта 1', { exact: true })).toHaveValue('7.5');
});

test('отметки переживают перезагрузку и другую конфигурацию, не переходя на изменённый выпуск', async ({ page }) => {
  await seed(page); await build(page);
  const built = page.getByRole('checkbox', { name: `Построено: ${reinforced}`, exact: true });
  await built.check();
  await page.reload(); await build(page); await expect(built).toBeChecked();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
  await page.getByLabel('Количество продукта 1', { exact: true }).fill('5');
  await expect(page.getByRole('heading', { name: 'Инструкция для строительства', exact: true })).toHaveCount(0);
  await build(page); await expect(built).not.toBeChecked();
  await built.check();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
  await page.getByLabel('Количество продукта 1', { exact: true }).fill('7,5');
  await build(page); await expect(built).toBeChecked();
  await page.reload(); await build(page); await expect(built).toBeChecked();
});

test('отказ буфера обмена даёт ошибку и точное число для ручного копирования', async ({ page }) => {
  await seed(page); await build(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } }));
  await copy(page, 'частота').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось скопировать' })).toBeVisible();
  const manual = page.getByLabel(`Число для ручного копирования: ${reinforced}: частота`, { exact: true });
  await expect(manual).toHaveValue('75');
});
