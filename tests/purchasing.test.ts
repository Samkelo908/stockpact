import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePurchaseRequest } from "../src/integrations/purchasing";

test("extracts the water request and keeps the buyer's budget out of notes", async () => {
  const draft = await parsePurchaseRequest(
    "We need 20 cases of bottled still water delivered to Woodstock, Cape Town by 2028-11-20 under R2,400.50",
  );
  assert.equal(draft.mode, "demo");
  assert.equal(draft.product, "bottled still water");
  assert.equal(draft.quantity, 20);
  assert.equal(draft.unit, "cases");
  assert.equal(draft.location, "Woodstock, Cape Town");
  assert.equal(draft.requiredDate, "2028-11-20");
  assert.equal(draft.budgetCents, 240050);
  assert.doesNotMatch(draft.notes, /2,400/);
  assert.deepEqual(draft.missing, []);
});

test("asks for missing purchasing details without inventing them", async () => {
  const draft = await parsePurchaseRequest("Please source printer paper.");
  assert.equal(draft.product, "printer paper");
  assert.equal(draft.quantity, 0);
  assert.equal(draft.location, "");
  assert.equal(draft.budgetCents, null);
  assert.deepEqual(draft.missing, ["Quantity", "Unit", "Delivery address", "Required date"]);
});
