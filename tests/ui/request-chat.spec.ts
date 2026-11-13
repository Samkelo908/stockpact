import { expect, test } from "@playwright/test";

test("buyer and supplier exchange private request messages on a phone", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "This check uses the phone viewport.");
  const buyerMessage = `Can you deliver before lunch? ${Date.now()}`;
  const supplierMessage = "Yes, between 9 am and 11 am.";
  const action = async (name: string, input: Record<string, unknown>) => {
    const response = await page.request.post('/api/actions', { data: { action: name, ...input } });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const request = await action('createRequest', { draft: {
    product: 'Chopped tomatoes', quantity: 20, unit: 'cases', location: 'Cape Town',
    requiredDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    budgetCents: null, notes: '', category: 'Food & produce', substitutions: false, mode: 'manual',
  } });
  await action('matchRequest', { requestId: request.id });
  await expect.poll(async () => {
    const state = await (await page.request.get('/api/state')).json();
    return state.requests.find((row: { id: string }) => row.id === request.id)?.status;
  }).toBe('matched');
  await action('sendRequest', { requestId: request.id, supplierIds: ['demo-supplier-company', 'demo-supplier2-company'] });
  await page.goto(`/#requests/${request.id}`);
  await page.getByRole("button", { name: "Message Cape Supply Co." }).click();
  const buyerChat = page.getByRole("dialog", { name: "Conversation with Cape Supply Co." });
  await buyerChat.getByLabel("Message", { exact: true }).fill(buyerMessage);
  const fullViewport = page.viewportSize();
  if (fullViewport) await page.setViewportSize({ width: fullViewport.width, height: 420 });
  await expect(buyerChat.getByRole("button", { name: "Send message" })).toBeInViewport();
  await buyerChat.getByRole("button", { name: "Send message" }).click();
  await expect(buyerChat.getByText(buyerMessage)).toBeVisible();
  if (fullViewport) await page.setViewportSize(fullViewport);

  const sellerContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: testInfo.project.use.viewport });
  try {
    const seller = await sellerContext.newPage();
    await seller.goto("/");
    await seller.getByRole("button", { name: "Account and demo roles" }).click();
    await seller.getByRole("dialog").getByText("Supplier · Cape Supply Co.", { exact: true }).click();
    await expect(seller.getByRole("dialog")).toHaveCount(0);
    await seller.getByRole("button", { name: /Notifications/ }).click();
    await seller.getByRole("dialog", { name: "Notifications" }).getByRole("button", { name: /New request message/ }).first().click();
    const sellerChat = seller.getByRole("dialog", { name: "Conversation with Harbour Table" });
    await expect(sellerChat.getByText(buyerMessage)).toBeVisible();
    await sellerChat.getByLabel("Message", { exact: true }).fill(supplierMessage);
    await sellerChat.getByRole("button", { name: "Send message" }).click();
    await expect(buyerChat.getByText(supplierMessage)).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

    await sellerChat.getByRole("button", { name: "Close dialog" }).click();
    await seller.getByRole("button", { name: "Account and demo roles" }).click();
    await seller.getByRole("dialog").getByText("Supplier · Peninsula Wholesale", { exact: true }).click();
    await expect(seller.getByRole("dialog")).toHaveCount(0);
    await seller.getByRole("button", { name: "Message buyer" }).click();
    await expect(seller.getByRole("dialog", { name: "Conversation with Harbour Table" })).toBeVisible();
    await expect(seller.getByText(buyerMessage)).toHaveCount(0);
    await expect(seller.getByText(supplierMessage)).toHaveCount(0);
  } finally {
    await sellerContext.close();
  }
});
