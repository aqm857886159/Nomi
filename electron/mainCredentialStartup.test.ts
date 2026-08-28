import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop credential startup ordering", () => {
  it("registers the independent Surface IPC before creating the first window or starting capability core", () => {
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const readyBlock = source.slice(source.indexOf("app\n    .whenReady()"));
    const registerIpc = readyBlock.indexOf("registerIpc();");
    const createWindow = readyBlock.indexOf("await createWindow();");
    const capabilityStart = readyBlock.indexOf("void startDesktopCapabilityCore().catch");
    const registerIpcBody = source.slice(source.indexOf("function registerIpc(): void"), source.indexOf("registerI18nIpc();"));
    const runtimeSource = fs.readFileSync(new URL("./capabilityCore/canvasReadMainRuntime.ts", import.meta.url), "utf8");

    expect(registerIpcBody).toContain("const canvasReadExecutionRuntime = registerDesktopCanvasReadRuntime();");
    expect(runtimeSource).toContain("const surfaceCapture = registerCanvasReadSurfaceIpc({");
    expect(runtimeSource).toContain("const execution = registerMainCanvasReadExecutionRuntime({");
    expect(runtimeSource).not.toContain("registerAgentChatV2Ipc");
    expect(source).toContain("installProductionProjectAgentHost({");
    expect(source).toContain("registerProjectAgentIpc({");
    expect(source).toContain("surfaceCapture: canvasReadExecutionRuntime.surfaceCapture");
    expect(source).toContain("desktopCanvasReadExecutionRuntime = canvasReadExecutionRuntime;")
    const startDesktopCore = source.slice(source.indexOf("async function startDesktopCapabilityCore"), source.indexOf("function stopDesktopCapabilityCore"))
    expect(startDesktopCore).toContain("canvasReadExecutionRuntime: desktopCanvasReadExecutionRuntime")
    expect(registerIpc).toBeGreaterThanOrEqual(0);
    expect(createWindow).toBeGreaterThan(registerIpc);
    expect(capabilityStart).toBeGreaterThan(createWindow);
  });

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
});
