import { describe, expect, it } from "vitest";
import { createUpdateBusyGate } from "./updateBusyGate";

describe("updateBusyGate：判不准就拦", () => {
  it("没报过数的窗口、读主进程状态抛错，都按忙算", () => {
    expect(createUpdateBusyGate({ hasMainBusy: () => false }).isBusyForInstall(1)).toBe(true);
    const gate = createUpdateBusyGate({ hasMainBusy: () => { throw new Error("boom"); } });
    gate.report(1, 0);
    expect(gate.isBusyForInstall(1)).toBe(true);
    expect(gate.isBusyAtQuit()).toBe(true);
  });

  it("渲染层报了排队任务 / 主进程自己有活：忙；都为 0：放行", () => {
    let main = false;
    const gate = createUpdateBusyGate({ hasMainBusy: () => main });
    gate.report(1, 2);
    expect(gate.isBusyForInstall(1)).toBe(true);
    gate.report(1, 0);
    expect(gate.isBusyForInstall(1)).toBe(false);
    main = true;
    expect(gate.isBusyForInstall(1)).toBe(true);
  });

  it("窗口销毁后它的报告不再算（退出时窗口已关，不会被陈旧报告卡死）", () => {
    const gate = createUpdateBusyGate({ hasMainBusy: () => false });
    gate.report(1, 3);
    expect(gate.isBusyAtQuit()).toBe(true);
    gate.forget(1);
    expect(gate.isBusyAtQuit()).toBe(false);
  });

  it("非法数值按 0 记，不会变成忙", () => {
    const gate = createUpdateBusyGate({ hasMainBusy: () => false });
    gate.report(1, Number.NaN);
    expect(gate.isBusyForInstall(1)).toBe(false);
  });
});
