import { describe, expect, it, vi } from "vitest";
import { createInstallGate, type UpdaterInstaller } from "./installGate";

function gateWith(opts: { busy?: () => boolean; updater?: UpdaterInstaller | null }) {
  const events: string[] = [];
  const updater: UpdaterInstaller | null = opts.updater === undefined
    ? { quitAndInstall: vi.fn(() => { events.push("quitAndInstall"); }), install: vi.fn(() => { events.push("install"); return true; }) }
    : opts.updater;
  const gate = createInstallGate({
    getUpdater: () => updater,
    isBusy: () => { events.push("isBusy"); return opts.busy?.() ?? false; },
    markStarted: () => events.push("markStarted"),
    markFailed: () => events.push("markFailed"),
  });
  return { gate, events, updater };
}

describe("installIfIdleNow：同步判忙、同步调用", () => {
  it("返回的是值而不是 Promise；判忙 → 登记已开始 → 调用库，顺序固定", () => {
    const { gate, events } = gateWith({});
    const outcome = gate.installIfIdleNow("restart", 7);
    expect(outcome).toBe("started");
    expect(events).toEqual(["isBusy", "markStarted", "quitAndInstall"]);
    expect(gateWith({}).gate.installIfIdleNow("quit")).toBe("started");
  });

  it("忙：库一次都没调、也不登记已开始", () => {
    const { gate, events } = gateWith({ busy: () => true });
    expect(gate.installIfIdleNow("restart")).toBe("busy");
    expect(gate.installIfIdleNow("quit")).toBe("busy");
    expect(events).toEqual(["isBusy", "isBusy"]);
  });

  it("判忙抛错、没有更新器：判不准就拦 / 按失败，不调库", () => {
    const thrower = gateWith({ busy: () => { throw new Error("boom"); } });
    expect(thrower.gate.installIfIdleNow("restart")).toBe("busy");
    expect(gateWith({ updater: null }).gate.installIfIdleNow("quit")).toBe("failed");
  });

  it("库抛错 / 退出安装返回 false：撤回已开始，并复位库的「已调用」旗", () => {
    const updater: UpdaterInstaller = { quitAndInstall: () => { throw new Error("spawn EACCES"); }, install: () => false, quitAndInstallCalled: true };
    const { gate, events } = gateWith({ updater });
    expect(gate.installIfIdleNow("restart")).toBe("failed");
    expect(updater.quitAndInstallCalled).toBe(false);
    expect(events.at(-1)).toBe("markFailed");
    updater.quitAndInstallCalled = true;
    expect(gate.installIfIdleNow("quit")).toBe("failed");
    expect(updater.quitAndInstallCalled).toBe(false);
  });
});
