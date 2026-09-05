import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runRealUserLongVideoJourney } from "./real-user-long-video.runner.mjs";

describe("real user long-video journey boundary", () => {
  it("rejects direct store injection before any journey step can pass", async () => {
    const events = [];
    const unsafeDriver = {
      async injectStore() {
        events.push("store-injected");
      },
    };

    await assert.rejects(
      () => runRealUserLongVideoJourney({ driver: unsafeDriver, record: (event) => events.push(event) }),
      /ui_boundary_required/,
    );
    assert.deepEqual(events, []);
  });
});
