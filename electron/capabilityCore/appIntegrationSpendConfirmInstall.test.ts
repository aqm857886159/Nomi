// 装配失败**不许只留一行日志**（2026-09-12）。
//
// `appIntegration` 那段装配裹在一个 `catch` 里：失败只落一行日志，然后 `actions` 在整个会话里
// 恒为 `null`。而读通道原来是 `actions?.listPendingSpend(projectId) ?? []`——一个**会话级的
// 静默开关**：从此每一笔付费草稿都查无此卡，而模型还在一句句告诉用户「请在确认卡上点头」。
// 日志在开发机上没人看，用户那头只有空面板。
//
// 这一组钉住：没装起来就**抛**，而且抛得出原因；真的装起来了才回那几行。
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });

async function load() {
  return import("./appIntegrationSpendConfirm");
}

describe("付费确认卡读通道：没装起来是失败，不是空", () => {
  it("能力核没装 → 抛，而不是回空数组", async () => {
    const module = await load();
    expect(() => module.listPendingSpendConfirmations("project-1")).toThrow(module.PendingSpendSurfaceUnavailableError);
    expect(() => module.listPendingSpendConfirmations("project-1")).toThrow(/not installed/);
  });

  it("装配抛过的那次，原话进错误消息——渲染层据此说得出「断在哪一环」", async () => {
    const module = await load();
    module.recordPendingSpendInstallFailure(new Error("resident adapter factory blew up"));
    expect(() => module.listPendingSpendConfirmations("project-1")).toThrow(/resident adapter factory blew up/);
    // 错误带着稳定的 code：渲染层按它分流到那张会说话的卡，不靠猜文案。
    try {
      module.listPendingSpendConfirmations("project-1");
      expect.unreachable("读通道必须抛");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("spend_confirm_surface_unavailable");
    }
  });

  it("非 Error 的失败原因也说得出口（别把它吃成 [object Object]）", async () => {
    const module = await load();
    module.recordPendingSpendInstallFailure("core token missing");
    expect(() => module.listPendingSpendConfirmations("project-1")).toThrow(/core token missing/);
  });

  it("装起来之后就是正常的读：真的没有待确认时回空数组", async () => {
    const module = await load();
    module.recordPendingSpendInstallFailure(new Error("first attempt failed"));
    module.installPendingSpendActions({
      isProjectOpen: () => true, runs: { list: () => [], read: () => undefined },
    } as never);
    expect(module.listPendingSpendConfirmations("project-1")).toEqual([]);
  });

  it("装配被显式撤下（`install(null)`）→ 回到「抛」，不是悄悄回空", async () => {
    const module = await load();
    module.installPendingSpendActions({ isProjectOpen: () => true, runs: { list: () => [], read: () => undefined } } as never);
    module.installPendingSpendActions(null);
    expect(() => module.listPendingSpendConfirmations("project-1")).toThrow(module.PendingSpendSurfaceUnavailableError);
  });
});
