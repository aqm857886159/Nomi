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

  // 「只在真的改了文件时才提示」这道闸建在能力核起来的那一刻（appIntegration 的 repair.changed）。
  // 这条读源码是因为 appIntegration 一 import 就要整个 Electron app，vitest 里起不来；
  // 它两头的真单测在别处：mcpConfig.test 管 changed 怎么算，hostConfigRepairNotice.test 管这条怎么送。
  it("only announces the host restart notice after a real config write", () => {
    const integration = fs.readFileSync(new URL("./capabilityCore/appIntegration.ts", import.meta.url), "utf8");
    const repairResult = integration.indexOf("const repair = repairStaleMcpConfigs()");
    const changedGuard = integration.indexOf("if (repair.changed)", repairResult);
    const notify = integration.indexOf("notifyHostConfigRepaired(", changedGuard);
    expect(repairResult).toBeGreaterThanOrEqual(0);
    expect(changedGuard).toBeGreaterThan(repairResult);
    expect(notify).toBeGreaterThan(changedGuard);
    // 名单原样透传：不许在这里挑一个客户端名写死（Cursor / Codex / 自建 profile 走的是同一个修复函数）。
    expect(integration.slice(changedGuard, notify + 120)).toContain("repair.repaired.map((item) => item.label)");
  });
});
