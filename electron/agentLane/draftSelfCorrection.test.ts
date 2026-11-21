// 自纠闭环：Agent 起草被拒之后，**只凭工具结果**能当场改对再交，最后真的出付费卡。
//
// 2026-10-18 真付费第二次失败：大脑写了 `parameters.variant: "fast"`，起草校验正确地拒了，可工具结果的 Next 是
// 所有失败通用的那句「Read the current project state … Do not repeat an unknown paid submission」——
// Agent 照着停下，面板出一张「这一步没做成」。上一轮验收只核了「拒绝是结构化的」，没核「Agent 收到拒绝后改得对」。
//
// 这里的「模型」是一个脚本：每一回合只读上一回合**工具结果的文本**（和真模型同样看得到的那一份：message + Next），
// 照里面的话改草稿再交。文本里没有指路，它就停下（和真 Agent 一样）。链路是真的：lane 工具 → 传输适配器 → 起草准入 →
// 草稿落库 → 落到画布 → 摆出付费卡（真 durable Run、真落地宿主、真卡投影）。零额度。
import { afterEach, describe, expect, it } from "vitest";

import { createExtendedLaneTools } from "./laneExtendedTools";
import { verbToTransportCall } from "./laneVerbTransport";
import { renderLaneToolFailure } from "../shared/agentLane/laneToolContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { buildVideoModelCandidates } from "../shared/videoCapabilities";
import { PROJECT_ID, advanceClock, lease, resetSpendFixture, spendWorld } from "../capabilityCore/agentPanelSpendConfirmTestUtils";

afterEach(resetSpendFixture);

const anyParam = { type: "any" } as const;
const SCHEMA = { duration: { type: "number" }, size: anyParam, resolution: anyParam, generate_audio: anyParam, seed: anyParam } as const;
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0",
  inputKinds: ["text", "image", "video"], outputKinds: ["video"],
  modes: ["text_to_video", "image_to_video"],
  parameterSchema: SCHEMA,
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "doubao-seedance-2.0", modes: ["text_to_video", "image_to_video"], parameterSchema: SCHEMA,
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } }] }],
}]);
const videoModelCandidates = buildVideoModelCandidates([
  { provider: "apimart", modelKey: "doubao-seedance-2.0", label: "Seedance 2.0" },
  { provider: "apimart", modelKey: "doubao-seedance-2.0-fast", label: "Seedance 2.0 Fast" },
  { provider: "apimart", modelKey: "doubao-seedance-2.0-mini", label: "Seedance 2.0 Mini" },
]);

/** 这条消息带上来的可用模型清单：`draft_shots` 的完整名字在这里查。 */
const LANE_MODELS = [{ vendor: "apimart", modelId: "doubao-seedance-2.0", modelAlias: null }];

type Shot = Record<string, unknown> & { parameters?: Record<string, unknown> };
const goodShot = (): Shot => ({
  title: "纸船", prompt: "一只纸船在雨后的水洼里慢慢漂，清晨的光", taskKind: "text_to_video",
  model: "doubao-seedance-2.0@apimart",
  parameters: { duration: 4, resolution: "480p", generate_audio: false },
});

/**
 * 脚本化的模型：**只读失败文本**。每一条规则都对应「文本里确实写了怎么改」——没写就返回 undefined（= 模型停下）。
 */
function reviseFromFailureText(text: string, shot: Shot): Shot | undefined {
  // 结果里写着「别重复提交」：真 Agent 就停在这里（2026-10-18 第二次真走查）。
  if (text.includes("Do not repeat")) return undefined;
  const next: Shot = { ...shot, parameters: { ...(shot.parameters ?? {}) } };
  const params = next.parameters!;
  let changed = false;
  // ① 放错位置的字段：「X 不是这个模型的参数，是起草（draft）的顶层字段：请放到 draft 的 F 字段」
  const misplaced = /不接受参数 (\w+)。.*?请放到 draft 的 (\w+) 字段/.exec(text);
  if (misplaced) {
    const [, key, field] = misplaced;
    const written = String(params[key]);
    delete params[key];
    if (field === "variantId") {
      const listed = /该模型的变体：([^。]+)。/.exec(text)?.[1]?.split("、") ?? [];
      next.variantId = listed.includes(written) ? written : listed[0];
    } else next[field] = written;
    changed = true;
  } else {
    // ② 多出来的未知键：删掉
    const unknown = /不接受参数 (\w+)。/.exec(text);
    if (unknown) { delete params[unknown[1]]; changed = true; }
  }
  // ③ 类型不对：「参数 parameters.K 的类型不对：… 要 number」
  const mismatch = /参数 parameters\.(\w+) 的类型不对：\S+ 要 (number|integer|boolean)/.exec(text);
  if (mismatch) {
    const [, key, expected] = mismatch;
    const value = params[key];
    if (expected === "boolean") params[key] = value === true || value === "true";
    else params[key] = Number(value);
    changed = true;
  }
  // ④ 变体写错：「变体 X 不属于 …。该模型的变体：a、b」
  const badVariant = /变体 \S+ 不属于 [^。]+。该模型的变体：([^。]+)。/.exec(text);
  if (badVariant) {
    next.variantId = badVariant[1]!.split("、")[0];
    changed = true;
  }
  return changed ? next : undefined;
}

async function runAgentTurns(first: Shot, expectOutcome: "card" | "stopped") {
  const world = spendWorld({ registry, videoModelCandidates });
  const adapter = world.transport("request");
  const tools = createExtendedLaneTools({
    execute: async (call, signal) => adapter.tryExecute(verbToTransportCall(call, LANE_MODELS)!.call, signal) as never,
  });
  const draftTool = tools.find((tool) => tool.name === "draft_shots")!;
  const signal = new AbortController().signal;
  const rejections: string[] = [];
  let shot = first;
  let operationId: string | undefined;
  for (let turn = 1; turn <= 4; turn += 1) {
    const result = await draftTool.execute(draftTool.schema.parse({ shots: [shot] }), { toolCallId: `turn-${turn}`, signal }) as
      { ok: boolean; text?: string; failure?: Parameters<typeof renderLaneToolFailure>[0] };
    if (result.ok) { operationId = /"operationId":"([^"]+)"/.exec(String(result.text))?.[1]; break; }
    const seen = renderLaneToolFailure(result.failure!);
    rejections.push(seen);
    const revised = reviseFromFailureText(seen, shot);
    if (!revised) break;
    shot = revised;
  }
  if (expectOutcome === "stopped") return { rejections, card: false, operationId };
  expect(operationId, `草稿没交成。看到的拒绝：\n${rejections.join("\n---\n")}`).toBeTruthy();
  // 最后一步：把草稿摆到用户面前 → 出付费卡。
  await world.handler({ capability: "present", params: { operationId }, lease });
  advanceClock(1000);
  return { rejections, card: world.card.listPendingSpend(PROJECT_ID).length === 1, operationId };
}

describe("起草被拒 → Agent 只凭工具结果当场改对再交 → 出付费卡", () => {
  const faults: Array<[string, (shot: Shot) => Shot, RegExp]> = [
    ["参数里塞 variant（真走查那一份）", (shot) => ({ ...shot, parameters: { ...shot.parameters, variant: "fast" } }), /variantId/],
    // 规范数字串 "42" 自 2026-11-17 起先过值门、就是 42（见下面单独那一格）；还会被拒的是非规范写法。
    ["数字写成非规范的字符串", (shot) => ({ ...shot, parameters: { ...shot.parameters, seed: "42.0", resolution: "480p" } }), /类型不对/],
    ["多一个未知键", (shot) => ({ ...shot, parameters: { ...shot.parameters, motion_strength: 0.5 } }), /不接受参数 motion_strength/],
    ["variantId 写错", (shot) => ({ ...shot, variantId: "turbo" }), /变体 turbo 不属于/],
  ];

  for (const [name, break_, expected] of faults) {
    it(`毛病：${name}`, async () => {
      const { rejections, card } = await runAgentTurns(break_(goodShot()), "card");
      expect(rejections.length).toBeGreaterThanOrEqual(1);
      expect(rejections[0]).toMatch(expected);
      // 参数类拒绝发生在什么都没提交的时候：工具结果里绝不能有「别重复提交」那句（那句让 Agent 停在报错卡上）。
      for (const seen of rejections) {
        expect(seen).not.toContain("Do not repeat");
        expect(seen).toContain("Nothing was submitted and nothing was charged");
        expect(seen).toContain("call the same tool again");
      }
      expect(card, "最后要出付费卡").toBe(true);
    });
  }

  it("毛病：写 null（模型的坏习惯）——起草直接放行，不需要自纠，付费卡照出", async () => {
    const { rejections, card } = await runAgentTurns({ ...goodShot(), parameters: { ...goodShot().parameters, seed: null } }, "card");
    expect(rejections).toEqual([]);
    expect(card).toBe(true);
  });

  it("规范数字串 \"42\"（要数字的参数）：先过值门就是 42，起草直接放行，付费卡照出（2026-11-17 取代「不放宽类型」）", async () => {
    const { rejections, card } = await runAgentTurns({ ...goodShot(), parameters: { ...goodShot().parameters, seed: "42" } }, "card");
    expect(rejections).toEqual([]);
    expect(card).toBe(true);
  });

  it("variant 这一条还把该模型真实的变体词列出来（取自目录档案），并且点名 variantId 字段", async () => {
    const { rejections } = await runAgentTurns({ ...goodShot(), parameters: { ...goodShot().parameters, variant: "fast" } }, "card");
    expect(rejections[0]).toContain("放到 draft 的 variantId 字段");
    expect(rejections[0]).toMatch(/该模型的变体：[^。]*fast/);
  });

  it("阴性对照：脚本读不懂的拒绝（这里是时长超范围，脚本没有对应规则）它就停下——证明上面的绿靠的是工具结果里写的话，不是脚本直接知道答案", async () => {
    const { card, operationId } = await runAgentTurns({ ...goodShot(), parameters: { ...goodShot().parameters, duration: 9999 } }, "stopped");
    expect(operationId).toBeUndefined();
    expect(card).toBe(false);
  });
});
