import { expect, test } from "@playwright/test";

test("sources two linked products and switches between their own supplier matches", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Exercise the grouped request from the phone layout.");
  await page.goto("/#assistant");
  await page.getByRole("button", { name: "Source multiple products" }).click();
  await expect(page.getByRole("heading", { name: "Grouped purchase" })).toBeVisible();
  await page.getByLabel("Purchase name").fill("Weekly stock run");
  await page.getByLabel("Required by").fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const water = page.getByRole("group", { name: "Product 1", exact: true });
  const tomatoes = page.getByRole("group", { name: "Product 2", exact: true });
  await water.getByLabel("Product and specification").fill("500 ml still water");
  await water.getByLabel("Quantity", { exact: true }).fill("4");
  await water.getByLabel("Unit", { exact: true }).fill("cases");
  await tomatoes.getByLabel("Product and specification").fill("Chopped tomatoes");
  await tomatoes.getByLabel("Quantity", { exact: true }).fill("6");
  await tomatoes.getByLabel("Unit", { exact: true }).fill("cases");
  await page.getByRole("button", { name: "Find suppliers for all products" }).click();

  await expect(page.getByRole("heading", { name: "Weekly stock run" })).toBeVisible();
  await expect(page.getByText("Item 1 of 2. Each item has its own quotes and order.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Matching suppliers" })).toBeVisible();
  await page.getByRole("button", { name: /2\. Chopped tomatoes/ }).click();
  await expect(page.getByText("Item 2 of 2. Each item has its own quotes and order.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Matching suppliers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send to 2 suppliers" })).toBeVisible();
});
