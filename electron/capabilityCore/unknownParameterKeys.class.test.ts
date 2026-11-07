// 类级回归：模型写进 `parameters` 的、这个模型不认识的键，在**每一扇主进程写入门**当场被拒，
// 结果原样回给模型；什么都不落盘，供应商 0 次，读盘归一也没有机会把它「悄悄清掉」。
//
// 这条测试先钉住一个被实查证伪的猜测（设计卡 `docs/plan/2026-10-27-unknown-param-keys.md` §1）：
//   「起草 / 改草稿写入时不核参数键 → 模型新写的未知键在下一次读盘时被 normalizeStoredDraft 当失效参数悄悄清掉
//    → 卡上看不到那句 16:9 → 用户照默认比例付钱。」
// 实际上主进程的每一扇写入门——Agent 的 draft_shots（单镜 / 多镜 / 改草稿 / 改多镜里的某一镜）与对外 MCP 的
// create（一句话 / 显式候选 / shots）与 plan 改草稿（整份 / 某一镜）——落盘之前都经 `admitPlanCandidate`，
// 也就是确认时用的同一个 `compileParameters`。没有一扇是「写入不核」。
// 这里把「同一份写错的输入、每一扇门给出同一个结果」写成回归，免得哪天有人新开一扇不经准入的门。
//
// 走的是真链：模型面动词 schema → lane 翻译 → 生成传输适配器 → 规划 handler → 真 durable Run → 付费卡 →
// 交给画布 → 本机回环供应商（进程内替身，`vendor.executes` 记下它真正收到的每一份请求）。零额度。
//
// 已知缺口（设计卡 §1.3）有两处，都只留可执行的复现（`it.fails`），因为修它们要动的文件在方向检查里已命中（设计卡 §6）：
//   · 意图键：写入门放行并落盘，第一次读被读盘归一悄悄清掉（本文件末尾）；
//   · 文稿方案改一镜：渲染层拥有，主进程不碰（`src/workbench/creation/storyboard/unknownParameterKeys.docPlan.test.ts`）。
import { afterEach, describe, expect, it } from "vitest";

import { createExtendedLaneTools } from "../agentLane/laneExtendedTools";
import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { admissionNextActionEn } from "../shared/agentCapabilities/admissionRejectionHints";
import { GENERATION_METHODS } from "../shared/agentCapabilities/generation";
import type { RuntimeToolDecision } from "../shared/agentCapabilities/transportContracts";
import { writeVerbs } from "../shared/agentCapabilities/verbs/writeVerbs";
import { renderLaneToolFailure } from "../shared/agentLane/laneToolContract";
import {
  PROJECT_ID, VENDOR, callTool, lease, resetSpendFixture, settleMicrotasks, spendWorld, type SpendWorld,
} from "./agentPanelSpendConfirmTestUtils";
import { ContractCompilationError, compileExecutionContract } from "./executionContract";
import { buildToolErrorOutcome } from "./mcpToolErrorResults";
import { createModuleRegistry } from "./moduleRegistry";

afterEach(resetSpendFixture);

// ── 三类模型的参数表 ────────────────────────────────────────────────────────────
//   vid-model  声明了 aspect_ratio / duration / resolution
//   vid-lite   同一个视频模块里的第二个模型：只有 aspect_ratio / duration（换模型 → resolution 变成「上个模型的残留」）
//   bare-model 一个参数都没声明（用户自己接的中转那种）：判不了，只能原样带过并告警
//   img-model  真实键叫 `size`（模型最常猜成 aspect_ratio 的那一类）
const CAPABILITIES = { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } as const;
const VIDEO_SCHEMA = {
  duration: { type: "number" },
  aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
  resolution: { type: "string", enum: ["480p", "720p"] },
} as const;
const IMAGE_SCHEMA = { size: { type: "string", enum: ["1024x1024", "1536x1024"] } } as const;
// 模块层的 parameterSchema 故意留空：注册表会把「模块层 + 模型层」并起来当这个模型的表，模块层写了的键
// 同一模块里的每个模型都有——那样「换模型 → 旧参数失效」就造不出来了。
const registry = createModuleRegistry([
  {
    moduleId: "generation.video", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["video"], modes: ["text_to_video"],
    parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 4 } },
    providers: [{ providerId: VENDOR, models: [
      { modelId: "vid-model", modes: ["text_to_video"], parameterSchema: VIDEO_SCHEMA, capabilities: CAPABILITIES },
      { modelId: "vid-lite", modes: ["text_to_video"], parameterSchema: { duration: VIDEO_SCHEMA.duration, aspect_ratio: VIDEO_SCHEMA.aspect_ratio }, capabilities: CAPABILITIES },
      { modelId: "bare-model", modes: ["text_to_video"], parameterSchema: {}, capabilities: CAPABILITIES },
    ] }],
  },
  {
    moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["image"], modes: ["text_to_image"],
    parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 4 } },
    providers: [{ providerId: VENDOR, models: [{ modelId: "img-model", modes: ["text_to_image"], parameterSchema: IMAGE_SCHEMA, capabilities: CAPABILITIES }] }],
  },
]);

// 真实档案：注册表里的模块层、模型层参数表都留空，合法键完全由内置档案派生（生产里 95% 的模型就是这个形状）。
const realCatalogRegistry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["image"], modes: ["text_to_image"],
  parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 14 } },
  providers: [
    { providerId: "apimart", models: [{ modelId: "z-image-turbo", modes: ["text_to_image"], parameterSchema: {}, capabilities: CAPABILITIES }] },
    { providerId: "kie", models: [{ modelId: "nano-banana-2", modes: ["text_to_image"], parameterSchema: {}, capabilities: CAPABILITIES }] },
  ],
}]);

const AGENT_ORIGIN = { host: "nomi", actorId: "agent-panel" } as const;
const PROMPT = "一只纸船在雨后的水洼里慢慢漂";
const videoShot = (extra: Record<string, unknown> = {}, modelId = "vid-model") => ({
  prompt: PROMPT, taskKind: "text_to_video", candidate: { providerId: VENDOR, modelId }, ...extra,
});

/** 近似键：和真实键 `aspect_ratio` 只差一个字符——准入应当把它指出来。 */
const NEAR_MISS = { aspect_ratios: "16:9" };
/** 远键：`img-model` 的真实键叫 `size`，没有任何合法键足够接近——准入不许编一个。 */
const FAR_MISS = { aspect_ratio: "16:9" };

// ── 两个模型面 ──────────────────────────────────────────────────────────────────
/** 被拒 / 放行，归一成一个形状，各扇门才能逐字段比较。 */
type Seen =
  | Readonly<{ accepted: true; result: unknown }>
  | Readonly<{ accepted: false; code: string | undefined; message: string; details?: Readonly<Record<string, string | number>> }>;

const draftShotsVerb = writeVerbs().find((verb) => verb.name === "draft_shots")!;

/** Agent 面：动词自己的容忍 + schema → lane 翻译 → 常驻传输适配器（和真 lane 同一条）。 */
function agentDoor(world: SpendWorld) {
  const adapter = world.transport("request");
  let sequence = 0;
  return async (args: Record<string, unknown>): Promise<Seen> => {
    const admitted = draftShotsVerb.schema.parse(draftShotsVerb.prepareArguments ? draftShotsVerb.prepareArguments(args) : args);
    const call = verbToTransportCall({ toolCallId: `call-${++sequence}`, toolName: "draft_shots", args: admitted })!.call;
    const decision = await adapter.tryExecute(call, new AbortController().signal);
    if (!decision) throw new Error("the transport adapter did not route draft_shots");
    return seenFromDecision(decision);
  };
}

function seenFromDecision(decision: RuntimeToolDecision): Seen {
  if (decision.ok) return { accepted: true, result: decision.result };
  return { accepted: false, code: decision.admission, message: decision.message ?? "" };
}

/** 对外 MCP 面：直接打规划 handler 的 capability（`nomi_operation_plan` 的 create / plan 落在这里）。 */
function mcpDoor(world: SpendWorld) {
  return async (capability: "create" | "plan", params: Record<string, unknown>): Promise<Seen> => {
    try {
      return { accepted: true, result: await world.handler({ capability, params, lease, origin: { host: "codex" } } as never) };
    } catch (error) {
      if (!(error instanceof ContractCompilationError)) throw error;
      return { accepted: false, code: error.rejection?.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
    }
  };
}

const operationIdOf = (seen: Seen): string => {
  if (!seen.accepted) throw new Error(`expected the draft to be accepted, got: ${seen.message}`);
  const result = seen.result as { operation?: { operationId?: string }; drafted?: { operation?: { operationId?: string } } };
  const id = result.operation?.operationId ?? result.drafted?.operation?.operationId;
  if (!id) throw new Error("accepted result carries no operationId");
  return id;
};

const storedParameters = async (world: SpendWorld, operationId: string) =>
  (await world.operations.read(PROJECT_ID, operationId))!.candidate.parameters;

/** 草稿里每一镜（单镜草稿 = 顶层候选）此刻存着的参数，按镜头顺序。 */
const parametersOfEveryShot = async (world: SpendWorld, operationId: string) => {
  const run = await world.operations.read(PROJECT_ID, operationId);
  return (run!.shots ?? [{ candidate: run!.candidate }]).map((shot) => shot.candidate.parameters);
};

// ── 门表 ────────────────────────────────────────────────────────────────────────
// 创建门：写错的输入进去，什么都不许落（连同一份多镜草稿里写对的那几镜）。
type CreateDoor = Readonly<{ name: string; run: (world: SpendWorld, parameters: Record<string, unknown>, modelId?: string) => Promise<Seen> }>;
const CREATE_DOORS: readonly CreateDoor[] = [
  { name: "draft_shots · 单镜", run: (world, parameters, modelId) => agentDoor(world)({ shots: [videoShot({ parameters }, modelId)] }) },
  {
    name: "draft_shots · 多镜（第 2 镜写错）",
    run: (world, parameters, modelId) => agentDoor(world)({ shots: [{ ...videoShot({}, modelId), title: "镜1" }, { ...videoShot({ parameters }, modelId), title: "镜2" }] }),
  },
  {
    name: "MCP create · 一句话",
    run: (world, parameters, modelId = "vid-model") => mcpDoor(world)("create", { prompt: PROMPT, taskKind: "text_to_video", providerId: VENDOR, modelId, parameters }),
  },
  {
    name: "MCP create · 显式 candidate",
    run: (world, parameters, modelId = "vid-model") => mcpDoor(world)("create", {
      candidate: {
        candidateId: "cand-explicit", revision: 1, moduleId: "generation.video", providerId: VENDOR, modelId,
        mode: "text_to_video", prompt: PROMPT, parameters, references: [],
      },
    }),
  },
  {
    name: "MCP create · shots[]",
    run: (world, parameters, modelId) => {
      // 对外 MCP 的多镜 shots 与 Agent 的 draft_shots 落在同一份宿主 create 载荷上；这里取那份载荷直接打 handler。
      const translated = verbToTransportCall({
        toolCallId: "call-mcp-shots", toolName: "draft_shots",
        args: { shots: [{ ...videoShot({}, modelId), title: "镜1" }, { ...videoShot({ parameters }, modelId), title: "镜2" }] },
      })!.call.args as Record<string, unknown>;
      const { operation: _operation, ...params } = translated;
      return mcpDoor(world)("create", params);
    },
  },
];

// 改草稿门：已有一份好草稿，写错的 patch 进去，草稿必须一字不动。
type DraftRef = Readonly<{ operationId: string; shotIds: readonly string[] }>;
type PatchDoor = Readonly<{ name: string; multiShot: boolean; run: (world: SpendWorld, draft: DraftRef, parameters: Record<string, unknown>) => Promise<Seen> }>;
const PATCH_DOORS: readonly PatchDoor[] = [
  { name: "draft_shots · 改草稿（单镜顶层）", multiShot: false, run: (world, { operationId }, parameters) => agentDoor(world)({ operationId, shots: [{ parameters }] }) },
  { name: "draft_shots · 改多镜草稿里的某一镜", multiShot: true, run: (world, { operationId, shotIds }, parameters) => agentDoor(world)({ operationId, shots: [{ shotId: shotIds[1], parameters }] }) },
  { name: "MCP plan · 改草稿", multiShot: false, run: (world, { operationId }, parameters) => mcpDoor(world)("plan", { operationId, patch: { parameters } }) },
  { name: "MCP plan · 改某一镜", multiShot: true, run: (world, { operationId, shotIds }, parameters) => mcpDoor(world)("plan", { operationId, shotId: shotIds[1], patch: { parameters } }) },
];

/** 一份已经存在的好草稿（用 Agent 的门建，和用户真实走的是同一条路）。镜头 id 由宿主发，不由模型写。 */
async function existingDraft(world: SpendWorld, multiShot: boolean): Promise<DraftRef> {
  const door = agentDoor(world);
  const written = { parameters: { aspect_ratio: "9:16", resolution: "480p" } };
  const created = multiShot
    ? await door({ shots: [{ ...videoShot(written), title: "镜1" }, { ...videoShot(written), title: "镜2" }] })
    : await door({ shots: [videoShot(written)] });
  const operationId = operationIdOf(created);
  const stored = await world.operations.read(PROJECT_ID, operationId);
  return { operationId, shotIds: (stored!.shots ?? []).map((shot) => shot.shotId) };
}

describe("未知键：每一扇主进程写入门当场拒，同一份输入得到同一个结果", () => {
  // 参照物：**共享边界本身**（`compileExecutionContract` 里的 `compileParameters`）对同一份写错的候选给出的结构化拒绝。
  // 不取自任何一扇门——否则某扇门坏了，参照物跟着坏，别的门的测试就一起红，分不清是哪一扇。每扇门都要和它逐字相同。
  async function reference(): Promise<Extract<Seen, { accepted: false }>> {
    try {
      compileExecutionContract({
        candidateId: "cand-reference", revision: 1, moduleId: "generation.video", providerId: VENDOR, modelId: "vid-model",
        mode: "text_to_video", prompt: PROMPT, parameters: NEAR_MISS, references: [],
      }, registry);
    } catch (error) {
      if (!(error instanceof ContractCompilationError)) throw error;
      return { accepted: false, code: error.rejection?.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
    }
    throw new Error("the shared boundary accepted an unknown key");
  }

  it("参照物本身：unknown_parameter，点名写错的那一处、列出合法键、指出最接近的那个", async () => {
    const seen = await reference();
    expect(seen.code).toBe("unknown_parameter");
    expect(seen.details).toEqual({ at: "parameters.aspect_ratios", allowedKeys: "aspect_ratio,duration,resolution", closestKey: "aspect_ratio" });
  });

  for (const door of CREATE_DOORS) {
    it(`创建门 · ${door.name}：拒，同一个码同一句话；不落草稿、不出卡、供应商 0 次`, async () => {
      const expected = await reference();
      const world = spendWorld({ registry });
      const seen = await door.run(world, NEAR_MISS);
      expect(seen.accepted, "写错的键被放行了 = 这扇门不经准入").toBe(false);
      if (seen.accepted) return;
      expect(seen.message).toBe(expected.message);
      // Agent 的门只带粗码 + 具体码（`admission`）；MCP 的门另带语言中立的 details。两边的具体码都是同一个。
      expect(seen.code).toBe(expected.code);
      if (seen.details) expect(seen.details).toEqual(expected.details);
      expect(world.repository.list(PROJECT_ID), "被拒的创建不留任何草稿（多镜里写对的那几镜也不留）").toEqual([]);
      expect(world.pending(), "没有付费卡").toBeUndefined();
      expect(world.vendor.executes, "供应商 0 次").toHaveLength(0);
    });
  }

  for (const door of PATCH_DOORS) {
    it(`改草稿门 · ${door.name}：拒，同一个码同一句话；草稿一字不动，下一次读也没有被清掉的痕迹`, async () => {
      const expected = await reference();
      const world = spendWorld({ registry });
      const draft = await existingDraft(world, door.multiShot);
      const { operationId } = draft;
      const before = await world.operations.read(PROJECT_ID, operationId);
      const seen = await door.run(world, draft, NEAR_MISS);
      expect(seen.accepted, "写错的键被放行了 = 这扇门不经准入").toBe(false);
      if (seen.accepted) return;
      expect(seen.message).toBe(expected.message);
      expect(seen.code).toBe(expected.code);
      if (seen.details) expect(seen.details).toEqual(expected.details);
      expect(await world.operations.read(PROJECT_ID, operationId), "被拒的 patch 不能留下半张脸").toEqual(before);
      // 下一次读（预览）：没有任何「清掉了什么」的报告——因为什么都没写进去过；每一镜的参数还是写之前那一份。
      const parametersBefore = await parametersOfEveryShot(world, operationId);
      const preview = await world.handler({ capability: "preview", params: { operationId }, lease, origin: AGENT_ORIGIN } as never) as { clearedParameters?: string[] };
      expect(preview.clearedParameters).toBeUndefined();
      expect(await parametersOfEveryShot(world, operationId)).toEqual(parametersBefore);
      expect(world.vendor.executes, "供应商 0 次").toHaveLength(0);
    });
  }

  it("远键：真实键叫 size 的模型被写了 aspect_ratio——拒，列出合法键，不编一个「最接近」", async () => {
    const world = spendWorld({ registry });
    const seen = await agentDoor(world)({ shots: [{ prompt: PROMPT, taskKind: "text_to_image", candidate: { providerId: VENDOR, modelId: "img-model" }, parameters: FAR_MISS }] });
    expect(seen).toMatchObject({ accepted: false, code: "unknown_parameter" });
    const mcp = await mcpDoor(world)("create", { prompt: PROMPT, taskKind: "text_to_image", providerId: VENDOR, modelId: "img-model", parameters: FAR_MISS });
    expect(mcp).toMatchObject({ accepted: false, code: "unknown_parameter", details: { at: "parameters.aspect_ratio", allowedKeys: "size" } });
    expect(mcp.accepted ? undefined : mcp.details).not.toHaveProperty("closestKey");
    expect(world.repository.list(PROJECT_ID)).toEqual([]);
    expect(world.vendor.executes).toHaveLength(0);
  });

  it("模型读到的就是拒绝本身：Agent 的 lane 文本带着同一句话和「没提交没扣钱、改了再调」的下一步；MCP 的结构化结果带着 closestKey", async () => {
    const expected = await reference();
    const world = spendWorld({ registry });
    const adapter = world.transport("request");
    const tools = createExtendedLaneTools({ execute: async (call, signal) => adapter.tryExecute(verbToTransportCall(call)!.call, signal) as never });
    const tool = tools.find((candidate) => candidate.name === "draft_shots")!;
    const result = await tool.execute(tool.schema.parse({ shots: [videoShot({ parameters: NEAR_MISS })] }), { toolCallId: "turn-1", signal: new AbortController().signal }) as
      { ok: boolean; failure?: Parameters<typeof renderLaneToolFailure>[0] };
    expect(result.ok).toBe(false);
    const seenByAgent = renderLaneToolFailure(result.failure!);
    expect(seenByAgent).toContain(expected.message);
    expect(seenByAgent).toContain(admissionNextActionEn("unknown_parameter"));

    // 对外 MCP 那一面：真门抛出的错误，经和生产同一个渲染口，带着语言中立的事实。
    let thrown: unknown;
    try {
      await world.handler({ capability: "create", params: { prompt: PROMPT, taskKind: "text_to_video", providerId: VENDOR, modelId: "vid-model", parameters: NEAR_MISS }, lease, origin: { host: "codex" } } as never);
    } catch (error) {
      thrown = error;
    }
    const outcome = buildToolErrorOutcome("nomi_operation_plan", thrown, "en");
    expect(outcome.outcome).toMatchObject({ errorCode: "unknown_parameter", details: expected.details });
  });

  it("真实档案：键由档案派生、不靠注册表那份——Z-Image 写 aspect_ratio 被拒（它的比例键叫 size），Nano Banana 2 写 aspect_ratio 放行", async () => {
    const world = spendWorld({ registry: realCatalogRegistry });
    const zImage = { providerId: "apimart", modelId: "z-image-turbo" };
    const refused = await agentDoor(world)({ shots: [{ prompt: "海边日出", taskKind: "text_to_image", candidate: zImage, parameters: { aspect_ratio: "16:9" } }] });
    expect(refused).toMatchObject({ accepted: false, code: "unknown_parameter" });
    const viaMcp = await mcpDoor(world)("create", { prompt: "海边日出", taskKind: "text_to_image", ...zImage, parameters: { aspect_ratio: "16:9" } });
    expect(viaMcp).toMatchObject({ accepted: false, code: "unknown_parameter", details: { at: "parameters.aspect_ratio" } });
    const allowed = String(viaMcp.accepted ? "" : viaMcp.details?.allowedKeys).split(",");
    expect(allowed).toContain("size");
    expect(allowed).not.toContain("aspect_ratio");
    expect(world.repository.list(PROJECT_ID)).toEqual([]);

    const nano = await agentDoor(world)({ shots: [{ prompt: "海边日出", taskKind: "text_to_image", candidate: { providerId: "kie", modelId: "nano-banana-2" }, parameters: { aspect_ratio: "16:9" } }] });
    expect(nano.accepted).toBe(true);
    expect(await storedParameters(world, operationIdOf(nano))).toEqual({ aspect_ratio: "16:9" });
    expect(world.vendor.executes).toHaveLength(0);
  });
});

describe("放行的一侧：声明过的键照常过，值原样到达供应商；读盘归一不碰新写的键", () => {
  it("声明过的键：起草 → 改草稿 → 摆卡 → 点生成，供应商收到的就是模型写的那一份", async () => {
    const world = spendWorld({ registry });
    const { operationId } = await existingDraft(world, false);
    // 只改被点名的键：比例 9:16 → 16:9，清晰度不动。
    const patched = await agentDoor(world)({ operationId, shots: [{ parameters: { aspect_ratio: "16:9" } }] });
    expect(patched.accepted).toBe(true);
    expect(await storedParameters(world, operationId)).toEqual({ aspect_ratio: "16:9", resolution: "480p" });
    expect(await callTool(world.transport("request"), GENERATION_METHODS.plan, { operation: "present", operationId })).toMatchObject({ ok: true });
    expect(world.pending(), "卡出来了").toBeDefined();
    expect(world.vendor.executes, "点之前一个字节都不发").toHaveLength(0);
    expect(await world.generate()).toEqual({ ok: true, code: "handed_over" });
    await world.renderer.drain();
    await settleMicrotasks();
    expect(world.vendor.executes).toHaveLength(1);
    expect(world.vendor.executes[0]!.request.extras).toMatchObject({ aspect_ratio: "16:9", resolution: "480p" });
  });

  it("读盘归一不碰新写的键：写入门放行的每一个键，预览 / 改提示词 / 摆卡这三次读之后还在，也没有被报成「清掉了」", async () => {
    for (const multiShot of [false, true]) {
      const world = spendWorld({ registry });
      const { operationId, shotIds } = await existingDraft(world, multiShot);
      const readBack = () => parametersOfEveryShot(world, operationId);
      const written = await readBack();
      expect(written.every((parameters) => parameters.aspect_ratio === "9:16" && parameters.resolution === "480p")).toBe(true);

      const preview = await world.handler({ capability: "preview", params: { operationId }, lease, origin: AGENT_ORIGIN } as never) as { clearedParameters?: string[] };
      expect(preview.clearedParameters).toBeUndefined();
      expect(await readBack()).toEqual(written);

      // 第一次读不是预览，而是改一句提示词——此前 `changeset` 之外没有任何地方会提到被清掉的键。
      const revised = await world.handler({ capability: "plan", params: { operationId, patch: { prompt: "改一句提示词" }, ...(multiShot ? { shotId: shotIds[0] } : {}) }, lease, origin: AGENT_ORIGIN } as never) as { changeset?: { clearedParameters?: string[] } };
      expect(revised.changeset?.clearedParameters).toBeUndefined();
      expect(await readBack()).toEqual(written);

      await callTool(world.transport("request"), GENERATION_METHODS.plan, { operation: "present", operationId });
      expect(await readBack()).toEqual(written);
    }
  });

  it("没声明参数表的模型：原样带过（不拒、不丢），合同里有告警，读盘不清，供应商收到原值", async () => {
    const world = spendWorld({ registry });
    const created = await agentDoor(world)({ shots: [videoShot({ parameters: { whatever: 1, label: "x" } }, "bare-model")] });
    const operationId = operationIdOf(created);
    const preview = await world.handler({ capability: "preview", params: { operationId }, lease, origin: AGENT_ORIGIN } as never) as
      { contract: { parameters: Record<string, unknown>; warnings: string[] }; clearedParameters?: string[] };
    expect(preview.contract.parameters).toEqual({ whatever: 1, label: "x" });
    // 告警点名了这两个键：判不了就明说（R17），不是悄悄放行。
    expect(preview.contract.warnings).toHaveLength(2);
    for (const key of ["whatever", "label"]) expect(preview.contract.warnings.some((warning) => warning.includes(key))).toBe(true);
    expect(preview.clearedParameters).toBeUndefined();
    expect(await storedParameters(world, operationId)).toEqual({ whatever: 1, label: "x" });

    await callTool(world.transport("request"), GENERATION_METHODS.plan, { operation: "present", operationId });
    expect(await world.generate()).toEqual({ ok: true, code: "handed_over" });
    await world.renderer.drain();
    expect(world.vendor.executes[0]!.request.extras).toMatchObject({ whatever: 1, label: "x" });
  });

  it("换模型 → 旧参数失效：读盘归一照旧清、changeset 照旧报；同一次 patch 里新写的未知键不走这条，当场拒", async () => {
    const world = spendWorld({ registry });
    const { operationId } = await existingDraft(world, false);
    // 换成没有 resolution 的 vid-lite：上个模型的 resolution 是残留，清掉并如实上报，不拒。
    const switched = await agentDoor(world)({ operationId, shots: [{ modelId: "vid-lite" }] });
    expect(switched.accepted).toBe(true);
    expect(switched.accepted ? (switched.result as { changeset?: { clearedParameters?: string[] } }).changeset?.clearedParameters : undefined).toEqual(["resolution"]);
    expect(await storedParameters(world, operationId)).toEqual({ aspect_ratio: "9:16" });

    // 换回去的同一次 patch 里再写一个新模型也不认识的键：那是「这一次点名的」，不是残留——拒，草稿不动。
    const before = await world.operations.read(PROJECT_ID, operationId);
    const rejected = await agentDoor(world)({ operationId, shots: [{ modelId: "vid-lite", parameters: { resolution: "720p" } }] });
    expect(rejected).toMatchObject({ accepted: false, code: "unknown_parameter" });
    expect(await world.operations.read(PROJECT_ID, operationId)).toEqual(before);
  });

  it("多镜草稿里只换第 2 镜的模型：只有那一镜的残留被清、被报；第 1 镜原样", async () => {
    const world = spendWorld({ registry });
    const { operationId, shotIds } = await existingDraft(world, true);
    const switched = await agentDoor(world)({ operationId, shots: [{ shotId: shotIds[1], modelId: "vid-lite" }] });
    expect(switched.accepted).toBe(true);
    expect(switched.accepted ? (switched.result as { changeset?: { clearedParameters?: string[] } }).changeset?.clearedParameters : undefined).toEqual(["resolution"]);
    expect(await parametersOfEveryShot(world, operationId)).toEqual([{ aspect_ratio: "9:16", resolution: "480p" }, { aspect_ratio: "9:16" }]);
  });

  it("存量旧草稿（升级前落盘、没经过写入准入）：读盘照旧清并如实上报，之后不再有残留；草稿还读得起来", async () => {
    const world = spendWorld({ registry });
    await world.operations.create({
      operationId: "op-legacy", projectId: PROJECT_ID, now: "2026-10-24T00:00:00.000Z", origin: AGENT_ORIGIN,
      candidate: {
        candidateId: "cand-legacy", revision: 1, moduleId: "generation.video", providerId: VENDOR, modelId: "vid-model",
        mode: "text_to_video", prompt: PROMPT, parameters: { aspect_ratio: "9:16", legacy_knob: 9 }, references: [],
      },
    });
    const first = await world.handler({ capability: "preview", params: { operationId: "op-legacy" }, lease, origin: AGENT_ORIGIN } as never) as
      { clearedParameters?: string[]; contract: { parameters: Record<string, unknown> } };
    expect(first.clearedParameters).toEqual(["legacy_knob"]);
    expect(first.contract.parameters).toEqual({ aspect_ratio: "9:16" });
    expect(await storedParameters(world, "op-legacy")).toEqual({ aspect_ratio: "9:16" });
    const second = await world.handler({ capability: "preview", params: { operationId: "op-legacy" }, lease, origin: AGENT_ORIGIN } as never) as { clearedParameters?: string[] };
    expect(second.clearedParameters).toBeUndefined();
  });
});

describe("已知缺口（设计卡 §1.3 G2 / §3-1）：留可执行的复现，修它的那一刀翻成 it", () => {
  // 意图键（`GENERATION_PLANNING_HINTS`：cameraIntent / preferredFamily / preserveCharacter …）是 Nomi 的推荐器读的，
  // 永不上 wire。写入门（`compileParameters`）认它们、放行、落盘；读盘归一用的是另一个判据（`stripParametersNotAccepted`
  // 只看「在不在这个模型的参数表里」），意图键永远不在表里——于是写入放行的键，第一次读就被悄悄清掉
  // （只有预览会把它报成 clearedParameters，改提示词 / 摆卡 / 封印前的读一个字都不说）。
  //
  // 断言写成与方向无关的不变量：**写入门落了盘的，第一次读之后还是那一份**。设计卡 §3-1 给了两条出路
  // （读盘认意图键 / 写入时就不存意图键），任何一条修好，这条都会转绿，`it.fails` 随之变红，提醒翻回 `it`。
  it.fails("意图键：写入放行并落盘的键，第一次读（改一句提示词）之后还是那一份", async () => {
    const world = spendWorld({ registry });
    const created = await agentDoor(world)({ shots: [videoShot({ parameters: { resolution: "480p", cameraIntent: "pan", preserveCharacter: true } })] });
    const operationId = operationIdOf(created);
    const written = await storedParameters(world, operationId);
    await world.handler({ capability: "plan", params: { operationId, patch: { prompt: "改一句提示词" } }, lease, origin: AGENT_ORIGIN } as never);
    expect(await storedParameters(world, operationId)).toEqual(written);
  });
});
