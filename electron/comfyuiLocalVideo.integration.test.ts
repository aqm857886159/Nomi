/**
 * 本地 ComfyUI **视频**传输链真 HTTP 端到端集成测试（S1 视频输出的可回归 R13）。
 *
 * 姊妹篇：comfyuiLocal.integration.test.ts 证的是文生图（images→image_url）；这条证**视频**——
 * 自定义导入的 WAN/VHS 类工作流出的是 gifs（VHS_VideoCombine 历史命名，mp4 也落 gifs），走 S1 扩后的
 * comfyui-history 变换归一成 video_url。起假 ComfyUI（node http）：POST /prompt 返 id、GET /history/{id}
 * 头一拍空后一拍出 gifs、GET /view 返 mp4；用**真 runtime**跑提交→轮询→变换→succeeded，坐实：
 * ① /prompt 收到 API 格式图 + 提示词注入；② gifs → video_url（不是 image_url）；③ /view 视频下载并落进真实项目。
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
  webContents: { getAllWebContents: () => [] },
}));

import { executeProfileOperation, buildProfileTaskResult, createProject } from "./runtime";
import type { HttpOperation } from "./catalog/types";
// 导入本文件即注册 "comfyui-history" 变换（副作用）——runtime 按名查表要它在场。
import "./catalog/comfyuiLocal";

// 真实可解码 MP4：集成链必须经过与生产一致的 ffprobe + ffmpeg certification。
const MP4_BYTES = fs.readFileSync(path.join(__dirname, "providerAdapter/__fixtures__/certification-media/valid.mp4"));

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
  request_transform: "comfyui-prompt",
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
const REQUEST_PROMPT_ID = "223e4567-e89b-42d3-a456-426614174000";
let lastPromptBody: { prompt?: Record<string, { inputs?: Record<string, unknown> }>; client_id?: string; prompt_id?: string } | null = null;

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
        res.end(JSON.stringify({ prompt_id: lastPromptBody?.prompt_id || "vid-abc", number: 1 }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === `/history/${REQUEST_PROMPT_ID}`) {
      historyHits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      // 头一拍空（证会继续轮询）；后一拍出 gifs（VHS 输出，mp4 也落 gifs 键）。
      res.end(
        historyHits < 2
          ? JSON.stringify({})
          : JSON.stringify({
              [REQUEST_PROMPT_ID]: {
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
    const projectRoot = fs.mkdtempSync(path.join(mockedUserDataRoot, "project-"));
    const project = createProject({ rootPath: projectRoot, name: "ComfyUI 视频回收验证", payload: {} });
    const vendor = {
      key: "comfyui-local", name: "本地 ComfyUI", enabled: true,
      baseUrlHint: baseUrl, authType: "none" as const, authHeader: null,
      createdAt: "", updatedAt: "",
    };
    const model = {
      modelKey: "my-wan-i2v", vendorKey: "comfyui-local", labelZh: "本地·WAN 视频",
      kind: "video" as const, enabled: true, createdAt: "", updatedAt: "",
    };
    const request = { prompt: "a dragon flying over misty mountains", extras: { comfyPromptId: REQUEST_PROMPT_ID } } as never;

    // ── 1) 提交 ──
    const created = await executeProfileOperation({ vendor, model, apiKey: "", request, operation: VIDEO_CREATE_OP });
    const createNorm = await buildProfileTaskResult({
      response: created.response, mapping: { create: VIDEO_CREATE_OP, query: VIDEO_QUERY_OP } as never,
      operation: VIDEO_CREATE_OP, request, taskIdFallback: "", wantedKind: "video", vendor, model,
    });
    expect(createNorm.result.id).toBe(REQUEST_PROMPT_ID);
    // 真收到 API 格式图 + 提示词注入到 CLIPTextEncode
    expect(lastPromptBody?.prompt?.["2"]?.inputs?.text).toBe("a dragon flying over misty mountains");
    expect(lastPromptBody?.client_id).toMatch(/^nomi-[0-9a-f-]{36}$/);
    expect(lastPromptBody?.prompt_id).toBe(REQUEST_PROMPT_ID);

    // ── 2) 轮询直到成功 ──
    const taskId = createNorm.result.id;
    const providerMeta = { ...createNorm.providerMeta, task_id: taskId, query_id: taskId };
    let status = createNorm.result.status;
    let assetUrl = "";
    for (let tries = 0; status !== "succeeded" && status !== "failed" && tries < 6; tries += 1) {
      const polled = await executeProfileOperation({ vendor, model, apiKey: "", request, operation: VIDEO_QUERY_OP, providerMeta });
      const norm = await buildProfileTaskResult({
        response: polled.response, mapping: { create: VIDEO_CREATE_OP, query: VIDEO_QUERY_OP } as never,
        operation: VIDEO_QUERY_OP, request, taskIdFallback: REQUEST_PROMPT_ID, wantedKind: "video", projectId: project.id, vendor, model,
      });
      status = norm.result.status;
      assetUrl = norm.result.assets[0]?.url || "";
    }

    expect(status).toBe("succeeded");
    expect(historyHits).toBeGreaterThanOrEqual(2); // 真轮询过
    // gifs（VHS 视频输出）→ video_url，并把 /view 产物回收到真实项目。
    expect(assetUrl).toContain("nomi-local://asset/");
    const generatedDir = path.join(projectRoot, "assets", "generated");
    const generatedFiles = fs.readdirSync(generatedDir, { recursive: true }).map(String);
    expect(generatedFiles.some((file) => /video-\d+\.mp4$/.test(file))).toBe(true);
    expect(viewHits).toBeGreaterThanOrEqual(1);
  });
});
