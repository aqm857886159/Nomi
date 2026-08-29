import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "./catalog/types";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
let mockedUserDataRoot = "";
const roots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-runtime-"));
  roots.push(mockedUserDataRoot);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("executeProfileOperation adapter verification seam", () => {
  it("rejects a polluted Antigravity operation envelope at the full-operation runtime boundary", async () => {
    const [{ executeProfileOperation }, { antigravityImageMappings }] = await Promise.all([
      import("./runtime"),
      import("./catalog/antigravityCatalog"),
    ]);
    const now = "2026-08-27T00:00:00.000Z";
    const mapping = antigravityImageMappings({
      state: "unverified", version: "1.1.21", checkedAt: 1, loginCommand: "agy", models: [], checks: [],
    })[0];
    const vendor: Vendor = { key: "antigravity-cli", name: "Antigravity", enabled: true, authType: "none",
      baseUrlHint: "local://antigravity", createdAt: now, updatedAt: now };
    const model: Model = { vendorKey: vendor.key, modelKey: "generate_image", labelZh: "generate_image", kind: "image",
      enabled: true, createdAt: now, updatedAt: now };

    await expect(executeProfileOperation({
      vendor, model, apiKey: "", request: { kind: "text_to_image", prompt: "crane", extras: {} },
      operation: { ...mapping.create, body: { prompt: "{{request.params.untrusted}}" } }, stage: "create",
    } as Parameters<typeof executeProfileOperation>[0])).rejects.toThrow("ANTIGRAVITY_INVALID_CONFIG");
  });

  it("uses the injected local asset reader while preserving the production localization pipeline", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/output.png" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchFn);
    const { executeProfileOperation } = await import("./runtime");
    const now = "2026-08-07T00:00:00.000Z";
    const vendor: Vendor = {
      key: "blind-example",
      name: "Blind Example",
      enabled: false,
      baseUrlHint: "https://api.example.com/v1",
      authType: "bearer",
      assetIngestion: { strategy: "inline-base64", accepts: ["image"] },
      createdAt: now,
      updatedAt: now,
    };
    const model: Model = {
      vendorKey: vendor.key,
      modelKey: "paint-v2",
      labelZh: "Paint V2",
      kind: "image",
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };

    await executeProfileOperation({
      vendor,
      model,
      apiKey: "sk-test",
      request: {
        kind: "image_edit",
        prompt: "preserve the blue square",
        extras: {
          modelKey: model.modelKey,
          referenceImages: ["nomi-local://adapter-test/reference.png"],
        },
      },
      operation: {
        method: "POST",
        path: "/images/edits",
        body: {
          model: "{{model.modelKey}}",
          prompt: "{{request.prompt}}",
          image: "{{request.params.image_url}}",
        },
      },
      localAssetReader: (url) =>
        url === "nomi-local://adapter-test/reference.png"
          ? { bytes: PNG_BYTES, contentType: "image/png", fileName: "reference.png" }
          : null,
    });

    const body = JSON.parse(String((fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body || "{}"));
    expect(body.image).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
  });

  /**
   * 出站 body 里**永远不该**出现 data: URI（除非该 vendor 的策略就是 inline-base64，见上一条）。
   * 2026-08-26 真实付费实测：raw data: URI 直穿到 wire 时，Ark 收（200）、kie 三个模型全 500
   * "File type not supported" —— 同一张图换个供应商就挂。这条把「wire 上是公网 URL」钉死在
   * runtime 层（不只是 assetLocalization 单测）。
   */
  it("materialises a caller-supplied data: URI into a public url before it reaches the wire", async () => {
    const fetchFn = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/uploads/images")) {
        return new Response(JSON.stringify({ url: "https://cdn.example.com/uploaded.png" }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/output.png" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchFn);
    const { executeProfileOperation } = await import("./runtime");
    const now = "2026-08-26T00:00:00.000Z";
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const vendor: Vendor = {
      key: "upload-example",
      name: "Upload Example",
      enabled: false,
      baseUrlHint: "https://api.example.com/v1",
      authType: "bearer",
      assetIngestion: { strategy: "upload-multipart", endpoint: "https://api.example.com/v1/uploads/images", urlPath: "url", accepts: ["image"] },
      createdAt: now,
      updatedAt: now,
    };
    const model: Model = {
      vendorKey: vendor.key,
      modelKey: "paint-v2",
      labelZh: "Paint V2",
      kind: "image",
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };

    await executeProfileOperation({
      vendor,
      model,
      apiKey: "sk-test",
      request: {
        kind: "image_edit",
        prompt: "keep the composition",
        extras: {
          modelKey: model.modelKey,
          // headless/MCP 调用方直接给内联字节（UI 主路径会先落成项目素材，碰不到这条）。
          referenceImages: [`data:image/png;base64,${pngBytes.toString("base64")}`],
        },
      },
      operation: {
        method: "POST",
        path: "/images/edits",
        body: {
          model: "{{model.modelKey}}",
          prompt: "{{request.prompt}}",
          image: "{{request.params.image_url}}",
        },
      },
      // 读盘器一次都不该被调用：内联字节零 IO。
      localAssetReader: () => null,
    });

    const uploadCall = fetchFn.mock.calls.find((call) => String(call[0]).includes("/uploads/images"));
    expect(uploadCall).toBeDefined();
    const generateCall = fetchFn.mock.calls.find((call) => String(call[0]).includes("/images/edits"));
    const body = JSON.parse(String((generateCall?.[1] as RequestInit | undefined)?.body || "{}"));
    expect(body.image).toBe("https://cdn.example.com/uploaded.png");
    expect(JSON.stringify(body)).not.toContain("data:");
  });
});
