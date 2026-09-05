import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop credential startup ordering", () => {
  it("does not expose the external capability listener until the initial window has finished loading", () => {
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const readyBlock = source.slice(source.indexOf("app\n    .whenReady()"));
    const createWindow = readyBlock.indexOf("await createWindow();");
    const capabilityStart = readyBlock.indexOf("void startDesktopCapabilityCore().catch");
    const capabilityFailure = readyBlock.indexOf("startCapabilityCore failed", capabilityStart);

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

  it("only forwards the Claude restart notice after a real config write", () => {
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const repair = source.indexOf("onMcpConfigRepaired: async");
    const guard = source.indexOf("if (!clients.includes('claude')) return", repair);
    const request = source.indexOf("requestRenderer('host-config.repaired'", guard);
    expect(repair).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(repair);
    expect(request).toBeGreaterThan(guard);
    const integration = fs.readFileSync(new URL("./capabilityCore/appIntegration.ts", import.meta.url), "utf8");
    const repairResult = integration.indexOf("const repair = repairStaleMcpConfigs()");
    const changedGuard = integration.indexOf("if (repair.changed)", repairResult);
    expect(repairResult).toBeGreaterThanOrEqual(0);
    expect(changedGuard).toBeGreaterThan(repairResult);
  });
});
