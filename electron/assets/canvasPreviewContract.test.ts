// 画布预览不变式 · 主进程入口矩阵（2026-10-16 F-thumbs）。
//
// 不变式：成功交给画布的图片 / 视频结果，要么带可验证的有界预览（独立小图文件存在、≠ 源、长边 ≤ 1024），
// 要么带明确的预览事实（source = 源本身有界；missing = 派生不出来），绝不把源地址填进 thumbnailUrl 冒充预览。
// 每一行是一个真实入口：真项目目录、真 ffmpeg/ffprobe、真落盘回执，不 mock 预览 owner。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { probeMediaMetadata } from "../export/mediaProbe";
import { CANVAS_PREVIEW_LONG_EDGE_PX, canvasPreviewFieldsFromReceipt } from "../shared/canvas/canvasMediaPreview";
import { absolutePathFromLocalAssetUrlAnyProject } from "./localAssetFile";
import { createProject, projectDirById } from "../projects/repository";
import { localizeTaskAsset } from "./localizeTaskAsset";
import { ensureLocalAssetPreview, importLocalFile } from "./localFileImport";
import { createGenerationOutputMaterializer } from "../capabilityCore/generationOutputMaterializer";
import { handleNomiLocalRequest } from "../protocol/localProtocol";
import { localAssetUrl } from "./assetPaths";
import { attachStoredAssetPreview } from "./assetPreview";
import { unlocalizedTaskAsset } from "../tasks/unlocalizedTaskAsset";

vi.mock("./assetEvents", () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn(async () => {}) }));
vi.mock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "documents" ? mockedDocumentsRoot : mockedUserDataRoot),
    getAppPath: () => process.cwd(),
  },
}));

function makeTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function synthesize(source: string, args: string[]): Buffer {
  const result = spawnSync(resolveFfmpegPath(), ["-hide_banner", "-v", "error", "-f", "lavfi", "-i", source, ...args, "pipe:1"], { maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`fixture synthesize failed: ${result.stderr}`);
  return result.stdout;
}

// C-dense 的同款尺寸：2048×3072 原图。
const TALL_JPEG = synthesize("testsrc2=s=2048x3072", ["-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg"]);
const SMALL_PNG = synthesize("color=c=green:s=640x360", ["-frames:v", "1", "-f", "image2pipe", "-c:v", "png"]);
const dataUrl = (bytes: Buffer, type: string) => `data:${type};base64,${bytes.toString("base64")}`;

type CanvasResultLike = { type: string; url: string; thumbnailUrl?: string | null; previewState?: string };

/** 不变式本身：每个入口交给画布的结果都过这一道。 */
async function expectCanvasPreviewInvariant(result: CanvasResultLike): Promise<void> {
  expect(["image", "video"]).toContain(result.type);
  expect(result.thumbnailUrl ?? undefined, "thumbnailUrl 不许等于源").not.toBe(result.url);
  expect(["ready", "source", "missing"], "必须带预览事实").toContain(result.previewState);
  if (result.previewState === "ready") {
    const previewPath = absolutePathFromLocalAssetUrlAnyProject(result.thumbnailUrl);
    expect(previewPath && fs.existsSync(previewPath), "小图文件必须真的存在").toBeTruthy();
    const probe = await probeMediaMetadata(previewPath!);
    expect(Math.max(probe.width ?? Infinity, probe.height ?? Infinity)).toBeLessThanOrEqual(CANVAS_PREVIEW_LONG_EDGE_PX);
  } else {
    expect(result.thumbnailUrl ?? undefined).toBeUndefined();
  }
  if (result.previewState === "source") {
    const sourcePath = absolutePathFromLocalAssetUrlAnyProject(result.url);
    const probe = await probeMediaMetadata(sourcePath!);
    expect(Math.max(probe.width ?? Infinity, probe.height ?? Infinity)).toBeLessThanOrEqual(CANVAS_PREVIEW_LONG_EDGE_PX);
  }
}

/** 落盘回执（`data`）→ 画布结果：所有入口都只走 canvasPreviewFieldsFromReceipt 这一个投影。 */
function canvasResultFromReceipt(type: "image" | "video", data: { url?: unknown; thumbnailUrl?: unknown; previewState?: unknown }): CanvasResultLike {
  const url = String(data.url);
  return { type, url, ...canvasPreviewFieldsFromReceipt(type, data, url) };
}

async function makeProject(): Promise<string> {
  return createProject({ rootPath: makeTempDir("nomi-preview-contract-project-"), name: "Preview contract", payload: {} }).id;
}

beforeEach(() => {
  mockedDocumentsRoot = makeTempDir("nomi-preview-contract-documents-");
  mockedUserDataRoot = makeTempDir("nomi-preview-contract-user-data-");
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
});

afterEach(() => {
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("画布预览不变式 · 主进程入口矩阵", () => {
  it("普通生成 / 远程本地化（localizeTaskAsset → importRemoteAsset）：大图带小图，小图记 source，绝不 thumbnailUrl = url", async () => {
    const projectId = await makeProject();
    const big = await localizeTaskAsset(projectId, dataUrl(TALL_JPEG, "image/jpeg"), "image");
    expect(big.previewState).toBe("ready");
    await expectCanvasPreviewInvariant(big);
    // reported case：小图以前回落成 thumbnailUrl = url（「非空 thumbnailUrl ≠ 真的小图」）。
    const small = await localizeTaskAsset(projectId, dataUrl(SMALL_PNG, "image/png"), "image");
    expect(small.thumbnailUrl).toBeNull();
    expect(small.previewState).toBe("source");
    await expectCanvasPreviewInvariant(small);
  });

  it("拖拽 / 文件导入（importLocalFile 字节与原生路径两条）：回执带小图 + 事实", async () => {
    const projectId = await makeProject();
    const bytes = (await importLocalFile({ projectId, bytes: TALL_JPEG, fileName: "tall.jpg", contentType: "image/jpeg" })) as { data: { url: string; thumbnailUrl?: string; previewState?: string } };
    await expectCanvasPreviewInvariant(canvasResultFromReceipt("image", bytes.data));
    const sourcePath = path.join(makeTempDir("nomi-preview-contract-native-"), "native.jpg");
    fs.writeFileSync(sourcePath, TALL_JPEG);
    const native = (await importLocalFile({ projectId, sourcePath, fileName: "native.jpg", contentType: "image/jpeg" }, { allowSourcePath: true })) as { data: { url: string; thumbnailUrl?: string; previewState?: string } };
    expect(native.data.previewState).toBe("ready");
    await expectCanvasPreviewInvariant(canvasResultFromReceipt("image", native.data));
  });

  it("制作流程 / Agent / MCP 落图（generationOutputMaterializer → writeDeterministicAsset）：回执带小图（以前没有）", async () => {
    const projectId = await makeProject();
    const receipt = await createGenerationOutputMaterializer().materialize({
      projectId,
      providerTaskId: "task-preview-contract",
      output: { kind: "image", url: dataUrl(TALL_JPEG, "image/jpeg") },
    });
    // reported case：C-dense 真落盘探针里这张回执没有 thumbnailRelativePath。
    expect(receipt.thumbnailRelativePath).toMatch(/\.preview\.jpg$/);
    expect(receipt.previewState).toBe("ready");
    // 制作流程落画布（multiShotCanvasLanding）用的就是这条投影。
    await expectCanvasPreviewInvariant(canvasResultFromReceipt("image", {
      url: localAssetUrl(projectId, receipt.projectRelativePath),
      thumbnailUrl: localAssetUrl(projectId, receipt.thumbnailRelativePath!),
      previewState: receipt.previewState,
    }));
  });

  it("派生不出来（ffprobe 认不出的字节）：明确 missing，不带 thumbnailUrl", async () => {
    const dir = makeTempDir("nomi-preview-contract-broken-");
    const absolutePath = path.join(dir, "broken.png");
    fs.writeFileSync(absolutePath, Buffer.from("not really a png"));
    const attached = await attachStoredAssetPreview({ projectId: "p1", data: { url: "nomi-local://asset/p1/broken.png", relativePath: "broken.png", absolutePath, contentType: "image/png" } });
    expect(attached.data.previewState).toBe("missing");
    expect(attached.data.thumbnailUrl).toBeUndefined();
  });

  it("没落盘的远端结果（unlocalizedTaskAsset）：明确 missing，不把远端原图填进 thumbnailUrl", async () => {
    const asset = unlocalizedTaskAsset("image", "https://cdn.provider.test/a.png");
    expect(asset.thumbnailUrl).toBeNull();
    expect(asset.previewState).toBe("missing");
  });

  it("旧数据补预览（ensureLocalAssetPreview，后台补齐的唯一主进程入口）：没有 sidecar 的旧大图派生小图，旧小图记 source", async () => {
    const projectId = await makeProject();
    const root = projectDirById(projectId)!;
    fs.mkdirSync(path.join(root, "assets", "generated", "legacy"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets", "generated", "legacy", "old-big.jpg"), TALL_JPEG);
    fs.writeFileSync(path.join(root, "assets", "generated", "legacy", "old-small.png"), SMALL_PNG);
    const bigUrl = localAssetUrl(projectId, "assets/generated/legacy/old-big.jpg");
    const smallUrl = localAssetUrl(projectId, "assets/generated/legacy/old-small.png");
    const legacyFiles = () => fs.readdirSync(path.join(root, "assets/generated/legacy")).sort();
    const before = legacyFiles();
    const big = await ensureLocalAssetPreview({ url: bigUrl });
    expect(big?.previewState).toBe("ready");
    expect(big?.thumbnailUrl).not.toBe(bigUrl);
    const response = await handleNomiLocalRequest(new Request(String(big?.thumbnailUrl)));
    expect(response.status).toBe(200);
    const decoded = path.join(makeTempDir("nomi-preview-response-"), "preview.jpg");
    fs.writeFileSync(decoded, Buffer.from(await response.arrayBuffer()));
    const probe = await probeMediaMetadata(decoded);
    expect(Math.max(probe.width!, probe.height!)).toBe(CANVAS_PREVIEW_LONG_EDGE_PX);
    const small = await ensureLocalAssetPreview({ url: smallUrl });
    expect(small).toEqual({ previewState: "source" });
    expect(legacyFiles()).toEqual(before);
  });
});
