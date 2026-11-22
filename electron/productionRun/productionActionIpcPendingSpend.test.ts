// 付费卡的 IPC 通道（2026-09-11 起；D2 第③步收成四条动作）。读通道的那一组（「读不到 ≠ 没有」，2026-09-12）随 2026-10-05
// 付费卡并进对话投影一起移走：待决出价不再被渲染层拉，而是随对话投影推过去。
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const harness = vi.hoisted(() => {
  const MAIN_FRAME_ROUTING_ID = 7;
  const APP_ENTRY_URL = "file:///app/index.html";
  const byContents = new Map<object, object>();
  class FakeBrowserWindow {
    readonly webContents: { mainFrame: { routingId: number }; isDestroyed(): boolean; getURL(): string };
    constructor() {
      this.webContents = {
        mainFrame: { routingId: MAIN_FRAME_ROUTING_ID },
        isDestroyed: () => false,
        getURL: () => APP_ENTRY_URL,
      };
      byContents.set(this.webContents, this);
    }
    isDestroyed(): boolean { return false; }
    static fromWebContents(contents: object): object | null { return byContents.get(contents) ?? null; }
  }
  return { FakeBrowserWindow, MAIN_FRAME_ROUTING_ID, APP_ENTRY_URL };
});

vi.mock("electron", () => ({
  BrowserWindow: harness.FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerProductionActionIpc } from "./productionActionIpc";
import { setMainWindow } from "../appWindowRegistry";

function trustedEvent(): { sender: unknown; senderFrame: unknown } {
  const win = new harness.FakeBrowserWindow();
  setMainWindow(win as never);
  return {
    sender: win.webContents,
    senderFrame: { routingId: harness.MAIN_FRAME_ROUTING_ID, url: harness.APP_ENTRY_URL },
  };
}

// 2026-10-05 付费卡并进对话投影：渲染层**没有**去拉待决出价的通道了——它随对话投影推过来
// （`electron/agentLane/laneDesktopSpend.ts`）。「读不到 ≠ 没有」那三种现实搬进了推送的值本身
// （`PendingSpendRead.unreadable`，见 `appIntegrationSpendConfirmInstall.test.ts`）。这一条守的是轮询别长回来。
// D2 第③步：卡上没有参数了，「改参数」「确认这一张」「确认剩下」三条通道随旧卡删掉；卡只剩交给画布 / 取消 / 不生成 × / 恢复。
describe("付费卡的动作通道：只剩交给画布 / 取消 / 不生成 / 恢复，没有读通道", () => {
  beforeEach(() => handlers.clear());

  it("注册完之后正好这四条动作通道；没有任何一条「读待决出价」或改参数 / 逐镜确认的 IPC", () => {
    registerProductionActionIpc({ getActiveProjectId: () => "project-1", loadCore: async () => ({}) as never });
    const spend = [...handlers.keys()].filter((channel) => /spend/.test(channel)).sort();
    expect(spend).toEqual([
      "nomi:production-runs:discard-spend",
      "nomi:production-runs:hand-over-spend",
      "nomi:production-runs:remove-spend-shot",
      "nomi:production-runs:restore-spend-shot",
    ]);
    expect([...handlers.keys()].filter((channel) => /pending-spend|pendingSpend|revise-spend|confirm-spend/.test(channel))).toEqual([]);
  });
});

// 「生成」/「全部生成（N）」/「生成剩下 N 段」（D2 第③步）：渲染层只递「用户点的是这几镜」和托管那一句他看过没有，
// 交不交、怎么交（逐镜走画布单节点提交）由主进程决定。
describe("hand-over-spend 通道：只转达点名的那几镜", () => {
  beforeEach(() => handlers.clear());

  function registerHandOver(handOverPendingSpendShots: (input: unknown) => unknown) {
    registerProductionActionIpc({
      getActiveProjectId: () => "project-1",
      loadCore: async () => ({ handOverPendingSpendShots } as never),
    });
    return handlers.get("nomi:production-runs:hand-over-spend")!;
  }

  it("点名的镜原样递到能力核（去掉空白、只留字符串）；托管只认显式 true", async () => {
    const forward = vi.fn(async () => ({ ok: true, code: "handed_over" }));
    const handOver = registerHandOver(forward);
    await expect(handOver(trustedEvent(), { projectId: "project-1", operationId: "op-1", quoteId: " q-1 ", shotIds: [" s1 ", "s2", 3, ""], hostingAllowed: "yes" }))
      .resolves.toEqual({ ok: true, code: "handed_over" });
    expect(forward).toHaveBeenCalledWith({ projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotIds: ["s1", "s2"] });
    await handOver(trustedEvent(), { projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotIds: ["s1"], presentationId: "p-1", presentationEpoch: 2, planVersion: 4 });
    expect(forward).toHaveBeenLastCalledWith({ projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotIds: ["s1"], presentationId: "p-1", presentationEpoch: 2, planVersion: 4 });
  });

  it("一镜都没点名 → 当场拒绝，不惊动能力核", async () => {
    const forward = vi.fn();
    const handOver = registerHandOver(forward);
    await expect(handOver(trustedEvent(), { projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotIds: [] }))
      .resolves.toEqual({ ok: false, code: "failed", message: "generation_scope_invalid" });
    expect(forward).not.toHaveBeenCalled();
  });

  it("不是当前打开的项目 → run_not_open，不惊动能力核", async () => {
    const forward = vi.fn();
    const handOver = registerHandOver(forward);
    await expect(handOver(trustedEvent(), { projectId: "project-2", operationId: "op-1", quoteId: "q-1", shotIds: ["s1", "s2"] }))
      .resolves.toEqual({ ok: false, code: "run_not_open" });
    expect(forward).not.toHaveBeenCalled();
  });
});

// 「不生成 ×」与「恢复」：一镜一下，可撤回；没点名哪一镜当场拒。
describe("remove-spend-shot / restore-spend-shot：一镜一下", () => {
  beforeEach(() => handlers.clear());

  it.each([
    ["nomi:production-runs:remove-spend-shot", "removePendingSpendShot"],
    ["nomi:production-runs:restore-spend-shot", "restorePendingSpendShot"],
  ])("%s 只递那一镜；没点名就拒", async (channel, method) => {
    const forward = vi.fn(async () => ({ ok: true }));
    registerProductionActionIpc({ getActiveProjectId: () => "project-1", loadCore: async () => ({ [method]: forward } as never) });
    const call = handlers.get(channel)!;
    await expect(call(trustedEvent(), { projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotId: " s2 " })).resolves.toEqual({ ok: true });
    expect(forward).toHaveBeenCalledWith({ projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotId: "s2" });
    await expect(call(trustedEvent(), { projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotId: "" }))
      .resolves.toEqual({ ok: false, code: "failed", message: "generation_scope_invalid" });
    expect(forward).toHaveBeenCalledTimes(1);
  });
});
