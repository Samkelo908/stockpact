import { expect, test } from "@playwright/test";

test("home and marketplace photos reload on phone after a transient image failure", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "This check uses the phone viewport.");
  const heroName = /Cape Town shop owner/;
  const heroPath = "/cape-town-shop-delivery.webp";
  let denyOnce = true;
  await page.route((url) => url.pathname === heroPath && !url.search, async (route) => {
    if (!denyOnce) { await route.continue(); return; }
    denyOnce = false;
    await route.fulfill({ status: 401, contentType: "text/plain", body: "Unauthorized" });
  });
  await page.goto("/");
  const photo = page.getByRole("img", { name: heroName });
  await expect.poll(() => photo.evaluate((element) => (element as HTMLImageElement).naturalWidth).catch(() => 0)).toBeGreaterThan(0);

  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await navigation.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Marketplace", exact: true })).toBeVisible();
  const cataloguePhoto = page.locator(".market-photo img[src*='/listing-']").first();
  await cataloguePhoto.scrollIntoViewIfNeeded();
  await expect.poll(() => cataloguePhoto.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await expect.poll(() => photo.evaluate((element) => (element as HTMLImageElement).naturalWidth).catch(() => 0)).toBeGreaterThan(0);
  await navigation.getByRole("button", { name: "Market", exact: true }).click();
  await cataloguePhoto.scrollIntoViewIfNeeded();
  await expect.poll(() => cataloguePhoto.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
