/**
 * runTask 的 L3 诚实护栏（docs/plan/2026-07-06-i2i-reference-reliability.md）：
 *
 *  闸① kind=image_edit/image_to_video 而请求里一张参考图都没有 → 拒发人话错误。
 *     此前模板引擎丢空键 / fallback body 根本没图片位 → 静默退化纯文生，「图生图不按原图」体感根源。
 *  闸② 同两 kind 且无 mapping → 拒发（绝不掉进丢参考图的 /v1/images/generations fallback）。
 *
 *  两闸都必须在 vendor 调用之前（fetch 不该被叫到 = 零扣费）。
 *  另验一条正路径：有 image_edit mapping（NEWAPI chat/completions 多模态）+ 参考图 → 参考图真到 wire。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

const stubFetch = (impl: () => Promise<Response> | Response) => {
  const fn = vi.fn(async () => impl());
  vi.stubGlobal("fetch", fn);
  return fn;
};

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-runtime-i2i-guard-");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 中转图片 vendor：有 vendor + key + image model；mapping 由各用例按需建。
async function seedRelayImageVendor(withEditMapping: boolean): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "relay",
    name: "中转站",
    enabled: true,
    authType: "bearer",
    baseUrlHint: "https://relay.example.com",
  });
  store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay" });
  store.upsertModelCatalogModel({ vendorKey: "relay", modelKey: "some-image-model", kind: "image", enabled: true });
  if (withEditMapping) {
    const { NEWAPI_IMAGE_EDIT_OP } = await import("./catalog/newapiTransport");
    store.upsertModelCatalogMapping({ vendorKey: "relay", taskKind: "image_edit", name: "改图", create: NEWAPI_IMAGE_EDIT_OP });
  }
}

describe("runTask L3 护栏 — 图生图/图生视频绝不静默退化", () => {
  it("闸②：image_edit 无 mapping（存量未自愈/奇形接入）→ 拒发人话错误，vendor 零调用", async () => {
    await seedRelayImageVendor(false);
    const fetchFn = stubFetch(() => new Response("{}", { status: 200 }));
    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const error = await runTask({
      vendor: "relay",
      request: { kind: "image_edit", prompt: "放在一起", extras: { modelKey: "some-image-model", referenceImages: ["https://cdn.example.com/dog.png"], grantId: mintSpendGrant({ nodeIds: [] }) } },
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/没有配置「图生图（改图）」通道/);
    expect(fetchFn).not.toHaveBeenCalled();
  }, 15_000);

  it("闸①：image_edit 一张参考图都没有 → 拒发（不再当纯文生图发出去），vendor 零调用", async () => {
    await seedRelayImageVendor(true);
    const fetchFn = stubFetch(() => new Response("{}", { status: 200 }));
    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const error = await runTask({
      vendor: "relay",
      request: { kind: "image_edit", prompt: "放在一起", extras: { modelKey: "some-image-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/图生图缺少参考图/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("闸①：image_to_video 无首帧/参考 → 拒发（fallback 的 t2v body 会丢首帧，同类病同闸）", async () => {
    const store = await import("./catalog/catalogStore");
    store.upsertModelCatalogVendor({ key: "relay", name: "中转站", enabled: true, authType: "bearer", baseUrlHint: "https://relay.example.com" });
    store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay" });
    store.upsertModelCatalogModel({ vendorKey: "relay", modelKey: "some-video-model", kind: "video", enabled: true });
    const fetchFn = stubFetch(() => new Response("{}", { status: 200 }));
    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const error = await runTask({
      vendor: "relay",
      request: { kind: "image_to_video", prompt: "动起来", extras: { modelKey: "some-video-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/图生视频缺少参考图/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("正路径：image_edit mapping + 参考图 → 参考图真到 wire（chat/completions content 带 image_url 项）", async () => {
    await seedRelayImageVendor(true);
    const fetchFn = stubFetch(() =>
      new Response(JSON.stringify({ choices: [{ message: { images: [{ url: "https://cdn.example.com/out.png" }] } }] }), { status: 200 }),
    );
    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const result = await runTask({
      vendor: "relay",
      request: {
        kind: "image_edit",
        prompt: "把狗和猫放在一起",
        extras: { modelKey: "some-image-model", referenceImages: ["https://cdn.example.com/dog.png", "https://cdn.example.com/cat.png"], grantId: mintSpendGrant({ nodeIds: [] }) },
      },
    });
    expect(result.status).toBe("succeeded");
    const body = JSON.parse(String((fetchFn.mock.calls[0]?.[1] as { body?: string })?.body || "{}")) as {
      messages?: Array<{ content?: Array<{ type?: string; image_url?: { url?: string } }> }>;
    };
    const parts = body.messages?.[0]?.content || [];
    const imageUrls = parts.filter((p) => p.type === "image_url").map((p) => p.image_url?.url);
    expect(imageUrls).toEqual(["https://cdn.example.com/dog.png", "https://cdn.example.com/cat.png"]);
  }, 15_000);
});
