// 免费自检的回归钉子（2026-09-11 用户拍板「删掉所有会花用户钱的自动逻辑」）。
//
// 这份文件替代了 verifier.test.ts / verifierPrivateAsset.test.ts / textProbeBudget.test.ts ——
// 那三份钉的是「发一次真实付费生成、轮询、下载产物、验真」那条路，而那条路整条删了。
// 这里钉的是它的替代物，以及**最关键的那条：自检不许花一分钱**（夹具里没有任何生成端点，
// 打过去就是 404；任何一次生成请求都会被 `calls` 抓个正着）。
import { describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import type { AdapterModeDraft } from "./types";
import { checkAdapterModeContract, probeAdapterCredential } from "./selfCheck";
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

function listFixture(models: string[], options: { status?: number; body?: unknown } = {}) {
  const calls: string[] = [];
  const fetchModelList = vi.fn(async (_kind, baseUrl: string) => {
    calls.push(baseUrl);
    if (options.status === 401) return { ok: false as const, failureKind: "auth" as const, status: 401, error: "invalid api key", statuses: [401] };
    if (options.status === 404) return { ok: false as const, failureKind: "unsupported" as const, status: 404, error: "not found", statuses: [404] };
    return { ok: true as const, models, statuses: [200] };
  });
  return { calls, dependencies: { fetchModelList: fetchModelList as never } };
}

describe("接模型的免费自检", () => {
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

  describe("凭据探测（只打 GET /models，零成本）", () => {
    it("列表拿到了就是通过，并带回模型清单", async () => {
      const fixture = listFixture(["gpt-image-2.5-flare", "other"]);
      await expect(probeAdapterCredential({ vendor: vendor(), apiKey: "sk-x" }, fixture.dependencies))
        .resolves.toEqual({ ok: true, modelIds: ["gpt-image-2.5-flare", "other"], listed: true });
    });

    it("401/403 才判死（这是唯一确定的「你的 key 不对」）", async () => {
      const fixture = listFixture([], { status: 401 });
      const result = await probeAdapterCredential({ vendor: vendor(), apiKey: "sk-bad" }, fixture.dependencies);
      expect(result).toMatchObject({ ok: false, reason: "credential_rejected", httpStatus: 401 });
    });

    it("这家根本没有列表端点（404）**不判死** —— 验证失败 ≠ 不可用", async () => {
      const fixture = listFixture([], { status: 404 });
      await expect(probeAdapterCredential({ vendor: vendor(), apiKey: "sk-x" }, fixture.dependencies))
        .resolves.toEqual({ ok: true, modelIds: [], listed: false });
    });

    it("authType none（火山语音那类三头鉴权）没有可打的端点，如实放行且一次请求都不发", async () => {
      const fixture = listFixture([]);
      await expect(probeAdapterCredential({ vendor: vendor({ authType: "none" }), apiKey: "" }, fixture.dependencies))
        .resolves.toEqual({ ok: true, modelIds: [], listed: false });
      expect(fixture.calls).toEqual([]);
    });
  });

  describe("一条模式的自检结论", () => {
    it("通过：不发任何生成请求，结果里没有产物、没有远端任务", async () => {
      const fixture = listFixture(["gpt-image-2.5-flare"]);
      const result = await verifyAdapterMode(
        { vendor: vendor(), model: model(), apiKey: "sk-x", mode: syncImageMode },
        fixture.dependencies,
      );
      expect(result.ok).toBe(true);
      // 唯一打出去的请求就是那次免费的模型清单。
      expect(fixture.calls).toEqual(["https://relay.example.test/v1"]);
      expect(JSON.stringify(result)).not.toContain("remoteTaskId");
      expect(JSON.stringify(result)).not.toContain("mediaEvidence");
    });

    it("异步中转 + 我们缺 query：判失败，但说的是「我们缺一条查询接口」，且没花一分钱", async () => {
      const fixture = listFixture(["gpt-image-2.5-flare"]);
      const result = await verifyAdapterMode(
        { vendor: vendor(), model: model(), apiKey: "sk-x", mode: asyncImageModeWithoutQuery },
        fixture.dependencies,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.stage).toBe("contract");
      expect(result.selfCheckReason).toBe("async_without_query");
      // 形状不对时连那次免费清单都不用打——错的是我们这边，问上游没有意义。
      expect(fixture.calls).toEqual([]);
    });

    it("key 被拒：带上 auth 归类与 credential_rejected 两个维度（上游 vs 我们，正交）", async () => {
      const fixture = listFixture([], { status: 401 });
      const result = await verifyAdapterMode(
        { vendor: vendor(), model: model(), apiKey: "sk-bad", mode: syncImageMode },
        fixture.dependencies,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.stage).toBe("credential");
      expect(result.selfCheckReason).toBe("credential_rejected");
      expect(result.errorCategory).toBe("auth");
    });

    it("模型不在上游清单里 → 仍然通过，只带一个提示（很多中转不把模型列全）", async () => {
      const fixture = listFixture(["something-else"]);
      const result = await verifyAdapterMode(
        { vendor: vendor(), model: model(), apiKey: "sk-x", mode: syncImageMode },
        fixture.dependencies,
      );
      expect(result).toMatchObject({ ok: true, modelNotListed: true });
    });

    it("调用方给了已探好的凭据结论时，不再重复打清单（一条连接只探一次）", async () => {
      const fixture = listFixture(["gpt-image-2.5-flare"]);
      const result = await verifyAdapterMode(
        {
          vendor: vendor(),
          model: model(),
          apiKey: "sk-x",
          mode: syncImageMode,
          credential: { ok: true, modelIds: ["gpt-image-2.5-flare"], listed: true },
        },
        fixture.dependencies,
      );
      expect(result.ok).toBe(true);
      expect(fixture.calls).toEqual([]);
    });
  });
});
