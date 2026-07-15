import { describe, it, expect, vi } from "vitest";
import {
  collectLocalAssetUrls,
  replaceLocalAssetUrls,
  resolveLocalAsset,
  localizeAssetsForVendor,
  resolveAssetIngestion,
  resolveAssetIngestionWithFallback,
  isLocalAssetUrl,
  trustedOriginalUrl,
  ORIGINAL_URL_TRUST_MS,
  LITTERBOX_INGESTION,
  TMPFILES_INGESTION,
  ANON_UPLOAD_CHAIN,
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

  it("upload-multipart plain-text url (litterbox): no auth header, posts reqtype/time/fileToUpload, returns trimmed body", async () => {
    const ingestion: AssetIngestion = {
      strategy: "upload-multipart",
      endpoint: "https://litterbox.catbox.moe/resources/internals/api.php",
      responseIsPlainTextUrl: true,
      fileField: "fileToUpload",
      extraFields: { reqtype: "fileupload", time: "1h" },
      accepts: ["image", "video", "audio"],
    };
    const readMp4 = (): LocalAsset => ({ bytes: Buffer.from("mp4-bytes"), contentType: "video/mp4", fileName: "clip.mp4" });
    // 纯文本响应（两端带空白，验证 trim）
    const postMultipart = vi.fn().mockResolvedValue("  https://litter.catbox.moe/abc123.mp4\n");
    const out = await resolveLocalAsset(localUrl("clip.mp4"), ingestion, "", readMp4, vi.fn(), postMultipart);
    expect(out).toBe("https://litter.catbox.moe/abc123.mp4");
    const [url, headers, bytes, fileName, contentType, extraFields, fileField] = postMultipart.mock.calls[0];
    expect(url).toBe("https://litterbox.catbox.moe/resources/internals/api.php");
    expect("Authorization" in (headers as Record<string, string>)).toBe(false); // 匿名：无 key → 无 Authorization
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(fileName).toBe("clip.mp4");
    expect(contentType).toBe("video/mp4");
    expect((extraFields as Record<string, string>).reqtype).toBe("fileupload");
    expect((extraFields as Record<string, string>).time).toBe("1h");
    expect(fileField).toBe("fileToUpload");
  });

  it("upload-multipart plain-text url throws when body isn't an http url", async () => {
    const ingestion: AssetIngestion = {
      strategy: "upload-multipart",
      endpoint: "https://litterbox.catbox.moe/resources/internals/api.php",
      responseIsPlainTextUrl: true,
      fileField: "fileToUpload",
      extraFields: { reqtype: "fileupload", time: "1h" },
    };
    const postMultipart = vi.fn().mockResolvedValue("Error: too big");
    await expect(resolveLocalAsset(localUrl("a.png"), ingestion, "", read, vi.fn(), postMultipart)).rejects.toThrow(/不是可达 URL/);
  });

  it("upload-multipart throws when response lacks the url path", async () => {
    const ingestion: AssetIngestion = { strategy: "upload-multipart", endpoint: "https://up/x", urlPath: "url" };
    const postMultipart = vi.fn().mockResolvedValue({ oops: "no url" });
    await expect(resolveLocalAsset(localUrl("a.png"), ingestion, "k", read, vi.fn(), postMultipart)).rejects.toThrow(/缺少可达 URL/);
  });

  it("upload-stream posts binary + uploadPath/fileName fields and reads the declared url path", async () => {
    const ingestion: AssetIngestion = {
      strategy: "upload-stream",
      endpoint: "https://kieai.redpandaai.co/api/file-stream-upload",
      uploadPathField: "uploadPath",
      uploadPath: "videos/nomi",
      fileNameField: "fileName",
      urlPath: "data.downloadUrl",
      accepts: ["image", "video", "audio"],
    };
    const readMp4 = (): LocalAsset => ({ bytes: Buffer.from("mp4-bytes"), contentType: "video/mp4", fileName: "clip.mp4" });
    const postMultipart = vi.fn().mockResolvedValue({ success: true, data: { downloadUrl: "https://tempfile.redpandaai.co/clip.mp4" } });
    const out = await resolveLocalAsset(localUrl("clip.mp4"), ingestion, "key123", readMp4, vi.fn(), postMultipart);
    expect(out).toBe("https://tempfile.redpandaai.co/clip.mp4");
    const [url, headers, bytes, fileName, contentType, extraFields] = postMultipart.mock.calls[0];
    expect(url).toBe("https://kieai.redpandaai.co/api/file-stream-upload");
    expect(headers.Authorization).toBe("Bearer key123");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(fileName).toBe("clip.mp4");
    expect(contentType).toBe("video/mp4");
    expect((extraFields as Record<string, string>).uploadPath).toBe("videos/nomi");
    expect((extraFields as Record<string, string>).fileName).toBe("clip.mp4");
  });

  it("upload-multipart with urlTransform (tmpfiles): JSON page url → /dl/ direct url", async () => {
    const postMultipart = vi.fn().mockResolvedValue({ status: "success", data: { url: "https://tmpfiles.org/12345/clip.mp4" } });
    const readMp4 = (): LocalAsset => ({ bytes: Buffer.from("mp4-bytes"), contentType: "video/mp4", fileName: "clip.mp4" });
    const out = await resolveLocalAsset(localUrl("clip.mp4"), TMPFILES_INGESTION, "", readMp4, vi.fn(), postMultipart);
    expect(out).toBe("https://tmpfiles.org/dl/12345/clip.mp4");
    const [url, headers, , , , , fileField] = postMultipart.mock.calls[0];
    expect(url).toBe("https://tmpfiles.org/api/v1/upload");
    expect("Authorization" in (headers as Record<string, string>)).toBe(false); // anonymous
    expect(fileField).toBe("file");
  });

  it("anon-chain falls through litterbox → tmpfiles when the first throws, returns the second's url", async () => {
    const readMp4 = (): LocalAsset => ({ bytes: Buffer.from("mp4-bytes"), contentType: "video/mp4", fileName: "clip.mp4" });
    const postMultipart = vi
      .fn()
      // 1st call = litterbox (plain text) → throw (host down / rate-limited)
      .mockRejectedValueOnce(new Error("素材上传失败(HTTP 503)：litterbox down"))
      // 2nd call = tmpfiles (JSON) → success
      .mockResolvedValueOnce({ status: "success", data: { url: "https://tmpfiles.org/77/clip.mp4" } });
    const out = await resolveLocalAsset(localUrl("clip.mp4"), ANON_UPLOAD_CHAIN, "ignored", readMp4, vi.fn(), postMultipart);
    expect(out).toBe("https://tmpfiles.org/dl/77/clip.mp4"); // tmpfiles, /dl/-transformed
    expect(postMultipart).toHaveBeenCalledTimes(2);
    // 1st attempt hit litterbox, 2nd hit tmpfiles
    expect(postMultipart.mock.calls[0][0]).toBe(LITTERBOX_INGESTION.strategy === "upload-multipart" ? LITTERBOX_INGESTION.endpoint : "");
    expect(postMultipart.mock.calls[1][0]).toBe("https://tmpfiles.org/api/v1/upload");
  });

  it("anon-chain uses the first host when it succeeds (tmpfiles not tried)", async () => {
    const readMp4 = (): LocalAsset => ({ bytes: Buffer.from("mp4-bytes"), contentType: "video/mp4", fileName: "clip.mp4" });
    const postMultipart = vi.fn().mockResolvedValue("https://litter.catbox.moe/abc.mp4");
    const out = await resolveLocalAsset(localUrl("clip.mp4"), ANON_UPLOAD_CHAIN, "", readMp4, vi.fn(), postMultipart);
    expect(out).toBe("https://litter.catbox.moe/abc.mp4");
    expect(postMultipart).toHaveBeenCalledTimes(1); // litterbox succeeded, tmpfiles never tried
  });

  it("anon-chain throws an honest error when ALL hosts fail", async () => {
    const readMp4 = (): LocalAsset => ({ bytes: Buffer.from("mp4-bytes"), contentType: "video/mp4", fileName: "clip.mp4" });
    const postMultipart = vi
      .fn()
      .mockRejectedValueOnce(new Error("litterbox 503"))
      .mockRejectedValueOnce(new Error("tmpfiles 500"));
    await expect(
      resolveLocalAsset(localUrl("clip.mp4"), ANON_UPLOAD_CHAIN, "", readMp4, vi.fn(), postMultipart),
    ).rejects.toThrow(/所有免配置上传 host 都失败/);
    expect(postMultipart).toHaveBeenCalledTimes(2);
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
  const resolverFor = (ing: AssetIngestion, key = "k") => () => ({ ingestion: ing, uploadApiKey: key });

  it("uploads each unique url once and replaces all occurrences", async () => {
    const post = vi.fn().mockImplementation((_u, _h, body: Record<string, string>) => {
      // echo a stable url derived from the base64 so dupes map identically
      return Promise.resolve({ url: "https://pub/" + body.b.slice(-6) });
    });
    const extras = {
      firstFrameUrl: localUrl("a.png"),
      referenceImageUrls: [localUrl("b.png"), localUrl("a.png")],
    };
    const out = await localizeAssetsForVendor(extras, resolverFor(ingestion), read, post, noMultipart);
    expect(out.uploaded).toBe(2); // a.png + b.png, a.png not uploaded twice
    expect(post).toHaveBeenCalledTimes(2);
    const value = out.value as typeof extras;
    expect(value.firstFrameUrl).toBe(value.referenceImageUrls[1]); // same source → same resolved url
    expect(value.referenceImageUrls[0].startsWith("https://pub/")).toBe(true);
  });

  it("is a zero-cost passthrough when there are no local assets", async () => {
    const post = vi.fn();
    const extras = { firstFrameUrl: "https://pub/a.png", prompt: "hi" };
    const out = await localizeAssetsForVendor(extras, resolverFor(ingestion), read, post, noMultipart);
    expect(out.uploaded).toBe(0);
    expect(out.value).toBe(extras);
    expect(post).not.toHaveBeenCalled();
  });

  it("routes per media kind: image asset uses image channel, video asset uses video channel", async () => {
    // image asset (png) + video asset (mp4) in same extras → each routed by its contentType
    const readMixed = (url: string): LocalAsset | null => {
      const name = url.split("/").pop() || "x";
      const contentType = name.endsWith(".mp4") ? "video/mp4" : "image/png";
      return { bytes: Buffer.from("bytes-" + name), contentType, fileName: name };
    };
    const imageIngestion: AssetIngestion = { strategy: "upload-url", endpoint: "https://img/up", base64Field: "b", urlPath: "url", accepts: ["image"] };
    const videoIngestion: AssetIngestion = { strategy: "upload-stream", endpoint: "https://vid/up", urlPath: "data.downloadUrl", accepts: ["image", "video"] };
    const resolver = (kind: "image" | "video" | "audio") =>
      kind === "video" ? { ingestion: videoIngestion, uploadApiKey: "vk" } : { ingestion: imageIngestion, uploadApiKey: "ik" };
    const post = vi.fn().mockResolvedValue({ url: "https://pub/img.png" });
    const postMultipart = vi.fn().mockResolvedValue({ data: { downloadUrl: "https://pub/clip.mp4" } });
    const extras = { referenceImageUrls: [localUrl("a.png")], referenceVideoUrls: [localUrl("clip.mp4")] };
    const out = await localizeAssetsForVendor(extras, resolver, readMixed, post, postMultipart);
    expect(out.uploaded).toBe(2);
    expect(post).toHaveBeenCalledTimes(1); // image via base64 upload-url
    expect(postMultipart).toHaveBeenCalledTimes(1); // video via stream multipart
    const value = out.value as typeof extras;
    expect(value.referenceImageUrls[0]).toBe("https://pub/img.png");
    expect(value.referenceVideoUrls[0]).toBe("https://pub/clip.mp4");
    // stream upload sent uploadPath + fileName as extra multipart fields
    const extraFields = postMultipart.mock.calls[0][5] as Record<string, string>;
    expect(extraFields.uploadPath).toBe("uploads");
    expect(extraFields.fileName).toBe("clip.mp4");
  });

  it("throws an honest error when no channel accepts the asset's media kind", async () => {
    const readVideo = (url: string): LocalAsset | null => ({ bytes: Buffer.from("v"), contentType: "video/mp4", fileName: url.split("/").pop() || "v.mp4" });
    const resolver = () => null; // no channel for any kind
    const extras = { referenceVideoUrls: [localUrl("clip.mp4")] };
    await expect(localizeAssetsForVendor(extras, resolver, readVideo, vi.fn(), noMultipart)).rejects.toThrow(/运镜参考视频需要支持视频上传的通道/);
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

  it("inline-base64 的 vendor 不算「有上传能力」，不被选作中转 → 落到匿名链零配置兜底", () => {
    const inlineVendor = { key: "inliner", assetIngestion: { strategy: "inline-base64" } as AssetIngestion };
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, inlineVendor], keysOf("openai", "inliner"));
    // 没有真正能产出公网 URL 的供应商通道 → 匿名链（零配置）接住
    expect(out?.ingestion.strategy).toBe("anon-chain");
    expect(out?.uploadApiKey).toBe("");
  });

  it("⑤ 无任何供应商上传通道 → 匿名链零配置兜底（不再返回 null）", () => {
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }], keysOf("openai"));
    expect(out?.ingestion.strategy).toBe("anon-chain");
    expect(out?.uploadApiKey).toBe("");
  });

  it("配了 KIE 但没填 key → 不选 KIE，落到匿名链（key 缺失视为不可用）", () => {
    // vendor 列表里有 kie，但 getApiKey('kie') 返回 null
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, { key: "kie" }], keysOf("openai"));
    expect(out?.ingestion.strategy).toBe("anon-chain");
  });
});

describe("resolveAssetIngestionWithFallback (内容类型感知路由)", () => {
  const keysOf = (...vendorKeys: string[]) => (k: string) => (vendorKeys.includes(k) ? `key-${k}` : null);

  it("image asset → apimart chosen (image channel)", () => {
    const out = resolveAssetIngestionWithFallback({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "image");
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.uploadApiKey).toBe("key-apimart");
  });

  it("video asset + only apimart configured → anon chain (apimart image-only, zero-config fallback)", () => {
    const out = resolveAssetIngestionWithFallback({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "video");
    expect(out?.ingestion.strategy).toBe("anon-chain");
    expect(out?.uploadApiKey).toBe("");
  });

  it("video asset + KIE configured → KIE stream chosen", () => {
    const out = resolveAssetIngestionWithFallback({ key: "apimart" }, [{ key: "apimart" }, { key: "kie" }], keysOf("apimart", "kie"), "video");
    expect(out?.ingestion.strategy).toBe("upload-stream");
    expect(out?.uploadApiKey).toBe("key-kie");
    if (out?.ingestion.strategy === "upload-stream") {
      expect(out.ingestion.endpoint).toBe("https://kieai.redpandaai.co/api/file-stream-upload");
      expect(out.ingestion.urlPath).toBe("data.downloadUrl");
    }
  });

  it("video asset + apimart target + KIE configured → apimart skipped, KIE used", () => {
    // target is apimart, but mp4 can't go there; KIE picks it up
    const out = resolveAssetIngestionWithFallback({ key: "apimart" }, [{ key: "kie" }], keysOf("kie"), "video");
    expect(out?.uploadApiKey).toBe("key-kie");
    expect(out?.ingestion.strategy).toBe("upload-stream");
  });

  it("video asset + no KIE (only apimart, image-only) → anon chain zero-config fallback, no honest error", () => {
    // target apimart can't take mp4, no KIE key → anon chain (no key) catches it
    const out = resolveAssetIngestionWithFallback({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "video");
    expect(out).not.toBeNull();
    expect(out?.uploadApiKey).toBe(""); // anonymous, no key needed
    if (out?.ingestion.strategy === "anon-chain") {
      // 链头是 litterbox，链尾是 tmpfiles —— 两个免 key host
      const heads = out.ingestion.chain.map((h) => (h.strategy === "upload-multipart" ? h.endpoint : ""));
      expect(heads[0]).toBe("https://litterbox.catbox.moe/resources/internals/api.php");
      expect(heads[1]).toBe("https://tmpfiles.org/api/v1/upload");
    } else {
      throw new Error("expected anon-chain");
    }
  });

  it("video asset + nothing configured at all → still anon chain (zero user config)", () => {
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }], keysOf("openai"), "video");
    expect(out?.uploadApiKey).toBe("");
    expect(out?.ingestion.strategy).toBe("anon-chain");
  });

  it("video asset + KIE present → KIE wins over anon chain (upgrade when key available)", () => {
    const out = resolveAssetIngestionWithFallback({ key: "openai" }, [{ key: "openai" }, { key: "kie" }], keysOf("openai", "kie"), "video");
    expect(out?.ingestion.strategy).toBe("upload-stream");
    expect(out?.uploadApiKey).toBe("key-kie");
  });

  it("image asset + apimart present → apimart still wins over litterbox", () => {
    const out = resolveAssetIngestionWithFallback({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "image");
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.ingestion.endpoint).toBe("https://api.apimart.ai/v1/uploads/images");
    expect(out?.uploadApiKey).toBe("key-apimart");
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

describe("sidecar originalUrl 新鲜度门（L2：参考图永不过期）", () => {
  const FRESH = 60_000;
  const STALE = ORIGINAL_URL_TRUST_MS + 1;
  const withSidecar = (ageMs: number): LocalAsset => ({ ...fakeAsset("a.png"), originalUrl: "https://cdn.example.com/orig-a.png", ageMs });

  it("trustedOriginalUrl：新鲜→直用；过窗→null；ageMs 未知→按新鲜（兼容旧调用方/stat 失败）", () => {
    expect(trustedOriginalUrl(withSidecar(FRESH))).toBe("https://cdn.example.com/orig-a.png");
    expect(trustedOriginalUrl(withSidecar(STALE))).toBeNull();
    expect(trustedOriginalUrl({ originalUrl: "https://cdn.example.com/orig-a.png" })).toBe("https://cdn.example.com/orig-a.png");
    expect(trustedOriginalUrl(null)).toBeNull();
  });

  it("localize：新鲜 sidecar 直接用公网直链，零上传", async () => {
    const post = vi.fn();
    const readFresh = () => withSidecar(FRESH);
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => ({ ingestion: { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "u" }, uploadApiKey: "k" }), readFresh, post, noMultipart);
    expect((out.value as { input_urls: string[] }).input_urls).toEqual(["https://cdn.example.com/orig-a.png"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("localize：过窗 sidecar 忽略 → 用本地字节走上传通道换新链（治「发过期临时链」整类）", async () => {
    const post = vi.fn().mockResolvedValue({ u: "https://fresh.example.com/new-a.png" });
    const readStale = () => withSidecar(STALE);
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => ({ ingestion: { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "u" }, uploadApiKey: "k" }), readStale, post, noMultipart);
    expect((out.value as { input_urls: string[] }).input_urls).toEqual(["https://fresh.example.com/new-a.png"]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("resolveLocalAsset：过窗 sidecar 不短路，inline-base64 落 data URI", async () => {
    const readStale = () => withSidecar(STALE);
    const out = await resolveLocalAsset(localUrl("a.png"), { strategy: "inline-base64" }, "k", readStale, vi.fn(), noMultipart);
    expect(out.startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("comfyui-upload（本地 ComfyUI 首帧上传，S2）", () => {
  const comfyIngestion = (endpoint = "http://127.0.0.1:8188/upload/image"): AssetIngestion => ({ strategy: "comfyui-upload", endpoint, accepts: ["image"] });
  const readFresh = (name = "a.png"): LocalAsset => ({ bytes: Buffer.from("x"), contentType: "image/png", fileName: name, originalUrl: "https://pub/" + name, ageMs: 0 });

  it("resolveAssetIngestionWithFallback：comfyui-local 图片 → comfyui-upload，端点从 baseUrl 派生（默认 + 自定义 + 尾斜杠归一）", () => {
    const def = resolveAssetIngestionWithFallback({ key: "comfyui-local" }, [], () => null, "image");
    expect(def?.ingestion).toEqual({ strategy: "comfyui-upload", endpoint: "http://127.0.0.1:8188/upload/image", accepts: ["image"] });
    const custom = resolveAssetIngestionWithFallback({ key: "comfyui-local", baseUrlHint: "http://192.168.1.9:8000/" }, [], () => null, "image");
    expect((custom?.ingestion as { endpoint: string }).endpoint).toBe("http://192.168.1.9:8000/upload/image");
  });

  it("resolveAssetIngestionWithFallback：comfyui-local 视频不被 image-only 拦截（v2v 是另一套机制，暂走通用兜底）", () => {
    // 拦截仅图片；视频落到通用匿名链兜底（strategy≠comfyui-upload）——v2v 支持是后续工作，非本次范围。
    const vid = resolveAssetIngestionWithFallback({ key: "comfyui-local" }, [], () => null, "video");
    expect(vid?.ingestion.strategy).not.toBe("comfyui-upload");
  });

  it("resolveLocalAsset comfyui-upload：POST /upload/image（field image + type/overwrite）→ 返回 subfolder/name", async () => {
    const post = vi.fn().mockResolvedValue({ name: "input.png", subfolder: "nomi", type: "input" });
    const out = await resolveLocalAsset(localUrl("a.png"), comfyIngestion(), "", read, vi.fn(), post);
    expect(out).toBe("nomi/input.png");
    const [url, headers, , fileName, contentType, extraFields, fileField] = post.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8188/upload/image");
    expect(headers).toEqual({});
    expect(fileField).toBe("image");
    expect(extraFields).toEqual({ type: "input", overwrite: "true" });
    expect([fileName, contentType]).toEqual(["a.png", "image/png"]);
  });

  it("resolveLocalAsset comfyui-upload：无 subfolder → 只返回 name", async () => {
    const post = vi.fn().mockResolvedValue({ name: "x.png", subfolder: "", type: "input" });
    expect(await resolveLocalAsset(localUrl("x.png"), comfyIngestion(), "", read, vi.fn(), post)).toBe("x.png");
  });

  it("resolveLocalAsset comfyui-upload：响应缺 name → 诚实报错", async () => {
    const post = vi.fn().mockResolvedValue({ error: "boom" });
    await expect(resolveLocalAsset(localUrl("a.png"), comfyIngestion(), "", read, vi.fn(), post)).rejects.toThrow(/未返回文件名/);
  });

  it("resolveLocalAsset comfyui-upload：新鲜 sidecar originalUrl 也不短路（LoadImage 不认公网 URL，恒上传换文件名）", async () => {
    const post = vi.fn().mockResolvedValue({ name: "up.png", subfolder: "", type: "input" });
    const out = await resolveLocalAsset(localUrl("a.png"), comfyIngestion(), "", () => readFresh(), vi.fn(), post);
    expect(out).toBe("up.png"); // 不是 https://pub/a.png
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("localizeAssetsForVendor：comfyui-upload 传首帧 → extras 里替换成文件名（跳过 trusted 快路）", async () => {
    const post = vi.fn().mockResolvedValue({ name: "frame.png", subfolder: "in", type: "input" });
    const out = await localizeAssetsForVendor(
      { firstFrameUrl: localUrl("f.png") },
      () => ({ ingestion: comfyIngestion(), uploadApiKey: "" }),
      () => readFresh("f.png"),
      vi.fn(),
      post,
    );
    expect((out.value as { firstFrameUrl: string }).firstFrameUrl).toBe("in/frame.png");
    expect(post).toHaveBeenCalledTimes(1);
  });
});
