// 五入口对拍：同一个模型名 + 同一组输入，每个入口认出的模型和选出的方式逐字段相同。
//
// 为什么要它：2026-11-17 之前「写下的模型名认哪一行」「这次按哪种方式发」各有好几个家——应用内助手认大小写、
// 外部短创建不认；同名多家一处拒、一处悄悄取第一家；点名别家的拟镜还带着默认那家的方式；首尾帧没写 modeId
// 时主进程只看方式级的桶、漏了档案级。名字和方式各收进一个主人（`modelHandle.ts` / `modeForInputs.ts`）以后，
// 任何一个入口换了写法、长出第二个家，只要答案不同，这里就红——结构测试拦写法，这里拦行为。
//
// 五个入口都走真链（不出网、不花钱）：
//   ① 应用内助手：`draft_shots` 参数 → lane 翻译（`verbToTransportCall`，完整名字在这里认）→ 宿主规划 handler；
//   ② 外部助手：`nomi_operation_plan` 的参数 → 它自己的 `build`（`vendor` / `modelKey` 别名表）→ 同一个 handler；
//   ③ 宿主短创建：handler 的 create（`providerId` / `modelId`）；
//   ④ 剧本拟镜：handler 的 create（`scriptText`，规划器桩只产提示词和时长，和生产注入的形状一样）；
//   ⑤ 改计划：先建一份别家模型的草稿，再 handler 的 plan 换模型。
// 可用性：只消费共用结果，这里打桩为「全部能用」（宿主快照 = 可用性线筛过的行）。
// 应用内助手的 `references` 只收素材 id、不带角色，所以带角色的输入组合它不参加（不是漏测：那条路写不出角色）。
import { createHash } from "node:crypto";
import { describe, expect, it, afterEach, beforeEach } from "vitest";

import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { MCP_GENERATION_TOOL_CATALOG } from "./mcpGenerationToolCatalog";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { setCatalogRowLookup } from "./modelAdmissionSchema";
import { normalizeVideoCandidate } from "./mcpGenerationVideoResolve";
import { requireModelSpecDetail } from "./modelSpecRead";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import type { PlanCandidate } from "./executionContract";
import { buildVideoModelCandidates, effectiveVideoModes } from "../shared/videoCapabilities";
import { modeForInputs, modesInTask } from "../shared/modelArchetypes/modeForInputs";
import { referenceDemandsForCandidate } from "../shared/canvas/edgeAdmission";
import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import { agentModelEntriesFromCatalog } from "../catalog/agentModelEntriesFromCatalog";
import { modelSpecDetail } from "../shared/agentCapabilities/modelSpecProjection";
import { sendArchetypeMode } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { GENERATION_DEFAULT_TASK_KINDS, type GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";

const PROJECT_ID = "project-1";
const MODULE_ID = "generation.single-shot";
const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true };
const VIDEO_MODES = ["text_to_video", "image_to_video"];

/** 目录里的行（真实 id，真实档案）：同名三家、自接模型 id 带大写 + 别名、一个改计划用的「别家」底稿模型。 */
const ROWS: ReadonlyArray<{ vendor: string; modelId: string; modelAlias?: string }> = [
  { vendor: "kie", modelId: "bytedance/seedance-2" },
  { vendor: "apimart", modelId: "doubao-seedance-2.0" },
  { vendor: "kie", modelId: "minimax-h3" },
  { vendor: "apimart", modelId: "minimax-h3" },
  { vendor: "minimax", modelId: "minimax-h3" },
  { vendor: "acme", modelId: "Clip-X", modelAlias: "clipx-pro" },
  { vendor: "studio", modelId: "base-video" },
];
const PATCH_BASE = { providerId: "studio", modelId: "base-video" };

const registry = createModuleRegistry([{
  moduleId: MODULE_ID,
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["video"],
  modes: VIDEO_MODES,
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [...new Set(ROWS.map((row) => row.vendor))].map((providerId) => ({
    providerId,
    models: ROWS.filter((row) => row.vendor === providerId).map((row) => ({ modelId: row.modelId, modes: VIDEO_MODES, parameterSchema: {}, capabilities })),
  })),
}]);
const videoModelCandidates = buildVideoModelCandidates(ROWS.map((row) => ({ provider: row.vendor, modelKey: row.modelId, label: row.modelId })));
/** 应用内助手这条消息带上来的同一份清单（lane 在它上面认名字）。 */
const LANE_ROWS = ROWS.map((row) => ({ vendor: row.vendor, modelId: row.modelId, modelAlias: row.modelAlias ?? null, kind: "video" }));

const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION, keyId: "key-1", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main",
  nonce: "nonce-1", scopeHash: "scope-hash-1", mac: "mac-1", projectId: PROJECT_ID,
  immutableProjectUuid: "project-uuid-1", projectGeneration: 1, canonicalRootDigest: "root-1", manifestDigest: "manifest-1",
  issuedAt: "2026-11-17T00:00:00.000Z", expiresAt: "2026-11-17T01:00:00.000Z", audience: PROJECT_LEASE_AUDIENCE,
  leasePrincipal: "mcp:parity", sessionId: "session-1", connectionNonce: "connection-1", revocationEpoch: 0,
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:read"],
};

beforeEach(() => {
  // 别名住在装配期装好的目录行里（生产里是 `installCatalogRowLookup`）。
  setCatalogRowLookup((providerId, modelId) => {
    const row = ROWS.find((item) => item.vendor === providerId && item.modelId === modelId);
    return row ? { modelAlias: row.modelAlias ?? null } : undefined;
  });
});
afterEach(() => setCatalogRowLookup(undefined));

type Identity = Readonly<{ providerId: string; modelId: string }>;
type DefaultFor = (taskKind: GenerationDefaultTaskKind) => Identity | undefined;

/** 一个格子的答案：认成哪一行 + 选出哪个方式；或者是哪一种拒收（只比类别，不比文字——三处包装格式各自保留，I8）。 */
type Outcome =
  | Readonly<{ ok: true; model: string; modeId: string | undefined }>
  | Readonly<{ ok: false; refusal: "ambiguous" | "unknown" | "other"; problem?: string }>;

/** 失败里的结构化问题：宿主拒收挂在 `.problem`，lane 拒收（`LaneDomainFailure`）挂在 `.failure.problem`。 */
function problemOf(error: unknown): { code?: string; message?: string } | undefined {
  const failure = error as { problem?: { code?: string; message?: string }; failure?: { problem?: { code?: string; message?: string } } };
  return failure.problem ?? failure.failure?.problem;
}

const debugMessages: string[] = [];

function refusalOf(error: unknown): Outcome {
  const problem = problemOf(error);
  const text = `${(error as { message?: string }).message ?? ""} ${JSON.stringify(error)}`;
  if (problem?.code === "unknown_model") return { ok: false, refusal: "unknown" };
  if (/several (?:vendors|providers)/.test(text)) return { ok: false, refusal: "ambiguous" };
  debugMessages.push(text);
  return { ok: false, refusal: "other", problem: problem?.code ?? "none" };
}

function outcomeOf(candidate: PlanCandidate | undefined): Outcome {
  if (!candidate) return { ok: false, refusal: "other", problem: "no candidate" };
  return { ok: true, model: `${candidate.providerId}/${candidate.modelId}`, modeId: candidate.modeId };
}

type Created = { operation: { operationId: string; candidate: PlanCandidate; shots?: ReadonlyArray<{ candidate: PlanCandidate }> }; modelNamesResolved?: ReadonlyArray<{ written: string; model: string; note?: string }> };
const firstCandidate = (created: Created): PlanCandidate | undefined => created.operation.shots?.[0]?.candidate ?? created.operation.candidate;

function host(defaultFor: DefaultFor) {
  const operations = createInMemoryGenerationOperationStore();
  return createGenerationPlanningHandler({
    registry,
    operations,
    now: () => "2026-11-17T00:00:00.000Z",
    videoModelCandidates,
    resolveModelPricing: () => ({ cost: 0, enabled: true, specCosts: [] }),
    defaultModelForTaskKind: (taskKind) => {
      const identity = defaultFor(taskKind);
      return identity ? { moduleId: MODULE_ID, ...identity, mode: taskKind } : undefined;
    },
    resolveAssetReferenceIdentity: (_projectId, assetId) => ({ contentHash: assetId.padEnd(64, "0"), version: 1, kind: "image" as const }),
    planStoryboard: () => ({ shots: [{ prompt: "镜头一：海浪推近", durationSeconds: 5 }] }),
  });
}

/** 一种写法：应用内助手写一个完整名字字符串；其余入口写两段（供应商可省）。 */
type NameForm = Readonly<{ label: string; lane: string; providerId?: string; modelId: string }>;
type InputCombo = Readonly<{ label: string; references: ReadonlyArray<{ assetId: string; role?: "first_frame" | "last_frame" | "character" | "reference" }> }>;

const INPUTS: readonly InputCombo[] = [
  { label: "无输入", references: [] },
  { label: "一张无角色图", references: [{ assetId: "asset-a" }] },
  { label: "首帧 + 尾帧", references: [{ assetId: "asset-a", role: "first_frame" }, { assetId: "asset-b", role: "last_frame" }] },
  { label: "首帧 + 全能参考", references: [{ assetId: "asset-a", role: "first_frame" }, { assetId: "asset-b", role: "reference" }] },
  { label: "一张人物参考", references: [{ assetId: "asset-a", role: "character" }] },
];

const laneCan = (input: InputCombo): boolean => input.references.every((reference) => reference.role === undefined);

/** 五个入口各跑一遍，返回 `入口 → 答案`。 */
async function fiveEntries(name: NameForm, input: InputCombo, defaultFor: DefaultFor): Promise<Record<string, Outcome>> {
  const results: Record<string, Outcome> = {};
  const attempt = async (entry: string, run: () => Promise<Outcome>) => {
    try { results[entry] = await run(); } catch (error) { results[entry] = refusalOf(error); }
  };
  const written = { ...(name.providerId ? { providerId: name.providerId } : {}), modelId: name.modelId };
  const references = input.references.map((reference) => ({ ...reference }));

  if (laneCan(input)) {
    await attempt("应用内助手", async () => {
      const laneDefaults = Object.fromEntries(GENERATION_DEFAULT_TASK_KINDS.flatMap((kind) => {
        const identity = defaultFor(kind);
        return identity ? [[kind, { vendor: identity.providerId, modelId: identity.modelId }]] : [];
      }));
      const translated = verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots",
        args: { shots: [{ prompt: "海浪推近", model: name.lane, ...(references.length ? { references: references.map((reference) => reference.assetId) } : {}) }] } },
      LANE_ROWS, laneDefaults);
      if (!translated || translated.lane !== "generation") throw new Error("lane did not route to generation");
      return outcomeOf(firstCandidate(await host(defaultFor)({ capability: "create", params: translated.call.args as Record<string, unknown>, lease } as never) as Created));
    });
  }
  await attempt("外部助手", async () => {
    const tool = MCP_GENERATION_TOOL_CATALOG.find((item) => item.name === "nomi_operation_plan")!;
    const params = tool.build({ projectId: PROJECT_ID, leaseHandle: "lease", prompt: "海浪推近", ...(name.providerId ? { vendor: name.providerId } : {}), modelKey: name.modelId, references });
    return outcomeOf(firstCandidate(await host(defaultFor)({ capability: "create", params, lease } as never) as Created));
  });
  await attempt("宿主短创建", async () => outcomeOf(firstCandidate(await host(defaultFor)({
    capability: "create", params: { prompt: "海浪推近", ...written, references }, lease } as never) as Created)));
  await attempt("剧本拟镜", async () => outcomeOf(firstCandidate(await host(defaultFor)({
    capability: "create", params: { scriptText: "海边，一个人走向镜头。", ...written, references }, lease } as never) as Created)));
  await attempt("改计划", async () => {
    const handler = host(defaultFor);
    const base = await handler({ capability: "create", params: { prompt: "海浪推近", ...PATCH_BASE, references }, lease } as never) as Created;
    const patched = await handler({ capability: "plan", params: { operationId: base.operation.operationId, patch: written }, lease } as never) as Created;
    return outcomeOf(patched.operation.candidate);
  });
  return results;
}

/** 每格五个入口逐字段相同，并且等于期望（期望由名字主人 + 方式主人直接算，不在这里另写判据）。 */
function expectSameEverywhere(results: Record<string, Outcome>, expected: Outcome | ((entry: string) => Outcome)) {
  for (const [entry, outcome] of Object.entries(results)) {
    expect(outcome, entry).toEqual(typeof expected === "function" ? expected(entry) : expected);
  }
  const answers = new Set(Object.values(results).map((outcome) => JSON.stringify(outcome)));
  expect(answers.size, JSON.stringify(results, null, 2)).toBe(1);
}

/**
 * 方式主人对「这个模型 + 这组输入 + 这一桶」的答案（主进程归一必须等于它）。
 * 这一桶里一个方式都没有（例：APIMart 的 H3 只有一个文生视频端点，带图时宿主按图生视频定桶）→ 宿主照旧拒「这个模型做不了这类任务」，
 * 五个入口拒得一样；这条拒收不是本轮的口径，只要求一致。
 */
function ownerOutcome(providerId: string, modelId: string, references: InputCombo["references"]): Outcome {
  const video = videoModelCandidates.find((item) => item.provider === providerId && item.modelKey === modelId)!;
  const archetype = { ...video.archetype, modes: effectiveVideoModes(video) };
  const kind = references.length > 0 ? "image_to_video" : "text_to_video";
  const demands = referenceDemandsForCandidate(references.map((reference) => ({ ...reference, contentHash: "x", version: 1, kind: "image" as const })));
  const model = `${providerId}/${modelId}`;
  if (modesInTask(archetype, { kind, vendor: providerId }).length === 0) return { ok: false, refusal: "other", problem: "mode_not_in_model" };
  const choice = modeForInputs(archetype, demands, null, { task: { kind, vendor: providerId } });
  return choice.status === "inputsNotAccepted" ? { ok: false, refusal: "other", problem: "parameter_not_allowed" } : { ok: true, model, modeId: choice.mode.id };
}

const ok = (providerId: string, modelId: string, input: InputCombo): Outcome => ownerOutcome(providerId, modelId, input.references);

const NO_DEFAULT: DefaultFor = () => undefined;
const DEFAULT_IS_APIMART_H3: DefaultFor = (kind) => (kind.endsWith("video") ? { providerId: "apimart", modelId: "minimax-h3" } : undefined);
const DEFAULT_IS_KIE_H3: DefaultFor = (kind) => (kind.endsWith("video") ? { providerId: "kie", modelId: "minimax-h3" } : undefined);
const DEFAULT_IS_OTHER_MODEL: DefaultFor = (kind) => (kind.endsWith("video") ? { providerId: "apimart", modelId: "doubao-seedance-2.0" } : undefined);

describe("五入口对拍：名字写法 × 输入组合", () => {
  const NAMES: ReadonlyArray<{ name: NameForm; expect: (input: InputCombo) => Outcome }> = [
    { name: { label: "完整名字", lane: "bytedance/seedance-2@kie", providerId: "kie", modelId: "bytedance/seedance-2" }, expect: (input) => ok("kie", "bytedance/seedance-2", input) },
    { name: { label: "裸 id（只有一家）", lane: "bytedance/seedance-2", modelId: "bytedance/seedance-2" }, expect: (input) => ok("kie", "bytedance/seedance-2", input) },
    // U2：自接模型 id 带大写，写成小写。
    { name: { label: "大小写不同", lane: "clip-x", modelId: "clip-x" }, expect: (input) => ok("acme", "Clip-X", input) },
    // U3：写的是别名。
    { name: { label: "别名", lane: "clipx-pro", modelId: "clipx-pro" }, expect: (input) => ok("acme", "Clip-X", input) },
    { name: { label: "认不出", lane: "totally-not-a-model", modelId: "totally-not-a-model" }, expect: () => ({ ok: false, refusal: "unknown" }) },
  ];
  for (const { name, expect: expected } of NAMES) {
    for (const input of INPUTS) {
      it(`${name.label} × ${input.label}`, async () => {
        expectSameEverywhere(await fiveEntries(name, input, DEFAULT_IS_OTHER_MODEL), expected(input));
      });
    }
  }
});

describe("U1 同名多家、没说哪家：只看用户给这一种任务设的默认，且只在匹配的几家里挑", () => {
  const h3: NameForm = { label: "同名多家", lane: "minimax-h3", modelId: "minimax-h3" };
  for (const input of INPUTS) {
    it(`默认就在匹配里 → 落默认那家 × ${input.label}`, async () => {
      expectSameEverywhere(await fiveEntries(h3, input, DEFAULT_IS_APIMART_H3), ok("apimart", "minimax-h3", input));
    });
    // APIMart 的 H3 只有文生视频端点，带图的格子在准入那一层拒；再用 KIE 那家做默认，确认带图时也确实落到默认那家、方式按它的档案选。
    it(`默认是另一家的同名模型 → 落那一家 × ${input.label}`, async () => {
      expectSameEverywhere(await fiveEntries(h3, input, DEFAULT_IS_KIE_H3), ok("kie", "minimax-h3", input));
    });
    it(`默认是别的模型（不在匹配里）→ 拒并列全部家 × ${input.label}`, async () => {
      expectSameEverywhere(await fiveEntries(h3, input, DEFAULT_IS_OTHER_MODEL), { ok: false, refusal: "ambiguous" });
    });
    it(`没设默认 → 拒并列全部家 × ${input.label}`, async () => {
      expectSameEverywhere(await fiveEntries(h3, input, NO_DEFAULT), { ok: false, refusal: "ambiguous" });
    });
  }

  it("落到默认那家时，回执写明「同名有 N 家，按你的默认用了哪家」（应用内与宿主同一个判据）", async () => {
    const created = await host(DEFAULT_IS_APIMART_H3)({ capability: "create", params: { prompt: "海浪推近", modelId: "minimax-h3" }, lease } as never) as Created;
    expect(created.modelNamesResolved).toEqual([expect.objectContaining({ written: "minimax-h3", model: "minimax-h3@apimart", note: expect.stringMatching(/3/) })]);
    const translated = verbToTransportCall({ toolCallId: "c", toolName: "draft_shots", args: { shots: [{ prompt: "海浪推近", model: "minimax-h3" }] } },
      LANE_ROWS, { text_to_video: { vendor: "apimart", modelId: "minimax-h3" } });
    expect(translated && translated.lane === "generation" ? translated.resolvedModels : undefined)
      .toEqual(created.modelNamesResolved);
  });
});

describe("U4 / U5：方式只由点名的模型的档案 + 这次真实输入决定", () => {
  it("U4 拟镜点名 KIE Seedance + 一张首帧，默认是 APIMart Seedance → 每镜方式是 KIE 档案按输入选的，短创建同答", async () => {
    const first: InputCombo = { label: "首帧", references: [{ assetId: "asset-a", role: "first_frame" }] };
    const name: NameForm = { label: "KIE Seedance", lane: "bytedance/seedance-2@kie", providerId: "kie", modelId: "bytedance/seedance-2" };
    const results = await fiveEntries(name, first, DEFAULT_IS_OTHER_MODEL);
    expectSameEverywhere(results, ok("kie", "bytedance/seedance-2", first));
    // 不继承默认那家的方式：APIMart 档案这一桶选出来的方式 id 与 KIE 的不同时，结果里只有 KIE 的。
    expect(results["剧本拟镜"]).toEqual(ok("kie", "bytedance/seedance-2", first));
  });

  it("U5 KIE Seedance、图生视频、首帧 + 尾帧、没写 modeId → firstlast（画布今天就是 firstlast）", async () => {
    const input = INPUTS.find((item) => item.label === "首帧 + 尾帧")!;
    const name: NameForm = { label: "KIE Seedance", lane: "bytedance/seedance-2@kie", providerId: "kie", modelId: "bytedance/seedance-2" };
    expectSameEverywhere(await fiveEntries(name, input, DEFAULT_IS_OTHER_MODEL), { ok: true, model: "kie/bytedance/seedance-2", modeId: "firstlast" });
    // 方式参照：画布发送时（同一个档案、同样一张首帧一张尾帧）选的就是这一个。
    const video = videoModelCandidates.find((item) => item.provider === "kie" && item.modelKey === "bytedance/seedance-2")!;
    const canvas = sendArchetypeMode({ ...video.archetype, modes: effectiveVideoModes(video) }, { id: "node-1", kind: "video", meta: {} } as never,
      { firstFrameUrl: "nomi-asset://a", lastFrameUrl: "nomi-asset://b" } as never);
    expect(canvas.id).toBe("firstlast");
  });
});

describe("全目录性质：每个内置视频档案 × 每家 × 五种输入，主进程归一的方式 = 方式主人的答案", () => {
  const seeded = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-11-17T00:00:00.000Z").state;
  const builtinVideo = buildVideoModelCandidates(seeded.models.filter((model) => model.kind === "video")
    .map((model) => ({ provider: model.vendorKey, modelKey: model.modelKey, label: model.modelKey })));

  it("内置视频行够多（不然这条性质是空的）", () => {
    expect(builtinVideo.length).toBeGreaterThan(20);
  });

  it("差 0 格", () => {
    const differences: string[] = [];
    let cells = 0;
    for (const video of builtinVideo) {
      const archetype = { ...video.archetype, modes: effectiveVideoModes(video) };
      // 第六格「说了图生、没给图」：方式照收（needsInput），缺的图由发送前的检查拒——不许偷换成文生或别的方式（反例 12）。
      for (const input of [...INPUTS, { label: "说了图生、没给图", references: [], kind: "image_to_video" }] as ReadonlyArray<InputCombo & { kind?: string }>) {
        const references = input.references.map((reference) => ({ ...reference, contentHash: "x".repeat(64), version: 1, kind: "image" as const }));
        const kind = input.kind ?? (references.length > 0 ? "image_to_video" : "text_to_video");
        const task = { kind, vendor: video.provider };
        const candidate: PlanCandidate = { candidateId: "c", revision: 1, moduleId: MODULE_ID, providerId: video.provider, modelId: video.modelKey,
          mode: kind, prompt: "一镜", parameters: {}, references };
        let actual: string | undefined;
        try { actual = normalizeVideoCandidate(candidate, builtinVideo).modeId; } catch { actual = undefined; }
        let owner: string | undefined;
        if (modesInTask(archetype, task).length > 0) {
          const choice = modeForInputs(archetype, referenceDemandsForCandidate(references), null, { task });
          owner = choice.status === "inputsNotAccepted" ? undefined : choice.mode.id;
        }
        cells += 1;
        if (actual !== owner) differences.push(`${video.provider}/${video.modelKey} × ${input.label}: 归一 ${actual} ≠ 主人 ${owner}`);
      }
    }
    expect(cells).toBeGreaterThan(100);
    expect(differences).toEqual([]);
  });
});

describe("外部读详情：成功回包逐字节不变（读的是名字主人认出的那一行本身）", () => {
  const seeded = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-11-17T00:00:00.000Z").state;
  const rows = agentModelEntriesFromCatalog(seeded);

  it("每一行按完整两段读，回包 = 这一行的投影", () => {
    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      const read = requireModelSpecDetail(row.entry.modelId, row.entry.vendor, seeded);
      expect(JSON.stringify(read), `${row.entry.vendor}/${row.entry.modelId}`).toBe(JSON.stringify(modelSpecDetail(row.entry, "mcp", row.availability)));
    }
  });

  it("读详情没有「这一种任务」：同名多家一律当歧义，不看默认；码与 details 键不变", () => {
    try {
      requireModelSpecDetail("minimax-h3", undefined, seeded);
    } catch (error) {
      const failure = error as { code?: string; details?: Record<string, unknown> };
      expect(failure.code).toBe("ambiguous_model_vendor");
      expect(Object.keys(failure.details ?? {}).sort()).toEqual(["modelKey", "vendorsForModelId"]);
      return;
    }
    throw new Error("expected ambiguous_model_vendor");
  });
});

// 外部助手看到的生成工具表逐字节不变（★1b：这一刀不改外部字段）。现有的模型面基线只冻结应用内动词，
// 外部 MCP 工具的描述与入参表没有逐字节的门，所以在这里补一道：改了它就红，要改须在 PR 里说明外部助手看到的什么变了再换这串。
describe("外部生成工具表逐字节不变", () => {
  it("nomi_operation_plan 等外部生成工具的名字、标题、描述、入参表", () => {
    const face = MCP_GENERATION_TOOL_CATALOG.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema }));
    expect(createHash("sha256").update(JSON.stringify(face)).digest("hex")).toBe("751104680f49b1a3357f82008640826080edecea68cb4ac3bef7e86d0c372959");
  });
});
