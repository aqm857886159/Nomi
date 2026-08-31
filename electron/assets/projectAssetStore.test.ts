import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-asset-store-"));

vi.mock("../projects/repository", () => ({
  projectDirById: () => projectRoot,
  sanitizeName: (value: unknown, fallback = "Untitled") => String(value || "").trim() || fallback,
}));

const { listProjectAssets, writeAsset, writeDeterministicAsset } = await import("./projectAssetStore");

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
      data?: { relativePath?: string };
    };

    const listed = listProjectAssets({ projectId: "project-1", limit: 20 }).items.find((entry) => entry.data.relativePath === result.data?.relativePath);
    expect(listed?.id).toBe(result.id);
  });

  it("sniffs an octet-stream video before selecting its stored extension", () => {
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(16)]);
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
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from("ftypisom", "ascii"),
      Buffer.alloc(16),
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
});
