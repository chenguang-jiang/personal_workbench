import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  test("verifies the original password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  });

  test("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("Correct horse battery staple", stored), false);
  });

  test("uses a random salt for every hash", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    assert.notEqual(first, second);
  });

  test("rejects malformed stored hashes instead of throwing", async () => {
    for (const stored of ["", "plain-text", "scrypt$1$2", "bcrypt$a$b$c$d$e", "scrypt$x$8$1$aa$bb"]) {
      assert.equal(await verifyPassword("anything", stored), false, stored);
    }
  });

  test("refuses empty passwords", async () => {
    await assert.rejects(() => hashPassword(""));
    const stored = await hashPassword("non-empty");
    assert.equal(await verifyPassword("", stored), false);
  });
});
