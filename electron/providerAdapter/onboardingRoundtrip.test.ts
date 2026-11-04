// 模型接入 → 生成 的**真实往返**测试：起一台真的 HTTP 服务器，用真实 runtime 打过去，
// 验的是「真发出去会怎样」，而不是「我们打算发出什么」（那层由 onboardingMatrix 覆盖）。
//
// 为什么必须有这层（docs/plan/2026-08-11-model-onboarding-to-generation-roundtrip.md）：
// 响应解析目前靠「防御式试多种路径」兜底，各家返回形状千奇百怪，这条链从没被系统性验过；
// issue 区「接进去了但用不了」已同源出现 7 次。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildProfileTaskResult, executeProfileOperation, type TaskRequest } from "../runtime";
import type { Mapping, Model, Vendor } from "../catalog/types";
import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";

type Received = { method: string; url: string; headers: http.IncomingHttpHeaders; body: unknown };

const received: Received[] = [];
let baseUrl = "";
let server: http.Server;
/** 视频轮询：第 N 次查询才成功，用来验真实的「排队 → 运行中 → 成功」流转。 */
let videoPolls = 0;

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      received.push({ method: req.method || "", url: req.url || "", headers: req.headers, body });
      const url = req.url || "";

      if (url.startsWith("/v1/images/generations")) {
        return json(res, 200, { created: 1, data: [{ url: `${baseUrl}/asset/a.png` }, { url: `${baseUrl}/asset/b.png` }] });
      }
      if (url.startsWith("/v1/video/generations/")) {
        videoPolls += 1;
        if (videoPolls < 2) return json(res, 200, { task_id: "task-1", status: "processing" });
        return json(res, 200, { task_id: "task-1", status: "succeeded", data: [{ url: `${baseUrl}/asset/v.mp4` }] });
      }
      if (url.startsWith("/v1/video/generations")) {
        return json(res, 200, { task_id: "task-1", status: "processing" });
      }
      if (url.startsWith("/v1/chat/completions")) {
        return json(res, 200, { choices: [{ message: { images: [{ url: `${baseUrl}/asset/edit.png` }] } }] });
      }
      return json(res, 404, { error: { message: "not found" } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function vendorFor(authType: "none" | "bearer"): Vendor {
  return {
    key: "local-probe",
    name: "local probe",
    baseUrlHint: baseUrl,
    authType,
    enabled: true,
    createdAt: "t",
    updatedAt: "t",
  } as Vendor;
}

function modelFor(kind: "image" | "video"): Model {
  return { modelKey: "probe-model", vendorKey: "local-probe", kind, enabled: true, createdAt: "t", updatedAt: "t" } as Model;
}

function opsFor(kind: "image" | "video", authType: "none" | "bearer") {
  const draft = buildOpenAiCompatibleDraft({
      mediaProtocols: ["video-generations-json-v1"],
    baseUrl,
    authType,
    models: [{ modelKey: "probe-model", labelZh: "probe", kind }],
  });
  return draft.models[0].modes;
}

const request: TaskRequest = { kind: "text_to_image", prompt: "a red cube", extras: {} };

describe("往返 · 图片同步出图", () => {
  it("请求打到正确端点、带正确鉴权头，且 n>1 的多张产物全部取回", async () => {
    const modes = opsFor("image", "bearer");
    const create = modes.find((mode) => mode.taskKind === "text_to_image")!.create;
    const executed = await executeProfileOperation({
      vendor: vendorFor("bearer"),
      model: modelFor("image"),
      apiKey: "sk-probe",
      request,
      operation: create,
      stage: "create",
    });
    const hit = received.at(-1)!;
    expect(hit.url).toBe("/v1/images/generations");
    expect(hit.headers.authorization).toBe("Bearer sk-probe");

    const { result } = await buildProfileTaskResult({
      response: executed.response,
      mapping: { create } as unknown as Mapping,
      operation: create,
      request,
      taskIdFallback: "fallback",
      wantedKind: "image",
    });
    expect(result.assets.map((asset) => asset.url)).toEqual([`${baseUrl}/asset/a.png`, `${baseUrl}/asset/b.png`]);
  });

  it("无 key 端点不发 Authorization（本地 ComfyUI/Ollama 的真实形态）", async () => {
    const create = opsFor("image", "none").find((mode) => mode.taskKind === "text_to_image")!.create;
    await executeProfileOperation({
      vendor: vendorFor("none"),
      model: modelFor("image"),
      apiKey: "",
      request,
      operation: create,
      stage: "create",
    });
    expect(received.at(-1)!.headers.authorization).toBeUndefined();
  });
});

describe("往返 · 图生图（chat/completions 多模态）", () => {
  it("产物从 choices[0].message.images[0].url 取得出来", async () => {
    const edit = opsFor("image", "bearer").find((mode) => mode.taskKind === "image_edit")!.create;
    const editRequest: TaskRequest = { kind: "image_edit", prompt: "make it blue", extras: {} };
    const executed = await executeProfileOperation({
      vendor: vendorFor("bearer"),
      model: modelFor("image"),
      apiKey: "sk-probe",
      request: editRequest,
      operation: edit,
      stage: "create",
    });
    const { result } = await buildProfileTaskResult({
      response: executed.response,
      mapping: { create: edit } as unknown as Mapping,
      operation: edit,
      request: editRequest,
      taskIdFallback: "fallback",
      wantedKind: "image",
    });
    expect(result.assets[0]?.url).toBe(`${baseUrl}/asset/edit.png`);
  });
});

// 响应形状 / 状态动词矩阵：各家返回长得千奇百怪，这层此前只靠「防御式试多种路径」兜底。
describe("往返 · 上游响应形状", () => {
  const imageCases: Array<[string, unknown, string[]]> = [
    ["data[*].url 多张", { data: [{ url: "https://x.test/a.png" }, { url: "https://x.test/b.png" }] }, ["https://x.test/a.png", "https://x.test/b.png"]],
    ["b64_json 内联", { data: [{ b64_json: "aGVsbG8=" }] }, ["data:image/png;base64,aGVsbG8="]],
    ["markdown 包裹", { choices: [{ message: { content: "![img](https://x.test/a.png)" } }] }, ["https://x.test/a.png"]],
  ];
  for (const [label, response, expected] of imageCases) {
    it(`图片 · ${label} → 取得出产物`, async () => {
      const create = opsFor("image", "bearer").find((mode) => mode.taskKind === "text_to_image")!.create;
      const { result } = await buildProfileTaskResult({
        response,
        mapping: { create } as unknown as Mapping,
        operation: create,
        request,
        taskIdFallback: "fb",
        wantedKind: "image",
      });
      expect(result.assets.map((asset) => asset.url)).toEqual(expected);
    });
  }
});

describe("往返 · 状态动词", () => {
  // 回归钉：失败动词若没被认出来会落进 queued（= 继续轮询）→ 用户看到任务永远转圈，
  // 既不出结果也不报错。"failure" / "rejected" 实测就是这个下场（2026-08-11 往返测试发现）。
  const failVerbs = ["failed", "fail", "failure", "error", "rejected", "refused", "expired", "aborted", "FAILED", "Cancelled"];
  for (const verb of failVerbs) {
    it(`"${verb}" 判为失败，绝不落进 queued（落进去就是永远转圈）`, async () => {
      const videoMode = opsFor("video", "bearer").find((mode) => mode.taskKind === "text_to_video")!;
      const { result } = await buildProfileTaskResult({
        response: { status: verb, data: [] },
        mapping: { create: videoMode.create, query: videoMode.query, statusMapping: videoMode.statusMapping } as unknown as Mapping,
        operation: videoMode.query!,
        request: { kind: "text_to_video", prompt: "x", extras: {} },
        taskIdFallback: "fb",
        wantedKind: "video",
      });
      expect(result.status, `${verb} 不该被当成还在排队`).toBe("failed");
    });
  }

  for (const verb of ["succeeded", "success", "completed", "done", "SUCCESS"]) {
    it(`"${verb}" 判为成功`, async () => {
      const videoMode = opsFor("video", "bearer").find((mode) => mode.taskKind === "text_to_video")!;
      const { result } = await buildProfileTaskResult({
        response: { status: verb, data: [{ url: "https://x.test/v.mp4" }] },
        mapping: { create: videoMode.create, query: videoMode.query, statusMapping: videoMode.statusMapping } as unknown as Mapping,
        operation: videoMode.query!,
        request: { kind: "text_to_video", prompt: "x", extras: {} },
        taskIdFallback: "fb",
        wantedKind: "video",
      });
      expect(result.status).toBe("succeeded");
    });
  }
});

describe("往返 · 视频异步 create → 轮询 → 取产物", () => {
  it("create 拿到 task_id，轮询到 succeeded 后取回视频", async () => {
    const videoRequest: TaskRequest = { kind: "text_to_video", prompt: "a cat", extras: {} };
    const modes = opsFor("video", "bearer");
    const videoMode = modes.find((mode) => mode.taskKind === "text_to_video")!;
    const created = await executeProfileOperation({
      vendor: vendorFor("bearer"),
      model: modelFor("video"),
      apiKey: "sk-probe",
      request: videoRequest,
      operation: videoMode.create,
      stage: "create",
    });
    const createResult = await buildProfileTaskResult({
      response: created.response,
      mapping: { create: videoMode.create } as unknown as Mapping,
      operation: videoMode.create,
      request: videoRequest,
      taskIdFallback: "fallback",
      wantedKind: "video",
    });
    expect(createResult.providerMeta.task_id).toBe("task-1");

    const query = videoMode.query!;
    let status = "";
    let assets: string[] = [];
    for (let attempt = 0; attempt < 4 && status !== "succeeded"; attempt += 1) {
      const polled = await executeProfileOperation({
        vendor: vendorFor("bearer"),
        model: modelFor("video"),
        apiKey: "sk-probe",
        request: videoRequest,
        operation: query,
        stage: "query",
        providerMeta: createResult.providerMeta,
      });
      const polledResult = await buildProfileTaskResult({
        response: polled.response,
        mapping: { create: videoMode.create, query, statusMapping: videoMode.statusMapping } as unknown as Mapping,
        operation: query,
        request: videoRequest,
        taskIdFallback: "task-1",
        wantedKind: "video",
      });
      status = polledResult.result.status === "succeeded" ? "succeeded" : "running";
      assets = polledResult.result.assets.map((asset) => asset.url);
    }
    expect(status).toBe("succeeded");
    expect(assets).toEqual([`${baseUrl}/asset/v.mp4`]);
    // 轮询 URL 必须把 task_id 填进路径，否则每次都查同一个空地址（静默永远转圈）。
    expect(received.at(-1)!.url).toBe("/v1/video/generations/task-1");
  });
});
