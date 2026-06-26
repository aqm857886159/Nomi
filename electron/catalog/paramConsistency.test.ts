// 参数一致性不变量（铁律的机器看门狗）。
// 见 docs/plan/2026-06-24-model-param-consistency-invariant.md。
//
// 把从前全靠人肉 + 注释的「档案 canonical 参数 ↔ codec wire 字段」对齐变成 CI 断言：
//   对每个内置 (模型 × 模式 × 它实际命中的 codec)：
//     档案该模式的 canonical 参数键  ⊆  body 直接引用键 ∪ paramMap 消费键 ∪ paramMap.drops
//   否则该参数会被静默丢弃（值发不出去 / 发错字段 → vendor 报错），即错位。
//
// 另测通用 relay（new-api）op 覆盖**中性 canonical 维度**——这是用户自建中转（xcode-hk）那条路，
// 不在内置 mapping 里枚举，单独守。
import { describe, expect, it } from "vitest";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { selectTaskMapping } from "./types";
import { resolveArchetypeForModel } from "../../src/config/modelArchetypes";
import { applyParamMap, bodyReferencedParamKeys, consumedCanonicalKeys } from "./paramTranslate";
import { NEWAPI_IMAGE_CREATE_OP, NEWAPI_VIDEO_CREATE_OP } from "./newapiTransport";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import type { CatalogState } from "./types";

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-06-24T00:00:00.000Z").state;
}

function coveredWireKeys(create: { body?: unknown; process?: { args?: string[]; build?: string }; paramMap?: { drops?: string[] } | undefined } & Record<string, unknown>): Set<string> {
  const map = (create as { paramMap?: Parameters<typeof consumedCanonicalKeys>[0] }).paramMap;
  return new Set([
    ...bodyReferencedParamKeys(create.body),
    // 进程型 transport（即梦 dreamina）的参数在 CLI args 里读（{{request.params.X}}），同样算「真覆盖」
    // ——它们确实经 argv 发出去，不是静默丢弃。bodyReferencedParamKeys 能直接扫字符串数组。
    ...bodyReferencedParamKeys(create.process?.args),
    // 多帧（build="multiframe"）的 args 由 buildMultiframeArgs 按图数变形构建（非模板），它确实消费 duration
    // （2 图档发 --duration）——声明在此，让不变量认它是真覆盖而非静默丢弃。
    ...(create.process?.build === "multiframe" ? ["duration"] : []),
    ...consumedCanonicalKeys(map),
    ...(map?.drops ?? []),
  ]);
}

describe("参数一致性不变量：内置 (模型×模式) canonical 参数都被其 codec 覆盖", () => {
  it("无静默错位（档案声明的每个参数都被 codec 翻译或显式 drop）", () => {
    const state = seededState();
    const violations: string[] = [];

    for (const model of state.models) {
      const archetype = resolveArchetypeForModel({
        modelKey: model.modelKey,
        modelAlias: model.modelAlias,
        vendorKey: model.vendorKey,
        meta: model.meta,
      });
      if (!archetype) continue; // 文本/未识别模型不走档案
      // 音频档案（TTS/转写）的标量参数经 audioTaskRunner 的 archetypeInput 通道发送，不走标准 body 模板，
      // 故 body 令牌扫描不适用——由各音频 codec 自己的单测覆盖（doubaoTts.test 等）。
      if (archetype.kind === "audio") continue;

      for (const mode of archetype.modes) {
        const canonicalKeys = mode.params.map((p) => p.key);
        if (canonicalKeys.length === 0) continue;
        const taskKind = mode.transportTaskKind ?? archetype.transportTaskKind;
        const mapping = selectTaskMapping(state.mappings, model.vendorKey, taskKind, model.modelKey);
        if (!mapping) continue; // 该 (vendor, mode) 没内置 codec —— 另一类问题，本不变量不管

        const covered = coveredWireKeys(mapping.create);
        const missing = canonicalKeys.filter((k) => !covered.has(k));
        if (missing.length) {
          violations.push(`${model.vendorKey}/${model.modelKey} [${mode.id}] 未覆盖: ${missing.join(", ")} (codec 读: ${[...covered].join(", ") || "∅"})`);
        }
      }
    }

    expect(violations, `\n参数错位（canonical 参数被 codec 静默丢弃）:\n${violations.join("\n")}\n`).toEqual([]);
  });
});

describe("通用 relay（new-api）覆盖中性 canonical 维度（用户自建中转那条路）", () => {
  // 中性 canonical 维度：图像 = 比例 + 清晰度档位；视频 = 比例 + 清晰度 + 时长。
  // 通用 OpenAI 兼容 relay 必须能把它们翻译成自己的线缆字段（比例+档位→像素 size 等），否则
  // 用户自建中转上分辨率/比例发不出去 → 报错（gpt-image-2 × xcode-hk 的根因）。
  const NEUTRAL_IMAGE_DIMS = ["aspect_ratio", "resolution"];
  const NEUTRAL_VIDEO_DIMS = ["aspect_ratio", "resolution", "duration"];

  it("图像 op 覆盖比例 + 清晰度", () => {
    const covered = coveredWireKeys(NEWAPI_IMAGE_CREATE_OP);
    const missing = NEUTRAL_IMAGE_DIMS.filter((k) => !covered.has(k));
    expect(missing, `new-api 图像 op 未覆盖中性维度: ${missing.join(", ")}`).toEqual([]);
  });

  it("视频 op 覆盖比例 + 清晰度 + 时长", () => {
    const covered = coveredWireKeys(NEWAPI_VIDEO_CREATE_OP);
    const missing = NEUTRAL_VIDEO_DIMS.filter((k) => !covered.has(k));
    expect(missing, `new-api 视频 op 未覆盖中性维度: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("端到端：自建中转 gpt-image-2 比例+清晰度 → 真实请求 body 出正确 size（修用户报错）", () => {
  // 复刻 runtime 路径：applyParamMap(op.paramMap, params) → buildTemplateContext → buildHttpRequest。
  // 用户 code-newcli-com 的 op 就是 NEWAPI_IMAGE_CREATE_OP 形状（v4 迁移补上 paramMap 后）。
  function renderBody(neutralParams: Record<string, unknown>): Record<string, unknown> {
    const params = applyParamMap(NEWAPI_IMAGE_CREATE_OP.paramMap, neutralParams);
    const context = buildTemplateContext({ request: { prompt: "一只猫" }, params, model: {}, modelKey: "gpt-image-2", apiKey: "X" });
    const built = buildHttpRequest({ baseUrl: "https://relay.example", authType: "bearer", apiKey: "X", context, operation: NEWAPI_IMAGE_CREATE_OP });
    return built.body as Record<string, unknown>;
  }

  it("16:9 + 4K → size 3840x2160（4K 终于发得出去）", () => {
    expect(renderBody({ aspect_ratio: "16:9", resolution: "4K" }).size).toBe("3840x2160");
  });

  it("9:16 + 2K → 竖图像素 size", () => {
    expect(renderBody({ aspect_ratio: "9:16", resolution: "2K" }).size).toBe("1152x2048");
  });

  it("比例 auto → 不发 size（让中转默认），不再发空字符串报错", () => {
    const body = renderBody({ aspect_ratio: "auto", resolution: "1K" });
    expect(body.size).toBeUndefined();
  });
});
