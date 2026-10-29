import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LoginThrottle } from "./login-throttle";

const WINDOW_MS = 15 * 60 * 1000;

describe("login throttle", () => {
  test("locks a client after too many failures within the window", () => {
    const throttle = new LoginThrottle({ maxFailures: 3, windowMs: WINDOW_MS });
    for (let i = 0; i < 3; i += 1) {
      assert.equal(throttle.retryAfterMs("1.1.1.1", 0), 0);
      throttle.recordFailure("1.1.1.1", 0);
    }
    assert.equal(throttle.retryAfterMs("1.1.1.1", 1000), WINDOW_MS - 1000);
  });

  test("tracks clients separately", () => {
    const throttle = new LoginThrottle({ maxFailures: 1, windowMs: WINDOW_MS });
    throttle.recordFailure("1.1.1.1", 0);
    assert.ok(throttle.retryAfterMs("1.1.1.1", 0) > 0);
    assert.equal(throttle.retryAfterMs("2.2.2.2", 0), 0);
  });

  test("unlocks once the window has passed", () => {
    const throttle = new LoginThrottle({ maxFailures: 1, windowMs: WINDOW_MS });
    throttle.recordFailure("1.1.1.1", 0);
    assert.equal(throttle.retryAfterMs("1.1.1.1", WINDOW_MS), 0);
  });

  test("a successful login clears earlier failures", () => {
    const throttle = new LoginThrottle({ maxFailures: 2, windowMs: WINDOW_MS });
    throttle.recordFailure("1.1.1.1", 0);
    throttle.recordSuccess("1.1.1.1");
    throttle.recordFailure("1.1.1.1", 0);
    assert.equal(throttle.retryAfterMs("1.1.1.1", 0), 0);
  });
});
