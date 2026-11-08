// 生成产物落盘关口的「期望类型」矩阵（V-1213 第 2 次复验收口）：字节必须就是调用方说好的那一类。
//
// 关口只认字节：上游声明的 content-type、文件名 / 地址扩展名、回执上的种类都不算数。
//   · 字节不是要的那一类（视频任务拿到图片 / 音频、图片任务拿到视频）→ 不发布、不登记，带 retrieval-download 码；
//   · 字节正是要的那一类、只是声明或扩展名乱标（CDN 常见）→ 照收，按字节记类型和扩展名；
//   · 唯一例外：要音频时收视频容器（.mp4 / .webm 装音频），落盘按音频记。
// 三扇写入口（writeGeneratedAsset / writeGeneratedDeterministicAsset / copyAssetFile）都过这一道。
// 「重定向后才是真类型」：关口只看最终到手的字节，地址长什么样无关——用「地址 / 文件名说 .mp4、字节是 PNG」覆盖；
// 真实的 302 跳转在本机回环里会被出站策略直接拒（有私网例外时不跟跳转），这里不另造。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { writeWorkspaceManifest } from "../workspace/workspaceManifest";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-kind-gate-"));
vi.mock("../projects/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../projects/repository")>(),
  projectDirById: () => projectRoot,
  resolveProjectRelativePath: (_projectId: string, relativePath: string) => path.join(projectRoot, relativePath),
}));

const projectAssetStore = await import("./projectAssetStore");
const { copyAssetFile, importRemoteAsset, writeGeneratedAsset, writeGeneratedDeterministicAsset } = projectAssetStore;
const { importLocalFile } = await import("./localFileImport");
type Stored = { data?: { relativePath?: string; contentType?: string } };
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media", name));
const PNG = fixture("valid.png");
const MP4 = fixture("valid.mp4");
const WAV = fixture("valid.wav");
const published = () => fs.existsSync(path.join(projectRoot, "assets")) ? fs.readdirSync(path.join(projectRoot, "assets"), { recursive: true }).map(String).filter((name) => /\.\w+$/.test(name) && !name.endsWith(".meta")) : [];
const stagingLeftovers = () => fs.readdirSync(projectRoot).filter((name) => name.startsWith(".nomi-upload-"));

/** 只有音轨的 MP4（容器扩展名是视频，内容是音频）：音频任务的合法产物。 */
function audioOnlyMp4(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-audio-mp4-"));
  const output = path.join(dir, "voice.mp4");
  try {
    const result = spawnSync(resolveFfmpegPath(), ["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
      "-vn", "-c:a", "aac", output], { timeout: 20_000, maxBuffer: 64 * 1024 });
    if (result.status !== 0) throw new Error(`fixture ffmpeg failed: ${result.stderr?.toString() || "unknown"}`);
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  fs.rmSync(path.join(projectRoot, "assets"), { recursive: true, force: true });
  writeWorkspaceManifest(projectRoot, { id: "project-1", name: "project", version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1, payload: {} });
});
afterAll(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

describe("落盘关口：字节不是任务要的那一类就不收（retrieval-download，可找回）", () => {
  it.each([
    ["视频任务拿到参考 PNG（声明 octet-stream、无扩展名）", PNG, "application/octet-stream", "signed-reference", "video"],
    ["视频任务拿到 PNG，上游把它声明成 video/mp4", PNG, "video/mp4", "result.mp4", "video"],
    ["地址 / 文件名说 .mp4（重定向后的真类型）、最终字节是 PNG", PNG, "application/octet-stream", "out.mp4", "video"],
    ["视频任务拿到音频（WAV）", WAV, "audio/wav", "result.wav", "video"],
    ["图片任务拿到视频", MP4, "video/mp4", "result.mp4", "image"],
    ["音频任务拿到图片", PNG, "image/png", "result.png", "audio"],
  ] as const)("%s", async (_name, bytes, contentType, fileName, wanted) => {
    const error = await writeGeneratedAsset("project-1", bytes, fileName, contentType, { kind: "generated" }, wanted).then(() => null, (caught: Error) => caught);
    expect(error, "must not publish").toBeInstanceOf(Error);
    expect(matchNomiErrorCode(error!.message)).toBe("retrieval-download");
    // 用户读到的是填好的人话：没有原样漏出的占位符（{{got}} 曾写成 {got}，界面会露花括号）。
    expect(error!.message).not.toMatch(/\{\{?\w+\}?\}/);
    expect(published()).toEqual([]);
    expect(stagingLeftovers()).toEqual([]);
  });

  it("三扇写入口都过这一道：确定性写入、拷贝本地文件同样拒", async () => {
    await expect(writeGeneratedDeterministicAsset("project-1", PNG, "out.mp4", "application/octet-stream", { kind: "generated" }, "video", "task:1"))
      .rejects.toThrow(/NOMI_ERR::retrieval-download::/);
    const source = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-kind-gate-src-")), "out.mp4");
    fs.writeFileSync(source, PNG);
    await expect(copyAssetFile("project-1", source, "out.mp4", "video/mp4", { kind: "generated" }, "video"))
      .rejects.toThrow(/NOMI_ERR::retrieval-download::/);
    expect(published()).toEqual([]);
  });

  it("生成产物不说要哪一类：直接拒，不按声明猜", async () => {
    // 主进程里这样写编译不过（RemoteAssetImportPayload）；渲染层经 IPC 来的载荷不过类型系统，关口在运行时同样拒。
    // @ts-expect-error generated output without an expected kind must not compile
    await expect(importRemoteAsset({ projectId: "project-1", url: `data:image/png;base64,${PNG.toString("base64")}`, kind: "generated", expectedKind: null }))
      .rejects.toThrow("generated_output_expected_kind_required");
    expect(published()).toEqual([]);
  });

  // 2026-11-07：配音把供应商回来的字节交给了「用户文件」那扇门（importLocalFile，kind generated、没说要哪一类），
  // 钱花了、落盘被拒。用户文件的门从此不收生成产物——主进程里写不出来，渲染层经 IPC 送来的同样当场拒。
  it("用户文件的门不收生成产物：编译不过，运行时也拒（不落盘）", async () => {
    const generatedThroughUserDoor = () => importLocalFile({
      projectId: "project-1", bytes: WAV.buffer.slice(WAV.byteOffset, WAV.byteOffset + WAV.byteLength), fileName: "tts.wav", contentType: "audio/wav",
      // @ts-expect-error a generated output must go through writeGeneratedAsset with its expected kind
      kind: "generated",
    });
    await expect(generatedThroughUserDoor()).rejects.toThrow("local_file_import_refuses_generated_output");
    await expect(importLocalFile({ projectId: "project-1", bytes: new Uint8Array(WAV).buffer, fileName: "tts.wav", contentType: "audio/wav", kind: "Generated" } as never))
      .rejects.toThrow("local_file_import_refuses_generated_output");
    expect(published()).toEqual([]);
  });

  // 2026-11-07 复盘必改 ①：拷文件的门以前是「JsonRecord + 期望类型可空」，主进程里写得出生成产物不带期望类型，
  // 付费执行器要花完钱才在关口抛。现在 meta 与期望类型成对写；字节那扇「kind 不定」的门收回素材模块。
  // 下面每一行都是一种写法：编译不过（@ts-expect-error 由 check:test-types 钉住），运行时也落不了盘。
  it("拷文件的门：生成产物不说要哪一类编译不过；「kind 不定」的字节入口不出素材模块", async () => {
    const source = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-kind-gate-src-")), "tts.wav");
    fs.writeFileSync(source, WAV);
    const refused = "generated_output_expected_kind_required";
    const looseMeta: Record<string, unknown> = { kind: "generated" };
    const widenedMeta = { kind: "generated" };
    const maybeKind = null as "audio" | null;
    // @ts-expect-error generated output must name the kind it should be
    await expect(copyAssetFile("project-1", source, "tts.wav", "audio/wav", { kind: "generated" }, null)).rejects.toThrow(refused);
    // @ts-expect-error an expected kind that may be null is not an expected kind
    await expect(copyAssetFile("project-1", source, "tts.wav", "audio/wav", { kind: "generated" }, maybeKind)).rejects.toThrow(refused);
    // @ts-expect-error a JsonRecord meta does not say what it is
    await expect(copyAssetFile("project-1", source, "tts.wav", "audio/wav", looseMeta, null)).rejects.toThrow(refused);
    // @ts-expect-error a widened string kind may hold "generated"
    await expect(copyAssetFile("project-1", source, "tts.wav", "audio/wav", widenedMeta, null)).rejects.toThrow(refused);
    // @ts-expect-error case variants are the same generated output
    await expect(copyAssetFile("project-1", source, "tts.wav", "audio/wav", { kind: "Generated" }, null)).rejects.toThrow(refused);
    expect(published()).toEqual([]);
    // 成对写的两种都照常落：生成产物带期望类型过关口，用户的东西给 null。
    await expect(copyAssetFile("project-1", source, "tts.wav", "audio/wav", { kind: "generated" }, "audio")).resolves.toMatchObject({ data: { contentType: "audio/wav" } });
    await expect(copyAssetFile("project-1", source, "voice.wav", "audio/wav", { kind: "upload" }, null)).resolves.toMatchObject({ data: { contentType: "audio/wav" } });

    // @ts-expect-error storeAssetBytes (kind as data, expected kind nullable) stays inside the asset module
    expect(projectAssetStore.storeAssetBytes).toBeUndefined();
    const runtimeReexport = (runtime: typeof import("../runtime")) =>
      // @ts-expect-error and runtime does not re-export it either
      runtime.storeAssetBytes;
    expect(runtimeReexport).toBeTypeOf("function");
  });
});

describe("落盘关口：字节正是要的那一类，声明 / 扩展名乱标照收，按字节记", () => {
  it("CDN 把真 MP4 标成 image/png、文件名 .png：视频任务照收，记成 video/mp4、扩展名 .mp4", async () => {
    const stored = await writeGeneratedAsset("project-1", MP4, "result.png", "image/png", { kind: "generated" }, "video") as Stored;
    expect(stored.data?.contentType).toBe("video/mp4");
    expect(stored.data?.relativePath).toMatch(/\.mp4$/);
  });

  it("签名地址没有扩展名、声明 octet-stream：图片任务按字节收成 image/png", async () => {
    const stored = await writeGeneratedAsset("project-1", PNG, "signed-result", "application/octet-stream", { kind: "generated" }, "image") as Stored;
    expect(stored.data?.contentType).toBe("image/png");
  });

  it.each(["audio/mp4", "video/mp4"])("音频任务收视频容器装的音频（声明 %s）：落盘按音频记", async (declared) => {
    const stored = await writeGeneratedAsset("project-1", audioOnlyMp4(), "voice.mp4", declared, { kind: "generated" }, "audio") as Stored;
    expect(stored.data?.contentType).toBe("audio/mp4");
  });
});
