import type { Page } from '@playwright/test';

/** Sections under the result board are collapsed except «Построить»; their content is hidden until opened. */
export async function openSection(page: Page, title: string) {
  const section = page.locator('.result-sections > details').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  if (await section.getAttribute('open') === null) await section.locator('> summary').click();
  return section;
}
