import { expect, test } from '@playwright/test';

test('reconnects from Home and retries supplier search without duplicating the saved request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'This check uses the mobile viewport.');
  const product = `Chopped tomatoes for reconnect ${Date.now()}`;
  let savedId: string | undefined;
  let expired = false;

  await page.route('**/api/state', (route) => expired
    ? route.fulfill({ status: 401, contentType: 'text/plain', body: 'Unauthorized' })
    : route.continue());

  await page.goto('/#assistant');
  await page.getByRole('button', { name: 'Use guided form' }).click();
  await page.getByLabel('Product and specification').fill(product);
  await page.getByLabel('Delivery area or collection location').fill('Cape Town');
  await page.getByLabel('Required by').fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  await page.getByLabel('Budget in rand').fill('300');

  await page.route('**/api/actions', async (route) => {
    const input = route.request().postDataJSON();
    if (input.action !== 'createRequest') return route.continue();
    expect(route.request().headers()['x-requested-with']).toBe('XMLHttpRequest');
    if (savedId) {
      expect(input.requestId).toBe(savedId);
      return route.continue();
    }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    savedId = (await response.json()).data.id;
    expired = true;
    await route.fulfill({ status: 401, contentType: 'text/plain; charset=utf-8', body: 'Unauthorized\n' });
  });
  await page.getByRole('button', { name: 'Find suppliers' }).click();
  const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true });
  await expect(reconnect).toBeVisible();
  await expect(page.getByText(/Unexpected token/)).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Procurement overview' })).toBeVisible();
  await expect(page.getByText(/Your request details will be kept/)).toBeVisible();
  await reconnect.click();
  expired = false;
  await expect(page.getByLabel('Product and specification')).toHaveValue(product);
  await expect(page.getByLabel('Budget in rand')).toHaveValue('300');
  await page.getByRole('button', { name: 'Find suppliers' }).click();
  await expect(page).toHaveURL(new RegExp(`#requests/${savedId}$`));
  await expect.poll(async () => {
    const state = await (await page.request.get('/api/state')).json();
    return state.requests.filter((request: { draft: { product: string } }) => request.draft.product === product).map((request: { status: string }) => request.status);
  }).toEqual(['matched']);
});

test('removes a stale reconnect warning when the workspace starts responding again', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'This check uses the mobile viewport.');
  let expired = false;
  await page.route('**/api/state', (route) => expired
    ? route.fulfill({ status: 401, contentType: 'text/plain', body: 'Unauthorized' })
    : route.continue());
  await page.route('**/api/actions', async (route) => {
    if (route.request().postDataJSON().action !== 'draftRequest') return route.continue();
    expired = true;
    await route.fulfill({ status: 401, contentType: 'text/plain', body: 'Unauthorized' });
  });
  await page.goto('/');
  const prompt = 'I need 20 cases of water delivered to Cape Town.';
  await page.getByLabel('Describe your requirement').fill(prompt);
  await page.getByRole('button', { name: 'Build request' }).click();
  const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true });
  await expect(reconnect).toBeVisible();
  expired = false;
  await expect(page.getByText('Connection restored. You can try your last action again.')).toBeVisible();
  await expect(reconnect).toHaveCount(0);
  await expect(page.getByLabel('Describe the goods you need')).toHaveValue(prompt);
});
