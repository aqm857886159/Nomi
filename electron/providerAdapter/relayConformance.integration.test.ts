// 自建中转一致性台架（docs/plan/2026-09-03-self-hosted-relay-conformance-harness.md）。
//
// 为什么存在：「用户接自己的中转」是全仓**唯一没有反馈回路**的路径——只有用户在跑，且跑在我们
// 没有的配置里。2026-09-03 真机付费实测（otokapi / gpt-image-2）一次挖出四连环，全部只能靠
// 真发一次请求才会暴露（root-cause: docs/fixes/2026-09-03-relay-multipart-image-edit-certification）。
//
// 两块现成积木，此前从未接在一起：
//   ① catalog/falLoopback.integration.test.ts —— 起本地 HTTP server 冒充供应商，驱动**真运行时**
//   ② providerAdapter/verifier.ts —— **真认证探针**（service.ts:127 生产同一条路）
// 本文件把它们接上：内置草稿 → 真认证 → 真落库投影 → 真生成，全程零 mock 生产逻辑。
//
// ★ 唯一的关键设计约束：**假中转必须是「严格的」，不是「配合的」。**
// 一个宽容的假中转会把那四个 bug 全部放过去——那正是本仓反复栽的「假绿」。真中转当初怎么拒我们，
// 假的就必须怎么拒。下面四条 REJECTION RULE 逐条转录自真机实测，不是臆造，**不许放松**：
//   R-A  改图发到 /v1/chat/completions → 400「This model is not supported on the Chat Completions
//        endpoint」（真机原文）。抓：用错端点族。
//   R-B  /v1/images/edits 收不到图片文件 part → 400。抓：漏声明 referenceParam → 探针没注图。
//   R-C  图片短边 < 256 → 400 invalid_image（实测 2×2 → 400，256×256 → 200）。抓：夹具过小。
//   R-D  multipart 的 image part 必须是真**字节**（PNG magic），不是 URL 字符串。抓：multipart
//        忽略注入的 localAssetReader。
// 每条都按 R17 验过红（回退对应生产修复 → 该条红），红字直接指名违反了哪条规则。
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-relay-conformance", getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  webContents: { getAllWebContents: () => [] },
}));

import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";
import { verifyAdapterMode } from "./verifier";
import { executeProfileOperation } from "../runtime";
import type { Model, Vendor } from "../catalog/types";
import type { AdapterModeDraft } from "./types";

/** 真机原文（otokapi/gpt-image-2，2026-09-03）。改图打到聊天端点时上游一字不差回这句。 */
const CHAT_ENDPOINT_REJECTION = "This model is not supported on the Chat Completions endpoint";
/** 实测下限：2×2 → 400 invalid_image；256×256 → 200。 */
const MIN_IMAGE_SHORT_SIDE = 256;
const MODEL_KEY = "gpt-image-2";

type RelayHit = {
  method: string;
  path: string;
  /** multipart 请求里真正收到的文件 part（已按 PNG 头解析出尺寸）。 */
  files: Array<{ field: string; fileName: string; byteLength: number; isPng: boolean; width: number; height: number; head: string }>;
  fields: Record<string, string>;
  jsonBody?: unknown;
  status: number;
  rejection?: string;
};

const hits: RelayHit[] = [];
let server: http.Server;
let baseUrl = "";

/** 1×1 起步的合法 PNG 生成器：用来造「短边过小」的反例，不手抄 base64。 */
function pngOfSize(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const raw = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 中转返回的产物图（256×256，够过认证的媒体校验）。 */
const RESULT_PNG = pngOfSize(256, 256);

function isPng(bytes: Buffer): boolean {
  return bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

/** 真读 PNG 的 IHDR，而不是相信声明——严格中转就是这么校验的。 */
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (!isPng(bytes)) return { width: 0, height: 0 };
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * 极简 multipart/form-data 解析（只够本台架用）：按 boundary 切块，分出文本字段与文件 part。
 * 必须真解析——「文件 part 里到底是字节还是 URL 字符串」正是规则 R-D 的判据。
 */
function parseMultipart(body: Buffer, contentType: string): Pick<RelayHit, "files" | "fields"> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const files: RelayHit["files"] = [];
  const fields: Record<string, string> = {};
  if (!boundaryMatch) return { files, fields };
  const boundary = Buffer.from(`--${(boundaryMatch[1] || boundaryMatch[2]).trim()}`);
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    const start = cursor + boundary.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(boundary, start);
    const part = body.subarray(start, next === -1 ? body.length : next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const headers = part.subarray(0, headerEnd).toString("utf8");
    // 尾部 \r\n 属于分隔符，不属于内容
    const content = part.subarray(headerEnd + 4, Math.max(headerEnd + 4, part.length - 2));
    const nameMatch = /name="([^"]*)"/i.exec(headers);
    const fileNameMatch = /filename="([^"]*)"/i.exec(headers);
    const name = nameMatch ? nameMatch[1] : "";
    if (fileNameMatch) {
      const size = pngSize(content);
      files.push({
        field: name,
        fileName: fileNameMatch[1],
        byteLength: content.length,
        isPng: isPng(content),
        width: size.width,
        height: size.height,
        // 前 48 字节可读预览：文件 part 若装的是 URL 字符串，这里会直接看到 nomi-local://…
        head: content.subarray(0, 48).toString("utf8").replace(/[^\x20-\x7e]/g, "."),
      });
    } else if (name) {
      fields[name] = content.toString("utf8");
    }
    cursor = next;
  }
  return { files, fields };
}

function send(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = new URL(request.url || "/", "http://relay").pathname;
      const contentType = String(request.headers["content-type"] || "");
      const hit: RelayHit = { method: request.method || "", path, files: [], fields: {}, status: 0 };
      hits.push(hit);

      const reject = (status: number, message: string, code?: string): void => {
        hit.status = status;
        hit.rejection = message;
        send(response, status, { error: { message, ...(code ? { code } : {}) } });
      };

      // ── GET /v1/models：中转的模型清单（接入向导第一步真会打它）
      if (request.method === "GET" && path === "/v1/models") {
        hit.status = 200;
        return send(response, 200, { object: "list", data: [{ id: MODEL_KEY, object: "model", owned_by: "openai" }] });
      }

      if (contentType.includes("multipart/form-data")) {
        const parsed = parseMultipart(body, contentType);
        hit.files = parsed.files;
        hit.fields = parsed.fields;
      } else if (body.length > 0) {
        try {
          hit.jsonBody = JSON.parse(body.toString("utf8"));
        } catch {
          hit.jsonBody = body.toString("utf8");
        }
      }

      // ── REJECTION RULE A ─────────────────────────────────────────────────
      // 改图发到聊天端点 → 400（真机原文）。判据：这家中转的 gpt-image 系模型在
      // /v1/chat/completions 上根本不存在，不管报文里带没带图，一律拒。
      if (request.method === "POST" && path === "/v1/chat/completions") {
        const model = String((hit.jsonBody as { model?: unknown })?.model ?? "");
        if (/gpt[_-]?image|dall-?e-2/i.test(model)) {
          return reject(400, CHAT_ENDPOINT_REJECTION, "model_not_supported");
        }
        hit.status = 200;
        return send(response, 200, { choices: [{ message: { content: "ready" } }] });
      }

      // ── /v1/images/generations：文生图（真中转回的是 data URL，不是 http URL）
      if (request.method === "POST" && path === "/v1/images/generations") {
        hit.status = 200;
        return send(response, 200, {
          created: 1,
          data: [{ url: `data:image/png;base64,${RESULT_PNG.toString("base64")}` }],
        });
      }

      // ── /v1/images/edits：multipart 改图
      if (request.method === "POST" && path === "/v1/images/edits") {
        // REJECTION RULE B：收不到图片文件 part → 400。改图端点必须有 image。
        if (hit.files.length === 0) {
          return reject(400, "Missing required parameter: 'image'.", "missing_required_parameter");
        }
        for (const file of hit.files) {
          // REJECTION RULE D：文件 part 必须真是图片**字节**。装 URL 字符串的一律 invalid_image
          // ——真端点解不出图，正是「multipart 忽略注入读取器」时会发生的事。
          if (!file.isPng) {
            return reject(400, `invalid_image: part '${file.field}' is not decodable image data (got ${JSON.stringify(file.head)})`, "invalid_image");
          }
          // REJECTION RULE C：短边过小 → 400 invalid_image（实测 2×2 拒、256×256 过）。
          if (Math.min(file.width, file.height) < MIN_IMAGE_SHORT_SIDE) {
            return reject(400, `invalid_image: image is too small (${file.width}x${file.height}, minimum short side ${MIN_IMAGE_SHORT_SIDE})`, "invalid_image");
          }
        }
        hit.status = 200;
        return send(response, 200, { created: 1, data: [{ b64_json: RESULT_PNG.toString("base64") }] });
      }

      hit.status = 404;
      return send(response, 404, { error: { message: `no such endpoint: ${path}` } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits.length = 0;
});

function vendor(): Vendor {
  return {
    key: "self-hosted-relay",
    name: "Self-hosted relay",
    baseUrlHint: baseUrl,
    authType: "bearer",
    authHeader: "Authorization",
    providerKind: "openai-compatible",
    enabled: true,
    createdAt: "t",
    updatedAt: "t",
  } as Vendor;
}

function model(): Model {
  return { modelKey: MODEL_KEY, vendorKey: "self-hosted-relay", labelZh: MODEL_KEY, kind: "image", enabled: true, createdAt: "t", updatedAt: "t" } as Model;
}

/** 走**真实内置草稿**建模式（用户填 BaseURL 后 service.ts:313 走的就是这条）。 */
function draftModes(): AdapterModeDraft[] {
  const draft = buildOpenAiCompatibleDraft({
    baseUrl,
    authType: "bearer",
    providerKind: "openai-compatible",
    models: [{ modelKey: MODEL_KEY, labelZh: MODEL_KEY, kind: "image" }],
  });
  return draft.models[0].modes;
}

function modeOf(taskKind: string): AdapterModeDraft {
  const mode = draftModes().find((item) => item.taskKind === taskKind);
  if (!mode) throw new Error(`内置草稿没有产出 ${taskKind} 模式——接入链在建模式这一步就断了`);
  return mode;
}

/** 真认证探针（service.ts:127 的 verify 就是它，未打桩）。 */
function certify(mode: AdapterModeDraft) {
  return verifyAdapterMode({ vendor: vendor(), model: model(), apiKey: "sk-relay-test", mode });
}

const editHit = () => hits.find((hit) => hit.path === "/v1/images/edits");

/** 取那次改图请求；没打到就带人话失败（顺带把类型收窄，免得每处 `!`）。 */
function requireEditHit(reason: string): RelayHit {
  const hit = editHit();
  if (!hit) throw new Error(reason);
  return hit;
}

describe("自建中转一致性台架 · 严格假中转拒绝规则（转录自 2026-09-03 真机实测）", () => {
  it("台架自证：改图打到 /v1/chat/completions 会被拒（规则 A · 真机原文）", async () => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL_KEY, messages: [] }),
    });
    expect(response.status, "规则 A 失效：严格中转必须拒绝聊天端点上的 gpt-image 改图").toBe(400);
    expect((await response.json()).error.message).toBe(CHAT_ENDPOINT_REJECTION);
  });

  it("台架自证：/v1/images/edits 缺文件 part 会被拒（规则 B）", async () => {
    const form = new FormData();
    form.append("model", MODEL_KEY);
    form.append("prompt", "make it red");
    const response = await fetch(`${baseUrl}/v1/images/edits`, { method: "POST", body: form });
    expect(response.status, "规则 B 失效：改图端点必须要求 image part").toBe(400);
    expect((await response.json()).error.code).toBe("missing_required_parameter");
  });

  it("台架自证：短边 < 256 的图会被拒，256×256 放行（规则 C · 实测 2×2 → 400）", async () => {
    const post = async (png: Buffer): Promise<number> => {
      const form = new FormData();
      form.append("model", MODEL_KEY);
      form.append("image[]", new Blob([new Uint8Array(png)], { type: "image/png" }), "ref.png");
      return (await fetch(`${baseUrl}/v1/images/edits`, { method: "POST", body: form })).status;
    };
    expect(await post(pngOfSize(2, 2)), "规则 C 失效：2×2 必须被拒（真机 400 invalid_image）").toBe(400);
    expect(await post(pngOfSize(256, 256)), "规则 C 过严：256×256 真机是 200").toBe(200);
  });

  it("台架自证：文件 part 装 URL 字符串而非字节会被拒（规则 D）", async () => {
    const form = new FormData();
    form.append("model", MODEL_KEY);
    form.append("image[]", new Blob(["nomi-local://adapter-test/reference.png"], { type: "image/png" }), "ref.png");
    const response = await fetch(`${baseUrl}/v1/images/edits`, { method: "POST", body: form });
    expect(response.status, "规则 D 失效：URL 字符串冒充图片字节必须被拒").toBe(400);
    expect((await response.json()).error.message).toContain("not decodable image data");
  });
});

describe("自建中转一致性台架 · 真实接入链（内置草稿 → 真认证探针 → 严格中转）", () => {
  it("文生图：认证通过，且打的是 /v1/images/generations", async () => {
    const result = await certify(modeOf("text_to_image"));
    expect(result.ok, `文生图认证失败：${result.ok ? "" : result.error}`).toBe(true);
    expect(hits.some((hit) => hit.path === "/v1/images/generations" && hit.status === 200)).toBe(true);
  });

  it("改图：认证通过全链路——协议选对（multipart /v1/images/edits，不是聊天端点）", async () => {
    const mode = modeOf("image_edit");
    // 协议选择必须按模型族 derive：gpt-image 系 → multipart /v1/images/edits。
    // 走成 /v1/chat/completions 的话，严格中转按规则 A 回真机原文 400。
    expect(mode.create.path, "改图协议选错端点族（规则 A 会拒）").toBe("/v1/images/edits");
    expect(mode.create.multipart, "改图应走 multipart wire").toBeTruthy();

    const result = await certify(mode);
    expect(result.ok, `改图认证失败：${result.ok ? "" : `[${result.stage}] ${result.error}`}`).toBe(true);

    const hit = requireEditHit("认证探针根本没打到 /v1/images/edits");
    expect(hit.status, `严格中转拒绝了这次改图：${hit.rejection}`).toBe(200);
  });

  it("改图：探针**真的注入了参考图**——文件 part 收到 256×256 的 PNG 字节", async () => {
    // 这条同时守三件事：referenceParam 有声明（否则 0 个 part → 规则 B）、multipart 尊重注入的
    // localAssetReader（否则 part 里是 URL 字符串 → 规则 D）、fixture 够大（否则 → 规则 C）。
    const result = await certify(modeOf("image_edit"));
    expect(
      result.ok,
      `改图认证失败（严格中转按真机规则拒绝了我们）：${result.ok ? "" : `[${result.stage}] ${result.error}`}`,
    ).toBe(true);

    const hit = requireEditHit("认证探针根本没打到 /v1/images/edits —— 改图协议选错了端点族（规则 A）");
    expect(hit.files.length, "改图报文里没有任何文件 part —— 参考图没进报文").toBeGreaterThan(0);
    const file = hit.files[0];
    expect(file.field).toBe("image[]");
    expect(file.isPng, `文件 part 不是 PNG 字节，实际开头是 ${JSON.stringify(file.head)}`).toBe(true);
    expect(Math.min(file.width, file.height), "参考图短边小于真实端点下限").toBeGreaterThanOrEqual(MIN_IMAGE_SHORT_SIDE);
    expect(hit.fields.model).toBe(MODEL_KEY);
  });

  it("改图模式声明了参考输入契约，且键就是这条 wire 真实读的那个", async () => {
    const mode = modeOf("image_edit");
    expect(mode.referenceParam, "参考类模式漏声明 referenceParam → 探针拿零参考图去验改图通道").toBe("reference_images");
    expect(mode.referenceShape).toBe("array");
    // 「声明的键」必须真是 create op 读的那个键（写错键 = 注了参考却进不了报文）。
    expect(JSON.stringify(mode.create.multipart?.imageSource)).toContain(String(mode.referenceParam));
  });

  it("图生视频模式按首帧单值声明（image_url/single），不与改图的数组键混用", () => {
    const videoDraft = buildOpenAiCompatibleDraft({
      baseUrl,
      authType: "bearer",
      models: [{ modelKey: "relay-video-1", labelZh: "relay video", kind: "video" }],
    });
    const i2v = videoDraft.models[0].modes.find((mode) => mode.taskKind === "image_to_video");
    expect(i2v, "视频模型缺 image_to_video 模式 → 连了首帧的节点会被直接拒发").toBeTruthy();
    expect(i2v!.referenceParam).toBe("image_url");
    expect(i2v!.referenceShape).toBe("single");
  });
});

describe("自建中转一致性台架 · 生成阶段（认证后的真实用法）", () => {
  it("带参考图的生成请求，参考图字节确实进了发给中转的 multipart 报文", async () => {
    // 认证只证「通道能通」；这条证「用户真拿它改图时，那张图真的发出去了」。
    const mode = modeOf("image_edit");
    const referencePng = pngOfSize(256, 256);
    const referenceUrl = `data:image/png;base64,${referencePng.toString("base64")}`;

    await executeProfileOperation({
      vendor: vendor(),
      model: model(),
      apiKey: "sk-relay-test",
      request: {
        kind: "image_edit",
        prompt: "keep the blue square, make the circle red",
        extras: { modelKey: MODEL_KEY, referenceImages: [referenceUrl] },
      } as never,
      operation: mode.create,
    });

    const hit = requireEditHit("生成请求没打到 /v1/images/edits");
    expect(hit.status, `严格中转拒绝了这次生成：${hit.rejection}`).toBe(200);
    // 行为式断言：断言注入的那张图**真的出现在渲染后的报文里**，不是断言某个键存在。
    expect(hit.files.length, "生成时参考图没进报文——用户以为在改图，实际发的是纯文生图").toBe(1);
    expect(hit.files[0].byteLength).toBe(referencePng.byteLength);
    expect(hit.files[0].isPng).toBe(true);
    expect(hit.fields.prompt).toContain("make the circle red");
  });
});
