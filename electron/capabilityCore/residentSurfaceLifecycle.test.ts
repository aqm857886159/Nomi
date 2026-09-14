// 常驻生成面「装没装起来」只有一个 owner（2026-09-14）。
//
// 这组钉住五种相各自是各自的：按配置关掉 ≠ 还在起 ≠ 装配抛了 ≠ 已停 ≠ 就绪。
// 2026-09-14 之前它们是一个 null：Canvas Performance 的 harness 用 NOMI_DISABLE_CAPABILITY_CORE=1
// 关掉能力核，读通道把「没起过」当成「装配失败」抛出去，渲染层每 1.5s 一条 console error，
// #764 之后每一条画布 PR 的性能门都红——预算其实全过。
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });

async function load() {
  return import("./residentSurfaceLifecycle");
}

const factory = (() => { throw new Error("not called"); }) as never;

describe("boot：从 env 判「本会话装不装」", () => {
  it("NOMI_DISABLE_CAPABILITY_CORE=1 → disabled/env", async () => {
    const m = await load();
    expect(m.bootResidentSurfaceLifecycle({ env: { NOMI_DISABLE_CAPABILITY_CORE: "1" }, lowMemoryMode: false })).toEqual({ phase: "disabled", reason: "env" });
    expect(m.readResidentSurfaceLifecycle().phase).toBe("disabled");
  });
  it("低内存模式默认不装（除非 NOMI_KEEP_CAPABILITY_CORE=1）", async () => {
    const m = await load();
    expect(m.bootResidentSurfaceLifecycle({ env: {}, lowMemoryMode: true })).toEqual({ phase: "disabled", reason: "low-memory" });
    expect(m.bootResidentSurfaceLifecycle({ env: { NOMI_KEEP_CAPABILITY_CORE: "1" }, lowMemoryMode: true })).toEqual({ phase: "starting" });
  });
  it("正常启动 → starting；能力核装到那一步之前工厂就是 undefined，但相不是失败", async () => {
    const m = await load();
    expect(m.bootResidentSurfaceLifecycle({ env: {}, lowMemoryMode: false })).toEqual({ phase: "starting" });
    expect(m.residentGenerationFactory()).toBeUndefined();
  });
});

describe("装配的三种结局", () => {
  it("ready 带着工厂：lane 从这里、也只从这里拿生成适配器工厂", async () => {
    const m = await load();
    m.markResidentSurfaceReady(factory);
    expect(m.readResidentSurfaceLifecycle()).toEqual({ phase: "ready", factory });
    expect(m.residentGenerationFactory()).toBe(factory);
  });
  it("install-failed 记下原话，工厂随之撤掉", async () => {
    const m = await load();
    m.markResidentSurfaceReady(factory);
    m.markResidentSurfaceInstallFailed(new Error("resident adapter factory blew up"));
    expect(m.readResidentSurfaceLifecycle()).toEqual({ phase: "install-failed", reason: "resident adapter factory blew up" });
    expect(m.residentGenerationFactory()).toBeUndefined();
  });
  it("非 Error 的失败原因也说得出口", async () => {
    const m = await load();
    m.markResidentSurfaceInstallFailed("core token missing");
    expect(m.readResidentSurfaceLifecycle()).toEqual({ phase: "install-failed", reason: "core token missing" });
  });
  it("stopped：退出/重启能力核时撤下，再 starting 就回到起点", async () => {
    const m = await load();
    m.markResidentSurfaceReady(factory);
    m.markResidentSurfaceStopped();
    expect(m.readResidentSurfaceLifecycle()).toEqual({ phase: "stopped" });
    expect(m.residentGenerationFactory()).toBeUndefined();
    m.markResidentSurfaceStarting();
    expect(m.readResidentSurfaceLifecycle()).toEqual({ phase: "starting" });
  });
});

describe("给模型看的那句话：每种相各说各的，不再是一个光秃秃的 code", () => {
  it.each([
    [{ env: { NOMI_DISABLE_CAPABILITY_CORE: "1" }, lowMemoryMode: false }, /disabled in this session.*NOMI_DISABLE_CAPABILITY_CORE/],
    [{ env: {}, lowMemoryMode: true }, /low-memory mode/],
    [{ env: {}, lowMemoryMode: false }, /still starting/],
  ] as const)("boot %j → %s", async (input, pattern) => {
    const m = await load();
    m.bootResidentSurfaceLifecycle(input);
    expect(m.residentGenerationUnavailableMessage()).toMatch(pattern);
  });
  it("装配抛了 → 原话在句子里；停了 → 说停了", async () => {
    const m = await load();
    m.markResidentSurfaceInstallFailed(new Error("keychain locked"));
    expect(m.residentGenerationUnavailableMessage()).toMatch(/failed to install.*keychain locked/);
    m.markResidentSurfaceStopped();
    expect(m.residentGenerationUnavailableMessage()).toMatch(/stopped/);
  });
});
