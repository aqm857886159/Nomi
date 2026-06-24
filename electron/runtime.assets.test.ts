import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, importRemoteAsset } from "./runtime";
import { importLocalFile } from "./assets/localFileImport";

type AssetRecord = {
  data: {
    relativePath: string;
    absolutePath: string;
    url: string;
    contentType: string;
  };
};

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "documents") return mockedDocumentsRoot;
      if (name === "userData") return mockedUserDataRoot;
      return mockedUserDataRoot;
    },
    getAppPath: () => process.cwd(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
  mockedDocumentsRoot = makeTempDir("nomi-runtime-assets-documents-");
  mockedUserDataRoot = makeTempDir("nomi-runtime-assets-user-data-");
  delete process.env.NOMI_PROJECTS_DIR;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NOMI_PROJECTS_DIR;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-runtime-assets-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function createWorkspace(): { id: string; rootPath: string } {
  const rootPath = makeTempDir();
  const project = createProject({ rootPath, name: "Asset Workspace", payload: {} });
  return { id: project.id, rootPath };
}

describe("runtime workspace asset storage", () => {
  it("writes generated remote assets under assets/generated/YYYY-MM-DD", async () => {
    const workspace = createWorkspace();

    const asset = (await importRemoteAsset({
      projectId: workspace.id,
      url: "data:image/png;base64,aGVsbG8=",
      fileName: "render.png",
      kind: "generated",
    })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/generated/2026-05-31/render.png");
    expect(asset.data.absolutePath).toBe(path.join(workspace.rootPath, "assets", "generated", "2026-05-31", "render.png"));
    expect(fs.readFileSync(asset.data.absolutePath, "utf8")).toBe("hello");
    expect(asset.data.url).toBe(`nomi-local://asset/${encodeURIComponent(workspace.id)}/assets/generated/2026-05-31/render.png`);
  });

  it("writes imported user files under assets/imported/YYYY-MM-DD", async () => {
    const workspace = createWorkspace();

    const asset = (await importLocalFile({
      projectId: workspace.id,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      fileName: "photo.png",
    })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/imported/2026-05-31/photo.png");
    expect(asset.data.absolutePath).toBe(path.join(workspace.rootPath, "assets", "imported", "2026-05-31", "photo.png"));
    expect([...fs.readFileSync(asset.data.absolutePath)]).toEqual([1, 2, 3]);
  });

  it("dedupes colliding generated asset filenames", async () => {
    const workspace = createWorkspace();

    await importRemoteAsset({ projectId: workspace.id, url: "data:image/png;base64,Zmlyc3Q=", fileName: "render.png" });
    const second = (await importRemoteAsset({ projectId: workspace.id, url: "data:image/png;base64,c2Vjb25k", fileName: "render.png" })) as AssetRecord;

    expect(second.data.relativePath).toBe("assets/generated/2026-05-31/render-2.png");
    expect(fs.readFileSync(second.data.absolutePath, "utf8")).toBe("second");
  });
});
