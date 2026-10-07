#!/usr/bin/env tsx
// 门岗：**UI 承诺发得出的参考槽，出站报文里必须真有它**。
//
// 病史（2026-09-08 实测）：模型档案（供应商无关）声明「这个模式有一个输入图槽，键叫 X」，各家渠道的
// create body 却按**自己的字段名**读参数。两侧各自自洽、各自的测试都绿，只有把两侧对起来才看得见
// 那条线断了。实测样本：`fal/openai/gpt-image-2[i2i]` 档案声明 `input_urls`（KIE/APIMart 的契约名，
// electron/shared/modelArchetypes/gptImage2.ts），fal 的 body 却读 `{{request.params.image_urls}}`
// —— 用户连上的参考图一张也进不了报文，第三闸只好拒发，于是「GPT Image 2 参考图失败」。
//
// 为什么既有门岗拦不住：`check:orphan-cables` 查的是「modeId 拼写 / 路由错桶」，即**线缆选不选得中**；
// 本门岗查的是选中之后「**槽里的东西上不上得了车**」。前者对了后者仍可能断。
//
// ── 判据（种一张合成 URL，渲染真实 body，看它在不在）─────────────────────────────
// 对 seed 后内置目录里每条带 (modelKey, modeId) 的 mapping，取档案的该模式，逐槽：
//   1. `modeSlotReach` 判该槽在这条渠道上的承载力。`none` = UI 已经把它收窄掉了（诚实，
//      是**真实能力上限**而非缺陷，例如 runway veo3.1 的尾帧、grok 的单图）→ **不在合同内**；
//   2. `single` / `full` = UI 对用户承诺「这个槽发得出去」→ **必须兑现**：往该槽种一张合成 URL，
//      走生产同一批函数投影 + 渲染，断言这张 URL 出现在渲染后的 body 里。
//
// **一次只种一个槽**：单图聚合位（image_url/imageUrl/image）只有一个名额，同时种多个槽会让
// 首帧抢走参考图的名额，把好端端的通道判成违约（初版就是这么假红的：grok/hailuo3 各误报一条）。
//
// 判据全部复用**生产同一批函数**（buildArchetypeInputParams / taskTemplateParams /
// renderTemplateValue / modeSlotReach），绝不另写一把尺子——门岗用一把尺子、UI 用另一把，
// 正是它本该拦住的那种病。
//
// 认不出档案的模型（resolveArchetypeForModel → null）不算违规：通用回退形状不做模式收窄，
// 没有「档案承诺」可违。无 create.body 的 op（multipart：参考走 imageSource 不走 body）同样跳过——
// 它们由 multipartOperation 的自有测试守（本门岗只管模板 body 这一面，不假装管得了它管不到的）。
//
// 硬零（不是棘轮）：2026-09-08 全目录实测存量违规 = 1 条，修完即 0；没有历史包袱要豁免。
// R17：改判据前先验它会红（把 falOfficial.ts 那一 token 改回 `p("image_urls")` → 必须报出那一条）。
import { applyBuiltinSeeds } from "../electron/catalog/seedBuiltins";
import type { CatalogState } from "../electron/catalog/types";
import { resolveArchetypeForModel } from "../electron/shared/modelArchetypes";
import { buildArchetypeInputParams } from "../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { taskTemplateParams } from "../electron/catalog/taskParams";
import { renderTemplateValue } from "../electron/ai/requestPipeline";
import { modeSlotReach } from "../electron/catalog/referenceReachability";

/** 合成参考 URL：只用于种槽，永不出网。 */
const PLANTED = "https://nomi-reference-contract.invalid/planted.png";

export type ContractBreach = {
  vendorKey: string;
  modelKey: string;
  modeId: string;
  archetypeId: string;
  slotKind: string;
  /** 档案给这个槽声明的 API 输入键。 */
  inputKey: string;
  /** UI 对用户的承诺（single = 至多 1 张，full = 整组）。 */
  reach: string;
};

/** 往**单个**槽种参考所需的解析结果形状（其余族留空，隔离单图聚合位的抢占）。 */
function seedForSlotKind(kind: string): Record<string, unknown> | null {
  if (kind === "first_frame") return { firstFrameUrl: PLANTED };
  if (kind === "last_frame") return { lastFrameUrl: PLANTED };
  if (kind === "image_ref") return { referenceImages: [PLANTED] };
  if (kind === "video_ref" || kind === "source_video") return { referenceVideos: [PLANTED] };
  if (kind === "audio_ref") return { referenceAudios: [PLANTED] };
  return null;
}

export function findOutboundContractBreaches(state: CatalogState): { breaches: ContractBreach[]; scanned: number; slotsChecked: number } {
  const breaches: ContractBreach[] = [];
  let scanned = 0;
  let slotsChecked = 0;

  for (const mapping of state.mappings) {
    if (!mapping.enabled) continue;
    const modelKey = (mapping.modelKey || "").trim();
    const modeId = (mapping.modeId || "").trim();
    if (!modelKey || !modeId) continue;

    const inVendor = state.models.filter((m) => m.vendorKey === mapping.vendorKey && m.enabled);
    const model = inVendor.find((m) => m.modelKey === modelKey) ?? inVendor.find((m) => m.modelAlias === modelKey);
    if (!model) continue;

    const archetype = resolveArchetypeForModel(model);
    if (!archetype) continue; // 通用回退形状：无档案承诺。

    const mode = archetype.modes.find((m) => m.id === modeId);
    if (!mode || mode.slots.length === 0) continue;

    const body = (mapping as { create?: { body?: unknown } }).create?.body;
    if (typeof body === "undefined") continue; // multipart / 进程 op：参考不走 body，由各自测试守。

    scanned++;
    const reach = modeSlotReach(mode.slots, body, mode.combineSlotsInto?.key);
    const meta = { archetype: { id: archetype.id, modeId } };

    mode.slots.forEach((slot, index) => {
      if (reach[index] === "none") return; // UI 已收窄 = 诚实的能力上限，不在合同内。
      const seed = seedForSlotKind(slot.kind);
      if (!seed) return;
      slotsChecked++;

      const projected = buildArchetypeInputParams(meta as Record<string, unknown>, archetype, seed as never);
      const extras: Record<string, unknown> = {
        ...seed,
        referenceImages: (seed.referenceImages as string[] | undefined) ?? [],
        archetypeInput: projected,
      };
      const params = taskTemplateParams(
        { prompt: "reference-contract-probe", extras, model: modelKey } as never,
        { vendorKey: mapping.vendorKey, modelKey },
      );
      const wire = JSON.stringify(
        renderTemplateValue(body, { request: { prompt: "reference-contract-probe", params } } as never),
      );
      if (wire.includes(PLANTED)) return;

      breaches.push({
        vendorKey: mapping.vendorKey,
        modelKey,
        modeId,
        archetypeId: archetype.id,
        slotKind: slot.kind,
        inputKey: (slot.inputKey || "(档案缺省键)").trim(),
        reach: reach[index],
      });
    });
  }
  return { breaches, scanned, slotsChecked };
}

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-09-08T00:00:00.000Z").state;
}

function main(): void {
  const state = seededState();
  if (state.mappings.length === 0) {
    console.error("✗ 参考图出站合同门岗：seed 后一条 mapping 都没有 —— seed 入口大概率变了，不许静默放行。");
    process.exit(1);
  }
  const { breaches, scanned, slotsChecked } = findOutboundContractBreaches(state);
  console.log(`scanned=${scanned}`);
  console.log(`参考图出站合同：${scanned} 条 (model × mode) 带参考槽，逐槽验 ${slotsChecked} 个「UI 承诺发得出」的槽。`);

  if (slotsChecked === 0) {
    console.error("✗ 一个槽都没验到 —— 档案投影或 seed 形状大概率变了，不许静默放行。");
    process.exit(1);
  }
  if (breaches.length === 0) {
    console.log("✓ 参考图出站合同门岗：每个 UI 承诺发得出的参考槽，出站报文里都真有它。");
    return;
  }
  for (const b of breaches) {
    console.error(
      `✗ ${b.vendorKey}/${b.modelKey} [${b.modeId}] 的 ${b.slotKind} 槽（档案 ${b.archetypeId} 声明键 ${b.inputKey}，UI 承诺 reach=${b.reach}）` +
        `—— 种进去的参考图没有出现在渲染后的 create body 里。`,
    );
  }
  console.error("");
  console.error("用户会连上这个槽、点生成，然后要么被第三闸拒发（「发不出：参考图」），要么白扣费。修法：");
  console.error("  • 多数情况是**键名对不上**：body 的 wire 字段名保持这家自己的叫法，但值的 token 换成档案声明的那个键");
  console.error("    （例：fal 的 `image_urls: \"{{request.params.input_urls}}\"`）；");
  console.error("  • 若这家确实发不出这个槽，就别在档案里对用户承诺它 —— 让 modeSlotReach 判成 none，UI 会如实收窄。");
  process.exit(1);
}

// 直接执行才跑主流程；被单测 import 时只取纯函数。
if (process.argv[1] && process.argv[1].endsWith("check-reference-outbound-contract.ts")) main();
