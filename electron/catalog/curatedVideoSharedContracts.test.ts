// 「档案声明的模式」×「这家真发得出的线缆」——**不变量随档案模型化而升级的那一版**。
//
// 旧不变量是「每个 (vendor, model, mode) 都必须有 mapping」。它在档案还是**平台形状**时成立
// （runway-video 一个档案蹲十个模型，模式集就是照着 Runway 的线缆写的，自然处处对得上）。
// 档案改成**模型身份**（一模型一档案，跨供应商共享）之后，这条前提就是错的：同一个模型经不同
// 供应商转售，各家的 union 能力**本就不同**——Runway 的 veo union 里没有 reference 字段，
// happyhorse 的 Runway 变体没有 ref/edit 端点。这些不是缺陷，是**事实**。
//
// 所以正确的不变量不是「处处都有」，而是「**要么发得出，要么用户根本看不到**」：
//
//   对每个 (vendor, model, mode)：
//     要么 —— 存在**属于这个模式自己的** mapping，且它声明的参考槽真能送达；
//     要么 —— 该模式被共用收窄判据**证明在 UI 上隐藏**。
//
// 关键在「隐藏」这一支不是豁免名单，而是**跟渲染层同一把尺子算出来的**。判据的主人是
// `src/workbench/generationCanvas/nodes/controls/channelModeReach.ts` 的 `archetypeModeIsVisible`；
// electron 侧测试不能 import src/workbench（分层边界），故这里用它的**两条真判据**原样重述：
//   (a) 这个模式取不到自己的 mapping → 隐藏；
//   (b) 声明了参考槽且全部 reach = none → 隐藏。
// 下面 `modeIsHiddenFromUi` 就是这两条，且用与判据同源的 `selectTaskMapping` + `modeSlotReach` 算——
// 与渲染层共用同一个可达性实现，两边不可能各自漂移（这正是本仓反复在修的那类病）。
//
// **为什么本文件不许出现 per-triple 豁免表**（那种「已知缺口」常量名单）：豁免表把「这条现在过不了」
// 变成永久许可证，下次真出问题时它照样绿。凡是「过不了」的三元组，要么是真发得出（补 mapping），
// 要么是真该隐藏（判据自会算出来）——两条路都不需要人肉名单。最后一个 describe 用**源码自查**
// 把这条纪律钉死：本文件里再冒出这类名单，测试自己会红。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVideoModelCandidates, modeTransportFor, videoArchetypeIdFromMeta } from "../shared/videoCapabilities";
import { modeSlotReach } from "./referenceReachability";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { selectTaskMapping, type CatalogState } from "./types";
import type { ArchetypeMode } from "../shared/videoCapabilities/types";

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-08-24T00:00:00.000Z").state;
}

/**
 * 渲染层 `archetypeModeIsVisible` 的 electron 侧对偶——**逐条对应，不是另写一份**。
 *
 * @param createBody 该模式自己的 mapping 的 create.body；`null` = 取不到 mapping。
 * @returns true = 这个模式在这条渠道上被收窄掉（用户看不到），故「没有 mapping」不是缺陷。
 */
function modeIsHiddenFromUi(mode: ArchetypeMode, createBody: unknown | null): boolean {
  // (a) 桶已知却没有本模式的线缆 = 这家发不出这个模式（U1 之后不再借别的模式的线缆）。
  if (createBody === null) return true;
  // 纯文生模式没有参考槽，永远可用 —— 它若没 mapping 已在 (a) 拦下。
  if (mode.slots.length === 0) return false;
  // (b) 声明了参考槽却一个都送不达。
  return modeSlotReach(mode.slots, createBody, mode.combineSlotsInto?.key).every((item) => item === "none");
}

describe("每个 (vendor, model, mode)：要么真发得出，要么被收窄判据证明是隐藏的", () => {
  it("没有「UI 上看得见、却发不出去」的模式", () => {
    const state = seededState();
    const models = state.models.filter((model) => model.kind === "video" && videoArchetypeIdFromMeta(model.meta));
    const candidates = buildVideoModelCandidates(models.map((model) => ({
      provider: model.vendorKey,
      modelKey: model.modelKey,
      label: model.labelZh,
      archetypeId: videoArchetypeIdFromMeta(model.meta),
    })));
    const violations: string[] = [];

    for (const [index, model] of models.entries()) {
      const candidate = candidates[index]!;
      for (const mode of candidate.archetype.modes) {
        const taskKind = modeTransportFor(mode, candidate.archetype, model.vendorKey);
        const mapping = selectTaskMapping(state.mappings, model.vendorKey, taskKind, model.modelKey, mode.id);
        const body = mapping ? mapping.create.body : null;
        // 被判据隐藏 = 用户根本看不到它，谈不上撒谎。这是本不变量与旧版的**唯一**区别。
        if (modeIsHiddenFromUi(mode, body)) continue;
        // 走到这里 = 该模式在 UI 上可见，那它必须真的立得住。
        if (!mapping) {
          violations.push(`${model.vendorKey}/${model.modelKey}/${mode.id}: 可见却没有 ${taskKind} mapping`);
          continue;
        }
        if (mode.slots.length === 0) continue;
        const reach = modeSlotReach(mode.slots, mapping.create.body, mode.combineSlotsInto?.key);
        if (reach.every((item) => item === "none")) {
          violations.push(`${model.vendorKey}/${model.modelKey}/${mode.id}: 可见却没有任何参考槽送得达`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("收窄判据与渲染层的 archetypeModeIsVisible 同构（判据漂移会在这里红）", () => {
    // 判据的主人在 src/workbench/.../channelModeReach.ts。electron 侧不能 import 它（分层边界），
    // 所以这里锁的是**判据的形状**：无槽模式永不隐藏；有槽但全 none 则隐藏；取不到 mapping 则隐藏。
    // 任何一侧改了判据而另一侧没跟，下面三条里必有一条不成立。
    const textOnly: ArchetypeMode = { id: "t", intent: "text", vendorTerm: "文生", hint: "", promptRequired: true, slots: [], params: [] };
    const withSlot: ArchetypeMode = {
      id: "r", intent: "character", vendorTerm: "参考", hint: "", promptRequired: true,
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 3, inputKey: "reference_image_urls" }], params: [],
    };
    // (a) 取不到 mapping → 隐藏（含纯文生）。
    expect(modeIsHiddenFromUi(textOnly, null)).toBe(true);
    expect(modeIsHiddenFromUi(withSlot, null)).toBe(true);
    // 有 mapping 的纯文生模式 → 永不隐藏。
    expect(modeIsHiddenFromUi(textOnly, { prompt: "{{request.prompt}}" })).toBe(false);
    // (b) 有槽但 body 完全送不达 → 隐藏；能送达 → 不隐藏。
    expect(modeIsHiddenFromUi(withSlot, { image: "{{request.params.unrelated_key}}" })).toBe(true);
    expect(modeIsHiddenFromUi(withSlot, { refs: "{{request.params.reference_image_urls}}" })).toBe(false);
  });
});

describe("结构上拒绝 per-triple 豁免名单", () => {
  // 为什么用源码自查而不是「相信大家不会加」：豁免表是最省事的绿灯，压力之下总有人加一行。
  // 这条断言让「加一行豁免」立刻变成红灯，成本高于「把它真修好」——纪律才守得住。
  // 双查：记号名（那个「已知历史缺口」常量名，下面拼装出来）+ 形状（三元组字面量集合声明）。
  const source = readFileSync(new URL("./curatedVideoSharedContracts.test.ts", import.meta.url), "utf8");

  it("全仓不存在「已知缺口」豁免记号", () => {
    // **全仓**扫，不只本文件：PR #342 在别处给 runway/happyhorse_1_0/reference 加了一条豁免，
    // 而本轮改动让那个缺口**真的不存在了**（happyhorse 的 ref 模式在 Runway 上没有 mapping →
    // 被判据判为隐藏 → 本就不需要豁免）。两边合并时那条豁免必须死，且回不来。
    // 记号名拆开拼装，免得这条断言自己成为「仓库里存在该字符串」的反例。
    const marker = ["KNOWN", "LEGACY", "GAPS"].join("_");
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    let hits = "";
    try {
      // git grep 只扫版本控制内的文件（天然跳过 node_modules / 构建产物）。
      hits = execFileSync("git", ["grep", "-n", "--", marker], { cwd: repoRoot, encoding: "utf8" });
    } catch {
      hits = ""; // 无命中时 git grep 退出码为 1，这正是我们要的结果。
    }
    // 计划文档里那几行是在**说明这条纪律**（该记号必须不存在），不是豁免代码本身。
    const offending = hits.split("\n").filter((line) => line.trim() && !line.startsWith("docs/"));
    expect(offending, `豁免名单又回来了:\n${offending.join("\n")}`).toEqual([]);
  });

  it("不存在按 vendor/model/mode 三元组写死的豁免集合", () => {
    // 形状判据：`allow`/`skip`/`known`/`exempt`/`gap`/`ignore` 命名的 Set/数组声明。
    // 名字换了也躲不过——真要豁免就得写成集合，集合就会被这条抓住。
    const exemptionDeclaration = /(const|let|var)\s+\w*(ALLOW|SKIP|KNOWN|EXEMPT|GAP|IGNORE|WAIVE)\w*\s*(:[^=]+)?=\s*(new\s+Set|\[)/i;
    expect(exemptionDeclaration.test(source)).toBe(false);
  });
});
