import { describe, it, expect, vi } from "vitest";
import {
  collectLocalAssetUrls,
  replaceLocalAssetUrls,
  resolveLocalAsset,
  localizeAssetsForVendor,
  resolveAssetIngestion,
  resolveAssetIngestionWithFallback,
  isLocalAssetUrl,
  type LocalAsset,
} from "./assetLocalization";
import type { AssetIngestion } from "./types";

const localUrl = (p: string) => `nomi-local://asset/proj/${p}`;
const fakeAsset = (name: string): LocalAsset => ({ bytes: Buffer.from("hello-" + name), contentType: "image/png", fileName: name });
const read = (url: string): LocalAsset | null => fakeAsset(url.split("/").pop() || "x");
// 默认 multipart mock：返回声明 urlPath 能读到的形状。各用例可覆盖。
const noMultipart = vi.fn();

describe("isLocalAssetUrl / collect / replace", () => {
  it("detects nomi-local urls only", () => {
    expect(isLocalAssetUrl(localUrl("a.png"))).toBe(true);
    expect(isLocalAssetUrl("https://x/a.png")).toBe(false);
    expect(isLocalAssetUrl(42)).toBe(false);
  });

  it("collects nested + array, deduped", () => {
    const extras = {
      firstFrameUrl: localUrl("a.png"),
      referenceImageUrls: [localUrl("b.png"), "https://pub/c.png", localUrl("a.png")],
      prompt: "no url here",
    };
    expect(Array.from(collectLocalAssetUrls(extras)).sort()).toEqual([localUrl("a.png"), localUrl("b.png")].sort());
  });

  it("replaces recursively, leaving non-local untouched", () => {
    const map = new Map([[localUrl("a.png"), "https://pub/a.png"]]);
    const out = replaceLocalAssetUrls({ x: localUrl("a.png"), y: ["https://pub/c.png", localUrl("a.png")] }, map);
    expect(out).toEqual({ x: "https://pub/a.png", y: ["https://pub/c.png", "https://pub/a.png"] });
  });
});

describe("resolveLocalAsset (per strategy)", () => {
  const noPost = vi.fn();

  it("inline-base64 returns a data URI without uploading", async () => {
    const out = await resolveLocalAsset(localUrl("a.png"), { strategy: "inline-base64" }, "k", read, noPost, noMultipart);
    expect(out.startsWith("data:image/png;base64,")).toBe(true);
    expect(noPost).not.toHaveBeenCalled();
    expect(noMultipart).not.toHaveBeenCalled();
  });

  it("none throws a clear error", async () => {
    await expect(resolveLocalAsset(localUrl("a.png"), { strategy: "none" }, "k", read, noPost, noMultipart)).rejects.toThrow(/不支持本地素材/);
  });

  it("upload-url posts base64 and reads the declared url path", async () => {
    const ingestion: AssetIngestion = {
      strategy: "upload-url",
      endpoint: "https://up/x",
      base64Field: "base64Data",
      uploadPathField: "uploadPath",
      uploadPath: "images/nomi",
      fileNameField: "fileName",
      urlPath: "data.downloadUrl",
    };
    const post = vi.fn().mockResolvedValue({ code: 200, data: { downloadUrl: "https://pub/a.png" } });
    const out = await resolveLocalAsset(localUrl("a.png"), ingestion, "key123", read, post, noMultipart);
    expect(out).toBe("https://pub/a.png");
    const [url, headers, body] = post.mock.calls[0];
    expect(url).toBe("https://up/x");
    expect(headers.Authorization).toBe("Bearer key123");
    expect((body as Record<string, unknown>).base64Field === undefined).toBe(true);
    expect(String((body as Record<string, string>).base64Data).startsWith("data:image/png;base64,")).toBe(true);
    expect((body as Record<string, string>).uploadPath).toBe("images/nomi");
    expect((body as Record<string, string>).fileName).toBe("a.png");
  });

  it("upload-url with dataUrlPrefix:false sends pure base64", async () => {
    const ingestion: AssetIngestion = { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b64", dataUrlPrefix: false, urlPath: "url" };
    const post = vi.fn().mockResolvedValue({ url: "https://pub/a.png" });
    await resolveLocalAsset(localUrl("a.png"), ingestion, "k", read, post, noMultipart);
    expect(String((post.mock.calls[0][2] as Record<string, string>).b64).startsWith("data:")).toBe(false);
  });

  it("upload-url throws when response lacks the url path", async () => {
    const ingestion: AssetIngestion = { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "data.downloadUrl" };
    const post = vi.fn().mockResolvedValue({ code: 500, msg: "boom" });
    await expect(resolveLocalAsset(localUrl("a.png"), ingestion, "k", read, post, noMultipart)).rejects.toThrow(/缺少可达 URL/);
  });

  it("upload-multipart posts the file bytes and reads the declared url path", async () => {
    const ingestion: AssetIngestion = { strategy: "upload-multipart", endpoint: "https://api.apimart.ai/v1/uploads/images", urlPath: "url" };
    const postMultipart = vi.fn().mockResolvedValue({ url: "https://cdn.apimart/a.png" });
    const out = await resolveLocalAsset(localUrl("a.png"), ingestion, "key123", read, vi.fn(), postMultipart);
    expect(out).toBe("https://cdn.apimart/a.png");
    const [url, headers, bytes, fileName, contentType] = postMultipart.mock.calls[0];
    expect(url).toBe("https://api.apimart.ai/v1/uploads/images");
    expect(headers.Authorization).toBe("Bearer key123");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(fileName).toBe("a.png");
    expect(contentType).toBe("image/png");
  });

  it("upload-multipart with empty apiKey sends NO Authorization header (relay 无鉴权)", async () => {
    const ingestion: AssetIngestion = { strategy: "upload-multipart", endpoint: "https://relay.example/upload", urlPath: "url" };
    const postMultipart = vi.fn().mockResolvedValue({ url: "https://relay.example/x.png" });
    await resolveLocalAsset(localUrl("a.png"), ingestion, "", read, vi.fn(), postMultipart);
    const headers = postMultipart.mock.calls[0][1] as Record<string, string>;
    expect("Authorization" in headers).toBe(false);
  });

  it("upload-multipart throws when response lacks the url path", async () => {
    const ingestion: AssetIngestion = { strategy: "upload-multipart", endpoint: "https://up/x", urlPath: "url" };
    const postMultipart = vi.fn().mockResolvedValue({ oops: "no url" });
    await expect(resolveLocalAsset(localUrl("a.png"), ingestion, "k", read, vi.fn(), postMultipart)).rejects.toThrow(/缺少可达 URL/);
  });

  it("sidecar originalUrl short-circuits: returns public URL, never uploads", async () => {
    const readWithSidecar = (): LocalAsset => ({ ...fakeAsset("a.png"), originalUrl: "https://cdn.origin/a.png" });
    const postJson = vi.fn();
    const postMultipart = vi.fn();
    // 即便策略是 upload-multipart，有 originalUrl 也直接返回，不调任何上传
    const out = await resolveLocalAsset(localUrl("a.png"), { strategy: "upload-multipart", endpoint: "x", urlPath: "url" }, "k", readWithSidecar, postJson, postMultipart);
    expect(out).toBe("https://cdn.origin/a.png");
    expect(postJson).not.toHaveBeenCalled();
    expect(postMultipart).not.toHaveBeenCalled();
  });
});

describe("localizeAssetsForVendor", () => {
  const ingestion: AssetIngestion = { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "url" };

  it("uploads each unique url once and replaces all occurrences", async () => {
    const post = vi.fn().mockImplementation((_u, _h, body: Record<string, string>) => {
      // echo a stable url derived from the base64 so dupes map identically
      return Promise.resolve({ url: "https://pub/" + body.b.slice(-6) });
    });
    const extras = {
      firstFrameUrl: localUrl("a.png"),
      referenceImageUrls: [localUrl("b.png"), localUrl("a.png")],
    };
    const out = await localizeAssetsForVendor(extras, ingestion, "k", read, post, noMultipart);
    expect(out.uploaded).toBe(2); // a.png + b.png, a.png not uploaded twice
    expect(post).toHaveBeenCalledTimes(2);
    const value = out.value as typeof extras;
    expect(value.firstFrameUrl).toBe(value.referenceImageUrls[1]); // same source → same resolved url
    expect(value.referenceImageUrls[0].startsWith("https://pub/")).toBe(true);
  });

  it("is a zero-cost passthrough when there are no local assets", async () => {
    const post = vi.fn();
    const extras = { firstFrameUrl: "https://pub/a.png", prompt: "hi" };
    const out = await localizeAssetsForVendor(extras, ingestion, "k", read, post, noMultipart);
    expect(out.uploaded).toBe(0);
    expect(out.value).toBe(extras);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("resolveAssetIngestionWithFallback (跨 vendor 上传优先级链)", () => {
  // getApiKey 工厂：用一组「已配置 key 的 vendor」构造查询函数
  const keysOf = (...vendorKeys: string[]) => (k: string) => (vendorKeys.includes(k) ? `key-${k}` : null);

  it("① 目标 vendor 自己有上传能力 → 用目标 + 目标的 key", () => {
    const out = resolveAssetIngestionWithFallback({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"));
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.uploadApiKey).toBe("key-apimart");
  });

  it("② 目标无上传能力 + 配了 KIE → 用 KIE 中转 + KIE 的 key", () => {
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, { key: "kie" }], keysOf("openai", "kie"));
    expect(out?.ingestion.strategy).toBe("upload-url"); // KIE = upload-url
    expect(out?.uploadApiKey).toBe("key-kie");
  });

  it("③ 无 KIE + 配了 apimart(且目标≠apimart) → 用 apimart 中转 + apimart 的 key", () => {
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, { key: "apimart" }], keysOf("openai", "apimart"));
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.uploadApiKey).toBe("key-apimart");
  });

  it("KIE 优先于 apimart（两者都配时选 KIE）", () => {
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "kie" }, { key: "apimart" }], keysOf("openai", "kie", "apimart"));
    expect(out?.uploadApiKey).toBe("key-kie");
  });

  it("④ 无 KIE/apimart + 另一 vendor 自带 upload-url 声明 → 用它中转", () => {
    const custom = { key: "custom", assetIngestion: { strategy: "upload-url", endpoint: "https://c/up", base64Field: "b", urlPath: "url" } as AssetIngestion };
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, custom], keysOf("openai", "custom"));
    expect(out?.ingestion.strategy).toBe("upload-url");
    expect(out?.uploadApiKey).toBe("key-custom");
  });

  it("inline-base64 的 vendor 不算「有上传能力」，不被选作中转", () => {
    const inlineVendor = { key: "inliner", assetIngestion: { strategy: "inline-base64" } as AssetIngestion };
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, inlineVendor], keysOf("openai", "inliner"));
    expect(out).toBeNull(); // 没有任何真正能产出公网 URL 的通道
  });

  it("⑤ 全无上传通道 → 返回 null（待 nomi-relay 兜底）", () => {
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }], keysOf("openai"));
    expect(out).toBeNull();
  });

  it("配了 KIE 但没填 key → 不选 KIE（key 缺失视为不可用）", () => {
    // vendor 列表里有 kie，但 getApiKey('kie') 返回 null
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, { key: "kie" }], keysOf("openai"));
    expect(out).toBeNull();
  });
});

describe("resolveAssetIngestion", () => {
  it("prefers the vendor's own declaration", () => {
    const own: AssetIngestion = { strategy: "inline-base64" };
    expect(resolveAssetIngestion({ key: "kie", assetIngestion: own })).toBe(own);
  });

  it("falls back to the curated registry for kie", () => {
    expect(resolveAssetIngestion({ key: "kie" })?.strategy).toBe("upload-url");
  });

  it("returns null for unknown vendors with no declaration", () => {
    expect(resolveAssetIngestion({ key: "mystery" })).toBeNull();
    expect(resolveAssetIngestion(null)).toBeNull();
  });
});
