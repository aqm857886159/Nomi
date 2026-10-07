// 付费确认卡的 IPC 通道（2026-09-11 起）。读通道的那一组（「读不到 ≠ 没有」，2026-09-12）随 2026-10-05
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
describe("pending-spend 读通道已删：卡只随对话投影推过来", () => {
  beforeEach(() => handlers.clear());

  it("注册完付费卡的动作通道之后，没有任何一条「读待决出价」的 IPC", () => {
    registerProductionActionIpc({ getActiveProjectId: () => "project-1", loadCore: async () => ({}) as never });
    expect(handlers.has("nomi:production-runs:revise-spend"), "动作通道照旧在").toBe(true);
    expect([...handlers.keys()].filter((channel) => /pending-spend|pendingSpend/.test(channel))).toEqual([]);
  });
});

// 「生成剩下 N 张」（2026-10-01）：渲染层只递「用户点的是这几张」，批不批、一张张怎么封由主进程决定。
describe("confirm-spend-remaining 通道：只转达点名的那一叠", () => {
  beforeEach(() => handlers.clear());

  function registerRemaining(confirmRemainingSpendShots: (input: unknown) => unknown) {
    registerProductionActionIpc({
      getActiveProjectId: () => "project-1",
      loadCore: async () => ({ confirmRemainingSpendShots } as never),
    });
    return handlers.get("nomi:production-runs:confirm-spend-remaining")!;
  }

  it("点名的镜原样递到能力核（去掉空白、只留字符串）", async () => {
    const forward = vi.fn(async () => ({ ok: true, code: "spend_confirmed" }));
    const confirm = registerRemaining(forward);
    await expect(confirm(trustedEvent(), { projectId: "project-1", operationId: "op-1", quoteId: " q-1 ", shotIds: [" s1 ", "s2", 3, ""] }))
      .resolves.toEqual({ ok: true, code: "spend_confirmed" });
    expect(forward).toHaveBeenCalledWith({ projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotIds: ["s1", "s2"] });
  });

  it("一张都没点名 → 当场拒绝，不惊动能力核", async () => {
    const forward = vi.fn();
    const confirm = registerRemaining(forward);
    await expect(confirm(trustedEvent(), { projectId: "project-1", operationId: "op-1", quoteId: "q-1", shotIds: [] }))
      .resolves.toEqual({ ok: false, code: "failed", message: "generation_scope_invalid" });
    expect(forward).not.toHaveBeenCalled();
  });

  it("不是当前打开的项目 → run_not_open，不惊动能力核", async () => {
    const forward = vi.fn();
    const confirm = registerRemaining(forward);
    await expect(confirm(trustedEvent(), { projectId: "project-2", operationId: "op-1", quoteId: "q-1", shotIds: ["s1", "s2"] }))
      .resolves.toEqual({ ok: false, code: "run_not_open" });
    expect(forward).not.toHaveBeenCalled();
  });
});
