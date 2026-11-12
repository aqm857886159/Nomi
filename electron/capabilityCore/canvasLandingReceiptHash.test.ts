import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __canvasReceiptArtifactRereadsForTests } from "./canvasShotRunApi";

// 落地回执用落地时算好的哈希（设计卡 docs/plan/2026-11-12-gen-landing-stall-cut1.md ★9 第 6 条）。
// 画布那台把结果落进项目时（落地门 localizeTaskAsset → 资产库写盘）已经流式算过 sha256；以前记 Run 回执时
// 又在主进程上同步整读一遍文件重算，8 张 4K 同时落地就是 8 次大文件同步读。现在哈希顺着产物一路带到回执：
// 回执不读文件，记下的哈希必须就是那份文件真实的哈希——链上哪一环传错、丢了，这里都会红。

const importRemoteAsset = vi.fn();
vi.mock("../assets/projectAssetStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assets/projectAssetStore")>()),
  importRemoteAsset,
}));
vi.mock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));

const { localizeTaskAsset } = await import("../assets/localizeTaskAsset");
const { CANVAS_TEST_PROJECT: PROJECT, setupCanvasShots } = await import("./canvasShotTestUtils");
const { canvasRunIdFor } = await import("../productionRun/canvasShotRunIndex");

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  importRemoteAsset.mockReset();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

/** 资产库写盘的形状：字节落进项目、回执上带写盘时算好的哈希（真实现是暂存时流式算、原子改名发布）。 */
function landInto(root: string) {
  importRemoteAsset.mockImplementation(async (payload: { url: string }) => {
    const name = path.basename(new URL(payload.url).pathname);
    const relative = `assets/landed-${name}`;
    const absolutePath = path.join(root, relative);
    const bytes = crypto.randomBytes(64 * 1024);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, bytes);
    return { id: `asset-${name}`, name, data: { url: `nomi-local://asset/${PROJECT}/${relative}`, absolutePath, contentHash: sha256(bytes) } };
  });
}

describe("落地回执取落地时算好的哈希，不再整读文件", () => {
  it("一次出 4 张：回执不读产物文件，Run 账上每份的哈希就是那份文件真实的哈希", async () => {
    const harness = setupCanvasShots();
    roots.push(harness.root);
    landInto(harness.root);
    harness.vendor.answer = async () => ({
      id: "task-landing-4",
      kind: "text_to_image",
      status: "succeeded",
      // 画布那台（runtime.runTask）出片后逐份过落地门。
      assets: await Promise.all([1, 2, 3, 4].map((index) => localizeTaskAsset(PROJECT, `https://cdn.vendor.test/out-${index}.png`, "image"))),
      raw: {},
    });
    const rereadsBefore = __canvasReceiptArtifactRereadsForTests();

    const result = await harness.submit("node-a", "run-a");

    expect(result.status).toBe("succeeded");
    expect(__canvasReceiptArtifactRereadsForTests() - rereadsBefore).toBe(0);
    const run = harness.repository.read(PROJECT, canvasRunIdFor("run-a"))!;
    expect(run.artifacts).toHaveLength(4);
    for (const artifact of run.artifacts)
      expect(artifact.contentHash).toBe(sha256(fs.readFileSync(path.join(harness.root, artifact.projectRelativePath!))));
  });

  it("没带哈希的产物（旧调用方）照旧现读现算，记下的仍是真实哈希", async () => {
    const harness = setupCanvasShots();
    roots.push(harness.root);
    const rereadsBefore = __canvasReceiptArtifactRereadsForTests();
    const result = await harness.submit("node-a", "run-a");
    // 阳性对照：没带哈希就真的现读一次，计数器必须涨 1。
    expect(__canvasReceiptArtifactRereadsForTests() - rereadsBefore).toBe(1);
    expect(result.status).toBe("succeeded");
    const run = harness.repository.read(PROJECT, canvasRunIdFor("run-a"))!;
    expect(run.artifacts[0]!.contentHash).toBe(sha256(fs.readFileSync(path.join(harness.root, "assets", "out.png"))));
  });
});
