import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __canvasReceiptArtifactRereadsForTests } from "./canvasShotRunApi";
import { writeWorkspaceManifest } from "../workspace/workspaceManifest";

// 落地回执用落地时算好的哈希，真实链路版（设计卡 docs/plan/2026-11-12-gen-landing-stall-cut1.md ★9 第 6 条）。
// 同目录的 canvasLandingReceiptHash.test.ts 把资产库换成了替身，那份只证明「哈希顺着链传下来」；这里不换资产库：
// 真的 importRemoteAsset（暂存、流式算哈希、原子发布）→ data.contentHash → 落地门 localizeTaskAsset → 回执 → 运行记录，
// 只换项目目录解析（指到测试临时目录）。资产库记录的哈希写错一位，运行记录里的哈希就不等于盘上文件的真实哈希 → 红。

const where = vi.hoisted(() => ({ root: "" }));
vi.mock("../projects/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../projects/repository")>()),
  projectDirById: () => where.root,
  resolveProjectRelativePath: (_projectId: string, relativePath: string) => path.join(where.root, relativePath),
}));
vi.mock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));

const { localizeTaskAsset } = await import("../assets/localizeTaskAsset");
const { CANVAS_TEST_PROJECT: PROJECT, setupCanvasShots } = await import("./canvasShotTestUtils");
const { canvasRunIdFor } = await import("../productionRun/canvasShotRunIndex");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const png = fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.png"));

describe("落地回执的哈希：真资产库写盘，不靠替身", () => {
  it("真的 importRemoteAsset 落地的图，运行记录里的哈希就是盘上那份文件的真实哈希，且回执不重读", async () => {
    const harness = setupCanvasShots();
    roots.push(harness.root);
    where.root = harness.root;
    writeWorkspaceManifest(harness.root, {
      id: PROJECT, name: "project", version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1, payload: {},
    });
    harness.vendor.answer = async () => ({
      id: "task-real-landing",
      kind: "text_to_image",
      status: "succeeded",
      assets: [await localizeTaskAsset(PROJECT, `data:image/png;base64,${png.toString("base64")}`, "image")],
      raw: {},
    });
    const rereadsBefore = __canvasReceiptArtifactRereadsForTests();

    const result = await harness.submit("node-a", "run-a");

    expect(result.status).toBe("succeeded");
    expect(__canvasReceiptArtifactRereadsForTests() - rereadsBefore).toBe(0);
    const run = harness.repository.read(PROJECT, canvasRunIdFor("run-a"))!;
    expect(run.artifacts).toHaveLength(1);
    const artifact = run.artifacts[0]!;
    const onDisk = fs.readFileSync(path.join(harness.root, artifact.projectRelativePath!));
    // 落地的是真文件，且就是传来的那份字节（不是 setup 里放的 "png-bytes" 占位）。
    expect(onDisk.equals(png)).toBe(true);
    expect(artifact.contentHash).toBe(sha256(onDisk));
  });
});
