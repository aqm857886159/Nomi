// 模型能力一处声明（设计卡 docs/plan/2026-11-22-model-meta-declaration.md ★9「声明测试」）。
//
// 一行挂在 openai-compatible 连接下的文本模型，`meta` 里声明：协议走 Responses、会推理（带档位表）、能收 PDF、
// 一格 pi 的 compat（会话头只发 `x-client-request-id`、不发 `session_id`）。
// 名字故意撞不上任何按名字猜的表（温度怪癖、PDF 名单）：这一行的一切只能从声明来。
// 走真门：目录行 → `nomiModelConfigFor` → Agent lane（`openLane`，带工具、两次请求）/ 单发（`callModelOnce`）→ 真 pi →
// 真 HTTP 打到本机假上游。只把「项目素材从哪读字节」换成内存。
//   · 请求层：网址、鉴权头、pi 用的协议、PDF 文件块、compat 管的会话头；没选档 → 请求里没有任何推理参数、系统提示不变成
//     developer（Chat、Anthropic 两条协议各再断一次单发）；
//   · 描述层：交给 pi 的模型 `reasoning: true`、档位表和 compat 原样；laneHost 算出的可选档 = pi 对这份声明算出的那组。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Model, Vendor } from "../catalog/types";

const PDF = vi.hoisted(() => Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1"));

vi.mock("../assets/projectAssetStore", () => ({
  resolveProjectAgentAttachmentClaims: (_projectId: string, claims: ReadonlyArray<{ assetId: string }>) => claims.map((claim) => ({
    assetId: claim.assetId, contentHash: `hash-${claim.assetId}`, version: 1,
    display: { url: `nomi-local://asset/declaration/${claim.assetId}.pdf`, fileName: `${claim.assetId}.pdf`,
      contentType: "application/pdf", sizeBytes: PDF.byteLength, kind: "file" },
  })),
}));
vi.mock("../assets/localAssetFile", async (importOriginal) => ({
  ...await importOriginal<typeof import("../assets/localAssetFile")>(),
  readNomiLocalAsset: (url: string) => url.endsWith(".pdf") ? { bytes: PDF, contentType: "application/pdf" } : null,
}));

import { createHttpFixture, type CapturedRequest, type FixtureReply } from "../../tests/agent-runtime/httpFixture.mjs";
import { createDocumentPort } from "../../tests/agent-runtime/laneFixture.mjs";
import { createDocumentLaneTools } from "./laneDocumentTools";
import { openLane } from "./laneHost.mjs";
import { callModelOnce } from "./laneModelCall.mjs";
import { createNomiModelDescriptor } from "./laneModelProvider.mjs";
import { createDesktopLaneInput } from "./laneDesktopInput";
import { nomiModelConfigFor } from "../ai/vendorModelConnection";

const API_KEY = "sk-declaration-fake";
const THINKING_LEVEL_MAP = { off: "none", minimal: null, low: "low", medium: "medium", high: "high" };
/** pi 对上面这张表算出来的可选档（`minimal: null` 被剔掉，`xhigh` / `max` 没写 = 不支持）。 */
const DECLARED_LEVELS = ["off", "low", "medium", "high"];
/** pi 的 Responses compat：会话头只发 `x-client-request-id`（缺省两个都发）。请求层看得见，所以拿它证 compat 真的递到了 pi。 */
const COMPAT = { sessionAffinityFormat: "openai-nosession" };
const DECLARED_META = { textProtocol: "openai-responses", reasoning: true, thinkingLevelMap: THINKING_LEVEL_MAP, compat: COMPAT, inputModalities: ["pdf"] };
/** 推理在三条协议里的请求参数名（Responses / Chat / Anthropic）+ 名字表那一格。没选档时一个都不许出现。 */
const REASONING_KEYS = ["reasoning", "reasoning_effort", "thinking", "enable_thinking", "include"];
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function connection(baseURL: string): Vendor {
  return { key: "relay-declared", name: "Relay", enabled: true, providerKind: "openai-compatible", authType: "bearer",
    baseUrlHint: baseURL, createdAt: "", updatedAt: "" } as Vendor;
}

function row(meta?: Record<string, unknown>): Model {
  return { vendorKey: "relay-declared", modelKey: "relay-thinker", labelZh: "Relay Thinker", kind: "text", enabled: true,
    createdAt: "", updatedAt: "", ...(meta ? { meta } : {}) };
}

async function withServer<T>(replies: FixtureReply[], run: (server: Awaited<ReturnType<typeof createHttpFixture>>) => Promise<T>) {
  const server = await createHttpFixture(replies);
  try { return await run(server); } finally { await server.close(); }
}

function desktopInput(model: Model, kind: string) {
  const context = { approvalPolicy: { mode: "request" as const }, attachments: [{ assetId: "brief", version: 1 }] };
  return createDesktopLaneInput({ projectId: "declaration", capture: () => context as never, activate: () => undefined,
    prepare: async (captured) => captured, model: () => ({ model, kind: kind as never }) });
}

/** 声明行发出去的一次请求：网址先断（主线上这一格先红），再断鉴权、推理参数、系统提示角色。 */
function expectDeclaredRequest(request: CapturedRequest, label: string) {
  expect(request.path, `${label}: URL`).toBe("/v1/responses");
  expect(request.headers.authorization, `${label}: auth`).toBe(`Bearer ${API_KEY}`);
  for (const key of REASONING_KEYS) expect(request.body, `${label}: no ${key} without a chosen level`).not.toHaveProperty(key);
  const input = request.body.input as Array<{ role?: string }>;
  expect(input[0]?.role, `${label}: system prompt keeps its role`).toBe("system");
}

function expectPdfBlock(request: CapturedRequest, label: string) {
  expect(request.raw, `${label}: PDF file block`).toContain("\"type\":\"input_file\"");
  expect(request.raw, `${label}: PDF bytes`).toContain(PDF.toString("base64"));
  expect(request.raw, `${label}: no drop note`).not.toContain("PDF 未发送");
}

describe("声明行：Agent 文本请求只照 `model.meta` 的声明走", () => {
  it("Agent lane：带工具的两次请求都走声明的 Responses、带 PDF、没有推理参数；laneHost 的可选档 = 声明", async () => {
    await withServer([
      { type: "tool", calls: [{ id: "call_declared_1", name: "read_script", arguments: { scope: "full" } }] },
      { type: "text", text: "Read it." },
    ], async (server) => {
      const model = row(DECLARED_META);
      const config = nomiModelConfigFor(connection(server.baseURL), model, API_KEY);
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-declaration-lane-"));
      roots.push(projectDir);
      const lane = await openLane({ fetch: globalThis.fetch, projectDir, systemPrompt: "NOMI_DECLARATION_SYSTEM", model: config,
        tools: createDocumentLaneTools(createDocumentPort()), input: desktopInput(model, config.kind) });
      try {
        await lane.execute({ kind: "prompt", text: "Read the script and the attached brief." });
        expect(server.requests).toHaveLength(2);
        server.requests.forEach((request, index) => expectDeclaredRequest(request, `lane request ${index + 1}`));
        for (const request of server.requests) {
          expect(request.headers["x-client-request-id"], "compat: the session header pi keeps").toBeTruthy();
          expect(request.headers, "compat: the session header the declaration drops").not.toHaveProperty("session_id");
        }
        expectPdfBlock(server.requests[0]!, "lane request 1");
        expect(JSON.stringify(server.requests[1]!.body), "second request replays the tool round").toContain("call_declared_1");
        expect(lane.projection().thinking.supportedLevels).toEqual(DECLARED_LEVELS);
      } finally {
        await lane.close();
      }
    });
  });

  it("单发：pi 用 Responses 协议发、带 PDF、没有推理参数", async () => {
    await withServer([{ type: "text", text: "Read." }], async (server) => {
      const model = row(DECLARED_META);
      const config = nomiModelConfigFor(connection(server.baseURL), model, API_KEY);
      const input = desktopInput(model, config.kind);
      const context = input.capture();
      const content = await input.providerContent({ role: "nomi.input", content: "Summarise the attached brief.", timestamp: 1, context } as never);
      const { message, model: used } = await callModelOnce({ model: config, fetch: globalThis.fetch, content: content as never,
        systemPrompt: "NOMI_DECLARATION_SYSTEM", signal: new AbortController().signal,
        onPayload: (payload, api) => input.rewritePayload(payload, api) });
      expect(server.requests).toHaveLength(1);
      expectDeclaredRequest(server.requests[0]!, "single shot");
      expect(message.api, "pi api").toBe("openai-responses");
      expect(used.api, "pi api").toBe("openai-responses");
      expectPdfBlock(server.requests[0]!, "single shot");
    });
  });

  it("描述层：交给 pi 的模型 reasoning: true、档位表和 compat 原样，pi 算出的可选档就是声明的那组", () => {
    const config = nomiModelConfigFor(connection("http://127.0.0.1:9/v1"), row(DECLARED_META), API_KEY);
    const descriptor = createNomiModelDescriptor(config);
    expect(descriptor.api).toBe("openai-responses");
    expect(descriptor.reasoning).toBe(true);
    expect(descriptor.thinkingLevelMap).toEqual(THINKING_LEVEL_MAP);
    expect(descriptor.compat).toEqual(COMPAT);
    expect(getSupportedThinkingLevels(descriptor)).toEqual(DECLARED_LEVELS);
  });

  // 另两条协议在 `reasoning: true` 时没选档也会改请求：Chat（`supportsReasoningEffort`）发 `reasoning_effort = thinkingLevelMap.off`、
  // 系统提示变 developer；Anthropic 发 `thinking: { type: "disabled" }`。没选档的单发两条都必须是普通请求。
  it.each([
    { protocol: "openai-compatible", path: "/v1/chat/completions",
      compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
      system: (body: Record<string, unknown>) => (body.messages as Array<{ role?: string }>)[0]?.role },
    { protocol: "anthropic", path: "/v1/messages", compat: undefined,
      system: (body: Record<string, unknown>) => Array.isArray(body.system) ? "system" : typeof body.system === "string" ? "system" : undefined },
  ])("单发 · $protocol 协议：声明了推理、没选档 → 请求里没有推理参数，系统提示还是 system", async ({ protocol, path: wanted, compat, system }) => {
    await withServer([{ type: "text", text: "Read." }], async (server) => {
      const model = row({ textProtocol: protocol, reasoning: true, thinkingLevelMap: THINKING_LEVEL_MAP, ...(compat ? { compat } : {}) });
      const config = nomiModelConfigFor(connection(server.baseURL), model, API_KEY);
      await callModelOnce({ model: config, fetch: globalThis.fetch, content: "Summarise." as never,
        systemPrompt: "NOMI_DECLARATION_SYSTEM", signal: new AbortController().signal });
      expect(server.requests).toHaveLength(1);
      const request = server.requests[0]!;
      expect(request.path.split("?")[0], "URL").toBe(wanted);
      for (const key of REASONING_KEYS) expect(request.body, `no ${key} without a chosen level`).not.toHaveProperty(key);
      expect(system(request.body), "system prompt keeps its role").toBe("system");
      expect(request.raw, "system prompt sent").toContain("NOMI_DECLARATION_SYSTEM");
    });
  });

  it("同一个连接下没声明的行：照连接的协议走、不推理、不发 PDF（声明是按行的，不是整家换）", async () => {
    await withServer([{ type: "text", text: "Read." }], async (server) => {
      const model = row();
      const config = nomiModelConfigFor(connection(server.baseURL), model, API_KEY);
      expect(createNomiModelDescriptor(config).reasoning).toBe(false);
      const input = desktopInput(model, config.kind);
      const content = await input.providerContent({ role: "nomi.input", content: "Summarise.", timestamp: 1, context: input.capture() } as never);
      await callModelOnce({ model: config, fetch: globalThis.fetch, content: content as never, signal: new AbortController().signal,
        onPayload: (payload, api) => input.rewritePayload(payload, api) });
      expect(server.requests[0]!.path).toBe("/v1/chat/completions");
      expect(server.requests[0]!.raw).not.toContain(PDF.toString("base64"));
    });
  });
});
