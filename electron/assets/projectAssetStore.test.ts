import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { writeWorkspaceManifest } from '../workspace/workspaceManifest';

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-asset-store-"));

// 只换项目根目录；sanitizeName 用**真的**。以前这里连它一起换成了一个不截断的替身——
// 于是「长文件名被截到 90 字、扩展名跟着被截掉、落成 .bin」这件事在测试里结构上不可能出现（2026-09-26）。
vi.mock("../projects/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../projects/repository")>(),
  projectDirById: () => projectRoot,
}));

const { copyAssetFile, listProjectAssets, moveAssetFile, writeAsset, writeDeterministicAsset } = await import("./projectAssetStore");
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
    type Stored = { data?: { relativePath?: string; contentType?: string } };

    it.each([
      ["120 chars + .mp4, declared video/mp4", longWithExtension, "video/mp4"],
      ["120 chars, no extension, declared octet-stream", longWithoutExtension, "application/octet-stream"],
    ])("writeDeterministicAsset: %s → .mp4", (_label, fileName, contentType) => {
      const stored = writeDeterministicAsset("project-1", mediaFixture("valid.mp4"), fileName, contentType, { kind: "generated" }, `task-long:${fileName.length}:${contentType}`) as Stored;
      expect(stored.data?.relativePath).toMatch(/\.mp4$/);
      expect(stored.data?.contentType).toBe("video/mp4");
      expect(fs.existsSync(path.join(projectRoot, stored.data?.relativePath || ""))).toBe(true);
    });

    it.each([
      ["120 chars + .mp4, declared video/mp4", longWithExtension, "video/mp4"],
      ["120 chars, no extension, declared octet-stream", longWithoutExtension, "application/octet-stream"],
    ])("writeAsset: %s → .mp4, name stays within the sanitized budget", (_label, fileName, contentType) => {
      const stored = writeAsset("project-1", mediaFixture("valid.mp4"), fileName, contentType, { kind: "generated" }) as Stored;
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
        ? await copyAssetFile("project-1", source, longWithoutExtension, "application/octet-stream", { kind: "reference" })
        : moveAssetFile("project-1", source, longWithoutExtension, "application/octet-stream", { kind: "reference" })) as Stored;
      expect(stored.data?.relativePath).toMatch(/\.mp4$/);
      expect(path.posix.basename(stored.data?.relativePath || "").length).toBeLessThanOrEqual(90);
    });

    it("a name whose only suffix is not a real extension keeps its text and gets .bin", () => {
      const stored = writeAsset("project-1", Buffer.from("opaque bytes"), `${"c".repeat(20)}.not-an-extension`, "application/octet-stream", { kind: "reference" }) as Stored;
      expect(path.posix.basename(stored.data?.relativePath || "")).toBe(`${"c".repeat(20)}.not-an-extension.bin`);
    });
  });

  it("reuses one deterministic asset path when materialization is retried", () => {
    const first = writeDeterministicAsset("project-1", mediaFixture("valid.mp4"), "result.mp4", "video/mp4", { kind: "generated" }, "task-1:output-1") as { id?: string; data?: { relativePath?: string } };
    const second = writeDeterministicAsset("project-1", mediaFixture("valid.mp4"), "result.mp4", "video/mp4", { kind: "generated" }, "task-1:output-1") as { id?: string; data?: { relativePath?: string } };
    expect(second).toMatchObject({ id: first.id, data: { relativePath: first.data?.relativePath } });
    expect(fs.readdirSync(path.join(projectRoot, first.data?.relativePath ? path.dirname(first.data.relativePath) : "assets"))).toHaveLength(2);
  });
  it("accepts a generated MP4 whose moov index is at the end of the file", () => {
    const result = writeAsset("project-1", trailingMoovMp4(), "runway.mp4", "video/mp4", { kind: "generated" }) as {
      data?: { relativePath?: string; contentType?: string };
    };
    expect(result.data?.relativePath).toMatch(/runway\.mp4$/);
    expect(result.data?.contentType).toBe("video/mp4");
  });
  it.each(["missing", "truncated"])("repairs a %s deterministic asset sidecar on retry", (failure) => {
    const args = ["project-1", mediaFixture("valid.jpg"), "result.jpg", "image/jpeg", { kind: "generated", localTaskId: "local-task" }, "task-1:output-1"] as const;
    const first = writeDeterministicAsset(...args) as { data: { absolutePath: string } };
    const sidecar = `${first.data.absolutePath}.meta`;
    if (failure === "missing") fs.unlinkSync(sidecar); else fs.writeFileSync(sidecar, "{");
    writeDeterministicAsset(...args);
    expect(JSON.parse(fs.readFileSync(sidecar, "utf8"))).toMatchObject({ kind: "generated", localTaskId: "local-task" });
    expect(fs.readdirSync(path.dirname(sidecar))).toHaveLength(2);
  });
  it("does not report deterministic import success when its sidecar cannot be committed", () => {
    const original = fs.writeFileSync;
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      if (String(args[0]).endsWith(".meta")) throw new Error("sidecar unavailable");
      return original(...args);
    });
    try {
      expect(() => writeDeterministicAsset("project-1", mediaFixture("valid.jpg"), "result.jpg", "image/jpeg", { kind: "generated" }, "task-2")).toThrow("sidecar unavailable");
    } finally { write.mockRestore(); }
  });

  it.each([
    ["HTML", Buffer.from("<!doctype html><html><body>upstream error</body></html>"), "image/png", "markup_masquerade"],
    ["declared image containing MP4", mediaFixture("valid.mp4"), "image/png", "kind_mismatch"],
    ["unknown bytes", Buffer.from("not-media"), "video/mp4", "unknown_bytes"],
  ])("fails closed before persisting generated %s", (_label, bytes, contentType, reason) => {
    expect(() => writeAsset("project-1", bytes, "output.bin", contentType, { kind: "generated" })).toThrow(reason);
    expect(fs.existsSync(path.join(projectRoot, "assets", "generated"))).toBe(false);
  });

  it("rejects changed bytes when trusted certification evidence no longer matches", () => {
    const bytes = mediaFixture("valid.png");
    expect(() => writeAsset("project-1", bytes, "output.png", "image/png", {
      kind: "generated",
      certificationEvidence: {
        kind: "image", contentType: "image/png", byteLength: bytes.byteLength,
        sha256: "0".repeat(64), metadata: {},
      },
    })).toThrow("evidence_mismatch");
  });
});
