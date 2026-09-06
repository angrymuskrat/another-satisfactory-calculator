import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });

test('основная навигация доступна клавиатурой, экраны помещаются в 390px', async ({ page }) => {
  await page.goto('/');
  const names = ['Планировщик', 'Рецепты', 'Технологии', 'Миры и фабрики', 'Профили'];
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'FICSIT — планировщик' })).toBeFocused();
  for (const name of names) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [index, name] of names.entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.content, name).toBeLessThanOrEqual(width.viewport + 1);
    await page.screenshot({ path: `output/playwright/p1-mobile-${index}.png` });
  }
});

test('контраст и размер основных второстепенных подписей', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Планировщик', 'Рецепты', 'Технологии', 'Миры и фабрики']) {
    await page.getByRole('button', { name, exact: true }).click();
    const samples = await page.locator('.constraint-summary, .field-label, .source-preview, .hint, .recipe-title small, .building-card small').evaluateAll(elements => {
      const rgb = (text: string) => text.match(/[\d.]+/g)?.map(Number) ?? [];
      const luminance = (color: number[]) => color.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
      return elements.filter(el => el.getClientRects().length && el.textContent?.trim()).map(el => {
        let ancestor: Element | null = el, background: number[] = [17, 20, 22];
        let gradient = false;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          gradient ||= style.backgroundImage !== 'none';
          const bg = rgb(style.backgroundColor);
          if (bg.length === 3 || (bg.length === 4 && bg[3] === 1)) { background = bg; break; }
          ancestor = ancestor.parentElement;
        }
        const style = getComputedStyle(el), foreground = luminance(rgb(style.color)), back = luminance(background);
        return { label: el.textContent!.trim().slice(0, 70), ratio: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05), size: parseFloat(style.fontSize), gradient };
      }).filter(sample => !sample.gradient);
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.size, `${name}: ${sample.label}`).toBeGreaterThanOrEqual(12);
      expect(sample.ratio, `${name}: ${sample.label}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
