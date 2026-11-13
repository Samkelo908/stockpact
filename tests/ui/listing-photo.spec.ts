import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('a supplier photo reaches buyers and is hidden when the listing is archived', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'This check exercises the phone listing form.');
  const product = `Fresh listing photo ${Date.now()}`;
  const buyer = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await page.goto('/#inventory');
    await page.request.post('/api/actions', { data: { action: 'switchRole', role: 'supplier' } });
    await page.reload();
    await page.getByRole('button', { name: 'New listing' }).click();
    const form = page.getByRole('dialog', { name: 'Create stock listing' });
    await form.getByLabel('Product name').fill(product);
    await form.getByLabel('Category').fill('Food & produce');
    await form.getByLabel('Available quantity').fill('25');
    await form.getByLabel('Product photo').setInputFiles({
      name: 'wholesale-stock.webp', mimeType: 'image/webp', buffer: await readFile('public/listing-tomatoes.webp'),
    });
    await form.getByRole('button', { name: 'Save listing' }).click();
    await expect(form).toHaveCount(0);

    const state = await (await buyer.request.get('/api/state')).json();
    const listing = state.listings.find((entry: { name: string }) => entry.name === product);
    expect(listing?.image).toMatch(/^\/api\/listing-photo\?/);
    const response = await buyer.request.get(listing.image);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/webp');
    expect((await response.body()).subarray(8, 12).toString()).toBe('WEBP');

    const shop = await buyer.newPage();
    await shop.goto('/#marketplace');
    await shop.getByRole('searchbox').fill(product);
    const photo = shop.locator('img[src*="/api/listing-photo"]');
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);

    const row = page.getByRole('row').filter({ hasText: product });
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Archive listing').check();
    await page.getByRole('button', { name: 'Save listing' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await buyer.request.get(listing.image)).status()).toBe(404);
    expect((await page.request.get(listing.image)).status()).toBe(200);
  } finally {
    await buyer.close();
  }
});
