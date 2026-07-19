/**
 * 本地 ComfyUI 传输链**真 HTTP 端到端**集成测试（零云端额度、进 CI，替一次性 harness 做 R13 的可回归版）。
 *
 * 起一个假 ComfyUI（node http）：POST /prompt 返 prompt_id、GET /history/{id} 头一拍空后一拍出图、GET /view 返图。
 * 然后用**真 runtime**（executeProfileOperation 真 fetch + buildProfileTaskResult 真解析/变换/状态机）跑
 * 提交→轮询→归一，坐实：① /prompt 收到的是 API 格式工作流图且数字是真数字；② prompt_id→providerMeta.task_id；
 * ③ 真轮询（第一拍未完成继续、第二拍出图）；④ /history 产物从同源 /view 下载并落进真实项目 → succeeded。
 *
 * 真出图（真像素、SaveImage 落盘、/view 下载本地化）需用户本机 ComfyUI + checkpoint —— 那一段靠用户环境，
 * 本测证的是**传输契约**（提交格式 + 轮询 + 取产物 URL 的构造），不是模型质量。
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

import { executeProfileOperation, buildProfileTaskResult, createProject, listProjectAssets } from "./runtime";
import { COMFYUI_CURATED_MAPPINGS, COMFYUI_CURATED_MODELS } from "./catalog/comfyuiLocal";
import { applyWireDefaults } from "./catalog/taskParams";

// 1×1 PNG（/view 返回的假图）。
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let server: http.Server;
let baseUrl = "";
let historyHits = 0;
let viewHits = 0;
let lastPromptBody: { prompt: Record<string, { inputs: Record<string, unknown> }>; client_id?: string } | null = null;

beforeAll(async () => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comfyui-e2e-"));
  server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://placeholder");
    if (req.method === "POST" && url.pathname === "/prompt") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        lastPromptBody = JSON.parse(raw || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prompt_id: "e2e-abc", number: 1 }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/history/e2e-abc") {
      historyHits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      // 第一拍：还没跑完（空 {}）→ 证 runtime 会继续轮询；第二拍：出图。
      res.end(
        historyHits < 2
          ? JSON.stringify({})
          : JSON.stringify({
              "e2e-abc": {
                status: { status_str: "success", completed: true },
                outputs: { "9": { images: [{ filename: "Nomi_00001_.png", subfolder: "", type: "output" }] } },
              },
            }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/view") {
      viewHits += 1;
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG_1x1);
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

describe("本地 ComfyUI 传输链（真 HTTP 端到端）", () => {
  it("提交→轮询→变换→/view 下载落盘→succeeded", async () => {
    const projectRoot = fs.mkdtempSync(path.join(mockedUserDataRoot, "project-"));
    const project = createProject({ rootPath: projectRoot, name: "ComfyUI 回收验证", payload: {} });
    const mapping = COMFYUI_CURATED_MAPPINGS[0];
    const vendor = {
      key: "comfyui-local", name: "本地 ComfyUI", enabled: true,
      baseUrlHint: baseUrl, authType: "none" as const, authHeader: null,
      createdAt: "", updatedAt: "",
    };
    const model = {
      modelKey: "comfyui-txt2img", vendorKey: "comfyui-local", labelZh: "本地·文生图",
      kind: "image" as const, enabled: true,
      meta: { parameters: COMFYUI_CURATED_MODELS[0].meta.parameters },
      createdAt: "", updatedAt: "",
    };
    const extras = applyWireDefaults({}, mapping.create.defaultParams) as Record<string, unknown>;
    const request = { prompt: "a red cube on green grass", extras } as never;

    // ── 1) 提交 POST /prompt ──
    const created = await executeProfileOperation({ vendor, model, apiKey: "", request, operation: mapping.create });
    const createNorm = await buildProfileTaskResult({
      response: created.response, mapping, operation: mapping.create, request,
      taskIdFallback: "", wantedKind: "image", vendor, model,
    });
    // prompt_id → result.id（response_mapping.task_id="prompt_id"）。真轮询路从缓存键(=result.id)回填
    // providerMeta.task_id（taskResultQuery.ts:70-71），故 id 落在 result.id 而非 providerMeta。
    expect(createNorm.result.id).toBe("e2e-abc");
    // ComfyUI 真收到的是 API 格式工作流图（不是 UI json），提示词注入 + 数字是真数字
    expect(lastPromptBody?.prompt?.["6"]?.inputs?.text).toBe("a red cube on green grass");
    expect(lastPromptBody?.prompt?.["4"]?.inputs?.ckpt_name).toBe("v1-5-pruned-emaonly.safetensors");
    expect(lastPromptBody?.prompt?.["3"]?.inputs?.seed).toBe(156680208700286);
    expect(typeof lastPromptBody?.prompt?.["5"]?.inputs?.width).toBe("number");
    expect(lastPromptBody?.client_id).toBe("nomi");

    // ── 2) 轮询 GET /history/{id} 直到成功 ──
    // 镜像真轮询路（taskResultQuery.ts）：providerMeta.task_id/query_id 从缓存键(=create result.id)回填。
    const taskId = createNorm.result.id;
    const providerMeta = { ...createNorm.providerMeta, task_id: taskId, query_id: taskId };
    let status = createNorm.result.status;
    let assetUrl = "";
    let providerUrl = "";
    for (let tries = 0; status !== "succeeded" && status !== "failed" && tries < 6; tries += 1) {
      const polled = await executeProfileOperation({ vendor, model, apiKey: "", request, operation: mapping.query, providerMeta });
      const norm = await buildProfileTaskResult({
        response: polled.response, mapping, operation: mapping.query, request,
        taskIdFallback: "e2e-abc", wantedKind: "image", projectId: project.id, vendor, model,
      });
      status = norm.result.status;
      assetUrl = norm.result.assets[0]?.url || "";
      providerUrl = norm.result.assets[0]?.providerUrl || "";
    }

    expect(status).toBe("succeeded");
    expect(historyHits).toBeGreaterThanOrEqual(2); // 真轮询过（第一拍空、第二拍出图）
    // 变换先拼 /view URL，再从明确受信任的 ComfyUI origin 拉取并落到项目资产。
    expect(providerUrl).toContain(`${baseUrl}/view?`);
    expect(providerUrl).toContain("filename=Nomi_00001_.png");
    expect(providerUrl).toContain("type=output");
    expect(assetUrl).toMatch(/^nomi-local:\/\/asset\//);
    const stored = listProjectAssets({ projectId: project.id, limit: 10 }).items;
    expect(stored).toHaveLength(1);
    expect(fs.readFileSync(stored[0].data.absolutePath)).toEqual(PNG_1x1);
    expect(viewHits).toBeGreaterThanOrEqual(1);
  });
});
