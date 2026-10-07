/**
 * 类测试（issue #975）：**认证 / 声明标记写在谁身上，都不该让一条没有代码契约的连接在正式生成里关门**。
 *
 * 正式生成的执行器对非 direct-key 家只渲染目录里那条 mapping——认证晋升、声明登记、设置页手加写的也是它。
 * 所以「这家名下有没有行带 `meta.adapter`」对它的就绪不该有任何影响：画布那台发动机不看这个，正式生成
 * 也不看。这里把**四种写标记的真实形状**（声明卡、渲染层新建、导入、认证晋升）× **标记落的位置**
 * （同一行 / 兄弟行 / 连接行）× **两类没有代码契约的家**（非内置自定义连接、内置非 direct-key 家）
 * 逐格扫一遍，每一格都必须和「没有任何标记」的基线给同一个答案（就绪）。
 *
 * 另一半（内置 direct-key 家的代码契约被认证接管时必须让开）由 generationProviderBootstrap.test.ts
 * 的 A10b / certification-owned 两条钉着，这里只做对照，证明那条边没有被这次一起放掉。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../catalog/secrets", () => ({
  decryptApiKeyRecord: (record?: { apiKey?: string }) => record?.apiKey ?? "",
  apiKeyDecryptStatus: (record?: { apiKey?: string; enc?: string }) =>
    record?.enc === "safeStorage" && record.apiKey ? "ok" : record?.apiKey ? "needs_resave" : "missing",
  credentialRecordCounts: (record?: { apiKey?: string; enabled?: boolean }) => Boolean(record?.apiKey) && record?.enabled !== false,
}));

import { createGenerationProviderBootstrap } from "./generationProviderBootstrap";
import { isBuiltinDirectKeyVendor } from "../catalog/builtinVendorSeeds";
import { builtinCatalogModelKeys } from "../catalog/seedBuiltins";
import { isCertificationOwnedConnection } from "../catalog/certificationOwnership";
import type { CatalogState } from "../catalog/types";

/** 四个真实写门写下的标记形状（与写门源码逐字同形）。 */
const MARKS: Record<string, Record<string, unknown>> = {
  // electron/catalog/declaredProviderRegistration.ts（MCP submit_declaration，#975 用户现场）
  "declaration-card": { state: "declared", source: "declaration-card", updatedAt: "now" },
  // electron/catalog/rendererCatalogMutation.ts sanitizeRendererModelMutation（设置页手加一行）
  "renderer-new-row": { state: "unverified", modes: [] },
  // electron/catalog/rendererCatalogMutation.ts sanitizeRendererCatalogImport（导入一份目录）
  "catalog-import": { state: "unverified", modes: [] },
  // electron/providerAdapter/promotionMeta.ts（AI 接入 / 继续验证 认证晋升）
  "certified-promotion": { state: "verified", activeRevision: "rev-1", modes: [{ taskKind: "text_to_video", state: "verified" }] },
};

type Place = "same-row" | "sibling-row" | "connection-row";
const PLACES: readonly Place[] = ["same-row", "sibling-row", "connection-row"];

function connection(vendorKey: string, modelKey: string, mark?: { place: Place; adapter: Record<string, unknown> }): CatalogState {
  const now = "now";
  const markOn = (place: Place) => (mark?.place === place ? { adapter: structuredClone(mark.adapter) } : {});
  return {
    version: 9,
    vendors: [{
      key: vendorKey, name: vendorKey, enabled: true, baseUrlHint: "https://relay.example.test", authType: "bearer",
      authHeader: "Authorization", createdAt: now, updatedAt: now, meta: markOn("connection-row"),
    }],
    models: [
      { modelKey, vendorKey, labelZh: modelKey, kind: "video", enabled: true, meta: markOn("same-row"), createdAt: now, updatedAt: now },
      { modelKey: `${modelKey}-sibling`, vendorKey, labelZh: "sibling", kind: "video", enabled: false, meta: markOn("sibling-row"), createdAt: now, updatedAt: now },
    ],
    mappings: [{
      id: `${vendorKey}-${modelKey}-t2v`, vendorKey, modelKey, taskKind: "text_to_video", name: "t2v", enabled: true,
      create: { method: "POST", path: "/v1/videos", body: { prompt: "{{request.prompt}}" }, response_mapping: { task_id: "task_id" } },
      query: { method: "GET", path: "/v1/videos/{{taskId}}", response_mapping: { status: "status", video_url: "video_url" } },
      createdAt: now, updatedAt: now,
    }],
    apiKeysByVendor: { [vendorKey]: { vendorKey, apiKey: "test-key", enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now } },
  } as CatalogState;
}

function readinessOf(state: CatalogState, vendorKey: string) {
  return createGenerationProviderBootstrap(state, { catalogReader: () => state }).readinessByProvider[vendorKey];
}

// 两类没有代码契约的家。内置那一家取「有 curated 目录模型、但不是 direct-key」的一家，
// 标记落在它的 curated 模型上——旧判据下这正是「整条连接归认证管」的那一格。
const BUILTIN_NON_DIRECT_KEY = "kie";
const builtinModelKey = [...builtinCatalogModelKeys(BUILTIN_NON_DIRECT_KEY)][0] ?? "";
const POPULATIONS = [
  { name: "非内置自定义连接（AI 接入 / 声明卡 / 手接中转）", vendorKey: "local-52931", modelKey: "local-video-fast" },
  { name: "内置非 direct-key 家（curated 模型被标记）", vendorKey: BUILTIN_NON_DIRECT_KEY, modelKey: builtinModelKey },
];

describe("正式生成就绪与认证 / 声明标记无关（没有代码契约的连接）", () => {
  it("前提：两类家都确实没有 direct-key 代码契约，且内置那家的模型确实在 curated 目录里", () => {
    expect(isBuiltinDirectKeyVendor("local-52931")).toBe(false);
    expect(isBuiltinDirectKeyVendor(BUILTIN_NON_DIRECT_KEY)).toBe(false);
    expect(builtinModelKey).not.toBe("");
  });

  for (const population of POPULATIONS) {
    it(`${population.name}：没有标记时就绪（基线）`, () => {
      expect(readinessOf(connection(population.vendorKey, population.modelKey), population.vendorKey))
        .toMatchObject({ providerReady: true });
    });

    for (const [writer, adapter] of Object.entries(MARKS)) {
      for (const place of PLACES) {
        it(`${population.name} · ${writer} 写在${place}：仍就绪，与基线同答`, () => {
          const state = connection(population.vendorKey, population.modelKey, { place, adapter });
          const baseline = readinessOf(connection(population.vendorKey, population.modelKey), population.vendorKey);
          expect(readinessOf(state, population.vendorKey)).toEqual(baseline);
        });
      }
    }
  }

  it("#975 现场那一格：声明卡标记让连接算作「归认证管」，但正式生成照样就绪", () => {
    const state = connection("local-52931", "local-video-fast", { place: "same-row", adapter: MARKS["declaration-card"]! });
    // 判据本身没变（设置页的鉴权锁仍然要它）：这条连接确实归认证 / 声明管。
    expect(isCertificationOwnedConnection(state, "local-52931")).toBe(true);
    // 变的是正式生成不再拿它当「有别人来执行」——别人并不存在。
    expect(readinessOf(state, "local-52931")).toMatchObject({ providerReady: true });
    expect(readinessOf(state, "local-52931")?.missingForSubmit).toBeUndefined();
  });
});
