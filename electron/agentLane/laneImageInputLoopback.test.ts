// 读图能力只认声明（设计卡 docs/plan/2026-10-27-vision-capability-declared.md，验收 A1/A2/A3/A5）。
//
// 走真门：Agent 车道的 `createDesktopLaneInput().providerContent`（判能力 → 拼附件）→ 真 pi（`callModelOnce`，
// 与 lane 同一个 provider 装配）→ 真 HTTP 打到本机假上游，录下请求体，看图在不在。只把「项目素材从哪读字节」换成内存。
// 起因：用户配了能读图的自起名模型（`my-gpt`），名字撞不上写死的正则 → 判不能 → 图在发出前被丢掉，模型只能说读不到。
import { describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";

const PNG = vi.hoisted(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]));

vi.mock("../assets/projectAssetStore", () => ({
  resolveProjectAgentAttachmentClaims: (_projectId: string, claims: ReadonlyArray<{ assetId: string }>) => claims.map((claim) => ({
    assetId: claim.assetId, contentHash: `hash-${claim.assetId}`, version: 1,
    display: { url: `nomi-local://asset/vision-fixture/${claim.assetId}.png`, fileName: `${claim.assetId}.png`, contentType: "image/png", sizeBytes: PNG.byteLength, kind: "image" },
  })),
}));
vi.mock("../assets/localAssetFile", async (importOriginal) => ({
  ...await importOriginal<typeof import("../assets/localAssetFile")>(),
  readNomiLocalAsset: () => ({ bytes: PNG }),
}));

import { createDesktopLaneInput } from "./laneDesktopInput";
import { callModelOnce } from "./laneModelCall.mjs";
import { nomiModelConfigFor } from "../ai/vendorModelConnection";
import { reply, startTextUpstream, type UpstreamProtocol } from "../../tests/fixtures/textTasks/textUpstream";

const IMAGE_BASE64 = Buffer.from(PNG).toString("base64");
/** 每种协议里「这是一张图」的那个段（pi 按协议翻译 image part）。 */
const IMAGE_PART_MARK: Record<UpstreamProtocol, string> = {
  "openai-compatible": "\"type\":\"image_url\"",
  "openai-responses": "\"type\":\"input_image\"",
  anthropic: "\"type\":\"image\"",
};
const DROP_NOTE = "张图片未发送";

/** 一行目录模型：只填判能力要看的那几格（vendorKey / modelKey / meta）。 */
function row(vendorKey: string, modelKey: string, meta?: Record<string, unknown>): Model {
  return { vendorKey, modelKey, labelZh: modelKey, kind: "text", enabled: true, createdAt: "", updatedAt: "", ...(meta ? { meta } : {}) };
}

/** 附一张图发一句话：经 Agent 车道的真门拼内容，再经真 pi 发到本机假上游，返回录下的请求体（JSON 文本）。 */
async function sendWithImage(model: Model, protocol: UpstreamProtocol): Promise<string> {
  const server = await startTextUpstream(protocol, () => reply.text("ok"));
  try {
    const vendor = { key: model.vendorKey, name: model.vendorKey, enabled: true, providerKind: protocol, authType: "bearer",
      baseUrlHint: protocol === "anthropic" ? `${server.origin}/v1` : server.baseURL, createdAt: "", updatedAt: "" } as Vendor;
    const config = nomiModelConfigFor(vendor, model, "sk-fixture");
    const context = { approvalPolicy: { mode: "request" as const }, attachments: [{ assetId: "photo", version: 1 }] };
    const input = createDesktopLaneInput({ projectId: "vision-fixture", capture: () => context, activate: () => undefined,
      prepare: async (captured) => captured, model: () => ({ model, kind: config.kind }) });
    const content = await input.providerContent({ role: "nomi.input", content: "这张图里有什么？", timestamp: 1, context } as never);
    const { message } = await callModelOnce({ model: config, fetch: globalThis.fetch, content: content as never, signal: new AbortController().signal });
    expect(message.stopReason).toBe("stop");
    expect(server.requests).toHaveLength(1);
    return JSON.stringify(server.requests[0].body);
  } finally {
    await server.close();
  }
}

const PROTOCOLS: UpstreamProtocol[] = ["openai-compatible", "openai-responses", "anthropic"];

/**
 * 没声明能力、又不是内置种子的行 = 不知道 → 照发，让真后端决定。名字故意取撞不上旧正则的那种：
 * 用户自起的名字，以及用户在内置 vendor 下自己加的新型号（按行判，不按 vendor 判）。
 */
const UNDECLARED_CUSTOM_ROWS: Model[] = [
  row("my-relay", "my-gpt"),
  row("apimart", "gpt-5.5"),
];

describe("Agent 车道附图：没声明能力的自配行，图真的进请求体（三种协议）", () => {
  it.each(UNDECLARED_CUSTOM_ROWS.flatMap((model) => PROTOCOLS.map((protocol) => ({ model, protocol }))))(
    "$model.vendorKey/$model.modelKey · $protocol",
    async ({ model, protocol }) => {
      const body = await sendWithImage(model, protocol);
      expect(body).toContain(IMAGE_BASE64);
      expect(body).toContain(IMAGE_PART_MARK[protocol]);
      expect(body).not.toContain(DROP_NOTE);
    },
  );
});

describe("Agent 车道附图：声明决定一切", () => {
  it("显式声明能读图的自配行：发图", async () => {
    const body = await sendWithImage(row("my-relay", "relay-declared", { supportsImageInput: true }), "openai-compatible");
    expect(body).toContain(IMAGE_BASE64);
    expect(body).not.toContain(DROP_NOTE);
  });

  it("显式声明不能读图的自配行：不发图，附注说明，素材原身份仍在", async () => {
    const body = await sendWithImage(row("my-relay", "relay-text-only", { supportsImageInput: false }), "openai-compatible");
    expect(body).not.toContain(IMAGE_BASE64);
    expect(body).toContain(DROP_NOTE);
    expect(body).toContain("photo");
  });

  it("内置 APIMart deepseek-v4-pro（种子行，没声明 = 不能）：不发图，附注说明，素材原身份仍在", async () => {
    const body = await sendWithImage(row("apimart", "deepseek-v4-pro"), "openai-compatible");
    expect(body).not.toContain(IMAGE_BASE64);
    expect(body).toContain(DROP_NOTE);
    expect(body).toContain("photo");
  });
});
