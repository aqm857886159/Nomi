// 补预览在途请求的取消（V-1209 首轮不通过：关项目后两路 ffmpeg 照跑完并写盘）。
// 锁的行为：发起窗口销毁 / 项目上下文失效 / 渲染层显式撤回，任一发生就把取消信号一路传到 ffmpeg 子进程：
// 杀进程、删掉没写完的产物、不写 sidecar、不给事实（返回 null）。子进程用受控替身，取消路径是确定性的。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processControl = vi.hoisted(() => ({
  signals: [] as AbortSignal[],
  started: 0,
  /** 第 n 次（从 0 数）起的子进程立刻写完并成功退出；其余一直跑到被取消。 */
  completeImmediately: new Set<number>(),
  outputs: [] as string[],
}));

vi.mock("../export/mediaProbe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/mediaProbe")>();
  return {
    ...actual,
    // 探测一律答「2048×3072 的大图」：走到 ffmpeg 那一步。
    probeMediaMetadata: vi.fn(async () => ({ width: 2048, height: 3072, pixelFormat: "yuvj420p" })),
    // 受控的 ffmpeg 子进程：开始写产物，一直跑到被取消（与 runBoundedProcess 的取消契约一致：杀进程后拒绝）。
    runBoundedProcess: vi.fn((_command: string, args: string[], options: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      const index = processControl.started;
      processControl.started += 1;
      const output = args[args.length - 1]!;
      processControl.outputs.push(output);
      fs.writeFileSync(output, Buffer.from(processControl.completeImmediately.has(index) ? "complete jpeg" : "partial jpeg"));
      if (processControl.completeImmediately.has(index)) { resolve({ code: 0, stdout: "", stderr: "" }); return; }
      if (!options.signal) return;
      processControl.signals.push(options.signal);
      options.signal.addEventListener("abort", () => reject(new actual.BoundedProcessError("cancelled")), { once: true });
    })),
  };
});
vi.mock("../export/ffmpegRunner", () => ({ resolveFfmpegPath: () => "ffmpeg" }));

const { createIpcRequestRegistry } = await import("../ipcRequestRegistry");
const { attachStoredAssetPreview, isAssetPreviewCancelled } = await import("./assetPreview");
const { readAssetSidecarMeta } = await import("./assetSidecar");

class FakeSender extends EventEmitter {
  destroyed = false;
  constructor(readonly id: number) { super(); }
  isDestroyed(): boolean { return this.destroyed; }
  destroy(): void { this.destroyed = true; this.emit("destroyed"); }
}

const roots: string[] = [];
function storedRecord() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-preview-cancel-"));
  roots.push(dir);
  const absolutePath = path.join(dir, "big.jpg");
  fs.writeFileSync(absolutePath, Buffer.from("source"));
  return { projectId: "p1", data: { url: "nomi-local://asset/p1/big.jpg", relativePath: "big.jpg", absolutePath, contentType: "image/jpeg" } };
}

beforeEach(() => {
  processControl.signals = [];
  processControl.started = 0;
  processControl.completeImmediately = new Set();
  processControl.outputs = [];
});
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function untilFfmpegStarted(): Promise<void> {
  await vi.waitFor(() => expect(processControl.started).toBe(1));
}

describe("补预览在途请求的取消", () => {
  it("发起窗口关掉：杀掉在途 ffmpeg、删掉没写完的预览、不写 sidecar、返回 null", async () => {
    const registry = createIpcRequestRegistry();
    const sender = new FakeSender(1);
    const record = storedRecord();
    const pending = registry.run(sender, "r1", undefined, (signal) => attachStoredAssetPreview(record, undefined, { signal }));
    await untilFfmpegStarted();
    // ffmpeg 写的是这一次自己的临时文件，正式预览名在成功前根本不存在。
    expect(fs.existsSync(processControl.outputs[0]!)).toBe(true);
    expect(fs.existsSync(record.data.absolutePath.replace(/\.jpg$/, ".preview.jpg"))).toBe(false);
    sender.destroy();
    await expect(pending).resolves.toBeNull();
    expect(processControl.signals[0]!.aborted).toBe(true);
    expect(fs.existsSync(processControl.outputs[0]!)).toBe(false);
    expect(fs.existsSync(record.data.absolutePath.replace(/\.jpg$/, ".preview.jpg"))).toBe(false);
    expect(readAssetSidecarMeta(record.data.absolutePath)).not.toHaveProperty("thumbnailRelativePath");
    expect(registry.inflightCount()).toBe(0);
  });

  it("项目上下文失效（关项目 / 换项目，发起时签发的 assertCurrent 开始抛）：同样杀进程、不留产物", async () => {
    const registry = createIpcRequestRegistry({ pollMs: 5 });
    let projectOpen = true;
    const assertCurrent = () => { if (!projectOpen) throw new Error("project_binding_stale"); };
    const record = storedRecord();
    const pending = registry.run(new FakeSender(2), "r2", assertCurrent, (signal) => attachStoredAssetPreview(record, undefined, { signal }));
    await untilFfmpegStarted();
    projectOpen = false;
    await expect(pending).resolves.toBeNull();
    expect(fs.existsSync(processControl.outputs[0]!)).toBe(false);
    expect(fs.existsSync(record.data.absolutePath.replace(/\.jpg$/, ".preview.jpg"))).toBe(false);
  });

  it("渲染层显式撤回只认同一个窗口的请求号；别的窗口撤不动", async () => {
    const registry = createIpcRequestRegistry();
    const record = storedRecord();
    const pending = registry.run(new FakeSender(3), "r3", undefined, (signal) => attachStoredAssetPreview(record, undefined, { signal }));
    await untilFfmpegStarted();
    expect(registry.cancel(4, "r3")).toBe(false);
    expect(processControl.signals[0]!.aborted).toBe(false);
    expect(registry.cancel(3, "r3")).toBe(true);
    await expect(pending).resolves.toBeNull();
  });

  it("发起前项目就已失效：一次子进程都不起", async () => {
    const registry = createIpcRequestRegistry();
    const record = storedRecord();
    const result = await registry.run(new FakeSender(5), "r5", () => { throw new Error("project_binding_stale"); }, (signal) => attachStoredAssetPreview(record, undefined, { signal }));
    expect(result).toBeNull();
    expect(processControl.started).toBe(0);
  });

  it("取消不是失败：owner 抛的是可辨认的取消错误，不会被记成 missing", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await attachStoredAssetPreview(storedRecord(), undefined, { signal: controller.signal }).catch((caught: unknown) => caught);
    expect(isAssetPreviewCancelled(error)).toBe(true);
  });
});

// V-1209 复验的新阻断：同一素材两个并发补预览，取消其中一个不许删掉另一个已经 ready 的预览（sidecar 还指着它）。
describe("同一素材并发补预览：取消只清自己的产物", () => {
  it("A 在途、B 先完成并登记 sidecar，再撤 A：B 的预览文件还在，sidecar 指的文件存在", async () => {
    const registry = createIpcRequestRegistry();
    const record = storedRecord();
    const finalPreview = record.data.absolutePath.replace(/\.jpg$/, ".preview.jpg");
    processControl.completeImmediately = new Set([1]);
    const senderA = new FakeSender(10);
    const pendingA = registry.run(senderA, "a", undefined, (signal) => attachStoredAssetPreview(record, undefined, { signal }));
    await untilFfmpegStarted();
    const resultB = await registry.run(new FakeSender(11), "b", undefined, (signal) => attachStoredAssetPreview(record, undefined, { signal }));
    expect(resultB?.data).toMatchObject({ previewState: "ready", thumbnailRelativePath: "big.preview.jpg" });
    expect(fs.readFileSync(finalPreview, "utf8")).toBe("complete jpeg");
    senderA.destroy();
    await expect(pendingA).resolves.toBeNull();
    expect(fs.existsSync(finalPreview)).toBe(true);
    expect(fs.readFileSync(finalPreview, "utf8")).toBe("complete jpeg");
    expect(readAssetSidecarMeta(record.data.absolutePath)).toMatchObject({ thumbnailRelativePath: "big.preview.jpg" });
    // 每个请求写自己的临时文件，正式预览名只由成功的那一个原子发布；被撤的那一个只删自己的临时文件。
    expect(processControl.outputs[0]).not.toBe(processControl.outputs[1]);
    expect(fs.existsSync(processControl.outputs[0]!)).toBe(false);
    expect(fs.readdirSync(path.dirname(finalPreview)).filter((name) => name.includes(".preview.")).sort()).toEqual(["big.preview.jpg"]);
  });

  it("B 先完成，A 后完成：A 不覆盖已发布的预览，丢掉自己的临时文件，回执指向同一份正式预览", async () => {
    const record = storedRecord();
    processControl.completeImmediately = new Set([0, 1]);
    const [first, second] = await Promise.all([
      attachStoredAssetPreview(record, undefined, {}),
      attachStoredAssetPreview(record, undefined, {}),
    ]);
    expect(first.data.thumbnailRelativePath).toBe("big.preview.jpg");
    expect(second.data.thumbnailRelativePath).toBe("big.preview.jpg");
    const dir = path.dirname(record.data.absolutePath);
    expect(fs.readdirSync(dir).filter((name) => name.includes(".preview.")).sort()).toEqual(["big.preview.jpg"]);
  });
});

