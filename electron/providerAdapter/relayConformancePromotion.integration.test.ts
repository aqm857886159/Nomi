// 自建中转一致性台架 · 落库那一段（docs/plan/2026-09-03-self-hosted-relay-conformance-harness.md）。
//
// 与 relayConformance.integration.test.ts 分文件的**唯一原因**：这条链必须 vi.mock catalogStore 才能
// 观察落库写入，而 mock 是模块级的、会污染那边的真运行时。两边覆盖的是同一条链的前后两段：
//   那边：内置草稿 → 真认证探针 → 严格假中转（证「通道真能通」）
//   这边：真认证结论 → 真 promote → 落库（证「认证通过的改图通道**真的落库且 enabled**」）
//
// 为什么这段非验不可：2026-09-03 那四个 bug 的**用户可见症状**不是「认证失败」——用户根本看不到认证
// 细节——而是「模型没有图生图通道，参考图发不出去」。那句话的直接来源就是**库里没有 image_edit
// mapping**。认证过了但没落库，症状与认证失败时一模一样。
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import type { Mapping, Model, Vendor } from "../catalog/types";

const now = "2026-09-03T00:00:00.000Z";
const MODEL_KEY = "gpt-image-2";
const VENDOR_KEY = "self-hosted-relay";

const vendor: Vendor = {
  key: VENDOR_KEY,
  name: "Self-hosted relay",
  enabled: false,
  baseUrlHint: "http://127.0.0.1:1/v1",
  authType: "bearer",
  providerKind: "openai-compatible",
  createdAt: now,
  updatedAt: now,
};
const models: Model[] = [{
  vendorKey: VENDOR_KEY,
  modelKey: MODEL_KEY,
  labelZh: MODEL_KEY,
  kind: "image",
  enabled: false,
  meta: { adapter: { state: "testing", runId: "run-relay", modes: [], updatedAt: now } },
  createdAt: now,
  updatedAt: now,
}];

const upsertMapping = vi.fn();
const upsertModel = vi.fn();
const upsertVendor = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-relay-promotion", getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  webContents: { getAllWebContents: () => [] },
}));

vi.mock("../catalog/catalogStore", () => ({
  readCatalog: () => ({ vendors: [vendor], models, mappings: [], apiKeysByVendor: {} }),
  mutateCatalog: (fn: (tx: unknown) => void) =>
    fn({ upsertModel, upsertVendor, upsertMapping, deleteModelMappings: vi.fn(), deleteMapping: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }),
  extractVendorExtraHeaders: () => ({}),
  normalizeProviderKind: (value: unknown) => value ?? "openai-compatible",
}));

const { buildOpenAiCompatibleDraft } = await import("./builtinOpenAiCompatibleDraft");
const { verifyAdapterMode } = await import("./verifier");
const { defaultCatalog } = await import("./service");

/** 与主台架同源的严格假中转（同四条规则）；这里只需要它对**正确**请求放行。 */
let server: http.Server;
let baseUrl = "";
const RESULT_PNG_B64 = (() => {
  const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0);
  ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(256 * (1 + 256 * 4)))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
})();

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = new URL(request.url || "/", "http://relay").pathname;
      const contentType = String(request.headers["content-type"] || "");
      const json = (status: number, payload: unknown): void => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      // 严格：改图必须是 multipart 且真带文件字节（与主台架规则 B/D 同口径）。
      if (path === "/v1/images/edits") {
        const hasFile = contentType.includes("multipart/form-data") && body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        if (!hasFile) return json(400, { error: { message: "invalid_image", code: "invalid_image" } });
        return json(200, { created: 1, data: [{ b64_json: RESULT_PNG_B64 }] });
      }
      if (path === "/v1/images/generations") {
        return json(200, { created: 1, data: [{ url: `data:image/png;base64,${RESULT_PNG_B64}` }] });
      }
      return json(400, { error: { message: "This model is not supported on the Chat Completions endpoint" } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vendor.baseUrlHint = baseUrl;
});

beforeEach(() => {
  upsertMapping.mockClear();
  upsertModel.mockClear();
  upsertVendor.mockClear();
});

describe("自建中转一致性台架 · 认证结论落库", () => {
  it("改图认证通过后，image_edit mapping 确实落库且 enabled（用户看不到「没有图生图通道」的前提）", async () => {
    const draft = buildOpenAiCompatibleDraft({
      baseUrl,
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey: MODEL_KEY, labelZh: MODEL_KEY, kind: "image" }],
    });
    const draftModel = draft.models[0];

    // 真认证探针打严格假中转（未打桩）——verifiedModes 必须来自**真实认证结论**，
    // 手写一份就等于假绿：那四个 bug 全部发生在「认证到底过没过」这一步。
    const verified: Array<{ modelKey: string; taskKind: string }> = [];
    for (const mode of draftModel.modes) {
      const result = await verifyAdapterMode({
        vendor: { ...vendor, baseUrlHint: baseUrl } as Vendor,
        model: { modelKey: MODEL_KEY, vendorKey: VENDOR_KEY, kind: "image", enabled: true, createdAt: now, updatedAt: now } as Model,
        apiKey: "sk-relay-test",
        mode,
      });
      if (result.ok) verified.push({ modelKey: MODEL_KEY, taskKind: mode.taskKind });
    }
    expect(verified.map((item) => item.taskKind).sort(), "改图没通过真实认证，落库无从谈起").toContain("image_edit");

    defaultCatalog.promote({
      run: {
        id: "run-relay",
        vendorKey: VENDOR_KEY,
        vendorName: vendor.name,
        connectionFingerprint: "fp",
        selectedModelKeys: [MODEL_KEY],
        stage: "succeeded",
        repairAttempt: 0,
        models: [{
          modelKey: MODEL_KEY,
          labelZh: MODEL_KEY,
          kind: "image",
          modes: draftModel.modes.map((mode) => ({
            taskKind: mode.taskKind,
            state: verified.some((item) => item.taskKind === mode.taskKind) ? "verified" : "failed",
            attempts: 1,
          })),
        }],
        sourceUrls: [],
        createdAt: now,
        updatedAt: now,
      },
      draft,
      revision: { id: "rev-relay", vendorKey: VENDOR_KEY, digest: "digest", draft, verifiedModes: verified, createdAt: now },
      verifiedModes: verified,
    } as unknown as Parameters<typeof defaultCatalog.promote>[0]);

    const written = upsertMapping.mock.calls.map(([payload]) => payload as Mapping);
    const edit = written.find((mapping) => mapping.taskKind === "image_edit");
    expect(edit, "认证过了却没落 image_edit mapping —— 用户仍会看到「没有图生图通道」").toBeTruthy();
    expect(edit!.enabled, "image_edit mapping 落库了但没 enabled，等于没有").toBe(true);
    // 落的必须是真实跑通的那条 wire（multipart /v1/images/edits），不是聊天端点那份。
    expect(edit!.create.path).toBe("/v1/images/edits");
    expect(edit!.create.multipart, "落库的改图 wire 不是 multipart —— 与认证时跑通的那条不是同一条").toBeTruthy();
  });
});
