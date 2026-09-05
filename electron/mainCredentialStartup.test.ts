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

  // 「只在真的改了文件时才提示」这道闸建在能力核里（appIntegration 的 repair.changed），
  // 主进程只负责把「该重启谁」原样递给渲染层。两半各自有真单测（mcpConfig.test 的 changed 判定、
  // capabilityApplyHandler.integration.test 的 toast），这里守的是中间那根线还接着。
  it("only forwards the host restart notice after a real config write", () => {
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const repair = source.indexOf("onMcpConfigRepaired:");
    const request = source.indexOf("requestRenderer('host-config.repaired'", repair);
    expect(repair).toBeGreaterThanOrEqual(0);
    expect(request).toBeGreaterThan(repair);
    // 名单原样透传：主进程不许自己挑一个客户端名写死（Cursor / Codex / 自建 profile 同样被修）。
    expect(source.slice(repair, request + 200)).toContain("clients: clientLabels");
    const integration = fs.readFileSync(new URL("./capabilityCore/appIntegration.ts", import.meta.url), "utf8");
    const repairResult = integration.indexOf("const repair = repairStaleMcpConfigs()");
    const changedGuard = integration.indexOf("if (repair.changed)", repairResult);
    expect(repairResult).toBeGreaterThanOrEqual(0);
    expect(changedGuard).toBeGreaterThan(repairResult);
  });
});
