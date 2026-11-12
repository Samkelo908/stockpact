import { expect, test, type Page } from "@playwright/test";

async function switchRole(page: Page, role: string) {
  await page.getByRole("button", { name: "Account and demo roles" }).click();
  await page.getByRole("dialog").getByText(role, { exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function submitQuote(page: Page, path: string, role: string, price: string) {
  await switchRole(page, role);
  await page.goto(path);
  await page.getByRole("button", { name: "Prepare quote" }).click();
  await page.getByLabel("Unit price (ZAR)").fill(price);
  await page.getByRole("button", { name: "Submit quote" }).click();
  await expect(page.getByRole("heading", { name: "Your quotes" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function authorize(page: Page, units: string) {
  await page.getByRole("button", { name: "Inspect goods & generate QR" }).click();
  await page.getByLabel("Accepted cases").fill(units);
  await page.getByRole("button", { name: "Authorise & generate QR" }).click();
  await expect(page.getByRole("img", { name: /scan to review/i })).toBeVisible();
  const link = await page.getByLabel("Handover link", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  return link;
}

async function reviewHandover(page: Page, link: string) {
  await page.goto("/#deliveries/scan");
  await page.getByLabel("Handover link or code").fill(link);
  await page.getByRole("button", { name: "Review handover", exact: true }).click();
}

test("matches, compares, funds, dispatches, pays two handovers and reorders", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The desktop test exercises the full workflow.");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Procurement overview" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-overview.png"), animations: "disabled" });
  const delivery = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Describe your requirement").fill(
    "I need 20 cases of bottled still water delivered to Cape Town by " + delivery,
  );
  await page.getByRole("button", { name: "Build request" }).click();
  await expect(page.getByLabel("Product and specification")).toHaveValue("bottled still water");
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("20");
  await page.getByRole("button", { name: "Find suppliers" }).click();
  await expect(page.getByRole("heading", { name: "Matching suppliers" })).toBeVisible();
  const requestPath = page.url();
  await page.getByRole("button", { name: /Send to [2-9] suppliers/ }).click();
  await expect(page.getByText("Waiting for quotes")).toBeVisible();

  await submitQuote(page, requestPath, "Supplier · Cape Supply Co.", "89.50");
  await submitQuote(page, requestPath, "Supplier · Peninsula Wholesale", "109.50");
  await switchRole(page, "Buyer · Harbour Table");
  await page.goto(requestPath);
  await expect(page.getByRole("button", { name: "Review & accept" })).toHaveCount(2);
  await page.getByRole("button", { name: "Review & accept" }).first().click();
  await page.getByRole("button", { name: "Accept quote", exact: true }).click();
  await page.getByRole("button", { name: "Reserve demo funds", exact: true }).click();
  await page.getByRole("button", { name: "Confirm demo reserve" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const orderPath = page.url();
  const orderId = decodeURIComponent(new URL(orderPath).hash.split("/")[1]);

  await page.getByLabel("Attach a file").setInputFiles("public/icon-192.png");
  await page.getByRole("button", { name: "Upload attachment" }).click();
  const attachment = page.getByRole("link", { name: /icon-192\.png/ });
  await expect(attachment).toBeVisible();
  const attachmentPath = await attachment.getAttribute("href");
  expect(attachmentPath).toContain("/api/attachments");
  await switchRole(page, "Supplier · Peninsula Wholesale");
  expect((await page.request.get(attachmentPath!)).status()).toBe(404);
  await switchRole(page, "Supplier · Cape Supply Co.");
  await page.goto(orderPath);
  expect((await page.request.get(attachmentPath!)).status()).toBe(200);
  await page.getByRole("button", { name: "Dispatch goods" }).click();
  await expect(page.getByRole("button", { name: "Scan handover QR" })).toBeVisible();

  await switchRole(page, "Buyer · Harbour Table");
  await page.goto(orderPath);
  const first = await authorize(page, "12");
  await switchRole(page, "Supplier · Cape Supply Co.");
  await reviewHandover(page, first);
  await page.getByLabel("Simulate a payment interruption").check();
  await page.getByRole("button", { name: "Accept handover and record demo payment" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /interrupt/i })).toBeVisible();
  await page.reload();
  await reviewHandover(page, first);
  await page.getByRole("button", { name: "Accept handover and record demo payment" }).click();
  await expect(page).toHaveURL(orderPath);
  const stateAfterPart = await (await page.request.get("/api/state")).json();
  expect((stateAfterPart.state ?? stateAfterPart).orders.find((item: { id: string }) => item.id === orderId).acceptedQuantity).toBe(12);
  await reviewHandover(page, first);
  await expect(page.getByRole("alert").filter({ hasText: /used|redeemed/i })).toBeVisible();

  await switchRole(page, "Buyer · Harbour Table");
  await page.goto(orderPath);
  const second = await authorize(page, "8");
  await switchRole(page, "Supplier · Cape Supply Co.");
  await reviewHandover(page, second);
  await page.getByRole("button", { name: "Accept handover and record demo payment" }).click();
  await expect(page).toHaveURL(orderPath);
  const stateAfterFull = await (await page.request.get("/api/state")).json();
  const order = (stateAfterFull.state ?? stateAfterFull).orders.find((item: { id: string }) => item.id === orderId);
  expect(order.acceptedQuantity).toBe(20);
  expect(order.releasedCents).toBe(order.fundedCents);
  await switchRole(page, "Buyer · Harbour Table");
  await page.goto(orderPath);
  await page.getByRole("button", { name: "Leave review" }).click();
  await page.getByLabel("Comment").fill("Both deliveries matched the order.");
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByRole("button", { name: "Leave review" })).toHaveCount(0);
  await page.getByRole("button", { name: "Buy again" }).click();
  await expect(page.getByLabel("Product and specification")).toHaveValue("bottled still water");
});

test("registers a separate company and restores its session on sign-in", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The desktop project verifies account isolation.");
  await page.goto("/");
  await page.getByRole("button", { name: "Account and demo roles" }).click();
  await page.getByRole("button", { name: "Business sign-in" }).click();
  await page.getByRole("button", { name: "Register a business" }).click();
  const email = "buyer-" + Date.now() + "@example.test";
  const password = "fictional-account-fixture-123";
  await page.getByLabel("Full name").fill("Test Buyer");
  await page.getByLabel("Company name").fill("Test Buyer Co.");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Procurement overview" })).toBeVisible();
  const state = await (await page.request.get("/api/state")).json();
  expect(state.actor.email).toBe(email);
  expect(state.actor.demoRole).toBeUndefined();
  expect(state.orders).toEqual([]);
  expect(state.listings.every((listing: { demo: boolean }) => !listing.demo)).toBeTruthy();

  await page.getByRole("button", { name: "Account and demo roles" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to StockPact" })).toBeVisible();
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Procurement overview" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Manage sourcing and orders for Test Buyer Co.")).toBeVisible();
});

test("fits a phone, supports keyboard focus and shows search progress while waiting", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "This check uses the mobile viewport.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Procurement overview" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-overview.png"), animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBeTruthy();
  const delivery = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Describe your requirement").fill("I need 20 cases of still water delivered to Cape Town by " + delivery);
  await page.getByRole("button", { name: "Build request" }).click();
  await expect(page.getByLabel("Product and specification")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Request ready to review" })).toBeInViewport();
  const motion = page.waitForFunction(() => {
    const status = document.querySelector('[role="status"][data-state="complete"]');
    if (!status?.textContent?.includes("Supplier search complete")) return false;
    const track = status.querySelector(".search-progress-track");
    return track?.getAnimations({ subtree: true }).some((animation) => animation.playState === "running");
  });
  await page.getByRole("button", { name: "Find suppliers" }).click();
  await motion;
  await expect(page.getByRole("status").filter({ hasText: "Supplier search complete" })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Matching suppliers" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Finding matching suppliers" })).toHaveCount(0);
});

test("reviews and reserves a payment from the phone, then finds and downloads the receipt", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "This check uses the mobile payment navigation.");
  await page.goto("/#requests/demo-request-sent");
  await page.getByRole("button", { name: "Review & accept" }).first().click();
  await page.getByRole("button", { name: "Accept quote", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  const orderId = decodeURIComponent(new URL(page.url()).hash.split("/")[1]);
  const state = await (await page.request.get("/api/state")).json();
  const order = state.orders.find((entry: { id: string }) => entry.id === orderId);
  expect(order.status).toBe("awaiting_funding");

  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "Payments" }).click();
  await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-payments.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Review payment" }).click();
  const checkout = page.getByRole("dialog", { name: "Review escrow payment" });
  await expect(checkout.getByText("Simulated payment")).toBeVisible();
  await expect(checkout.getByText(order.reference, { exact: false })).toBeVisible();
  await expect(checkout.getByText("Quoted total", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-checkout.png"), animations: "disabled" });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await checkout.getByRole("button", { name: "Confirm demo reserve" }).click();
  await expect(checkout).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review payment" })).toHaveCount(0);

  await page.getByRole("searchbox", { name: "Search transactions" }).fill(order.reference);
  const transactions = page.getByRole("list", { name: "Transactions" });
  await expect(transactions.getByRole("listitem")).toHaveCount(1);
  const receipt = transactions.getByRole("button", { name: /download.*receipt/i });
  const download = page.waitForEvent("download");
  await receipt.click();
  expect((await download).suggestedFilename()).toContain(order.reference);
});

test("finds a South African supplier by name and carries its listing into a request", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The desktop project verifies marketplace search.");
  await page.goto("/#marketplace");
  await expect(page.getByRole("heading", { name: "Marketplace", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-marketplace.png"), animations: "disabled" });
  await page.getByRole("searchbox", { name: "Search listings" }).fill("water Peninsula Wholesale");
  await page.getByRole("combobox", { name: "Delivery area" }).selectOption("Epping");
  await expect(page.getByRole("status").filter({ hasText: /^1 listing$/ })).toBeVisible();
  await page.getByRole("button", { name: "View listing" }).click();
  await page.getByRole("button", { name: "Request current pricing" }).click();
  await expect(page.getByLabel("Product and specification")).toHaveValue("500 ml still water");
  await expect(page.getByLabel("Units per pack")).toHaveValue("24");
});
