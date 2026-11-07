import { afterEach, describe, expect, it, vi } from "vitest";

// hasInFlightProductionWork 是「还有活没干完」的唯一 owner（后台自动退出、更新重启安装都问它）：
// 任务缓存、制作流程 Run、导出三类，缺一类都会让更新把活打断。
async function loadOwner(parts: { tasks?: boolean; exports?: number; runs?: string[]; throwRuns?: boolean }) {
  vi.resetModules();
  vi.doMock("electron", () => ({ app: { dock: undefined }, BrowserWindow: class {} }));
  vi.doMock("./tasks/taskCache", () => ({ hasInFlightTasks: () => parts.tasks ?? false }));
  vi.doMock("./export/exportJobs", () => ({ activeExportCount: () => parts.exports ?? 0 }));
  vi.doMock("./runtimePaths", () => ({ getWorkspaceRepositoryDeps: () => ({ settingsRoot: "unused", defaultProjectsRoot: "unused" }) }));
  vi.doMock("./workspace/workspaceRegistry", () => ({ listRegisteredProjectIds: () => ["p1"] }));
  vi.doMock("./productionRun/productionRunRuntime", () => ({
    getProductionRunService: () => {
      if (parts.throwRuns) throw new Error("not ready");
      return { repository: { list: () => (parts.runs ?? []).map((status) => ({ status })) } };
    },
  }));
  return import("./backgroundLaunch");
}

async function load(parts: Parameters<typeof loadOwner>[0]) { return (await loadOwner(parts)).hasInFlightProductionWork; }

afterEach(() => vi.resetModules());

describe("hasInFlightProductionWork", () => {
  it("什么都没有：false", async () => expect((await load({}))()).toBe(false));
  it("只有主进程任务缓存里的异步生成：true", async () => expect((await load({ tasks: true }))()).toBe(true));
  it("只有导出在跑：true", async () => expect((await load({ exports: 1 }))()).toBe(true));
  it("只有制作流程 Run 在跑 / 暂停中 / 导出中：true；已完成：false", async () => {
    for (const status of ["ready", "running", "exporting", "pausing"]) expect((await load({ runs: [status] }))()).toBe(true);
    expect((await load({ runs: ["completed"] }))()).toBe(false);
  });
  it("读不出状态：按忙算", async () => expect((await load({ throwRuns: true }))()).toBe(true));
});


describe("关闭与更新复用工作单例", () => {
  it.each([
    ["idle", {}, false], ["export-only", { exports: 1 }, true],
    ["empty-ready", { runs: ["ready"] as string[] }, true], ["read-failure", { throwRuns: true }, true],
  ] as const)("%s 保留原主进程宽判据，并要求渲染层已报告", async (_label, parts, busy) => {
    const { productionWorkBusyGate: gate } = await loadOwner(parts);
    expect(gate.isBusyForInstall(10)).toBe(true);
    gate.report(10, 0); expect(gate.isBusyForInstall(10)).toBe(busy);
    gate.report(10, 2); expect(gate.isBusyForInstall(10)).toBe(true);
    gate.forget(10); expect(gate.isBusyForInstall(10)).toBe(true);
    expect(gate.isBusyAtQuit()).toBe(busy);
  });
});
