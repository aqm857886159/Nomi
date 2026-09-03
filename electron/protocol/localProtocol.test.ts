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
      return new Response(bytes, { headers: { "Content-Type": filePath.endsWith(".bin") ? "application/octet-stream" : "video/mp4" } });
    }),
  },
}));

let projectRoot = "";
let assetPath = "";

vi.mock("../projects/repository", () => ({
  resolveProjectRelativePath: vi.fn((_projectId: string, relativePath: string) => path.join(projectRoot, relativePath)),
}));

const { appendEvents } = vi.hoisted(() => ({ appendEvents: vi.fn() }));
vi.mock("../events/eventLogRepository", () => ({ appendEvents }));

import { handleNomiLocalRequest } from "./localProtocol";
import { createArtifactProjection, getArtifactPreviewSecret } from "../productionRun/artifactProjection";

beforeAll(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-local-protocol-"));
  assetPath = path.join(projectRoot, "assets", "generated", "clip.mp4");
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(assetPath, Buffer.from("0123456789"));
  fs.writeFileSync(path.join(projectRoot, "assets", "generated", "clip.bin"), Buffer.concat([
    Buffer.from([0, 0, 0, 0x10]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.alloc(4),
  ]));
});

afterAll(() => {
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
});

function assetUrl(relativePath = "assets/generated/clip.mp4"): string {
  return `nomi-local://asset/project-a/${relativePath}`;
}

describe("handleNomiLocalRequest", () => {
  // 这条原先钉的是「`Readable.toWeb` 被调用过」——那是钉实现、不是钉契约，
  // 换个等价实现就会假红。它真正要守的是：**别把裸 Node 流交给 protocol.handle**
  // （Chromium 的媒体请求会挂住）。现在直接钉那个契约本身。
  // 至于「流的关闭权在我们手里」，由 fileResponseStream.test.ts 覆盖。
  it("hands Electron a Web ReadableStream, never a raw Node stream", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl()));

    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.body).not.toHaveProperty("pipe"); // Node Readable 的特征方法
    expect(await response.text()).toBe("0123456789");
  });

  it("serves full files without reopening an undici response stream", async () => {
    const fetchMock = vi.mocked((await import("electron")).net.fetch);
    fetchMock.mockRejectedValueOnce(new Error("net.fetch must not serve local files"));

    const response = await handleNomiLocalRequest(new Request(assetUrl()));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
  });

  it("records the local response status for playback diagnosis", async () => {
    appendEvents.mockClear();
    const response = await handleNomiLocalRequest(new Request(assetUrl(), { headers: { Range: "bytes=0-0" } }));
    expect(response.status).toBe(206);
    expect(appendEvents).toHaveBeenCalledWith("project-a", [expect.objectContaining({
      type: "preview.local.response",
      payload: expect.objectContaining({ status: 206, method: "GET" }),
    })]);
  });

  it("serves byte ranges for video playback", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl(), { headers: { Range: "bytes=0-0" } }));

    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-0/10");
    expect(response.headers.get("Content-Length")).toBe("1");
    expect(await response.text()).toBe("0");
  });

  it("sniffs a legacy .bin video for ranged playback", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl("assets/generated/clip.bin"), { headers: { Range: "bytes=0-0" } }));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
  });

  it("sniffs a legacy .bin video for full-file playback", async () => {
    const response = await handleNomiLocalRequest(new Request(assetUrl("assets/generated/clip.bin")));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    await response.arrayBuffer();
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
    await valid.arrayBuffer();
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
