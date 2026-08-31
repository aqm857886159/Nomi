// downloadAssetToDisk 行为集成测（「下载改保存名闪退」根因修复的逻辑铁证）。
// 崩溃本身在 Windows 原生层、mac 复现不出；但根因修复的**逻辑分支**能在这里锁死：
//   ① 改名场景（对话框返回的 filePath ≠ 默认名）→ 写到用户改后的路径；
//   ② 父窗口：永不传（2026-08-12 根因——传父窗口=跨线程持有属主，搜狗输入法一打字整个 app 崩）；
//   ③ 单飞：对话框不再 modal，系统不替我们挡第二次点击，得自己挡，别开出两个原生对话框；
//   ④ 面包屑：进对话框前同步落盘，原生崩溃时日志最后一行就是崩点铁证；
//   ⑤ native/IO 异常 → 落 crashLog + 返回失败，绝不冒泡成 unhandledRejection；⑥ 取消不写盘。
// 「不许传父窗口」这条还有一条全仓扫描的结构闸：electron/nativeDialogParent.invariant.test.ts。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  hardenedFetch: vi.fn(),
  logCrash: vi.fn(),
  logBreadcrumb: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/dl" },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}));
vi.mock("../hardenedFetch", () => ({ hardenedFetch: mocks.hardenedFetch }));
vi.mock("../crashLog", () => ({ logCrash: mocks.logCrash, logBreadcrumb: mocks.logBreadcrumb }));
vi.mock("../projects/repository", () => ({ resolveProjectRelativePath: (p: string, r: string) => `/proj/${p}/${r}` }));
vi.mock("./downloadPrefs", () => ({
  getLastDownloadDir: () => "",
  pickDownloadDir: (_last: string, downloads: string) => downloads,
  rememberDownloadDir: () => undefined,
}));
vi.mock("node:fs/promises", () => ({
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
  readFile: () => Promise.resolve(Buffer.from("")),
}));

import { downloadAssetToDisk } from "./downloadAsset";

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.hardenedFetch.mockResolvedValue({ bytes: Buffer.from([1, 2, 3, 4]) });
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
});

describe("downloadAssetToDisk — 下载改名闪退根因修复的逻辑分支", () => {
  it("改名场景：写到用户改后的路径（filePath ≠ 默认名），不崩", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/dl/我改的名.png" });
    const r = await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "默认名" });
    expect(mocks.writeFile).toHaveBeenCalledWith("/tmp/dl/我改的名.png", expect.anything());
    expect(r).toEqual({ ok: true, path: "/tmp/dl/我改的名.png" });
  });

  it("根因：永不给保存对话框传父窗口——只收一个 options 参数（跨线程属主=搜狗输入法闪退源）", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/dl/a.png" });
    await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    const call = mocks.showSaveDialog.mock.calls[0];
    expect(call).toHaveLength(1);
    expect(call[0]).toHaveProperty("defaultPath");
  });

  it("面包屑：进对话框前先落盘 open，返回后落 closed（原生崩溃时最后一行=崩点）", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/dl/a.png" });
    await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    const details = mocks.logBreadcrumb.mock.calls.map((c) => String(c[1]));
    expect(details[0]).toContain("save-dialog:open");
    expect(details[1]).toContain("save-dialog:closed");
  });

  // 对话框「还停在原生层没返回」的那一刻，正是真实闪退发生的时刻。用一个可控 deferred 停在那里，
  // 断言完再放行——不能让它永不 resolve，否则单飞闸会漏进后面的用例（模块级状态）。
  it("原生崩溃场景：对话框还没返回时 open 面包屑就已落盘 + 此时再点下载被单飞闸挡住", async () => {
    let release: ((value: { canceled: boolean; filePath?: string }) => void) | undefined;
    mocks.showSaveDialog.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const first = downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    await vi.waitFor(() => expect(mocks.showSaveDialog).toHaveBeenCalledOnce());

    // 崩点铁证：进程若在此刻消失，日志里已经有 open 这一行。
    expect(String(mocks.logBreadcrumb.mock.calls[0][1])).toContain("save-dialog:open");
    expect(mocks.logBreadcrumb.mock.calls.map((c) => String(c[1]))).not.toContain(
      expect.stringContaining("save-dialog:closed"),
    );

    const second = await downloadAssetToDisk({ url: "https://x.com/b.png", suggestedName: "b" });
    expect(second).toEqual({ ok: false, canceled: true });
    expect(mocks.showSaveDialog).toHaveBeenCalledOnce();

    release?.({ canceled: false, filePath: "/tmp/dl/a.png" });
    await expect(first).resolves.toEqual({ ok: true, path: "/tmp/dl/a.png" });
  });

  it("单飞闸用完即放：上一次结束后还能再下载（别把功能永久锁死）", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    await downloadAssetToDisk({ url: "https://x.com/b.png", suggestedName: "b" });
    expect(mocks.showSaveDialog).toHaveBeenCalledTimes(2);
  });

  it("对话框 native 异常 → 落 crashLog + 返回失败，绝不冒泡", async () => {
    mocks.showSaveDialog.mockRejectedValue(new Error("native crash"));
    const r = await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    expect(mocks.logCrash).toHaveBeenCalledWith("assets:download", expect.any(Error));
    expect(r).toEqual({ ok: false });
  });

  it("用户取消 → {ok:false,canceled:true}，不写盘", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    const r = await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    expect(r).toEqual({ ok: false, canceled: true });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
