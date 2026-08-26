import { describe, it, expect, vi } from "vitest";
import {
  collectLocalAssetUrls,
  assertLocalAssetTransportReady,
  replaceLocalAssetUrls,
  resolveLocalAsset,
  localizeAssetsForVendor,
  resolveAssetIngestion,
  resolveAssetIngestionWithFallback,
  isLocalAssetUrl,
  trustedOriginalUrl,
  trustedLocalOutputOrigin,
  ORIGINAL_URL_TRUST_MS,
  LITTERBOX_INGESTION,
  TMPFILES_INGESTION,
  ANON_UPLOAD_CHAIN,
  type LocalAsset,
} from "./assetLocalization";
import type { AssetIngestion } from "./types";

const localUrl = (p: string) => `nomi-local://asset/proj/${p}`;
// 内联素材（headless/MCP 直接给 data: URI，或落盘失败退回 base64 的兜底路径）。
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const MP4_BYTES = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from("ftypisom"), Buffer.from("mdat")]);
const inlineImageUrl = (salt = "") =>
  `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.from(salt)]).toString("base64")}`;
const inlineVideoUrl = () => `data:video/mp4;base64,${MP4_BYTES.toString("base64")}`;
const fakeAsset = (name: string): LocalAsset => ({ bytes: Buffer.from("hello-" + name), contentType: "image/png", fileName: name });
const read = (url: string): LocalAsset | null => fakeAsset(url.split("/").pop() || "x");
// 默认 multipart mock：返回声明 urlPath 能读到的形状。各用例可覆盖。
const noMultipart = vi.fn();

describe("isLocalAssetUrl / collect / replace", () => {
  it("detects local assets: nomi-local + inline data uris, never public urls", () => {
    expect(isLocalAssetUrl(localUrl("a.png"))).toBe(true);
    expect(isLocalAssetUrl(inlineImageUrl())).toBe(true);
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

  it("fails before paid submission when a local reference disappeared", () => {
    expect(() => assertLocalAssetTransportReady(
      { referenceImageUrls: [localUrl("missing.png")] },
      () => [{ vendorKey: "kie", ingestion: { strategy: "none" }, uploadApiKey: "" }],
      () => null,
    )).toThrow(/本地文件读取失败/);
  });

  it("fails closed for unknown octet-stream instead of guessing image", () => {
    expect(() => assertLocalAssetTransportReady(
      { referenceVideoUrls: [localUrl("unknown.bin")] },
      () => [{ vendorKey: "kie", ingestion: { strategy: "upload-url", endpoint: "https://upload", base64Field: "data", urlPath: "url" }, uploadApiKey: "k" }],
      () => ({ bytes: Buffer.from([1, 2, 3]), contentType: "application/octet-stream", fileName: "unknown.bin" }),
    )).toThrow(/无法识别/);
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

  // 2026-07-31：litterbox 官方允许 1h/12h/24h/72h（litterbox.catbox.moe/tools.php 核）。
  // 曾经传最短的 1h → 长队列里 URL 会在生成中途过期（厂商要求「有效期覆盖完整生成周期」），
  // 表现为提交成功但厂商拉不到图。不取 72h 是因为匿名上传没有删除 API，只能等过期。
  it("litterbox 有效期取 24h：够覆盖排队+生成，又不让参考图在公网多躺", () => {
    expect(LITTERBOX_INGESTION.strategy).toBe("upload-multipart")
    if (LITTERBOX_INGESTION.strategy !== "upload-multipart") return
    expect(LITTERBOX_INGESTION.extraFields?.time).toBe("24h")
    expect(LITTERBOX_INGESTION.extraFields?.reqtype).toBe("fileupload")
  })

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
  const resolverFor = (ing: AssetIngestion, key = "k") => () => [{ vendorKey: "kie", ingestion: ing, uploadApiKey: key }];

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
      kind === "video" ? [{ vendorKey: "kie", ingestion: videoIngestion, uploadApiKey: "vk" }] : [{ vendorKey: "kie", ingestion: imageIngestion, uploadApiKey: "ik" }];
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
    const resolver = () => []; // no channel for any kind
    const extras = { referenceVideoUrls: [localUrl("clip.mp4")] };
    await expect(localizeAssetsForVendor(extras, resolver, readVideo, vi.fn(), noMultipart)).rejects.toThrow(/运镜参考视频需要支持视频上传的通道/);
  });

  it("does not guess an unknown octet-stream file is an image", async () => {
    const resolver = vi.fn(() => [{ vendorKey: "kie", ingestion, uploadApiKey: "k" }]);
    await expect(localizeAssetsForVendor(
      { referenceVideoUrls: [localUrl("mystery.bin")] },
      resolver,
      () => ({ bytes: Buffer.from("not-media"), contentType: "application/octet-stream", fileName: "mystery.bin" }),
      vi.fn(),
      noMultipart,
    )).rejects.toThrow(/无法识别.*图片|视频|音频/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("strips stale local references when the renderer provides the active asset allowlist", async () => {
    const post = vi.fn().mockResolvedValue({ url: "https://cdn/active.png" });
    const out = await localizeAssetsForVendor(
      { activeAssetUrls: [localUrl("active.png")], referenceImageUrls: [localUrl("active.png"), localUrl("stale.png")] },
      resolverFor(ingestion),
      read,
      post,
      noMultipart,
      { minimizeUploads: true, activeAssetUrls: [localUrl("active.png")] },
    );
    expect((out.value as { referenceImageUrls: string[] }).referenceImageUrls).toEqual(["https://cdn/active.png"]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("requires disclosure before an anonymous fallback upload", async () => {
    const anonymous: AssetIngestion = {
      strategy: "anon-chain",
      chain: [],
      accepts: ["video"],
      visibility: "public-anonymous",
      requiresConsent: true,
      ttlSeconds: 60 * 60,
    };
    const postMultipart = vi.fn();
    await expect(localizeAssetsForVendor(
      { referenceVideoUrls: [localUrl("clip.mp4")] },
      () => [{ vendorKey: "kie", ingestion: anonymous, uploadApiKey: "" }],
      () => ({ bytes: Buffer.from("v"), contentType: "video/mp4", fileName: "clip.mp4" }),
      vi.fn(),
      postMultipart,
      { anonymousConsent: "ask" },
    )).rejects.toThrow(/KIE.*免费|公共临时托管/);
    expect(postMultipart).not.toHaveBeenCalled();
  });

  it("rejects a public URL lease that is too short for video generation", async () => {
    const shortLease: AssetIngestion = {
      strategy: "upload-multipart",
      endpoint: "https://tmp.example/upload",
      responseIsPlainTextUrl: true,
      accepts: ["video"],
      visibility: "public-anonymous",
      requiresConsent: true,
      ttlSeconds: 60,
    };
    await expect(localizeAssetsForVendor(
      { referenceVideoUrls: [localUrl("clip.mp4")] },
      () => [{ vendorKey: "kie", ingestion: shortLease, uploadApiKey: "" }],
      () => ({ bytes: Buffer.from("v"), contentType: "video/mp4", fileName: "clip.mp4" }),
      vi.fn(),
      vi.fn(),
      { anonymousConsent: "allow" },
    )).rejects.toThrow(/有效期|lease|所有上传通道/);
  });
});

// 2026-08-20 用户报 HTTP 413：一条通道装不下就整个生成死掉，而排在它后面、收得下的通道从没被试过。
// 此前 localizeAssetsForVendor 只拿第一条候选、没有 try/catch —— 「fallback」只对能力生效、对失败不生效。
describe("localizeAssetsForVendor — 上传失败换下一条通道（413 类）", () => {
  const bigVideo = (): LocalAsset => ({ bytes: Buffer.alloc(3 * 1024 * 1024, 1), contentType: "video/mp4", fileName: "clip.mp4" });
  const small: AssetIngestion = { strategy: "upload-multipart", endpoint: "https://small.example/up", urlPath: "url", accepts: ["video"] };
  const roomy: AssetIngestion = { strategy: "upload-multipart", endpoint: "https://roomy.example/up", urlPath: "url", accepts: ["video"] };

  it("第一条 413 → 自动换第二条，生成照常继续", async () => {
    const postMultipart = vi.fn().mockImplementation((url: string) => {
      if (url.includes("small.example")) return Promise.reject(new Error("素材上传失败(HTTP 413)：(无详情)"));
      return Promise.resolve({ url: "https://cdn/clip.mp4" });
    });
    const out = await localizeAssetsForVendor(
      { referenceVideoUrls: [localUrl("clip.mp4")] },
      () => [{ vendorKey: "kie", ingestion: small, uploadApiKey: "a" }, { vendorKey: "kie", ingestion: roomy, uploadApiKey: "b" }],
      bigVideo,
      vi.fn(),
      postMultipart,
    );
    expect((out.value as { referenceVideoUrls: string[] }).referenceVideoUrls[0]).toBe("https://cdn/clip.mp4");
    expect(postMultipart).toHaveBeenCalledTimes(2); // 试过 small（413）才换 roomy
  });

  it("全部 413 → 错误说人话：哪个素材、多大、别再重试", async () => {
    const postMultipart = vi.fn().mockRejectedValue(new Error("素材上传失败(HTTP 413)：(无详情)"));
    const run = localizeAssetsForVendor(
      { referenceVideoUrls: [localUrl("clip.mp4")] },
      () => [{ vendorKey: "kie", ingestion: small, uploadApiKey: "a" }, { vendorKey: "kie", ingestion: roomy, uploadApiKey: "b" }],
      bigVideo,
      vi.fn(),
      postMultipart,
    );
    // 要点名素材、报出大小、点破「超上限」——不能再是「服务商临时故障，稍等重试」那种甩锅文案。
    await expect(run).rejects.toThrow(/clip\.mp4/);
    await expect(run).rejects.toThrow(/3\.0MB/);
    await expect(run).rejects.toThrow(/超过了所有可用上传通道的大小上限/);
  });

  it("非 413 的全失败 → 汇总每条通道各自的原因（别吞掉线索）", async () => {
    const postMultipart = vi.fn()
      .mockRejectedValueOnce(new Error("素材上传失败(HTTP 401)：bad key"))
      .mockRejectedValueOnce(new Error("fetch failed"));
    const run = localizeAssetsForVendor(
      { referenceVideoUrls: [localUrl("clip.mp4")] },
      () => [{ vendorKey: "kie", ingestion: small, uploadApiKey: "a" }, { vendorKey: "kie", ingestion: roomy, uploadApiKey: "b" }],
      bigVideo,
      vi.fn(),
      postMultipart,
    );
    await expect(run).rejects.toThrow(/small\.example.*401/s);
    await expect(run).rejects.toThrow(/roomy\.example.*fetch failed/s);
  });
});

// 通道解析返回的是**按优先级排好的候选列表**（一条挂了要能换下一条，见 localizeAssetsForVendor）。
// 下面这些用例断言的是「排第一的是谁」，取 [0] 即可；空列表 = 没有任何可用通道。
const firstIngestion = (...args: Parameters<typeof resolveAssetIngestionWithFallback>) =>
  resolveAssetIngestionWithFallback(...args)[0] ?? null;

describe("resolveAssetIngestionWithFallback (跨 vendor 上传优先级链)", () => {
  // getApiKey 工厂：用一组「已配置 key 的 vendor」构造查询函数
  const keysOf = (...vendorKeys: string[]) => (k: string) => (vendorKeys.includes(k) ? `key-${k}` : null);

  it("① 目标 vendor 自己有上传能力 → 用目标 + 目标的 key", () => {
    const out = firstIngestion({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"));
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.uploadApiKey).toBe("key-apimart");
  });

  it("② 目标无上传能力 + 配了 KIE → 用 KIE 中转 + KIE 的 key", () => {
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }, { key: "kie" }], keysOf("openai", "kie"));
    expect(out?.ingestion.strategy).toBe("upload-url"); // KIE = upload-url
    expect(out?.uploadApiKey).toBe("key-kie");
  });

  it("③ 无 KIE + 配了 apimart(且目标≠apimart) → 用 apimart 中转 + apimart 的 key", () => {
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }, { key: "apimart" }], keysOf("openai", "apimart"));
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.uploadApiKey).toBe("key-apimart");
  });

  it("KIE 优先于 apimart（两者都配时选 KIE）", () => {
    const out = firstIngestion({ key: "openai" }, [{ key: "kie" }, { key: "apimart" }], keysOf("openai", "kie", "apimart"));
    expect(out?.uploadApiKey).toBe("key-kie");
  });

  it("④ 无 KIE/apimart + 另一 vendor 自带 upload-url 声明 → 用它中转", () => {
    const custom = { key: "custom", assetIngestion: { strategy: "upload-url", endpoint: "https://c/up", base64Field: "b", urlPath: "url" } as AssetIngestion };
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }, custom], keysOf("openai", "custom"));
    expect(out?.ingestion.strategy).toBe("upload-url");
    expect(out?.uploadApiKey).toBe("key-custom");
  });

  it("inline-base64 的 vendor 不算「有上传能力」，不被选作中转 → 落到匿名链零配置兜底", () => {
    const inlineVendor = { key: "inliner", assetIngestion: { strategy: "inline-base64" } as AssetIngestion };
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }, inlineVendor], keysOf("openai", "inliner"));
    // 没有真正能产出公网 URL 的供应商通道 → 匿名链（零配置）接住
    expect(out?.ingestion.strategy).toBe("anon-chain");
    expect(out?.uploadApiKey).toBe("");
  });

  it("⑤ 无任何供应商上传通道 → 匿名链零配置兜底（不再返回 null）", () => {
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }], keysOf("openai"));
    expect(out?.ingestion.strategy).toBe("anon-chain");
    expect(out?.uploadApiKey).toBe("");
  });

  it("配了 KIE 但没填 key → 不选 KIE，落到匿名链（key 缺失视为不可用）", () => {
    // vendor 列表里有 kie，但 getApiKey('kie') 返回 null
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }, { key: "kie" }], keysOf("openai"));
    expect(out?.ingestion.strategy).toBe("anon-chain");
  });
});

describe("resolveAssetIngestionWithFallback (内容类型感知路由)", () => {
  const keysOf = (...vendorKeys: string[]) => (k: string) => (vendorKeys.includes(k) ? `key-${k}` : null);

  it("image asset → apimart chosen (image channel)", () => {
    const out = firstIngestion({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "image");
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.uploadApiKey).toBe("key-apimart");
  });

  it("video asset + only apimart configured → anon chain (apimart image-only, zero-config fallback)", () => {
    const out = firstIngestion({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "video");
    expect(out?.ingestion.strategy).toBe("anon-chain");
    expect(out?.uploadApiKey).toBe("");
  });

  it("video asset + KIE configured → KIE stream chosen", () => {
    const out = firstIngestion({ key: "apimart" }, [{ key: "apimart" }, { key: "kie" }], keysOf("apimart", "kie"), "video");
    expect(out?.ingestion.strategy).toBe("upload-stream");
    expect(out?.uploadApiKey).toBe("key-kie");
    if (out?.ingestion.strategy === "upload-stream") {
      expect(out.ingestion.endpoint).toBe("https://kieai.redpandaai.co/api/file-stream-upload");
      expect(out.ingestion.urlPath).toBe("data.downloadUrl");
    }
  });

  it("video asset + apimart target + KIE configured → apimart skipped, KIE used", () => {
    // target is apimart, but mp4 can't go there; KIE picks it up
    const out = firstIngestion({ key: "apimart" }, [{ key: "kie" }], keysOf("kie"), "video");
    expect(out?.uploadApiKey).toBe("key-kie");
    expect(out?.ingestion.strategy).toBe("upload-stream");
  });

  it("video asset + no KIE (only apimart, image-only) → anon chain zero-config fallback, no honest error", () => {
    // target apimart can't take mp4, no KIE key → anon chain (no key) catches it
    const out = firstIngestion({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "video");
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
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }], keysOf("openai"), "video");
    expect(out?.uploadApiKey).toBe("");
    expect(out?.ingestion.strategy).toBe("anon-chain");
  });

  it("video asset + KIE present → KIE wins over anon chain (upgrade when key available)", () => {
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }, { key: "kie" }], keysOf("openai", "kie"), "video");
    expect(out?.ingestion.strategy).toBe("upload-stream");
    expect(out?.uploadApiKey).toBe("key-kie");
  });

  it("image asset + apimart present → apimart still wins over litterbox", () => {
    const out = firstIngestion({ key: "apimart" }, [{ key: "apimart" }], keysOf("apimart"), "image");
    expect(out?.ingestion.strategy).toBe("upload-multipart");
    expect(out?.ingestion.endpoint).toBe("https://api.apimart.ai/v1/uploads/images");
    expect(out?.uploadApiKey).toBe("key-apimart");
  });

  it("rejects a custom base64/upload-url declaration for video", () => {
    const unsafe = { key: "custom", assetIngestion: { strategy: "upload-url", endpoint: "https://c/up", base64Field: "b", urlPath: "url", accepts: ["video"] } as AssetIngestion };
    const out = firstIngestion({ key: "openai" }, [{ key: "openai" }, unsafe], keysOf("openai", "custom"), "video");
    expect(out?.ingestion.strategy).toBe("anon-chain");
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
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [{ vendorKey: "kie", ingestion: { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "u" }, uploadApiKey: "k" }], readFresh, post, noMultipart);
    expect((out.value as { input_urls: string[] }).input_urls).toEqual(["https://cdn.example.com/orig-a.png"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("localize：过窗 sidecar 忽略 → 用本地字节走上传通道换新链（治「发过期临时链」整类）", async () => {
    const post = vi.fn().mockResolvedValue({ u: "https://fresh.example.com/new-a.png" });
    const readStale = () => withSidecar(STALE);
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [{ vendorKey: "kie", ingestion: { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "u" }, uploadApiKey: "k" }], readStale, post, noMultipart);
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

  it("trustedLocalOutputOrigin：只信任代码所有的 ComfyUI baseUrl 精确 origin", () => {
    expect(trustedLocalOutputOrigin({ key: "comfyui-local", baseUrlHint: "http://127.0.0.1:8188/api/" })).toBe("http://127.0.0.1:8188");
    expect(trustedLocalOutputOrigin({ key: "custom-local", baseUrlHint: "http://127.0.0.1:9000" })).toBeNull();
    expect(trustedLocalOutputOrigin({ key: "comfyui-local", baseUrlHint: "file:///tmp/comfy" })).toBeNull();
  });

  it("resolveAssetIngestionWithFallback：comfyui-local 图片 → comfyui-upload，端点从 baseUrl 派生（默认 + 自定义 + 尾斜杠归一）", () => {
    const def = firstIngestion({ key: "comfyui-local" }, [], () => null, "image");
    expect(def?.ingestion).toEqual({ strategy: "comfyui-upload", endpoint: "http://127.0.0.1:8188/upload/image", accepts: ["image", "video"] });
    const custom = firstIngestion({ key: "comfyui-local", baseUrlHint: "http://192.168.1.9:8000/" }, [], () => null, "image");
    expect((custom?.ingestion as { endpoint: string }).endpoint).toBe("http://192.168.1.9:8000/upload/image");
  });

  it("resolveAssetIngestionWithFallback：comfyui-local **视频也走 comfyui-upload**（真机实测同一端点收视频）", () => {
    // 旧断言写的是「视频落通用匿名链兜底，v2v 是另一套机制」——**那是没验过的假设**。
    // 真机 ComfyUI 0.29 实测：POST mp4 进 /upload/image 返回 {name,subfolder,type}，
    // 返回的文件名当场出现在 LoadVideo.file 的 combo 里。走通用兜底（litterbox 等公网链）反而是错的：
    // ComfyUI 的 LoadVideo 只认自己 input 目录里的文件名，给它公网 URL 必失败。
    const vid = firstIngestion({ key: "comfyui-local" }, [], () => null, "video");
    expect(vid?.ingestion.strategy).toBe("comfyui-upload");
    expect((vid?.ingestion as { endpoint: string }).endpoint).toBe("http://127.0.0.1:8188/upload/image");
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
      () => [{ vendorKey: "kie", ingestion: comfyIngestion(), uploadApiKey: "" }],
      () => readFresh("f.png"),
      vi.fn(),
      post,
    );
    expect((out.value as { firstFrameUrl: string }).firstFrameUrl).toBe("in/frame.png");
    expect(post).toHaveBeenCalledTimes(1);
  });
});

/**
 * data: URI 与 nomi-local 走**同一条**物化/上传链。
 *
 * 根因（2026-08-26 真实付费实测）：此前 isLocalAssetUrl 只认 nomi-local://，一个 data: URI 一路直穿到
 * vendor body —— 火山方舟 Ark 收（HTTP 200），kie.ai 的 nano-banana-2 / seedream-5-lite / flux-2-pro
 * 三个模型一律 HTTP 500 "File type not supported"。同一张参考图换个供应商就挂，而 L3 参考护栏还判「有参考」。
 * 修在这里=每个 vendor 拿到的永远是公网 URL，整类「谁收 data: 谁不收」的差异当场消失。
 */
describe("localizeAssetsForVendor — data: URI 与 nomi-local 同链", () => {
  const uploadUrlIngestion: AssetIngestion = { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "url" };
  const neverRead = vi.fn(() => null); // 内联素材零 IO：不该碰读盘器

  it("内联图片上传换公网 URL，body 里带的是解码后的真字节", async () => {
    const post = vi.fn().mockResolvedValue({ url: "https://pub/inline.png" });
    const out = await localizeAssetsForVendor(
      { image_input: [inlineImageUrl()], prompt: "hi" },
      () => [{ vendorKey: "kie", ingestion: uploadUrlIngestion, uploadApiKey: "k" }],
      neverRead,
      post,
      noMultipart,
    );
    expect(out.uploaded).toBe(1);
    expect((out.value as { image_input: string[] }).image_input).toEqual(["https://pub/inline.png"]);
    expect(neverRead).not.toHaveBeenCalled();
    const body = post.mock.calls[0][2] as Record<string, string>;
    expect(body.b).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
  });

  it("公网 URL 原样穿过，一次上传都不发（零成本直通不被本次修改破坏）", async () => {
    const post = vi.fn();
    const extras = { image_urls: ["https://cdn/a.png"], input_urls: ["http://cdn/b.png"], prompt: "hi" };
    const out = await localizeAssetsForVendor(extras, () => [{ vendorKey: "kie", ingestion: uploadUrlIngestion, uploadApiKey: "k" }], neverRead, post, noMultipart);
    expect(out.uploaded).toBe(0);
    expect(out.value).toBe(extras);
    expect(post).not.toHaveBeenCalled();
  });

  it("内联素材与 nomi-local 混在一个请求里，各自换出可达 URL", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ url: "https://pub/from-file.png" })
      .mockResolvedValueOnce({ url: "https://pub/from-inline.png" });
    const out = await localizeAssetsForVendor(
      { referenceImages: [localUrl("a.png"), inlineImageUrl()] },
      () => [{ vendorKey: "kie", ingestion: uploadUrlIngestion, uploadApiKey: "k" }],
      read,
      post,
      noMultipart,
    );
    expect(out.uploaded).toBe(2);
    expect((out.value as { referenceImages: string[] }).referenceImages).toEqual([
      "https://pub/from-file.png",
      "https://pub/from-inline.png",
    ]);
  });

  it("同一份内联字节只上传一次；不同字节各传各的、文件名不重（重名=覆盖=两个参考塌成一张）", async () => {
    const postMultipart = vi.fn().mockImplementation((_u, _h, _f, fileName: string) => Promise.resolve({ url: `https://pub/${fileName}` }));
    const first = inlineImageUrl();
    const second = inlineImageUrl("other");
    const out = await localizeAssetsForVendor(
      { referenceImages: [first, second, first] },
      () => [{ vendorKey: "apimart", ingestion: { strategy: "upload-multipart", endpoint: "https://up/m", urlPath: "url" }, uploadApiKey: "k" }],
      neverRead,
      vi.fn(),
      postMultipart,
    );
    expect(out.uploaded).toBe(2); // first 去重
    const names = postMultipart.mock.calls.map((call) => call[3] as string);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => name.endsWith(".png"))).toBe(true);
    const values = (out.value as { referenceImages: string[] }).referenceImages;
    expect(values[0]).toBe(values[2]);
    expect(values[0]).not.toBe(values[1]);
  });

  it("内联视频按字节判成 video → 走视频通道（不被 mime 声明骗进图片 base64 通道被 413）", async () => {
    const post = vi.fn();
    const postMultipart = vi.fn().mockResolvedValue({ data: { downloadUrl: "https://pub/clip.mp4" } });
    const videoIngestion: AssetIngestion = { strategy: "upload-stream", endpoint: "https://vid/up", urlPath: "data.downloadUrl", accepts: ["image", "video"] };
    const out = await localizeAssetsForVendor(
      { referenceVideoUrls: [inlineVideoUrl()] },
      (kind) => (kind === "video" ? [{ vendorKey: "kie", ingestion: videoIngestion, uploadApiKey: "vk" }] : []),
      neverRead,
      post,
      postMultipart,
    );
    expect(post).not.toHaveBeenCalled();
    expect((out.value as { referenceVideoUrls: string[] }).referenceVideoUrls).toEqual(["https://pub/clip.mp4"]);
    expect((postMultipart.mock.calls[0][5] as Record<string, string>).fileName.endsWith(".mp4")).toBe(true);
  });

  it("inline-base64 供应商（如魔搭）：内联素材归一后原样内联，不空跑一次上传", async () => {
    const post = vi.fn();
    const out = await localizeAssetsForVendor(
      { image_url: inlineImageUrl() },
      () => [{ vendorKey: "modelscope", ingestion: { strategy: "inline-base64" }, uploadApiKey: "" }],
      neverRead,
      post,
      noMultipart,
    );
    expect((out.value as { image_url: string }).image_url).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
    expect(post).not.toHaveBeenCalled();
  });

  it("认不出类型的内联素材付费前拒发，且不把几 MB base64 糊进消息", async () => {
    // 既没声明媒体类型、字节也嗅不出 → 不能瞎猜是图还是视频（猜错=送错通道被 413）。
    const unknown = `data:application/octet-stream;base64,${"A".repeat(4000)}`;
    const resolver = () => [{ vendorKey: "kie", ingestion: uploadUrlIngestion, uploadApiKey: "k" }];
    expect(() => assertLocalAssetTransportReady({ referenceImages: [unknown] }, resolver, neverRead))
      .toThrow(/无法识别本地素材/);
    try {
      assertLocalAssetTransportReady({ referenceImages: [unknown] }, resolver, neverRead);
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(200);
    }
  });

  it("minimizeUploads 剪枝不碰内联素材（当场带进来的字节不可能是过期残留）", async () => {
    const post = vi.fn().mockResolvedValue({ url: "https://pub/inline.png" });
    const out = await localizeAssetsForVendor(
      { referenceImages: [inlineImageUrl(), localUrl("stale.png")] },
      () => [{ vendorKey: "kie", ingestion: uploadUrlIngestion, uploadApiKey: "k" }],
      read,
      post,
      noMultipart,
      { minimizeUploads: true, activeAssetUrls: [] }, // 名单里一个都没有
    );
    expect((out.value as { referenceImages: string[] }).referenceImages).toEqual(["https://pub/inline.png"]);
  });

  it("assertLocalAssetTransportReady：内联素材没有可用通道 → 付费前拒发", () => {
    expect(() => assertLocalAssetTransportReady({ referenceImages: [inlineImageUrl()] }, () => [], neverRead))
      .toThrow(/没有可用的图片上传通道/);
    expect(() => assertLocalAssetTransportReady(
      { referenceImages: [inlineImageUrl()] },
      () => [{ vendorKey: "kie", ingestion: uploadUrlIngestion, uploadApiKey: "k" }],
      neverRead,
    )).not.toThrow();
  });
});

/** blob:/file: 谁都够不着：与其让 vendor 500（或更糟——静默无视参考照样扣费），不如付费前拒发。 */
describe("出站前拦截够不着的素材值（blob: / file:）", () => {
  const resolver = () => [{ vendorKey: "kie", ingestion: { strategy: "upload-url", endpoint: "https://up/x", base64Field: "b", urlPath: "url" } as AssetIngestion, uploadApiKey: "k" }];

  it("assertLocalAssetTransportReady 与 localizeAssetsForVendor 两处都拦（付费守卫前后各一道）", async () => {
    expect(() => assertLocalAssetTransportReady({ referenceImages: ["blob:file:///abc-123"] }, resolver, read))
      .toThrow(/发不出去/);
    await expect(localizeAssetsForVendor({ referenceImages: ["file:///Users/me/a.png"] }, resolver, read, vi.fn(), noMultipart))
      .rejects.toThrow(/发不出去/);
  });

  it("提到 file:// 的普通文案不误杀（判定只认整串就是 blob:/file: 地址）", async () => {
    const extras = { prompt: "别用 file:// 这种地址", notes: "/Users/me/a.png" };
    const out = await localizeAssetsForVendor(extras, resolver, read, vi.fn(), noMultipart);
    expect(out.value).toBe(extras);
  });
});
