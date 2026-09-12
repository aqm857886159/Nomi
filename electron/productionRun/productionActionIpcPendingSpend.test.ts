// 「读不到」和「没有」必须是两种不同的结果（2026-09-12）。
//
// 这条通道原来写的是 `try { … } catch { return [] }`，理由是「能力核还没起来时抛异常会把面板
// 打成错误态」。那句话把两件事说成了一件：
//
//   · 「现在没有要确认的东西」——空数组，对；
//   · 「我读不到，不知道有没有」——**也回了空数组**，于是面板安安静静什么都不画，
//     而模型那头刚刚告诉用户「请在确认卡中批准」。用户看到的是沉默（2026-09-11 真实反馈）。
//
// 这一组钉住三种输入对三种输出：没打开这个项目 → 空（真的没有）；能力核拒绝 → **拒绝**
// （渲染层据此渲那张会说话的卡）；正常 → 那几行。
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

const ROW = { operationId: "op-1", projectId: "project-1", shots: [] } as const;

function register(listPendingSpendConfirmations: (projectId: string) => readonly unknown[]) {
  registerProductionActionIpc({
    getActiveProjectId: () => "project-1",
    loadCore: async () => ({ listPendingSpendConfirmations } as never),
  });
  return handlers.get("nomi:production-runs:pending-spend")!;
}

describe("pending-spend 读通道：读不到 ≠ 没有", () => {
  beforeEach(() => handlers.clear());

  it("正常读得到就回那几行", async () => {
    const read = register(() => [ROW]);
    await expect(read(trustedEvent(), { projectId: "project-1" })).resolves.toEqual([ROW]);
  });

  it("不是当前打开的项目 → 空数组。这是**真的没有**：那笔生成没有人在看着这张卡", async () => {
    const list = vi.fn(() => [ROW]);
    const read = register(list);
    await expect(read(trustedEvent(), { projectId: "project-2" })).resolves.toEqual([]);
    await expect(read(trustedEvent(), {})).resolves.toEqual([]);
    // 不惊动能力核：跨项目的读压根不该走到那一层。
    expect(list).not.toHaveBeenCalled();
  });

  it("能力核拒绝 → 这次调用**拒绝**，不再被洗成空数组", async () => {
    const read = register(() => {
      throw Object.assign(new Error("Pending spend confirmations cannot be read"), { code: "spend_confirm_surface_unavailable" });
    });
    await expect(read(trustedEvent(), { projectId: "project-1" })).rejects.toThrow(/cannot be read/);
  });

  it("失败原因一路带到渲染层：它要靠这句话说出「断在哪一环」", async () => {
    const read = register(() => { throw new Error("spend_confirm_surface_unavailable: boom"); });
    await expect(read(trustedEvent(), { projectId: "project-1" })).rejects.toThrow(/spend_confirm_surface_unavailable/);
  });
});
