import { describe, expect, it } from "vitest";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { hostRootJoin, joinUrl } from "../ai/requestPipeline";
import type { CatalogState, HttpOperation } from "./types";

// ---------------------------------------------------------------------------
// **内置种子发出去的每一条 URL** 都必须落在正确位置。
//
// 病史（2026-08-26，真 key 实发抓到）：把火山种子 vendor 的 baseUrl 从裸 host 改成官方口径
// `https://ark.cn-beijing.volces.com/api/v3` 后，种子 mapping 的 create op 没声明
// `pathFrom:"host-root"` → 走 joinUrl 而不是 hostRootJoin → 拼出
// `https://ark…/api/v3/api/v3/images/generations`，**新装用户 Seedream/Seedance 全线 404**。
//
// 为什么之前的矩阵没接住：nativeWireHostRoot.test.ts 测的是**向导路径**的 nativeWireProfiles
// （那些 op 由 nativeWireProfiles 统一盖上 pathFrom），测不到**种子路径**的 mapping。
// 两条路发的是同一批端点、却由两套代码组装 —— 只测其中一条，另一条就是盲区。这里补上盲区。
//
// 判据是 derive 的：拿种子 vendor 自己的 baseUrlHint 和种子 mapping 自己的 op，按**生产同一套**
// 拼接规则算出 URL，再看路径段里有没有重复的连续子序列（/api/v3/api/v3、/v1/v1 都算）。
// ---------------------------------------------------------------------------

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-08-26T00:00:00.000Z").state;
}

/** 生产拼接规则的单一入口（与 requestPipeline.buildHttpRequest 同判据）。 */
function resolveUrl(baseUrl: string, op: HttpOperation): string {
  return op.pathFrom === "host-root" ? hostRootJoin(baseUrl, op.path ?? "") : joinUrl(baseUrl, op.path ?? "");
}

/**
 * 路径里是否出现**重复的连续段序列**（长度 1..n 都查）。
 * 注意不能只查「相邻两段相同」——`/api/v3/api/v3` 里没有任何相邻两段相同，
 * 正是这个弱判据让上面那个 bug 溜过了一轮。
 */
function repeatedSegmentRun(url: string): string | null {
  const segs = url.replace(/^https?:\/\/[^/]+/i, "").split("/").filter(Boolean);
  for (let len = 1; len <= Math.floor(segs.length / 2); len += 1) {
    for (let i = 0; i + 2 * len <= segs.length; i += 1) {
      const a = segs.slice(i, i + len).join("/");
      const b = segs.slice(i + len, i + 2 * len).join("/");
      if (a === b) return `/${a}/${b}`;
    }
  }
  return null;
}

describe("内置种子 mapping 的最终 URL", () => {
  const state = seededState();
  const baseUrlByVendor = new Map(state.vendors.map((v) => [v.key, String(v.baseUrlHint || "")]));

  it("有种子 mapping 可测", () => {
    expect(state.mappings.length).toBeGreaterThan(0);
  });

  it("没有任何一条种子 URL 出现重复段序列（/api/v3/api/v3 一族）", () => {
    const violations: string[] = [];
    for (const mapping of state.mappings) {
      const baseUrl = baseUrlByVendor.get(mapping.vendorKey) ?? "";
      // 本地/进程型 vendor（local://codex、ComfyUI 等）不走 http 拼接，跳过。
      if (!/^https?:\/\//i.test(baseUrl)) continue;
      for (const [what, op] of [["create", mapping.create], ["query", mapping.query], ["result", mapping.result]] as const) {
        if (!op?.path || /^https?:\/\//i.test(op.path)) continue;
        const url = resolveUrl(baseUrl, op);
        const repeat = repeatedSegmentRun(url);
        if (repeat) violations.push(`${mapping.vendorKey}/${mapping.id}.${what}: ${url}（重复段 ${repeat}）`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("路径自带厂商原生命名空间（非 /v1）的 op 必须声明 pathFrom:host-root", () => {
    // 判据：op.path 的首段与该 vendor baseUrl 的**任一**路径段相同 → 说明两者处在同一命名空间，
    // 必须靠 hostRootJoin 折叠，否则必然重复。这条把「加了新种子却忘了 pathFrom」当场拦下。
    const violations: string[] = [];
    for (const mapping of state.mappings) {
      const baseUrl = baseUrlByVendor.get(mapping.vendorKey) ?? "";
      if (!/^https?:\/\//i.test(baseUrl)) continue;
      const baseSegs = new Set(new URL(baseUrl).pathname.split("/").filter(Boolean));
      for (const [what, op] of [["create", mapping.create], ["query", mapping.query], ["result", mapping.result]] as const) {
        if (!op?.path || /^https?:\/\//i.test(op.path)) continue;
        const head = op.path.split("/").filter(Boolean)[0];
        if (head && baseSegs.has(head) && op.pathFrom !== "host-root") {
          violations.push(`${mapping.vendorKey}/${mapping.id}.${what}: path 以 /${head} 开头而 baseUrl 也含该段，却没声明 pathFrom:"host-root"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("火山种子的图片/视频端点精确落位（这条是上面那个 404 的直接回归）", () => {
    const baseUrl = baseUrlByVendor.get("volcengine")!;
    const byId = new Map(state.mappings.filter((m) => m.vendorKey === "volcengine").map((m) => [m.id, m]));
    expect(resolveUrl(baseUrl, byId.get("seed-volcengine-seedream-5-image_edit")!.create)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    );
    expect(resolveUrl(baseUrl, byId.get("seed-volcengine-seedance-2-5-text_to_video")!.create)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
    );
    // 老装机的 vendor 行仍是裸 host（seedVendor 存在即跳过）→ 同一批 op 也必须在裸 host 下正确。
    expect(resolveUrl("https://ark.cn-beijing.volces.com", byId.get("seed-volcengine-seedream-5-image_edit")!.create)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    );
  });
});
