#!/usr/bin/env tsx
// 门岗：禁止「孤儿线缆」—— 目录里存在一条为某模式配好的 mapping，档案侧却永远选不中它。
//
// 病史（2026-09-03 实测）：生成画布的模式栏按可达性收窄，判据是
// `archetypeModeIsVisible`（src/workbench/generationCanvas/nodes/controls/channelModeReach.ts）——
// 「桶已知却查不到这个模式自己的 mapping」= 这家发不出这个模式 = 藏掉。收窄本身是对的，
// 但它有一个前提：**档案说的桶，和 seed 把 mapping 放进去的桶，是同一个桶**。
// 这个前提一旦破，收窄就变成**假收窄**：mapping 明明存在、body 也配得好好的，却因为
//   ① 档案把该模式路由到了另一个 taskKind 桶（`modeTransportFor` 与 `mapping.taskKind` 不咬合），或
//   ② mapping 的 `modeId` 与档案 `mode.id` 拼写不一致，
// 而永远 `selectTaskMapping` 取不到 → 线缆闲置、模式被静默藏掉、用户看不到一个真能用的功能。
// 实测样本：runway 的 hailuo3/ref、seedance2*/omni、wan3/ref（Runway 的 reference union 声明在
// text 端点，见 electron/catalog/runwayOfficial.ts 的注释；seed 是对的，档案没跟上），
// 以及 fal 的 gpt-image-2 把 modeId 写成 "edit"（档案 mode.id 是 "i2i"）。
//
// 为什么这类缺陷本地看不出来：两侧**各自都自洽**。档案单看没问题、seed 单看也没问题、
// 每一侧的既有测试都绿；只有把两侧**对起来**才看得见那条线缆连不上。这正是本仓反复在修的
// 「同一事实两条路径、只守住一条」族——所以判据必须是**跨两侧**的对账，不能是任一侧的自查。
//
// ── 判据（读运行时真值，不做正则猜测）─────────────────────────────────────
// 对 seed 后的内置目录里每条 mapping：若它带 `modelKey` 且带非空 `modeId`，
// 找到该 (vendorKey, modelKey) 的模型行 → `resolveArchetypeForModel` 取档案，则
//   • 孤儿拼写：`modeId` 在 `archetype.modes` 里找不到同名 mode → 这条线缆永远选不中；
//   • 孤儿错桶：找得到 mode，但 `modeTransportFor(mode, archetype, vendorKey) !== mapping.taskKind`
//     → 档案把这个模式路由去了别的桶，selectTaskMapping 在那个桶里找不到本条。
// 两者都用**生产同一批函数**（resolveArchetypeForModel / modeTransportFor），不另写一份判断：
// 门岗用一把尺子、UI 用另一把，就是它本该拦住的那种病。
//
// 认不出档案的模型（resolveArchetypeForModel → null）**不算违规**：那是「通用回退」形状，
// 渲染层按接入文档原样展示、不做模式收窄，没有线缆闲置问题。
//
// 硬零（不是棘轮）：2026-09-03 全目录实测存量违规 = 6 条，与本轮修复的 4 族完全重合，
// 修完即 0；没有需要豁免的历史包袱，所以不给基线文件——一条都不许有。
//
// R17：改判据前先验它会红（把任一条修复回退 → 本门岗必须报出那一条）。
import { applyBuiltinSeeds } from "../electron/catalog/seedBuiltins";
import type { CatalogState } from "../electron/catalog/types";
import { resolveArchetypeForModel } from "../src/config/modelArchetypes";
import { modeTransportFor } from "../electron/shared/videoCapabilities";

type Orphan = {
  kind: "spelling" | "bucket";
  vendorKey: string;
  modelKey: string;
  modeId: string;
  mappingTaskKind: string;
  archetypeId: string;
  /** 错桶族：档案把该模式路由到的桶。拼写族：档案实际有哪些 mode。 */
  detail: string;
};

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-09-03T00:00:00.000Z").state;
}

export function findOrphanMappingCables(state: CatalogState): Orphan[] {
  const orphans: Orphan[] = [];
  for (const mapping of state.mappings) {
    if (!mapping.enabled) continue;
    const modelKey = (mapping.modelKey || "").trim();
    const modeId = (mapping.modeId || "").trim();
    if (!modelKey || !modeId) continue; // generic / mode-less 线缆不在本判据范围。

    // 该 (vendor, modelKey) 的目录行。精确 key 优先于 alias，与 selectModel 同口径。
    const inVendor = state.models.filter((m) => m.vendorKey === mapping.vendorKey && m.enabled);
    const model = inVendor.find((m) => m.modelKey === modelKey) ?? inVendor.find((m) => m.modelAlias === modelKey);
    if (!model) continue; // 没有目录行 = 另一类问题（孤儿 mapping 无模型），不在本门岗范围。

    const archetype = resolveArchetypeForModel(model);
    if (!archetype) continue; // 通用回退形状：不做模式收窄，无闲置线缆问题。

    const mode = archetype.modes.find((m) => m.id === modeId);
    if (!mode) {
      orphans.push({
        kind: "spelling",
        vendorKey: mapping.vendorKey,
        modelKey,
        modeId,
        mappingTaskKind: mapping.taskKind,
        archetypeId: archetype.id,
        detail: `档案 modes = [${archetype.modes.map((m) => m.id).join(", ")}]`,
      });
      continue;
    }
    const routed = modeTransportFor(mode, archetype, mapping.vendorKey);
    if (routed !== mapping.taskKind) {
      orphans.push({
        kind: "bucket",
        vendorKey: mapping.vendorKey,
        modelKey,
        modeId,
        mappingTaskKind: mapping.taskKind,
        archetypeId: archetype.id,
        detail: `档案路由 ${routed}`,
      });
    }
  }
  return orphans;
}

function main(): void {
  const state = seededState();
  if (state.mappings.length === 0) {
    console.error("✗ 孤儿线缆门岗：seed 后一条 mapping 都没有 —— seed 入口大概率变了，不许静默放行。");
    process.exit(1);
  }
  const orphans = findOrphanMappingCables(state);
  const spelling = orphans.filter((o) => o.kind === "spelling");
  const bucket = orphans.filter((o) => o.kind === "bucket");

  const scanned = state.mappings.filter((m) => m.enabled && (m.modelKey || "").trim() && (m.modeId || "").trim()).length;
  console.log(`孤儿线缆扫描：${state.mappings.length} 条 mapping，其中 ${scanned} 条带 (modelKey, modeId) 进入判据。`);
  console.log(`孤儿拼写 ${spelling.length} 条 / 孤儿错桶 ${bucket.length} 条。`);

  if (orphans.length === 0) {
    console.log("✓ 孤儿线缆门岗：没有配好却永远选不中的 mapping。");
    return;
  }

  for (const o of spelling) {
    console.error(
      `✗ 孤儿拼写 ${o.vendorKey}/${o.modelKey} [${o.modeId}] 桶 ${o.mappingTaskKind} — 档案 ${o.archetypeId} 里没有这个 mode；${o.detail}`,
    );
  }
  for (const o of bucket) {
    console.error(
      `✗ 孤儿错桶 ${o.vendorKey}/${o.modelKey} [${o.modeId}] 期望桶 ${o.detail} vs 实际桶 ${o.mappingTaskKind}（档案 ${o.archetypeId}）`,
    );
  }
  console.error("");
  console.error("这些 mapping 配好了却永远选不中：selectTaskMapping 在档案路由到的桶里找不到它们，");
  console.error("于是模式栏把这些模式静默藏掉（archetypeModeIsVisible 判据 a）。修法二选一：");
  console.error("  • 错桶族：在档案对应模式上加 vendorTransportTaskKind: { <vendor>: \"<桶>\" }（若 seed 侧是对的）；");
  console.error("  • 拼写族：把 mapping 的 modeId 改成档案里那个 mode.id。");
  process.exit(1);
}

// 直接执行才跑主流程；被单测 import 时只取纯函数。
if (process.argv[1] && process.argv[1].endsWith("check-orphan-mapping-cables.ts")) main();
