// 待决出价的读口跟着常驻生成面的**相**走（2026-09-14；2026-10-05 起它只喂对话投影，渲染层不再轮询它）。
//
// 2026-09-12：读通道从「回空」改成「抛」——对「装配抛了」是对的。
// 但它把「本会话按配置没装」（Canvas Performance harness 的 NOMI_DISABLE_CAPABILITY_CORE=1、
// 低内存模式）也一并抛成了失败：渲染层每 1.5s 画一张「会说话的卡」+ 一条 console error，
// #764 之后每条画布 PR 的性能门恒红，预算其实全过。
//
// 这一组钉住：相是 off（disabled / starting / stopped）→ `{ surface: "off" }`，不是失败也不是空；
// 相是 install-failed → `unreadable: surface-unavailable`；ready 但投影抛了 → `unreadable: projection-failed`；
// ready → 那几行。它们现在是推送里的值，不是一次被拒的 IPC——推送没有「拒绝」可言。
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });

async function load() {
  const [confirm, lifecycle] = await Promise.all([import("./appIntegrationSpendConfirm"), import("./residentSurfaceLifecycle")]);
  return { ...confirm, ...lifecycle };
}

const deps = { isProjectOpen: () => true, runs: { list: () => [], read: () => undefined } } as never;
const factory = (() => { throw new Error("not called"); }) as never;

describe("待决出价读口：三种现实，三种不同的答案", () => {
  it("按配置没装（harness / 低内存）→ off，带上为什么；不是失败", async () => {
    const m = await load();
    m.bootResidentSurfaceLifecycle({ env: { NOMI_DISABLE_CAPABILITY_CORE: "1" }, lowMemoryMode: false });
    expect(m.readPendingSpend("project-1")).toEqual({ surface: "off", phase: "disabled", reason: "env" });
  });

  it("能力核还在起 → off/starting；停了 → off/stopped", async () => {
    const m = await load();
    m.bootResidentSurfaceLifecycle({ env: {}, lowMemoryMode: false });
    expect(m.readPendingSpend("project-1")).toEqual({ surface: "off", phase: "starting" });
    m.installPendingSpendActions(deps);
    m.markResidentSurfaceReady(factory, m.readInstalledPendingSpend);
    m.installPendingSpendActions(null);
    m.markResidentSurfaceStopped();
    expect(m.readPendingSpend("project-1")).toEqual({ surface: "off", phase: "stopped" });
  });

  it("装配抛过 → unreadable/surface-unavailable：面板据此渲那张会说话的卡", async () => {
    const m = await load();
    m.markResidentSurfaceInstallFailed(new Error("resident adapter factory blew up"));
    expect(m.readPendingSpend("project-1")).toEqual({ surface: "unreadable", reason: "surface-unavailable" });
  });

  it("装起来之后就是正常的读：真的没有待确认时回 ready + 空数组", async () => {
    const m = await load();
    m.markResidentSurfaceInstallFailed(new Error("first attempt failed"));
    m.installPendingSpendActions(deps);
    m.markResidentSurfaceReady(factory, m.readInstalledPendingSpend);
    expect(m.readPendingSpend("project-1")).toEqual({ surface: "ready", rows: [] });
  });

  it("相说 ready、投影本身抛了（账本说在等却一镜都投影不出来）→ unreadable/projection-failed，不静默回空", async () => {
    const m = await load();
    m.markResidentSurfaceReady(factory, () => { throw new Error("pending_spend_projection_empty"); });
    expect(m.readPendingSpend("project-1")).toEqual({ surface: "unreadable", reason: "projection-failed" });
  });

  it("每次换相都通知订阅者（对话投影据此重读：能力核晚于窗口起来，起来那一刻卡要能出现）", async () => {
    const m = await load();
    const heard: string[] = [];
    const off = m.subscribeResidentSurfaceLifecycle(() => heard.push(m.readResidentSurfaceLifecycle().phase));
    m.bootResidentSurfaceLifecycle({ env: {}, lowMemoryMode: false });
    m.markResidentSurfaceReady(factory, m.readInstalledPendingSpend);
    m.markResidentSurfaceInstallFailed(new Error("x"));
    m.markResidentSurfaceStopped();
    off();
    m.markResidentSurfaceStarting();
    expect(heard).toEqual(["starting", "ready", "install-failed", "stopped"]);
  });
});
