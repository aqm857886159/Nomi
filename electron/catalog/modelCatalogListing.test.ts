import { beforeEach, describe, it, expect, vi } from "vitest";
import type { CatalogState, Mapping, Model, Vendor } from "./types";

// 交付1：deriveModelListing 逐模型 keyStatus（ok/missing/locked）+ 参考承载力真话。
// safeStorage mock 同 secrets.test：哨兵 "FAIL" 明文解密时抛错（模拟身份不匹配 → locked）。
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, "utf8"),
    decryptString: (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (s === "FAIL") throw new Error("decrypt failed");
      return s;
    },
  },
}));

import { deriveModelListing, referenceModeForIntent } from "./modelCatalogListing";
import { apiKeyDecryptStatus } from "./secrets";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
// 主进程诊断输出已收口到 electron/logging/logger（打包后 console.* 没人接住，见
// docs/fixes/2026-09-06-main-process-logs-into-the-void.root-cause.json）。
// 这里改断言那个出口而不是 console：断言从「有人往终端喷了点什么」升级成
// 「哪个模块、什么事件、带哪些字段」，比原来更能说明问题。
const logged = vi.hoisted(() => [] as { level: string; scope: string; event: string; rest: unknown[] }[])
vi.mock("../logging/logger", () => {
  const record = (level: string) => (scope: string, event: string, ...rest: unknown[]) => {
    logged.push({ level, scope, event, rest })
  }
  return {
    logInfo: record("info"),
    logWarn: record("warn"),
    logError: record("error"),
    logDevDetail: () => undefined,
    logVendorCall: () => undefined,
    installMainLogger: () => undefined,
    currentLogFile: () => "",
  }
})

const vendor = (over: Partial<Vendor>): Vendor => ({ key: "v", name: "V", enabled: true, authType: "bearer", createdAt: "t", updatedAt: "t", ...over });
const model = (over: Partial<Model>): Model => ({
  modelKey: "m",
  vendorKey: "v",
  labelZh: "M",
  kind: "image",
  enabled: true,
  customCall: { script: "return { assets: [] }", updatedAt: "t" },
  createdAt: "t",
  updatedAt: "t",
  ...over,
} as Model);
const mapping = (over: Partial<Mapping>): Mapping => ({ id: "id", vendorKey: "v", taskKind: "text_to_image", name: "n", enabled: true, create: { method: "POST", path: "/x", body: {} }, createdAt: "t", updatedAt: "t", ...over } as Mapping);

function state(over: Partial<CatalogState>): CatalogState {
  return { version: 8, vendors: [], models: [], mappings: [], apiKeysByVendor: {}, ...over } as CatalogState;
}

beforeEach(() => {
  logged.length = 0;
});

describe("deriveModelListing — keyStatus 三态（ok / missing / locked）", () => {
  const three = state({
    vendors: [
      vendor({ key: "apimart", name: "APImart" }),
      vendor({ key: "kie", name: "Kie" }),
      vendor({ key: "volcengine", name: "火山" }),
    ],
    models: [
      model({ modelKey: "seedream", vendorKey: "apimart", labelZh: "Seedream" }),
      model({ modelKey: "kie-model", vendorKey: "kie", labelZh: "Kie 模型" }),
      model({ modelKey: "volc-model", vendorKey: "volcengine", labelZh: "火山模型" }),
    ],
    apiKeysByVendor: {
      apimart: { vendorKey: "apimart", apiKey: b64("sk-good"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" },
      // kie：完全没有 key 记录 → missing。
      volcengine: { vendorKey: "volcengine", apiKey: b64("FAIL"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" },
    },
  });

  it("apimart（key 解得开）→ ok；kie（无记录）→ missing；volcengine（key 在但解不开）→ locked", () => {
    const listing = deriveModelListing(three);
    const byVendor = Object.fromEntries(listing.map((e) => [e.vendor, e]));
    expect(byVendor.apimart.keyStatus).toBe("ok");
    expect(byVendor.kie.keyStatus).toBe("missing");
    expect(byVendor.volcengine.keyStatus).toBe("locked");
  });

  it("locked 的一句人话必须指向「在 App 里重新保存」——不再笼统说没配", () => {
    const listing = deriveModelListing(three);
    const volc = listing.find((e) => e.vendor === "volcengine")!;
    expect(volc.statusReason).toContain("重新保存");
    expect(volc.statusReason).toContain("火山");
    expect(volc.statusReason).not.toContain("未配置");
  });

  it("missing 的一句人话指向「去模型接入填 key」，带 vendor 名", () => {
    const listing = deriveModelListing(three);
    const kie = listing.find((e) => e.vendor === "kie")!;
    expect(kie.statusReason).toContain("未配置");
    expect(kie.statusReason).toContain("Kie");
  });

  it("不静默丢没 key 的模型——三个模型全在清单里（kie 也列出，带 missing）", () => {
    const listing = deriveModelListing(three);
    expect(listing.map((e) => e.vendor).sort()).toEqual(["apimart", "kie", "volcengine"]);
  });

  it("authType='none' 的 vendor（如本地 ComfyUI）无需 key → 恒 ok", () => {
    const local = state({
      vendors: [vendor({ key: "comfy", name: "ComfyUI", authType: "none" })],
      models: [model({ modelKey: "flux", vendorKey: "comfy" })],
      apiKeysByVendor: {},
    });
    expect(deriveModelListing(local)[0].keyStatus).toBe("ok");
  });

  it("只列 enabled 模型（停用的不进清单）", () => {
    const withDisabled = state({
      vendors: [vendor({ key: "apimart", name: "APImart" })],
      models: [model({ modelKey: "on", vendorKey: "apimart", enabled: true }), model({ modelKey: "off", vendorKey: "apimart", enabled: false })],
      apiKeysByVendor: { apimart: { vendorKey: "apimart", apiKey: b64("k"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" } },
    });
    expect(deriveModelListing(withDisabled).map((e) => e.modelKey)).toEqual(["on"]);
  });

  it("hides staged or failed adapter models without an active revision even when raw mappings are enabled", () => {
    const hidden = state({
      vendors: [vendor({ key: "relay", authType: "none" })],
      models: [
        model({ modelKey: "staged", vendorKey: "relay", customCall: undefined, meta: { adapter: { state: "unverified", modes: [], updatedAt: "t" } } }),
        model({ modelKey: "failed", vendorKey: "relay", customCall: undefined, meta: { adapter: { state: "failed", modes: [], updatedAt: "t" } } }),
      ],
      mappings: [
        mapping({ id: "staged-map", vendorKey: "relay", modelKey: "staged", enabled: true }),
        mapping({ id: "failed-map", vendorKey: "relay", modelKey: "failed", enabled: true }),
      ],
    });

    expect(deriveModelListing(hidden)).toEqual([]);
  });

  it("keeps only legacy text fallback plus a failed repair with a preserved active revision visible", () => {
    const visible = state({
      vendors: [vendor({ key: "relay", authType: "none" })],
      models: [
        model({ modelKey: "legacy-text", vendorKey: "relay", kind: "text", customCall: undefined }),
        model({ modelKey: "legacy-image", vendorKey: "relay", kind: "image", customCall: undefined }),
        model({ modelKey: "legacy-video", vendorKey: "relay", kind: "video", customCall: undefined }),
        model({ modelKey: "legacy-audio", vendorKey: "relay", kind: "audio", customCall: undefined }),
        model({
          modelKey: "active",
          vendorKey: "relay",
          customCall: undefined,
          meta: { adapter: { state: "failed", activeRevision: "revision-good", modes: [{ taskKind: "text_to_image", state: "verified" }], updatedAt: "t" } },
        }),
      ],
    });

    expect(deriveModelListing(visible).map((entry) => entry.modelKey)).toEqual(["legacy-text", "active"]);
  });

  it("does not let a raw custom-call script publish an adapter model without a certified active revision", () => {
    const customCall = state({
      vendors: [vendor({ key: "relay", authType: "none" })],
      models: [
        model({
          modelKey: "scripted",
          vendorKey: "relay",
          customCall: { script: "return { text: 'ok' }", updatedAt: "t" },
          meta: { adapter: { state: "failed", modes: [], updatedAt: "t" } },
        }),
        model({
          modelKey: "failed-without-execution",
          vendorKey: "relay",
          customCall: undefined,
          meta: { adapter: { state: "failed", modes: [], updatedAt: "t" } },
        }),
      ],
    });

    expect(deriveModelListing(customCall).map((entry) => entry.modelKey)).toEqual([]);
  });

  it("reports legacy plaintext credentials as needs_resave with a migration action", () => {
    const legacy = state({
      vendors: [vendor({ key: "relay", name: "Relay" })],
      models: [model({ modelKey: "legacy", vendorKey: "relay" })],
      apiKeysByVendor: {
        relay: { vendorKey: "relay", apiKey: "sk-legacy", enc: "plain", enabled: true, createdAt: "t", updatedAt: "t" },
      },
    });

    expect(deriveModelListing(legacy)[0]).toMatchObject({
      keyStatus: "needs_resave",
      statusReason: expect.stringContaining("重新保存"),
    });
  });
});

describe("deriveModelListing — 解密探测按 vendor 记忆化（单 vendor 多模型只探一次）", () => {
  const singleVendorManyModels = state({
    vendors: [vendor({ key: "apimart", name: "APImart" })],
    models: [
      model({ modelKey: "seedream", vendorKey: "apimart", labelZh: "Seedream" }),
      model({ modelKey: "seedance", vendorKey: "apimart", kind: "video", labelZh: "Seedance" }),
      model({ modelKey: "wan", vendorKey: "apimart", kind: "video", labelZh: "Wan" }),
    ],
    apiKeysByVendor: {
      apimart: { vendorKey: "apimart", apiKey: b64("sk-good"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" },
    },
  });

  it("单 vendor 3 个模型 → 解密探测只跑 1 次（记忆化命中，不再逐模型探）", () => {
    const probe = vi.fn(apiKeyDecryptStatus);
    const listing = deriveModelListing(singleVendorManyModels, { keyStatusProbe: probe });
    expect(listing).toHaveLength(3);
    expect(listing.every((e) => e.keyStatus === "ok")).toBe(true); // 命中的都是同一份 ok
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(singleVendorManyModels.apiKeysByVendor.apimart);
  });

  it("locked vendor 多模型：解密只探一次 → 只吐一行解密失败日志（不再 N 行重复）", () => {
    const lockedManyModels = state({
      vendors: [vendor({ key: "volcengine", name: "火山" })],
      models: [
        model({ modelKey: "a", vendorKey: "volcengine" }),
        model({ modelKey: "b", vendorKey: "volcengine" }),
        model({ modelKey: "c", vendorKey: "volcengine" }),
      ],
      apiKeysByVendor: {
        volcengine: { vendorKey: "volcengine", apiKey: b64("FAIL"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" },
      },
    });
    // 用真 apiKeyDecryptStatus（会触发 decryptString→抛错→logError）；记忆化后只应有 1 行。
    const listing = deriveModelListing(lockedManyModels);
    expect(listing.every((e) => e.keyStatus === "locked")).toBe(true);
    expect(logged.filter((entry) => entry.event === "api-key-decrypt-failed")).toHaveLength(1);
  });

  it("多 vendor：每个 vendor 各探一次（记忆化不跨 vendor 串台）", () => {
    const probe = vi.fn(apiKeyDecryptStatus);
    const twoVendors = state({
      vendors: [vendor({ key: "apimart", name: "APImart" }), vendor({ key: "kie", name: "Kie" })],
      models: [
        model({ modelKey: "m1", vendorKey: "apimart" }),
        model({ modelKey: "m2", vendorKey: "apimart" }),
        model({ modelKey: "m3", vendorKey: "kie" }),
      ],
      apiKeysByVendor: {
        apimart: { vendorKey: "apimart", apiKey: b64("k"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" },
        // kie 无记录 → probe 收到 undefined，仍算一次探测。
      },
    });
    deriveModelListing(twoVendors, { keyStatusProbe: probe });
    expect(probe).toHaveBeenCalledTimes(2); // apimart 一次 + kie 一次，非 3 次
  });

  it("authType='none' 的 vendor 恒 ok，压根不调探测（记忆化 + 短路都不触发解密）", () => {
    const probe = vi.fn(apiKeyDecryptStatus);
    const localVendor = state({
      vendors: [vendor({ key: "comfy", name: "ComfyUI", authType: "none" })],
      models: [model({ modelKey: "flux", vendorKey: "comfy" }), model({ modelKey: "sdxl", vendorKey: "comfy" })],
      apiKeysByVendor: {},
    });
    const listing = deriveModelListing(localVendor, { keyStatusProbe: probe });
    expect(listing.every((e) => e.keyStatus === "ok")).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("deriveModelListing — 参考承载力真话（与 referenceReachability.bodyReferenceSupport 同源）", () => {
  const IMAGE_URLS = "{{request.params.image_urls}}";
  const VIDEO_URLS = "{{request.params.video_urls}}";
  const AUDIO_URLS = "{{request.params.audio_urls}}";

  it("纯文生模型（t2i body 无参考键）→ references 全 false、referenceModes 空", () => {
    const s = state({
      vendors: [vendor({ key: "apimart", name: "APImart" })],
      models: [model({ modelKey: "seedream", vendorKey: "apimart" })],
      mappings: [mapping({ vendorKey: "apimart", modelKey: "seedream", taskKind: "text_to_image", create: { method: "POST", path: "/x", body: { size: "{{request.params.size}}" } } })],
      apiKeysByVendor: { apimart: { vendorKey: "apimart", apiKey: b64("k"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" } },
    });
    const entry = deriveModelListing(s)[0];
    expect(entry.references).toMatchObject({ image: false, video: false, audio: false, multiImage: false });
    expect(entry.references.referenceModes).toEqual([]);
  });

  it("i2v body（image_urls 数组 + video_urls + audio_urls）→ 图/视频/音频全能 + 多图 + referenceModes 含 image_to_video", () => {
    const s = state({
      vendors: [vendor({ key: "apimart", name: "APImart" })],
      models: [model({ modelKey: "seedance", vendorKey: "apimart", kind: "video" })],
      mappings: [
        mapping({ id: "t2v", vendorKey: "apimart", modelKey: "seedance", taskKind: "text_to_video", create: { method: "POST", path: "/x", body: { size: "{{request.params.size}}" } } }),
        mapping({ id: "i2v", vendorKey: "apimart", modelKey: "seedance", taskKind: "image_to_video", create: { method: "POST", path: "/x", body: { image_urls: IMAGE_URLS, video_urls: VIDEO_URLS, audio_urls: AUDIO_URLS } } }),
      ],
      apiKeysByVendor: { apimart: { vendorKey: "apimart", apiKey: b64("k"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" } },
    });
    const entry = deriveModelListing(s)[0];
    expect(entry.references).toMatchObject({ image: true, video: true, audio: true, multiImage: true });
    expect(entry.references.referenceModes).toEqual(["image_to_video"]);
  });

  it("generic（无 modelKey）mapping 也算进模型的参考能力（共享模板）", () => {
    const s = state({
      vendors: [vendor({ key: "relay", name: "Relay" })],
      models: [model({ modelKey: "shared", vendorKey: "relay", kind: "video" })],
      // generic i2v 模板（image 单图聚合位），不绑 modelKey → 该 vendor 下模型共享。
      mappings: [mapping({ id: "g", vendorKey: "relay", taskKind: "image_to_video", create: { method: "POST", path: "/x", body: { image: "{{request.params.image_url}}" } } })],
      apiKeysByVendor: { relay: { vendorKey: "relay", apiKey: b64("k"), enc: "safeStorage", enabled: true, createdAt: "t", updatedAt: "t" } },
    });
    const entry = deriveModelListing(s)[0];
    expect(entry.references.image).toBe(true);
    expect(entry.references.multiImage).toBe(false); // 单图聚合位不是多图
    expect(entry.references.referenceModes).toEqual(["image_to_video"]);
  });
});

// W1d：kind 按目录 derive（core.generateOnProject 带参考时用它选 kind，替掉硬编码 defaultKindForIntent）。
// 判据 = 该模型真实可带参考的模式（与 references.referenceModes 同源），按 intent 计费口径过滤。
describe("referenceModeForIntent — 带参考时按目录选生成 kind（不硬编码）", () => {
  const imgBody = (key: string) => ({ method: "POST" as const, path: "/x", body: { image_urls: `{{request.params.${key}}}` } });

  it("模型声明 image_edit（body 读 image_urls）→ image intent 选 image_edit", () => {
    const s = state({
      vendors: [vendor({ key: "apimart" })],
      models: [model({ modelKey: "seedream", vendorKey: "apimart" })],
      mappings: [
        mapping({ id: "t2i", vendorKey: "apimart", modelKey: "seedream", taskKind: "text_to_image", create: { method: "POST", path: "/x", body: { size: "{{request.params.size}}" } } }),
        mapping({ id: "edit", vendorKey: "apimart", modelKey: "seedream", taskKind: "image_edit", create: imgBody("image_urls") }),
      ],
    });
    expect(referenceModeForIntent(s, "apimart", "seedream", "image")).toBe("image_edit");
  });

  it("模型声明 image_to_video（帧类/参考图）→ video intent 选 image_to_video", () => {
    const s = state({
      vendors: [vendor({ key: "apimart" })],
      models: [model({ modelKey: "seedance", vendorKey: "apimart", kind: "video" })],
      mappings: [
        mapping({ id: "t2v", vendorKey: "apimart", modelKey: "seedance", taskKind: "text_to_video", create: { method: "POST", path: "/x", body: { size: "{{request.params.size}}" } } }),
        mapping({ id: "i2v", vendorKey: "apimart", modelKey: "seedance", taskKind: "image_to_video", create: imgBody("image_urls") }),
      ],
    });
    expect(referenceModeForIntent(s, "apimart", "seedance", "video")).toBe("image_to_video");
  });

  it("单图字符串首帧键（first_frame_image）也算带参考模式 → video intent 选 image_to_video", () => {
    const s = state({
      vendors: [vendor({ key: "apimart" })],
      models: [model({ modelKey: "kling", vendorKey: "apimart", kind: "video" })],
      mappings: [
        mapping({ id: "i2v", vendorKey: "apimart", modelKey: "kling", taskKind: "image_to_video", create: { method: "POST", path: "/x", body: { first_frame_image: "{{request.params.first_frame_image}}" } } }),
      ],
    });
    expect(referenceModeForIntent(s, "apimart", "kling", "video")).toBe("image_to_video");
  });

  it("intent 口径过滤：video 模型只有 image_to_video 时，image intent 得不到它 → null（回退 defaultKind）", () => {
    const s = state({
      vendors: [vendor({ key: "apimart" })],
      models: [model({ modelKey: "seedance", vendorKey: "apimart", kind: "video" })],
      mappings: [mapping({ id: "i2v", vendorKey: "apimart", modelKey: "seedance", taskKind: "image_to_video", create: imgBody("image_urls") })],
    });
    expect(referenceModeForIntent(s, "apimart", "seedance", "image")).toBeNull();
    expect(referenceModeForIntent(s, "apimart", "seedance", "video")).toBe("image_to_video");
  });

  it("无任何可带参考的模式（纯文生模型）→ null", () => {
    const s = state({
      vendors: [vendor({ key: "apimart" })],
      models: [model({ modelKey: "zimage", vendorKey: "apimart" })],
      mappings: [mapping({ id: "t2i", vendorKey: "apimart", modelKey: "zimage", taskKind: "text_to_image", create: { method: "POST", path: "/x", body: { size: "{{request.params.size}}" } } })],
    });
    expect(referenceModeForIntent(s, "apimart", "zimage", "image")).toBeNull();
  });

  it("generic（无 modelKey）通用 image_edit 模板也纳入该 vendor 下模型的参考模式", () => {
    const s = state({
      vendors: [vendor({ key: "relay" })],
      models: [model({ modelKey: "relay-img", vendorKey: "relay" })],
      // 单图聚合位 image 键（通用中转最小模板）→ 算带参考。
      mappings: [mapping({ id: "g", vendorKey: "relay", taskKind: "image_edit", create: { method: "POST", path: "/x", body: { image: "{{request.params.image_url}}" } } })],
    });
    expect(referenceModeForIntent(s, "relay", "relay-img", "image")).toBe("image_edit");
  });
});
