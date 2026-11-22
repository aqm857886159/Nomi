// 格式完整性检查的回归钉子（2026-09-11 用户拍板「删掉所有会花用户钱的自动逻辑」；
// 2026-11-17 D-1117-delete-verification 又删了凭据自检）。
//
// 这份文件替代了 verifier.test.ts / verifierPrivateAsset.test.ts / textProbeBudget.test.ts ——
// 那三份钉的是「发一次真实付费生成、轮询、下载产物、验真」那条路，而那条路整条删了。
// 这里钉的是它的替代物，以及**最关键的那条：格式检查一个请求都不发**（fetch 被换成记账的假货，
// 任何一次出站都会被 `calls` 抓个正着）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import type { AdapterModeDraft } from "./types";
import { checkAdapterModeContract } from "./selfCheck";
import { verifyAdapterMode } from "./verifier";

const vendor = (overrides: Partial<Vendor> = {}): Vendor => ({
  key: "relay",
  name: "Relay",
  enabled: true,
  baseUrlHint: "https://relay.example.test/v1",
  authType: "bearer",
  providerKind: "openai-compatible",
  createdAt: "t",
  updatedAt: "t",
  ...overrides,
} as Vendor);

const model = (overrides: Partial<Model> = {}): Model => ({
  vendorKey: "relay",
  modelKey: "gpt-image-2.5-flare",
  labelZh: "Flare",
  kind: "image",
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
  ...overrides,
} as Model);

const syncImageMode: AdapterModeDraft = {
  taskKind: "text_to_image",
  create: { method: "POST", path: "/v1/images/generations", response_mapping: { image_url: "data.0.url" } },
  sourceUrls: [],
};

/** 一个「提交任务 → 轮询」的中转，且我们**没有**它的查询端点：09-11 群反馈的真实形状。 */
const asyncImageModeWithoutQuery: AdapterModeDraft = {
  ...syncImageMode,
  delivery: "asynchronous",
};

const asyncImageModeWithQuery: AdapterModeDraft = {
  ...syncImageMode,
  delivery: "asynchronous",
  query: { method: "GET", path: "/v1/images/generations/{{task_id}}", response_mapping: { status: "status", image_url: "data.0.url" } },
  statusMapping: { succeeded: ["succeeded"], failed: ["failed"] },
};

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("格式任务里的格式完整性检查", () => {
  describe("说明卡形状（纯函数、零网络）", () => {
    it("同步图片配方通过", () => {
      expect(checkAdapterModeContract(model(), syncImageMode)).toEqual({ ok: true });
    });

    it("声明异步却没有查询端点 → 结构化原因 async_without_query，而不是一串英文甩给用户", () => {
      const result = checkAdapterModeContract(model(), asyncImageModeWithoutQuery);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("async_without_query");
      expect(result.error).toContain("asynchronous");
    });

    it("补上查询端点与状态表之后通过（治好的形状长这样）", () => {
      expect(checkAdapterModeContract(model(), asyncImageModeWithQuery)).toEqual({ ok: true });
    });

    it("没有可执行通道（中转上的 3D）→ no_channel", () => {
      const result = checkAdapterModeContract(model({ kind: "model3d" }), { taskKind: "text_to_3d", create: {} as never, sourceUrls: [] });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("no_channel");
    });

    it("改图模式没声明参考图槽 → reference_slot_missing（参考图会整条掉地）", () => {
      const result = checkAdapterModeContract(model(), {
        taskKind: "image_edit",
        create: { method: "POST", path: "/v1/images/edits" },
        sourceUrls: [],
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("reference_slot_missing");
    });
  });

  describe("一条模式的检查结论", () => {
    it("通过：一个请求都不发，结果里没有产物、没有远端任务，只说格式", async () => {
      const result = await verifyAdapterMode({ vendor: vendor(), model: model(), apiKey: "sk-x", mode: syncImageMode });
      expect(result).toMatchObject({ ok: true, requestSummary: { selfCheck: "contract" } });
      expect(calls).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("remoteTaskId");
      expect(JSON.stringify(result)).not.toContain("mediaEvidence");
      expect(JSON.stringify(result)).not.toContain("modelListed");
    });

    it("异步中转 + 我们缺 query：判失败，但说的是「我们缺一条查询接口」，且没花一分钱", async () => {
      const result = await verifyAdapterMode({ vendor: vendor(), model: model(), apiKey: "sk-x", mode: asyncImageModeWithoutQuery });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.stage).toBe("contract");
      expect(result.selfCheckReason).toBe("async_without_query");
      expect(calls).toEqual([]);
    });

    it("key 是错的也不影响格式结论：这一步不问上游（key 被拒只在保存那一刻挡）", async () => {
      const result = await verifyAdapterMode({ vendor: vendor(), model: model(), apiKey: "sk-definitely-wrong", mode: syncImageMode });
      expect(result.ok).toBe(true);
      expect(calls).toEqual([]);
    });
  });
});
