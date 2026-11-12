import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { parsePersonaEvent, verifyPersonaSignature } from "../src/integrations/verification";

test("accepts a current signed Persona decision and discards unrelated identity fields", () => {
  const at = new Date("2026-11-12T16:00:00Z");
  const timestamp = String(at.valueOf() / 1000);
  const raw = Buffer.from(JSON.stringify({ data: { id: "evt_TEST", attributes: {
    name: "inquiry.approved", "created-at": at.toISOString(),
    payload: { data: { id: "inq_TEST", attributes: { "name-first": "Fictional" } } },
  } } }));
  const secret = "fixture-only";
  const signature = "t=" + timestamp + ",v1=" + createHmac("sha256", secret).update(timestamp + ".").update(raw).digest("hex");
  assert.equal(verifyPersonaSignature(raw, signature, secret, at.valueOf()), true);
  assert.equal(verifyPersonaSignature(raw, signature, secret, at.valueOf() + 310000), false);
  assert.equal(verifyPersonaSignature(Buffer.concat([raw, Buffer.from(" ")]), signature, secret, at.valueOf()), false);
  assert.deepEqual(parsePersonaEvent(raw), { id: "evt_TEST", status: "verified", inquiry: "inq_TEST", at });
});
