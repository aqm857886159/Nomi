// 付费确认卡读通道的答案跟着常驻生成面的**相**走（2026-09-14）。
//
// 2026-09-12：读通道从「回空」改成「抛」——对「装配抛了」是对的。
// 但它把「本会话按配置没装」（Canvas Performance harness 的 NOMI_DISABLE_CAPABILITY_CORE=1、
// 低内存模式）也一并抛成了失败：渲染层每 1.5s 画一张「会说话的卡」+ 一条 console error，
// #764 之后每条画布 PR 的性能门恒红，预算其实全过。
//
// 这一组钉住：相是 off（disabled / starting / stopped）→ `{ surface: "off" }`，不抛也不回空；
// 相是 install-failed → 抛，原话在错误里；相是 ready → 那几行。
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });

async function load() {
  const [confirm, lifecycle] = await Promise.all([import("./appIntegrationSpendConfirm"), import("./residentSurfaceLifecycle")]);
  return { ...confirm, ...lifecycle };
}

const deps = { isProjectOpen: () => true, runs: { list: () => [], read: () => undefined } } as never;
const factory = (() => { throw new Error("not called"); }) as never;

describe("付费确认卡读通道：三种现实，三种不同的答案", () => {
  it("按配置没装（harness / 低内存）→ off，带上为什么；不是失败", async () => {
    const m = await load();
    m.bootResidentSurfaceLifecycle({ env: { NOMI_DISABLE_CAPABILITY_CORE: "1" }, lowMemoryMode: false });
    expect(m.listPendingSpendConfirmations("project-1")).toEqual({ surface: "off", phase: "disabled", reason: "env" });
  });

  it("能力核还在起 → off/starting；停了 → off/stopped", async () => {
    const m = await load();
    m.bootResidentSurfaceLifecycle({ env: {}, lowMemoryMode: false });
    expect(m.listPendingSpendConfirmations("project-1")).toEqual({ surface: "off", phase: "starting" });
    m.markResidentSurfaceReady(factory);
    m.installPendingSpendActions(deps);
    m.installPendingSpendActions(null);
    m.markResidentSurfaceStopped();
    expect(m.listPendingSpendConfirmations("project-1")).toEqual({ surface: "off", phase: "stopped" });
  });

  it("装配抛过 → 抛，原话进错误消息，带稳定 code——渲染层据此渲那张会说话的卡", async () => {
    const m = await load();
    m.markResidentSurfaceInstallFailed(new Error("resident adapter factory blew up"));
    expect(() => m.listPendingSpendConfirmations("project-1")).toThrow(m.PendingSpendSurfaceUnavailableError);
    expect(() => m.listPendingSpendConfirmations("project-1")).toThrow(/resident adapter factory blew up/);
    try {
      m.listPendingSpendConfirmations("project-1");
      expect.unreachable("读通道必须抛");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("spend_confirm_surface_unavailable");
    }
  });

  it("装起来之后就是正常的读：真的没有待确认时回 ready + 空数组", async () => {
    const m = await load();
    m.markResidentSurfaceInstallFailed(new Error("first attempt failed"));
    m.installPendingSpendActions(deps);
    m.markResidentSurfaceReady(factory);
    expect(m.listPendingSpendConfirmations("project-1")).toEqual({ surface: "ready", rows: [] });
  });

  it("相说 ready 却没装 actions = 装配顺序被人改坏了 → 抛，不静默回空", async () => {
    const m = await load();
    m.markResidentSurfaceReady(factory);
    expect(() => m.listPendingSpendConfirmations("project-1")).toThrow(/never installed/);
  });
});
