import { catalog } from './catalog';
import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDefaultPlan } from '../../packages/domain/defaults';

test.skip(!process.env.VISUAL_FREEZE, 'Попиксельная заморозка запускается явно: VISUAL_FREEZE=1.');

const viewports = [{ width: 1920, height: 1080 }, { width: 390, height: 844 }];
const baselineDir = fileURLToPath(new URL('../../output/visual-freeze/', import.meta.url));
// Chrome stitches very tall full-page captures unreliably; shorter clips also stay within canvas limits for decoding.
const SEGMENT_HEIGHT = 8000;
const STABLE_ATTEMPTS = 10;
type Clip = { x: number; y: number; width: number; height: number };

async function seed(page: Page) {
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'smooth-power'; plan.mode = 'target'; plan.targets[0].rate = 7.5;
  await page.addInitScript(value => {
    if (!localStorage.getItem('ficsit-plan-v1')) localStorage.setItem('ficsit-plan-v1', JSON.stringify(value));
  }, plan);
  await page.goto('/');
}

async function open(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function stableShot(page: Page, clip: Clip) {
  const capture = () => page.screenshot({ fullPage: true, clip, animations: 'disabled', caret: 'hide' });
  let previous = await capture();
  for (let attempt = 0; attempt < STABLE_ATTEMPTS; attempt++) {
    const next = await capture();
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error(`Снимок участка y=${clip.y} не стабилизировался за ${STABLE_ATTEMPTS} попыток.`);
}

/** Playwright's comparator skips pixels it classifies as anti-aliasing, so equality is checked on decoded RGBA. */
async function differingPixels(page: Page, expected: Buffer, actual: Buffer) {
  const scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(async sources => {
      const decode = async (src: string) => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [a, b] = await Promise.all(sources.map(decode));
      if (a.width !== b.width || a.height !== b.height) return { count: -1, detail: `размер ${a.width}×${a.height} → ${b.width}×${b.height}` };
      let count = 0, first = -1;
      for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
          count++; if (first < 0) first = i / 4;
        }
      }
      return { count, detail: count ? `${count} пикс., первый (${first % a.width}, ${Math.floor(first / a.width)})` : '' };
    }, [expected, actual].map(png => `data:image/png;base64,${png.toString('base64')}`));
  } finally { await scratch.close(); }
}

async function freeze(page: Page, name: string) {
  await page.mouse.move(0, 0);
  const { width } = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const segments = Math.ceil(height / SEGMENT_HEIGHT);
  const update = ['all', 'changed'].includes(test.info().config.updateSnapshots);
  const file = (index: number) => `${baselineDir}${name}-${index}.png`;
  const problems: string[] = [];
  if (update) await mkdir(baselineDir, { recursive: true });
  for (let index = 0; index < segments; index++) {
    const y = index * SEGMENT_HEIGHT;
    const actual = await stableShot(page, { x: 0, y, width, height: Math.min(SEGMENT_HEIGHT, height - y) });
    if (update) { await writeFile(file(index), actual); continue; }
    const expected = await readFile(file(index)).catch(() => null);
    if (!expected) { problems.push(`${name}-${index}: нет эталона`); continue; }
    if (expected.equals(actual)) continue;
    const diff = await differingPixels(page, expected, actual);
    if (diff.count === 0) continue;
    await test.info().attach(`${name}-${index}-actual.png`, { body: actual, contentType: 'image/png' });
    problems.push(`${name}-${index}: ${diff.detail}`);
  }
  if (update) await rm(file(segments), { force: true });
  else if (await readFile(file(segments)).then(() => true, () => false)) problems.push(`${name}: эталон длиннее страницы`);
  expect.soft(problems, name).toEqual([]);
}

for (const viewport of viewports) {
  test.describe(`${viewport.width}`, () => {
    test.use({ viewport });
    test.setTimeout(240_000);

    test('экраны без расчёта', async ({ page }) => {
      await seed(page);
      await freeze(page, `planner-${viewport.width}`);
      await page.getByRole('button', { name: 'Рассчитать по продукту' }).click();
      await freeze(page, `quick-order-${viewport.width}`);
      for (const [screen, slug] of [['Рецепты', 'recipes'], ['Схемы разделителей', 'splitters'], ['Технологии', 'technologies'], ['Миры и фабрики', 'worlds'], ['Профили', 'profiles']] as const) {
        await open(page, screen);
        await freeze(page, `${slug}-${viewport.width}`);
      }
    });

    test('результат, инструкция и схема', async ({ page }) => {
      await seed(page);
      await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
      await chooseMaximum(page);
      await expect(page.locator('.status-badge.approximate').first()).toHaveText('Допустимое приближение', { timeout: 30000 });
      await expect(page.getByRole('button', { name: 'Рассчитать', exact: true })).toBeVisible({ timeout: 60000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await freeze(page, `results-${viewport.width}`);
      await page.locator('.production-step > summary').first().click();
      await freeze(page, `results-step-${viewport.width}`);
      await expect(page.getByRole('heading', { name: 'Инструкция для строительства', exact: true })).toBeVisible();
      await freeze(page, `instruction-${viewport.width}`);
      await page.getByRole('button', { name: 'Схема', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Схема строительства', exact: true }).locator('.schematic-node').first()).toBeVisible({ timeout: 30000 });
      await freeze(page, `schematic-${viewport.width}`);
    });
  });
}
