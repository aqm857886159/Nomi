// 接入方式矩阵：把「真实用户会怎么填 API」穷举成表，一格一格跑，用来发现问题而不是确认已知。
//
// 维度取自 issue 区真实报错样本（#4 本地模型 / #8 中转 / #9 接入不可用 / #19 火山 / #43 ComfyUI /
// #62 局域网 IP）：① 地址形态（裸/带 v1/带尾斜杠/带端口/子路径/厂商原生命名空间/局域网/本机）
// ② 模型 id 的真实写法（决定被分到哪个桶）③ 模型类型 → 落到哪条 wire。
import { describe, expect, it } from "vitest";

import { joinUrl } from "../ai/requestPipeline";
import { guessModelKind } from "../catalog/modelKindHeuristic";
import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";
import { canHostPublicDocs } from "./docsDiscovery";

// ── 维度一：地址形态 ────────────────────────────────────────────────────────────
// publicDocs=false 的那些必须走内置契约，否则会去猜 docs.<主机> 然后崩（#62 根因）。
const ADDRESS_MATRIX: Array<{ label: string; baseUrl: string; publicDocs: boolean }> = [
  { label: "官方直连·带 /v1", baseUrl: "https://api.openai.com/v1", publicDocs: true },
  { label: "官方直连·裸地址", baseUrl: "https://api.openai.com", publicDocs: true },
  { label: "带尾斜杠（复制粘贴常见）", baseUrl: "https://api.openai.com/v1/", publicDocs: true },
  { label: "中转·子路径", baseUrl: "https://relay.example.com/codex/v1", publicDocs: true },
  { label: "厂商原生命名空间", baseUrl: "https://ark.example.com/api/v3", publicDocs: true },
  { label: "中转·自定义端口", baseUrl: "https://relay.example.com:8443/v1", publicDocs: true },
  { label: "局域网 IP + 端口（#62 原始现场）", baseUrl: "http://192.168.18.254:3000/v1", publicDocs: false },
  { label: "本机 ComfyUI", baseUrl: "http://127.0.0.1:8188", publicDocs: false },
  { label: "本机 Ollama", baseUrl: "http://localhost:11434/v1", publicDocs: false },
  { label: "内网域名", baseUrl: "http://nas.local:3000/v1", publicDocs: false },
  { label: "公网裸 IP（同样没有文档站）", baseUrl: "http://203.0.113.5:8000/v1", publicDocs: false },
];

describe("接入矩阵 · 地址形态", () => {
  for (const row of ADDRESS_MATRIX) {
    it(`${row.label} → 是否可能有公开文档站 = ${row.publicDocs}`, () => {
      expect(canHostPublicDocs(new URL(row.baseUrl).hostname)).toBe(row.publicDocs);
    });

    it(`${row.label} → 拼出的请求地址不畸形（无 //、无 /v1/v1）`, () => {
      for (const path of ["/v1/chat/completions", "/v1/images/generations", "/v1/video/generations"]) {
        const url = joinUrl(row.baseUrl, path);
        expect(() => new URL(url), url).not.toThrow();
        expect(url, `${row.baseUrl} + ${path}`).not.toMatch(/\/v1\/v1\//);
        expect(url.replace(/^https?:\/\//, ""), url).not.toMatch(/\/\//);
      }
    });
  }
});

// ── 维度二：模型 id 的真实写法 → 分类桶 ─────────────────────────────────────────
// 分错桶 = 生成时按 kind 过滤找不到模型 → 报「模型未配置」，而设置页仍显示已连接。
const MODEL_ID_MATRIX: Array<{ id: string; expected: string }> = [
  // 文本
  { id: "MiniMax-M3", expected: "text" },
  { id: "deepseek-v4-flash", expected: "text" },
  { id: "step-2-16k", expected: "text" },
  { id: "glm-4.6", expected: "text" },
  { id: "claude-sonnet-4-6", expected: "text" },
  { id: "gpt-4.1-mini", expected: "text" },
  // 图片
  { id: "gpt-image-1", expected: "image" },
  { id: "flux-dev", expected: "image" },
  { id: "seedream-4", expected: "image" },
  { id: "qwen-image", expected: "image" },
  { id: "nano-banana-2", expected: "image" },
  // 视频
  { id: "kling-v2-master", expected: "video" },
  { id: "sora-2", expected: "video" },
  { id: "veo-3.1", expected: "video" },
  { id: "wan2.5-i2v", expected: "video" },
  { id: "doubao-seedance-1-0-pro", expected: "video" },
  // 用户 2026-08-11 反馈：这两个此前都落进文本桶 → 「grok 接不进去、识别不出类型」「想接 H3」
  { id: "grok-imagine", expected: "image" },
  { id: "grok-imagine-video", expected: "video" },
  { id: "MiniMax-H3", expected: "video" },
  { id: "MiniMax-Hailuo-2.3", expected: "video" },
  // 音频
  { id: "whisper-1", expected: "audio" },
  { id: "seed-tts-2.0", expected: "audio" },
  { id: "cosyvoice-v2", expected: "audio" },
];

describe("接入矩阵 · 模型 id → 分类桶", () => {
  for (const row of MODEL_ID_MATRIX) {
    it(`${row.id} → ${row.expected}`, () => {
      expect(guessModelKind(row.id)).toBe(row.expected);
    });
  }
});

// ── 维度三：鉴权方式 → 发出去的头必须对 ─────────────────────────────────────────
// 自建端点（ComfyUI / Ollama / LM Studio 默认）常常根本不需要 key。模板是给中转写的、
// 把 Bearer 钉死了，照抄会发出空的 `Authorization: Bearer `，有的服务直接拒。
const AUTH_MATRIX: Array<{ authType: "none" | "bearer" | "x-api-key" | "query"; expectHeaders: Record<string, string> }> = [
  { authType: "none", expectHeaders: {} },
  { authType: "bearer", expectHeaders: { Authorization: "Bearer {{user_api_key}}" } },
  { authType: "x-api-key", expectHeaders: { "x-api-key": "{{user_api_key}}" } },
  { authType: "query", expectHeaders: {} },
];

describe("接入矩阵 · 鉴权方式 → 请求头", () => {
  for (const row of AUTH_MATRIX) {
    for (const kind of ["text", "image", "video", "audio"] as const) {
      it(`${row.authType} · ${kind} → 鉴权头随 authType derive，不钉死 Bearer`, () => {
        const draft = buildOpenAiCompatibleDraft({
      mediaProtocols: ["video-generations-json-v1"],
          baseUrl: "http://127.0.0.1:8188",
          authType: row.authType,
          models: [{ modelKey: "m", labelZh: "m", kind }],
        });
        for (const mode of draft.models[0].modes) {
          for (const operation of [mode.create, mode.query].filter(Boolean)) {
            const headers = (operation as { headers?: Record<string, string> }).headers || {};
            expect(headers.Authorization, `${row.authType}/${mode.taskKind}`).toBe(row.expectHeaders.Authorization);
            expect(headers["x-api-key"], `${row.authType}/${mode.taskKind}`).toBe(row.expectHeaders["x-api-key"]);
          }
        }
      });
    }
  }

  it("无 key 端点绝不发出空的 Authorization（会被部分服务直接拒）", () => {
    const draft = buildOpenAiCompatibleDraft({
      mediaProtocols: ["video-generations-json-v1"],
      baseUrl: "http://127.0.0.1:11434/v1",
      authType: "none",
      models: [{ modelKey: "llama3", labelZh: "llama3", kind: "text" }],
    });
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("user_api_key");
  });
});

// ── 维度四：本地端点 × 模型类型 → 真的拿到可用通道 ──────────────────────────────
describe("接入矩阵 · 本地端点每种模型类型都拿得到通道", () => {
  const localBases = ADDRESS_MATRIX.filter((row) => !row.publicDocs).map((row) => row.baseUrl);
  const kinds = ["text", "image", "video", "audio"] as const;

  for (const baseUrl of localBases) {
    for (const kind of kinds) {
      it(`${baseUrl} · ${kind} → 至少一条通道且每条都有 create`, () => {
        const draft = buildOpenAiCompatibleDraft({
      mediaProtocols: ["video-generations-json-v1"],
          baseUrl,
          authType: "bearer",
          models: [{ modelKey: `probe-${kind}`, labelZh: `probe-${kind}`, kind }],
        });
        const modes = draft.models[0].modes;
        expect(modes.length, "本地端点不该出现零通道（零通道 = 接入后依然不可用）").toBeGreaterThan(0);
        for (const mode of modes) {
          expect(mode.create?.path, `${kind}/${mode.taskKind}`).toBeTruthy();
          const url = joinUrl(baseUrl, mode.create.path);
          expect(() => new URL(url), url).not.toThrow();
          expect(url).not.toMatch(/\/v1\/v1\//);
        }
      });
    }
  }
});
