import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { writeWorkspaceManifest } from '../workspace/workspaceManifest';
import { matchNomiErrorCode } from '../shared/nomiErrorCodes';

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-asset-store-"));

// 只换项目根目录；sanitizeName 用**真的**。以前这里连它一起换成了一个不截断的替身——
// 于是「长文件名被截到 90 字、扩展名跟着被截掉、落成 .bin」这件事在测试里结构上不可能出现（2026-09-26）。
vi.mock("../projects/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../projects/repository")>(),
  projectDirById: () => projectRoot,
  resolveProjectRelativePath: (_projectId: string, relativePath: string) => path.join(projectRoot, relativePath),
}));

const { resolveProjectAssetReferenceIdentity, resolveProjectAgentAttachmentClaims, importRemoteAsset, copyAssetFile, listProjectAssets, moveAssetFile, writeAsset, writeGeneratedAsset, writeGeneratedDeterministicAsset } = await import("./projectAssetStore");
type Stored = { id?: string; data?: { relativePath?: string; contentType?: string } };
/** 生成产物的私有暂存（.nomi-upload-*）在成功、失败后都要被收掉。 */
const stagingLeftovers = () => fs.readdirSync(projectRoot).filter((name) => name.startsWith(".nomi-upload-"));
const mediaFixture = (name: string) => fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media", name));

function validGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }],
  }));
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + 36;
  const bytes = Buffer.alloc(total);
  bytes.write("glTF", 0, "ascii");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(total, 8);
  bytes.writeUInt32LE(jsonLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  bytes.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  bytes.writeUInt32LE(36, 20 + jsonLength);
  bytes.writeUInt32LE(0x004e4942, 24 + jsonLength);
  return bytes;
}

function trailingMoovMp4(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-trailing-moov-"));
  const output = path.join(dir, "trailing-moov.mp4");
  try {
    const result = spawnSync(resolveFfmpegPath(), [
      "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32:d=0.25",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", output,
    ], { timeout: 20_000, maxBuffer: 64 * 1024 });
    if (result.status !== 0) throw new Error(`fixture ffmpeg failed: ${result.stderr?.toString() || "unknown"}`);
    const bytes = fs.readFileSync(output);
    const moov = bytes.indexOf(Buffer.from("moov", "ascii"));
    const mdat = bytes.indexOf(Buffer.from("mdat", "ascii"));
    if (moov < mdat) throw new Error("fixture did not place moov after mdat");
    return bytes;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  fs.rmSync(path.join(projectRoot, "assets"), { recursive: true, force: true });
  writeWorkspaceManifest(projectRoot, { id: 'project-1', name: 'project', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1, payload: {} });
});

afterAll(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

describe("writeAsset canonical media filename", () => {
  it("accepts only the exact self-contained GLB media type after shared structural validation", async () => {
    const stored = await writeAsset("project-1", validGlb(), "scene.bin", "model/gltf-binary", { kind: "imported" }) as {
      data?: { relativePath?: string; contentType?: string };
    };
    expect(stored.data?.relativePath).toMatch(/scene\.glb$/);
    expect(stored.data?.contentType).toBe("model/gltf-binary");

    expect(() => writeAsset("project-1", Buffer.from("glTFbad"), "bad.glb", "model/gltf-binary", { kind: "imported" }))
      .toThrow(/3D model validation failed/);
    expect(() => writeAsset("project-1", validGlb(), "bad.model", "model/x-vendor-scene", { kind: "imported" }))
      .toThrow(/Unsupported 3D asset content type/);
  });
  it("does not persist a video as .bin when the upload had no usable extension", async () => {
    const result = await writeAsset("project-1", Buffer.from("video"), "upload.bin", "video/mp4", { kind: "imported" }) as {
      data?: { relativePath?: string; url?: string; contentType?: string };
    };

    expect(result.data?.relativePath).toMatch(/assets\/imported\/sha256\/[a-f0-9]{64}\/upload\.mp4$/);
    expect(result.data?.url).toContain("upload.mp4");
    expect(result.data?.contentType).toBe("video/mp4");
    expect(fs.existsSync(path.join(projectRoot, result.data?.relativePath || ""))).toBe(true);
  });

  it("keeps a known matching extension", async () => {
    const result = await writeAsset("project-1", Buffer.from("image"), "poster.png", "image/png", { kind: "imported" }) as {
      data?: { relativePath?: string };
    };
    expect(result.data?.relativePath).toMatch(/poster\.png$/);
  });

  it("returns the same stable identity that a later project listing reads", async () => {
    const result = await writeAsset("project-1", Buffer.from("stable-image"), "stable.png", "image/png", { kind: "imported" }) as {
      id?: string;
      data?: { relativePath?: string };
    };

    const listed = listProjectAssets({ projectId: "project-1", limit: 20 }).items.find((entry) => entry.data.relativePath === result.data?.relativePath);
    expect(listed?.id).toBe(result.id);
  });

  it("reference identity carries the asset's own media kind (the 3D-BOX preview mp4 is video, a png is image)", async () => {
    const video = await writeAsset("project-1", Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(4)]), "pre.mp4", "video/mp4", { kind: "imported" }) as { id: string };
    const image = await writeAsset("project-1", Buffer.from("stable-image"), "pic.png", "image/png", { kind: "imported" }) as { id: string };
    expect(resolveProjectAssetReferenceIdentity("project-1", video.id)).toMatchObject({ kind: "video", version: 1 });
    expect(resolveProjectAssetReferenceIdentity("project-1", image.id)).toMatchObject({ kind: "image", version: 1 });
  });

  it("sniffs an octet-stream video before selecting its stored extension", async () => {
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(4)]);
    const result = await writeAsset("project-1", bytes, "upload", "application/octet-stream", { kind: "imported" }) as {
      data?: { relativePath?: string; contentType?: string };
    };
    expect(result.data?.relativePath).toMatch(/upload\.mp4$/);
    expect(result.data?.contentType).toBe("video/mp4");
  });

  it("lists a legacy .bin video with its header-derived media type", () => {
    const relativePath = "assets/imported/2026-08-21/legacy.bin";
    const absolutePath = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.concat([
      Buffer.from([0, 0, 0, 0x10]),
      Buffer.from("ftypisom", "ascii"),
      Buffer.alloc(4),
    ]));

    const item = listProjectAssets({ projectId: "project-1", limit: 20 }).items.find((entry) => entry.data.relativePath === relativePath);
    expect(item?.data).toMatchObject({ contentType: "video/mp4", kind: "video", mediaType: "video" });
  });

  // 供应商产物地址的原始 basename 常常很长（签名段、哈希段）。截断只许截主干：扩展名由字节嗅出的
  // 内容类型定，永远不被截掉——否则落成 `.bin`，出了 App（下载、双击、MCP 预览、再上传）就认不出。
  describe("long file names keep the extension from the sniffed content type", () => {
    const longWithExtension = `${"a".repeat(120)}.mp4`;
    const longWithoutExtension = "b".repeat(120);

    it.each([
      ["120 chars + .mp4, declared video/mp4", longWithExtension, "video/mp4"],
      ["120 chars, no extension, declared octet-stream", longWithoutExtension, "application/octet-stream"],
    ])("writeGeneratedDeterministicAsset: %s → .mp4", async (_label, fileName, contentType) => {
      const stored = await writeGeneratedDeterministicAsset("project-1", mediaFixture("valid.mp4"), fileName, contentType, { kind: "generated" }, "video", `task-long:${fileName.length}:${contentType}`) as Stored;
      expect(stored.data?.relativePath).toMatch(/\.mp4$/);
      expect(stored.data?.contentType).toBe("video/mp4");
      expect(fs.existsSync(path.join(projectRoot, stored.data?.relativePath || ""))).toBe(true);
    });

    it.each([
      ["120 chars + .mp4, declared video/mp4", longWithExtension, "video/mp4"],
      ["120 chars, no extension, declared octet-stream", longWithoutExtension, "application/octet-stream"],
    ])("writeGeneratedAsset: %s → .mp4, name stays within the sanitized budget", async (_label, fileName, contentType) => {
      const stored = await writeGeneratedAsset("project-1", mediaFixture("valid.mp4"), fileName, contentType, { kind: "generated" }, "video") as Stored;
      const relativePath = stored.data?.relativePath || "";
      expect(relativePath).toMatch(/\.mp4$/);
      expect(path.posix.basename(relativePath).length).toBeLessThanOrEqual(90);
      expect(stored.data?.contentType).toBe("video/mp4");
    });

    // 类级：落盘路径由 uniqueAssetPath 定的另外两个入口（原生文件拷贝 / 挪入）走同一个裁法。
    it.each(["copyAssetFile", "moveAssetFile"] as const)("%s: long provider name without an extension → .mp4", async (entry) => {
      const source = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-long-name-")), "source");
      fs.writeFileSync(source, mediaFixture("valid.mp4"));
      const stored = (entry === "copyAssetFile"
        ? await copyAssetFile("project-1", source, longWithoutExtension, "application/octet-stream", { kind: "reference" }, null)
        : moveAssetFile("project-1", source, longWithoutExtension, "application/octet-stream", { kind: "reference" })) as Stored;
      expect(stored.data?.relativePath).toMatch(/\.mp4$/);
      expect(path.posix.basename(stored.data?.relativePath || "").length).toBeLessThanOrEqual(90);
    });

    it("a name whose only suffix is not a real extension keeps its text and gets .bin", () => {
      const stored = writeAsset("project-1", Buffer.from("opaque bytes"), `${"c".repeat(20)}.not-an-extension`, "application/octet-stream", { kind: "reference" }) as Stored;
      expect(path.posix.basename(stored.data?.relativePath || "")).toBe(`${"c".repeat(20)}.not-an-extension.bin`);
    });
  });

  it("reuses one deterministic asset path when materialization is retried", async () => {
    const first = await writeGeneratedDeterministicAsset("project-1", mediaFixture("valid.mp4"), "result.mp4", "video/mp4", { kind: "generated" }, "video", "task-1:output-1") as { id?: string; data?: { relativePath?: string } };
    const second = await writeGeneratedDeterministicAsset("project-1", mediaFixture("valid.mp4"), "result.mp4", "video/mp4", { kind: "generated" }, "video", "task-1:output-1") as { id?: string; data?: { relativePath?: string } };
    expect(second).toMatchObject({ id: first.id, data: { relativePath: first.data?.relativePath } });
    expect(fs.readdirSync(path.join(projectRoot, first.data?.relativePath ? path.dirname(first.data.relativePath) : "assets"))).toHaveLength(2);
  });
  it("accepts a generated MP4 whose moov index is at the end of the file", async () => {
    const result = await writeGeneratedAsset("project-1", trailingMoovMp4(), "runway.mp4", "video/mp4", { kind: "generated" }, "video") as {
      data?: { relativePath?: string; contentType?: string };
    };
    expect(result.data?.relativePath).toMatch(/runway\.mp4$/);
    expect(result.data?.contentType).toBe("video/mp4");
  });
  it.each(["missing", "truncated"])("repairs a %s deterministic asset sidecar on retry", async (failure) => {
    const args = ["project-1", mediaFixture("valid.jpg"), "result.jpg", "image/jpeg", { kind: "generated", localTaskId: "local-task" }, "image", "task-1:output-1"] as const;
    const first = await writeGeneratedDeterministicAsset(...args) as { data: { absolutePath: string } };
    const sidecar = `${first.data.absolutePath}.meta`;
    if (failure === "missing") fs.unlinkSync(sidecar); else fs.writeFileSync(sidecar, "{");
    await writeGeneratedDeterministicAsset(...args);
    expect(JSON.parse(fs.readFileSync(sidecar, "utf8"))).toMatchObject({ kind: "generated", localTaskId: "local-task" });
    expect(fs.readdirSync(path.dirname(sidecar))).toHaveLength(2);
  });
  it("does not report deterministic import success when its sidecar cannot be committed", async () => {
    const original = fs.writeFileSync;
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      if (String(args[0]).endsWith(".meta")) throw new Error("sidecar unavailable");
      return original(...args);
    });
    try {
      await expect(writeGeneratedDeterministicAsset("project-1", mediaFixture("valid.jpg"), "result.jpg", "image/jpeg", { kind: "generated" }, "image", "task-2")).rejects.toThrow("sidecar unavailable");
    } finally { write.mockRestore(); }
  });

  it.each([
    ["HTML", Buffer.from("<!doctype html><html><body>upstream error</body></html>"), "image/png", "image", "markup_masquerade"],
    // 「声明是图、字节是视频」以前在这里按声明拒；现在关口只认字节对不对得上任务期望，见 generatedOutputKindGate.test.ts。
    ["unknown bytes", Buffer.from("not-media"), "video/mp4", "video", "unknown_bytes"],
  ] as const)("fails closed before persisting generated %s", async (_label, bytes, contentType, wanted, reason) => {
    await expect(writeGeneratedAsset("project-1", bytes, "output.bin", contentType, { kind: "generated" }, wanted)).rejects.toThrow(reason);
    expect(fs.existsSync(path.join(projectRoot, "assets", "generated"))).toBe(false);
    expect(stagingLeftovers()).toEqual([]);
  });

  // 边界处的同一件事（判定本身的类级用例在 generatedMediaDecode.test.ts）：一张完整的图，IEND 之后带了尾数据，
  // 供应商已经出图——旧判定（-xerror 一有解码抱怨就退 1）把它当失败、什么都没落盘。
  it.each(["writeGeneratedAsset", "writeGeneratedDeterministicAsset"] as const)("%s keeps a generated PNG that carries bytes after its IEND chunk", async (entry) => {
    const bytes = Buffer.concat([mediaFixture("valid.png"), Buffer.alloc(100, 0x41)]);
    const stored = (entry === "writeGeneratedAsset"
      ? await writeGeneratedAsset("project-1", bytes, "output.png", "image/png", { kind: "generated" }, "image")
      : await writeGeneratedDeterministicAsset("project-1", bytes, "output.png", "image/png", { kind: "generated" }, "image", "task-trailing:output-1")) as {
      data?: { relativePath?: string; contentType?: string };
    };
    expect(stored.data?.contentType).toBe("image/png");
    expect(fs.existsSync(path.join(projectRoot, stored.data?.relativePath || ""))).toBe(true);
  });

  it("an undecodable generated image is refused with the machine code (so the UI says 'unreadable', not 'provider failed')", async () => {
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(Array.from({ length: 4000 }, (_, index) => (index * 131 + 7) & 255))]);
    let thrown: unknown;
    try { await writeGeneratedAsset("project-1", garbage, "output.jpg", "image/jpeg", { kind: "generated" }, "image"); } catch (error) { thrown = error; }
    expect((thrown as Error).message).toContain("decode_failed");
    expect(matchNomiErrorCode((thrown as Error).message)).toBe("output-unreadable");
    expect(fs.existsSync(path.join(projectRoot, "assets", "generated"))).toBe(false);
  });

  // 方向 B：同步写入边界不写生成产物。绕过「异步准备 → 同步发布」直接写，拒写——字节一个都不落。
  it.each(["writeAsset", "moveAssetFile"] as const)("%s refuses a generated output that did not go through verified publish", (entry) => {
    const source = path.join(projectRoot, "incoming-unverified.mp4");
    fs.writeFileSync(source, mediaFixture("valid.mp4"));
    expect(() => entry === "writeAsset"
      ? writeAsset("project-1", mediaFixture("valid.mp4"), "result.mp4", "video/mp4", { kind: "generated" })
      : moveAssetFile("project-1", source, "result.mp4", "video/mp4", { kind: "generated" })).toThrow("generated_output_requires_verified_publish");
    expect(fs.existsSync(path.join(projectRoot, "assets", "generated"))).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });

  // 0.23.1「卡到点什么都没反应」在落盘边界上的样子：生成产物落盘前的解码校验占住主进程。
  // 三个生成产物入口（字节 / 确定性物化 / 原生路径拷贝）都要让事件循环在校验期间照转。
  it.each(["writeGeneratedAsset", "writeGeneratedDeterministicAsset", "copyAssetFile"] as const)("%s verifies a generated video without parking the main loop", async (entry) => {
    const order: string[] = [];
    setImmediate(() => order.push("main-loop-turned"));
    const source = path.join(projectRoot, `incoming-${entry}.mp4`);
    if (entry === "copyAssetFile") fs.writeFileSync(source, mediaFixture("valid.mp4"));
    const pending = entry === "writeGeneratedAsset"
      ? writeGeneratedAsset("project-1", mediaFixture("valid.mp4"), "result.mp4", "video/mp4", { kind: "generated" }, "video")
      : entry === "writeGeneratedDeterministicAsset"
        ? writeGeneratedDeterministicAsset("project-1", mediaFixture("valid.mp4"), "result.mp4", "video/mp4", { kind: "generated" }, "video", `task-loop:${entry}`)
        : copyAssetFile("project-1", source, "result.mp4", "video/mp4", { kind: "generated" }, "video");
    order.push("call-returned");
    const stored = await pending as Stored;
    order.push("published");
    expect(fs.existsSync(path.join(projectRoot, stored.data?.relativePath || ""))).toBe(true);
    expect(order).toEqual(["call-returned", "main-loop-turned", "published"]);
    expect(stagingLeftovers()).toEqual([]);
  });

  // 校验可以并行，但「查在不在 → rename → 写 sidecar」是同步发布里一段不让出的临界区：
  // 同一确定性资产被并发写，不出半成品，也不会被不同字节覆盖。
  it("concurrent writes of the same deterministic asset publish one whole file and one whole sidecar", async () => {
    const bytes = mediaFixture("valid.mp4");
    const writes = Array.from({ length: 4 }, (_, index) => writeGeneratedDeterministicAsset("project-1", bytes, "result.mp4", "video/mp4",
      { kind: "generated", attempt: index }, "video", "task-race:output-1"));
    const stored = await Promise.all(writes) as Stored[];
    const relativePath = stored[0].data?.relativePath || "";
    expect(new Set(stored.map((entry) => entry.data?.relativePath))).toEqual(new Set([relativePath]));
    const absolutePath = path.join(projectRoot, relativePath);
    expect(Buffer.compare(fs.readFileSync(absolutePath), bytes)).toBe(0);
    expect(JSON.parse(fs.readFileSync(`${absolutePath}.meta`, "utf8"))).toMatchObject({ kind: "generated" });
    expect(fs.readdirSync(path.dirname(absolutePath)).sort()).toEqual([path.basename(absolutePath), `${path.basename(absolutePath)}.meta`].sort());
    expect(stagingLeftovers()).toEqual([]);
  });

  it("a concurrent write of different bytes under the same key is refused and never overwrites the published file", async () => {
    const video = mediaFixture("valid.mp4");
    const other = trailingMoovMp4();
    const results = await Promise.allSettled([
      writeGeneratedDeterministicAsset("project-1", video, "result.mp4", "video/mp4", { kind: "generated" }, "video", "task-race:output-2"),
      writeGeneratedDeterministicAsset("project-1", other, "result.mp4", "video/mp4", { kind: "generated" }, "video", "task-race:output-2"),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled") as PromiseFulfilledResult<Stored>[];
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(String(rejected[0]?.reason?.message)).toContain("maps to different bytes");
    const published = fs.readFileSync(path.join(projectRoot, fulfilled[0].value.data?.relativePath || ""));
    expect([video, other].some((candidate) => Buffer.compare(candidate, published) === 0)).toBe(true);
    expect(stagingLeftovers()).toEqual([]);
  });

  it("rejects changed bytes when trusted certification evidence no longer matches", async () => {
    const bytes = mediaFixture("valid.png");
    await expect(writeGeneratedAsset("project-1", bytes, "output.png", "image/png", {
      kind: "generated",
      certificationEvidence: {
        kind: "image", contentType: "image/png", byteLength: bytes.byteLength,
        sha256: "0".repeat(64), metadata: {},
      },
    }, "image")).rejects.toThrow("evidence_mismatch");
  });
});


describe('existing project media attachment receipts', () => {
  it('returns the canonical original identity and full receipt for a local reference', async () => {
    const stored = await writeAsset('project-1', Buffer.from('original'), 'portrait.png', 'image/png', { kind: 'upload' }) as { id: string; data: { url: string } }
    const receipt = await importRemoteAsset({ projectId: 'project-1', url: stored.data.url, kind: 'upload', expectedKind: null }) as { id: string; data: { size: number; contentHash: string } }
    expect(receipt.id).toBe(stored.id)
    expect(receipt.data.size).toBe(8)
    expect(receipt.data.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(resolveProjectAgentAttachmentClaims('project-1', [{ assetId: receipt.id, version: 1 }])).toHaveLength(1)
  })
  it('resolves a claimed original outside the first 500 project assets', () => {
    const assets = path.join(projectRoot, 'assets', 'upload'); fs.mkdirSync(assets, { recursive: true })
    for (let index = 0; index < 502; index += 1) fs.writeFileSync(path.join(assets, `take-${index}.txt`), `original ${index}`)
    const last = listProjectAssets({ projectId: 'project-1', limit: 500, cursor: '500' }).items[0]
    expect(resolveProjectAgentAttachmentClaims('project-1', [{ assetId: last.id, version: 1 }])[0].assetId).toBe(last.id)
  })
})
