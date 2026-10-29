import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSessionToken, verifySessionToken } from "./session";

const SECRET = "test-secret-that-is-long-enough-0123456789";
const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("session token", () => {
  test("accepts a token it signed before expiry", () => {
    const token = createSessionToken(SECRET, NOW, DAY_MS);
    assert.equal(verifySessionToken(token, SECRET, NOW + DAY_MS - 1), true);
  });

  test("rejects an expired token", () => {
    const token = createSessionToken(SECRET, NOW, DAY_MS);
    assert.equal(verifySessionToken(token, SECRET, NOW + DAY_MS), false);
  });

  test("rejects a token signed with another secret", () => {
    const token = createSessionToken(`${SECRET}-other`, NOW, DAY_MS);
    assert.equal(verifySessionToken(token, SECRET, NOW), false);
  });

  test("rejects a token whose expiry was edited", () => {
    const token = createSessionToken(SECRET, NOW, DAY_MS);
    const [version, , signature] = token.split(".");
    const forged = `${version}.${NOW + 365 * DAY_MS}.${signature}`;
    assert.equal(verifySessionToken(forged, SECRET, NOW), false);
  });

  test("rejects missing and malformed tokens", () => {
    for (const value of [undefined, "", "garbage", "v1.abc.def", "v1..", "v2.1.x"]) {
      assert.equal(verifySessionToken(value, SECRET, NOW), false, String(value));
    }
  });

  test("refuses to sign or verify with a short secret", () => {
    assert.throws(() => createSessionToken("short", NOW, DAY_MS));
    assert.equal(verifySessionToken("v1.1.x", "short", NOW), false);
  });
});
