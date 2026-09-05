import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop credential startup ordering", () => {
  it("does not expose the external capability listener until the initial window has finished loading", () => {
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const readyBlock = source.slice(source.indexOf("app\n    .whenReady()"));
    const createWindow = readyBlock.indexOf("await createWindow();");
    const capabilityStart = readyBlock.indexOf("void startDesktopCapabilityCore().catch");
    // 锚点跟着改名走：console.* 收口后这一句是 logError("capability", "start-failed", …)。
    const capabilityFailure = readyBlock.indexOf('logError("capability", "start-failed"', capabilityStart);

    expect(createWindow).toBeGreaterThanOrEqual(0);
    expect(capabilityStart).toBeGreaterThan(createWindow);
    expect(capabilityFailure).toBeGreaterThan(capabilityStart);
  });

  it("does not schedule relay credential resolution until the initial window has finished loading", () => {
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const readyBlock = source.slice(source.indexOf("app\n    .whenReady()"));
    const createWindow = readyBlock.indexOf("await createWindow();");
    const delayedBackgroundWork = readyBlock.indexOf("setTimeout(", createWindow);
    const relayMaintenance = readyBlock.indexOf("scheduleRelayNativeWireUpgrade");

    expect(createWindow).toBeGreaterThanOrEqual(0);
    expect(delayedBackgroundWork).toBeGreaterThan(createWindow);
    expect(relayMaintenance).toBeGreaterThan(delayedBackgroundWork);
  });
});
