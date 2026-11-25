import fs from "node:fs";
import { describe, it, expect } from "vitest";
import "./apimartVideos";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { selectTaskMapping, type CatalogState, type Mapping } from "./types";

// 路由根因回归：同 (vendor, taskKind) 下两个模型请求形状不同时，靠 modelKey 精确路由，
// 不再「第一个 enabled 赢、另一个模型静默套错模板」（实测：HappyHorse 撞 Kling 的 text_to_video）。

function mp(id: string, over: Partial<Mapping> = {}): Mapping {
  return {
    id, vendorKey: "kie", taskKind: "text_to_video", name: id, enabled: true,
    create: { method: "POST", path: "/x", headers: {}, body: { tag: id } },
    createdAt: "t", updatedAt: "t", ...over,
  } as Mapping;
}

describe("selectTaskMapping — 优先级：精确 modelKey > generic > 任意", () => {
  const kling = mp("kling", {}); // generic（无 modelKey）
  const happy = mp("happy", { modelKey: "happyhorse" }); // 绑 HappyHorse
  const all = [kling, happy];

  it("传 happyhorse → 命中 HappyHorse 自己的 mapping（不被 Kling 抢）", () => {
    expect(selectTaskMapping(all, "kie", "text_to_video", "happyhorse")?.id).toBe("happy");
  });
  it("传别的/不传 modelKey → 落 generic（Kling）", () => {
    expect(selectTaskMapping(all, "kie", "text_to_video", "kling-2")?.id).toBe("kling");
    expect(selectTaskMapping(all, "kie", "text_to_video")?.id).toBe("kling");
  });
  it("只有 generic 时，任何 modelKey 都落它（向后兼容老数据：Seedance 无 modelKey 仍可用）", () => {
    expect(selectTaskMapping([kling], "kie", "text_to_video", "anything")?.id).toBe("kling");
  });
  it("没有 generic、只有别的模型绑定、且 modelKey 不匹配 → 返回 null（P3:不静默套别的模型模板）", () => {
    // 旧行为是兜底 inBucket[0]，会把「other」静默套上 happyhorse 的请求模板。
    // 根因修复：无精确绑定 + 无 generic → null，让调用方走通用回退而非错模板。
    expect(selectTaskMapping([happy], "kie", "text_to_video", "other")).toBeNull();
  });
  it("没有 generic、不传 modelKey、桶里只有带 modelKey 的绑定 → 仍返回 null（不靠数组序乱选）", () => {
    expect(selectTaskMapping([happy], "kie", "text_to_video")).toBeNull();
  });
  it("禁用的不选；空桶返回 null", () => {
    expect(selectTaskMapping([mp("off", { enabled: false })], "kie", "text_to_video")).toBeNull();
    expect(selectTaskMapping([], "kie", "text_to_video")).toBeNull();
  });
});

// 2026-11-26（样片模式）：桶里恰有一条不带方式的映射时，它服务所有没被带方式映射认领的方式（含不传方式）。
// 只有「一条不带方式 + 若干带方式」的混合桶结果会变；下面的普查钉住：今天内置、旧版、升级后的目录里，
// 混合桶只有样片行的文生桶（样片映射 + 出高清映射）。
describe("selectTaskMapping — 不带方式的那一条服务没被认领的方式", () => {
  const shared = mp("shared", { modelKey: "m" });
  const final = mp("final", { modelKey: "m", modeId: "sample-final" });
  const mixed = [shared, final];

  it("请求被认领的方式 → 那一条；没被认领的方式 / 不传方式 → 不带方式的那一条", () => {
    expect(selectTaskMapping(mixed, "kie", "text_to_video", "m", "sample-final")?.id).toBe("final");
    expect(selectTaskMapping(mixed, "kie", "text_to_video", "m", "t2v")?.id).toBe("shared");
    expect(selectTaskMapping(mixed, "kie", "text_to_video", "m")?.id).toBe("shared");
  });
  it("不带方式的有两条 → 没被认领的方式仍是歧义，返回 null", () => {
    const two = [...mixed, mp("shared-2", { modelKey: "m" })];
    expect(selectTaskMapping(two, "kie", "text_to_video", "m", "t2v")).toBeNull();
    expect(selectTaskMapping(two, "kie", "text_to_video", "m")).toBeNull();
  });
  it("只有带方式的映射 → 别的方式 / 不传方式都不借（老规则不变）", () => {
    const tagged = [final, mp("other", { modelKey: "m", modeId: "omni" })];
    expect(selectTaskMapping(tagged, "kie", "text_to_video", "m", "t2v")).toBeNull();
    expect(selectTaskMapping(tagged, "kie", "text_to_video", "m")).toBeNull();
    expect(selectTaskMapping([final], "kie", "text_to_video", "m", "t2v")).toBeNull();
  });
});

describe("混合桶普查：一条不带方式 + 若干带方式", () => {
  function mixedBuckets(state: CatalogState): string[] {
    const buckets = new Map<string, Mapping[]>();
    for (const row of state.mappings) {
      if (!row.enabled) continue;
      const key = `${row.vendorKey}|${row.taskKind}|${(row.modelKey || "").trim()}`;
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return [...buckets]
      .filter(([, rows]) => rows.some((r) => !(r.modeId || "").trim()) && rows.some((r) => (r.modeId || "").trim()))
      .map(([key]) => key)
      .sort();
  }
  const SAMPLE_BUCKET = "apimart|text_to_video|doubao-seedance-2.5-sample";
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  const fixtureRoot = new URL("../../tests/fixtures/old-user-data/", import.meta.url);
  const readCatalog = (dir: string) => JSON.parse(fs.readFileSync(new URL(`${dir}/model-catalog.json`, fixtureRoot), "utf8")) as CatalogState;
  const OLD = ["curated/v0.24.1-apimart", ...fs.readdirSync(new URL("catalogs/", fixtureRoot)).map((dir) => `catalogs/${dir}`)];

  it("内置目录：只有样片行的文生桶", () => {
    expect(mixedBuckets(applyBuiltinSeeds(empty, "2026-11-26").state)).toEqual([SAMPLE_BUCKET]);
  });
  it.each(OLD)("旧版目录 %s：原样 0 个；升级后只多样片行那一个", (dir) => {
    const original = readCatalog(dir);
    expect(mixedBuckets(original)).toEqual([]);
    const upgraded = mixedBuckets(applyBuiltinSeeds(structuredClone(original), "2026-11-26").state);
    expect(upgraded.filter((key) => key !== SAMPLE_BUCKET)).toEqual([]);
  });
});
