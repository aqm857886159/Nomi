import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  protocol: { handle: vi.fn() },
  net: {
    fetch: vi.fn(async (url: string) => {
      const filePath = new URL(url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
      const bytes = fs.readFileSync(decodeURIComponent(filePath));
      return new Response(bytes, { headers: { "Content-Type": "video/mp4" } });
    }),
  },
}));

let projectRoot = "";
let assetPath = "";

vi.mock("../projects/repository", () => ({
  resolveProjectRelativePath: vi.fn((_projectId: string, relativePath: string) => path.join(projectRoot, relativePath)),
}));

import { handleNomiLocalRequest } from "./localProtocol";
import { createArtifactProjection, getArtifactPreviewSecret } from "../productionRun/artifactProjection";

beforeAll(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-local-protocol-"));
  assetPath = path.join(projectRoot, "assets", "generated", "clip.mp4");
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(assetPath, Buffer.from("0123456789"));
});

afterAll(() => {
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
});

function assetUrl(relativePath = "assets/generated/clip.mp4"): string {
  return `nomi-local://asset/project-a/${relativePath}`;
}

describe("handleNomiLocalRequest", () => {
  it("serves byte ranges for video playback", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl(), { headers: { Range: "bytes=0-0" } }));

    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-0/10");
    expect(response.headers.get("Content-Length")).toBe("1");
    expect(await response.text()).toBe("0");
  });

  it("serves suffix ranges", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl(), { headers: { Range: "bytes=-3" } }));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 7-9/10");
    expect(await response.text()).toBe("789");
  });

  it("rejects unsatisfiable ranges", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl(), { headers: { Range: "bytes=20-30" } }));

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("keeps full-file responses working", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl()));

    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toBe("0123456789");
  });

  it("requires a valid scoped preview token when a preview query is present", async () => {
    const projection = createArtifactProjection({
      projectRoot,
      run: { projectId: "project-a", runId: "run-a" },
      artifact: { artifactId: "artifact-a", stageId: "stage-a", kind: "video", status: "ready", projectRelativePath: "assets/generated/clip.mp4", createdAt: new Date().toISOString() },
      secret: getArtifactPreviewSecret(),
      nowMs: Date.now(),
      ttlMs: 60_000,
    });
    const valid = await handleNomiLocalRequest(new Request(projection.preview!.nomiUrl));
    expect(valid.status).toBe(200);
    const tampered = await handleNomiLocalRequest(new Request(`${projection.preview!.nomiUrl.slice(0, -1)}x`));
    expect(tampered.status).toBe(404);
  });

  it("fails closed when a production preview token is missing or stripped", async () => {
    const projection = createArtifactProjection({
      projectRoot,
      run: { projectId: "project-a", runId: "run-a" },
      artifact: { artifactId: "artifact-a", stageId: "stage-a", kind: "video", status: "ready", projectRelativePath: "assets/generated/clip.mp4", createdAt: new Date().toISOString() },
      secret: getArtifactPreviewSecret(),
      nowMs: Date.now(),
      ttlMs: 60_000,
    });
    const stripped = projection.preview!.nomiUrl.split("?")[0];
    const missing = await handleNomiLocalRequest(new Request(stripped));
    expect(missing.status).toBe(404);
    const forged = await handleNomiLocalRequest(new Request("nomi-local://production-preview/project-a/run-a/artifact-a/assets/generated/clip.mp4?preview=forged"));
    expect(forged.status).toBe(404);
  });
});
