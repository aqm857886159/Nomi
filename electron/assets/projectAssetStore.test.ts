import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFfmpegPath } from "../export/ffmpegRunner";

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-asset-store-"));

vi.mock("../projects/repository", () => ({
  projectDirById: () => projectRoot,
  sanitizeName: (value: unknown, fallback = "Untitled") => String(value || "").trim() || fallback,
}));

const assetStore = await import("./projectAssetStore");
const { listProjectAssets, writeAsset, writeDeterministicAsset } = assetStore;
const resolveProjectAgentAttachmentClaims = (assetStore as unknown as {
  resolveProjectAgentAttachmentClaims?: (
    projectId: string,
    claims: readonly unknown[],
  ) => readonly {
    assetId: string;
    contentHash: string;
    version: number;
    display: { url: string; fileName: string; contentType: string; sizeBytes: number; kind: "image" | "file" };
  }[];
}).resolveProjectAgentAttachmentClaims;

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
});

afterAll(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

describe("writeAsset canonical media filename", () => {
  it("does not persist a video as .bin when the upload had no usable extension", () => {
    const result = writeAsset("project-1", Buffer.from("video"), "upload.bin", "video/mp4", { kind: "imported" }) as {
      data?: { relativePath?: string; url?: string; contentType?: string };
    };

    expect(result.data?.relativePath).toMatch(/assets\/imported\/\d{4}-\d{2}-\d{2}\/upload\.mp4$/);
    expect(result.data?.url).toContain("upload.mp4");
    expect(result.data?.contentType).toBe("video/mp4");
    expect(fs.existsSync(path.join(projectRoot, result.data?.relativePath || ""))).toBe(true);
  });

  it("keeps a known matching extension", () => {
    const result = writeAsset("project-1", Buffer.from("image"), "poster.png", "image/png", { kind: "imported" }) as {
      data?: { relativePath?: string };
    };
    expect(result.data?.relativePath).toMatch(/poster\.png$/);
  });

  it("returns the same stable identity that a later project listing reads", () => {
    const result = writeAsset("project-1", Buffer.from("stable-image"), "stable.png", "image/png", { kind: "imported" }) as {
      id?: string;
      data?: { relativePath?: string; contentHash?: string };
    };

    const listed = listProjectAssets({ projectId: "project-1", limit: 20 }).items.find((entry) => entry.data.relativePath === result.data?.relativePath);
    expect(listed?.id).toBe(result.id);
    expect(result.data?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sniffs an octet-stream video before selecting its stored extension", () => {
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(4)]);
    const result = writeAsset("project-1", bytes, "upload", "application/octet-stream", { kind: "imported" }) as {
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

  it("reuses one deterministic asset path when materialization is retried", () => {
    const first = writeDeterministicAsset("project-1", Buffer.from("generated"), "result.mp4", "video/mp4", { kind: "generated" }, "task-1:output-1") as { id?: string; data?: { relativePath?: string } };
    const second = writeDeterministicAsset("project-1", Buffer.from("generated"), "result.mp4", "video/mp4", { kind: "generated" }, "task-1:output-1") as { id?: string; data?: { relativePath?: string } };
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
    const args = ["project-1", Buffer.from("generated"), "result.jpg", "image/jpeg", { kind: "generated", localTaskId: "local-task" }, "task-1:output-1"] as const;
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
      expect(() => writeDeterministicAsset("project-1", Buffer.from("generated"), "result.jpg", "image/jpeg", { kind: "generated" }, "task-2")).toThrow("sidecar unavailable");
    } finally { write.mockRestore(); }
  });
});

describe("Project Agent attachment authority", () => {
  it("P2B-ASSET-002 resolves immutable metadata and a safe display URL from stored bytes", () => {
    expect(resolveProjectAgentAttachmentClaims).toBeTypeOf("function");
    const stored = writeAsset("project-1", Buffer.from("trusted-bytes"), "reference.png", "image/png", {
      kind: "imported",
    }) as { id: string; data: { contentHash: string } };

    expect(resolveProjectAgentAttachmentClaims!("project-1", [{ assetId: stored.id, version: 1 }])).toEqual([
      expect.objectContaining({
        assetId: stored.id,
        contentHash: stored.data.contentHash,
        version: 1,
        display: expect.objectContaining({
          url: expect.stringMatching(/^nomi-local:\/\/asset\/project-1\//),
          fileName: "reference.png",
          contentType: "image/png",
          sizeBytes: 13,
          kind: "image",
        }),
      }),
    ]);
  });

  it.each([
    ["P2B-ASSET-003 forged renderer metadata", { assetId: "asset-a", version: 1, contentHash: "f".repeat(64), url: "file:///tmp/escape" }],
    ["P2B-ASSET-004 stale version", { assetId: "asset-a", version: 2 }],
    ["P2B-ASSET-005 missing or cross-project identity", { assetId: "asset-missing", version: 1 }],
  ])("rejects %s", (_id, claim) => {
    expect(resolveProjectAgentAttachmentClaims).toBeTypeOf("function");
    expect(() => resolveProjectAgentAttachmentClaims!("project-1", [claim])).toThrow("project_agent_attachment_invalid");
  });
});
