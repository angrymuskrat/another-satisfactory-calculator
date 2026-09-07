import { expect, type Page } from '@playwright/test';

/** Existing detail tests explicitly accept the first (maximum/compact) proposal. */
export async function chooseMaximum(page: Page) {
  const choice = page.getByRole('button', { name: 'Использовать вариант', exact: true }).first();
  await expect(choice.or(page.locator('.result-problem')).or(page.locator('.results-column .alert.error')).first()).toBeVisible({ timeout: 30000 });
  if (await choice.isVisible()) await choice.click();
}
