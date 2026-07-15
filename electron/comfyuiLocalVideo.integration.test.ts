/**
 * 本地 ComfyUI **视频**传输链真 HTTP 端到端集成测试（S1 视频输出的可回归 R13）。
 *
 * 姊妹篇：comfyuiLocal.integration.test.ts 证的是文生图（images→image_url）；这条证**视频**——
 * 自定义导入的 WAN/VHS 类工作流出的是 gifs（VHS_VideoCombine 历史命名，mp4 也落 gifs），走 S1 扩后的
 * comfyui-history 变换归一成 video_url。起假 ComfyUI（node http）：POST /prompt 返 id、GET /history/{id}
 * 头一拍空后一拍出 gifs、GET /view 返 mp4；用**真 runtime**跑提交→轮询→变换→succeeded，坐实：
 * ① /prompt 收到 API 格式图 + 提示词注入；② gifs → video_url（不是 image_url）；③ /view 契约（video/mp4）。
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

import { executeProfileOperation, buildProfileTaskResult } from "./runtime";
import type { HttpOperation } from "./catalog/types";
// 导入本文件即注册 "comfyui-history" 变换（副作用）——runtime 按名查表要它在场。
import "./catalog/comfyuiLocal";

// 极小 mp4 ftyp 盒（/view 返回；传输测只验能取到 + content-type，不验可播放）。
const MP4_BYTES = Buffer.from("00000018667479706d70343200000000", "hex");

// 一条「视频工作流」映射：图里有 VHS_VideoCombine 输出节点；提示词走 {{request.prompt}}。
const VIDEO_GRAPH = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "wan2.2.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "{{request.prompt}}", clip: ["1", 1] } },
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 6, model: ["1", 0], positive: ["2", 0] } },
  "4": { class_type: "VHS_VideoCombine", inputs: { images: ["3", 0], frame_rate: 24, format: "video/h264-mp4" } },
};
const VIDEO_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/prompt",
  headers: { "Content-Type": "application/json" },
  body: { prompt: VIDEO_GRAPH, client_id: "nomi" },
  response_mapping: { task_id: "prompt_id" },
};
const VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/history/{{providerMeta.task_id}}",
  response_transform: "comfyui-history",
  response_mapping: { video_url: "video_url", error_message: "error" },
};

let server: http.Server;
let baseUrl = "";
let historyHits = 0;
let viewHits = 0;
let lastPromptBody: { prompt?: Record<string, { inputs?: Record<string, unknown> }>; client_id?: string } | null = null;

beforeAll(async () => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comfyui-vid-e2e-"));
  server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://placeholder");
    if (req.method === "POST" && url.pathname === "/prompt") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        lastPromptBody = JSON.parse(raw || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prompt_id: "vid-abc", number: 1 }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/history/vid-abc") {
      historyHits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      // 头一拍空（证会继续轮询）；后一拍出 gifs（VHS 输出，mp4 也落 gifs 键）。
      res.end(
        historyHits < 2
          ? JSON.stringify({})
          : JSON.stringify({
              "vid-abc": {
                status: { status_str: "success", completed: true },
                outputs: { "4": { gifs: [{ filename: "Nomi_00001.mp4", subfolder: "", type: "output", format: "video/h264-mp4" }] } },
              },
            }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/view") {
      viewHits += 1;
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(MP4_BYTES);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  if (mockedUserDataRoot) fs.rmSync(mockedUserDataRoot, { recursive: true, force: true });
});

describe("本地 ComfyUI 视频传输链（真 HTTP 端到端）", () => {
  it("VHS gifs 输出 → video_url（非 image_url）→ /view 取到 mp4", async () => {
    const vendor = {
      key: "comfyui-local", name: "本地 ComfyUI", enabled: true,
      baseUrlHint: baseUrl, authType: "none" as const, authHeader: null,
      createdAt: "", updatedAt: "",
    };
    const model = {
      modelKey: "my-wan-i2v", vendorKey: "comfyui-local", labelZh: "本地·WAN 视频",
      kind: "video" as const, enabled: true, createdAt: "", updatedAt: "",
    };
    const request = { prompt: "a dragon flying over misty mountains", extras: {} } as never;

    // ── 1) 提交 ──
    const created = await executeProfileOperation({ vendor, model, apiKey: "", request, operation: VIDEO_CREATE_OP });
    const createNorm = await buildProfileTaskResult({
      response: created.response, mapping: { create: VIDEO_CREATE_OP, query: VIDEO_QUERY_OP } as never,
      operation: VIDEO_CREATE_OP, request, taskIdFallback: "", wantedKind: "video", vendor, model,
    });
    expect(createNorm.result.id).toBe("vid-abc");
    // 真收到 API 格式图 + 提示词注入到 CLIPTextEncode
    expect(lastPromptBody?.prompt?.["2"]?.inputs?.text).toBe("a dragon flying over misty mountains");
    expect(lastPromptBody?.client_id).toBe("nomi");

    // ── 2) 轮询直到成功 ──
    const taskId = createNorm.result.id;
    const providerMeta = { ...createNorm.providerMeta, task_id: taskId, query_id: taskId };
    let status = createNorm.result.status;
    let assetUrl = "";
    for (let tries = 0; status !== "succeeded" && status !== "failed" && tries < 6; tries += 1) {
      const polled = await executeProfileOperation({ vendor, model, apiKey: "", request, operation: VIDEO_QUERY_OP, providerMeta });
      const norm = await buildProfileTaskResult({
        response: polled.response, mapping: { create: VIDEO_CREATE_OP, query: VIDEO_QUERY_OP } as never,
        operation: VIDEO_QUERY_OP, request, taskIdFallback: "vid-abc", wantedKind: "video", vendor, model,
      });
      status = norm.result.status;
      assetUrl = norm.result.assets[0]?.url || "";
    }

    expect(status).toBe("succeeded");
    expect(historyHits).toBeGreaterThanOrEqual(2); // 真轮询过
    // gifs（VHS 视频输出）→ video_url，拼出 /view 完整 URL——证走的是视频键 gifs 不是 images（/history 里只有 gifs）。
    expect(assetUrl).toContain(`${baseUrl}/view?`);
    expect(assetUrl).toContain("filename=Nomi_00001.mp4");
    expect(assetUrl).toContain("type=output");

    // ── 3) 该 URL 真能取到视频（/view 契约）──
    const vid = await fetch(assetUrl);
    expect(vid.status).toBe(200);
    expect(vid.headers.get("content-type")).toBe("video/mp4");
    expect(viewHits).toBeGreaterThanOrEqual(1);
  });
});
