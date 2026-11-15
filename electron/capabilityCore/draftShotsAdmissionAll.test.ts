// 起草一组镜头被拒时：**一次列全**、每条带镜头号 / 标题 / 模型 / 方式，没问题的镜头也点名（2026-11-15）。
//
// 入参取自 11-15 真 App 评测轨迹 P18 第 4 次 `draft_shots`（6 镜：2 张参考卡、2 个文生、2 个首帧，全写了 aspectRatio 9:16；
// 提示词截短，其余原样）。那次模型读到的是「has no frame-ratio choice … set that one in parameters」+「aspectRatio: no such field here」，
// 不知道是哪一镜，于是把比例挪进 parameters.ratio 再撞一次，第三次被停。
//
// 走真链：动词投影 → 生成域 handler → adapter 的失败收敛 → lane 的措辞（与 `generationDomainRefusalReachesModel.test.ts` 同一条）。
import { describe, expect, it } from "vitest";

import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { laneFailureFromDecision } from "../shared/agentLane/laneFailureFromDecision";
import { laneToolPublicFailure, renderLaneToolFailure } from "../shared/agentLane/laneToolContract";
import type { ProjectBinding } from "../shared/projectBinding";
import { buildVideoModelCandidates } from "../shared/videoCapabilities";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { createModuleRegistry } from "./moduleRegistry";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";

const SEEDANCE = "doubao-seedance-2-5-260628";
const SEEDREAM = "doubao-seedream-4-5-251128";
const videoModelCandidates = buildVideoModelCandidates([{ provider: "volcengine", modelKey: SEEDANCE, label: "Seedance 2.5" }]);
const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true };
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0",
  inputKinds: ["text", "image", "video"], outputKinds: ["image", "video"],
  modes: ["text_to_image", "image_edit", "text_to_video", "image_to_video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [{ providerId: "volcengine", models: [
    { modelId: SEEDREAM, modes: ["text_to_image", "image_edit"], parameterSchema: {}, capabilities },
    { modelId: SEEDANCE, modes: ["text_to_video", "image_to_video"], parameterSchema: {}, capabilities },
  ] }],
}]);

const binding: ProjectBinding = { projectId: "project-1", immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1 };
const lease = {
  version: PROJECT_LEASE_VERSION, keyId: "k", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main",
  nonce: "n", scopeHash: "s", mac: "m", ...binding, canonicalRootDigest: "r", manifestDigest: "mf",
  issuedAt: "2026-11-15T00:00:00.000Z", expiresAt: "2099-11-15T00:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE, leasePrincipal: "mcp:agent-panel", sessionId: "s1", connectionNonce: "c1",
  revocationEpoch: 0, scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:read"],
} as ProjectLeaseV2;

const anchor = (title: string, kind: string) => ({
  title, role: "anchor", taskKind: "text_to_image", aspectRatio: "9:16",
  candidate: { providerId: "volcengine", modelId: SEEDREAM }, storyboard: { kind, carrier: "visual" }, prompt: `${title}参考图`,
});
const video = (title: string, modeId: "t2v" | "first", durationSec: number, extra: Record<string, unknown> = { aspectRatio: "9:16" }) => ({
  title, durationSec, ...extra, candidate: { providerId: "volcengine", modelId: SEEDANCE }, modeId,
  taskKind: modeId === "t2v" ? "text_to_video" : "image_to_video", prompt: `${title}，清晨老街，写实电影感`,
});
/** P18 第 4 次，原样（提示词截短）。下标 3、4 是首帧镜头。 */
const P18_ATTEMPT_4 = [
  anchor("角色锚·阿桥", "character"), anchor("场景锚·老街晨光", "scene"),
  video("镜1·早点铺开门", "t2v", 4), video("镜2·柜台买包子", "first", 4),
  video("镜3·跑向公交", "first", 5), video("镜4·车窗外晨光", "t2v", 5),
];

async function decisionFor(shots: readonly unknown[]) {
  const handler = createGenerationPlanningHandler({
    registry, operations: createInMemoryGenerationOperationStore(), videoModelCandidates, now: () => "2026-11-15T00:00:00.000Z",
  } as never);
  const adapter = createPiGenerationTransportAdapter(binding, { planning: handler as never, leaseFor: () => lease });
  const translated = verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots", args: { shots } })!;
  return adapter.tryExecute(translated.call, new AbortController().signal);
}

async function modelSees(shots: readonly unknown[]) {
  const decision = await decisionFor(shots);
  expect(decision && decision.ok === false, "应当拒收").toBe(true);
  const failed = decision as Extract<typeof decision, { ok: false }>;
  return laneFailureFromDecision({
    toolName: "draft_shots", code: failed.code, message: failed.message,
    admission: failed.admission, issues: failed.issues, problem: failed.problem,
    fallbackCode: "tool_execution_failed", nextAction: "Read the canvas again and retry.",
  });
}

describe("P18 第 4 次：两个首帧镜头写了比例 → 一次列全、带定位", () => {
  it("两个首帧镜头都列出来，各带下标 / 标题 / 模型 / 方式；文生镜头点名为没问题", async () => {
    const failure = await modelSees(P18_ATTEMPT_4);
    const text = renderLaneToolFailure(failure);
    expect(text).toContain("2 shots were refused");
    expect(text).toContain(`shots[3] "镜2·柜台买包子" (volcengine/${SEEDANCE}, mode first "首帧")`);
    expect(text).toContain(`shots[4] "镜3·跑向公交" (volcengine/${SEEDANCE}, mode first "首帧")`);
    expect(text).toMatch(/Shots that passed these checks: .*shots\[2\] "镜1·早点铺开门" \(mode t2v "文生视频"\).*shots\[5\] "镜4·车窗外晨光"/);
    // 两个家打架的那两句不许再出现：比例的家是 aspectRatio，这个方式只收自动。
    expect(text).not.toContain("no such field here");
    expect(text).not.toContain("set that one in parameters");
    expect(text).toContain("its ratio only takes adaptive");
    expect(text).toContain(`  - aspectRatio (shots[3] "镜2·柜台买包子" (volcengine/${SEEDANCE}, mode first "首帧")): value is not allowed. This mode has no ratio choice`);
    expect(text).toContain("Omit aspectRatio for this shot.");
  });

  it("面板读的公开清单和模型读的是同一份（同序、同条数、同路径），定位不进公开信封；面板行按的 problem 不变", async () => {
    const failure = await modelSees(P18_ATTEMPT_4);
    expect(failure.issues?.map((issue) => issue.path)).toEqual(["aspectRatio", "aspectRatio"]);
    expect(failure.issues?.map((issue) => issue.where)).toEqual([
      `shots[3] "镜2·柜台买包子" (volcengine/${SEEDANCE}, mode first "首帧")`,
      `shots[4] "镜3·跑向公交" (volcengine/${SEEDANCE}, mode first "首帧")`,
    ]);
    const envelope = laneToolPublicFailure(failure);
    expect(envelope.issues?.map((issue) => issue.path)).toEqual(failure.issues?.map((issue) => issue.path));
    expect(JSON.stringify(envelope)).not.toContain("shots[3]");
    expect(failure.problem).toMatchObject({ code: "ratio_not_in_mode", field: "aspectRatio", next: "drop_field" });
  });

  it("只有一镜坏：抛的还是那一个（同码、同 problem、同一条字段），正文末尾多一行定位", async () => {
    const shots = [...P18_ATTEMPT_4.slice(0, 4), video("镜3·跑向公交", "first", 5, {}), P18_ATTEMPT_4[5]];
    const failure = await modelSees(shots);
    expect(failure.message).not.toContain("shots were refused");
    expect(failure.message).toContain(`Which shot: shots[3] "镜2·柜台买包子" (volcengine/${SEEDANCE}, mode first "首帧").`);
    expect(failure.issues).toHaveLength(1);
    expect(failure.issues?.[0]).toMatchObject({ path: "aspectRatio", kind: "not_allowed" });
    expect(failure.issues?.[0]?.where).toBeUndefined();
    expect(failure.problem).toMatchObject({ code: "ratio_not_in_mode", field: "aspectRatio" });
  });

  it("面板那一行按的三样（码、problem、第一条字段）：两镜被拒和一镜被拒逐字相同", async () => {
    // 面板摘要（`laneToolFailureSummary`）只读 code / problem / issues[0]；三样相同，那一行就逐字不变。
    const many = laneToolPublicFailure(await modelSees(P18_ATTEMPT_4));
    const one = laneToolPublicFailure(await modelSees([...P18_ATTEMPT_4.slice(0, 4), video("镜3·跑向公交", "first", 5, {}), P18_ATTEMPT_4[5]]));
    expect(many.code).toBe(one.code);
    expect(many.problem).toEqual(one.problem);
    expect(many.issues?.[0]).toEqual(one.issues?.[0]);
  });

  it("按新正文改（首帧镜头去掉比例）→ 第一次就过", async () => {
    const fixed = P18_ATTEMPT_4.map((shot, index) => (index === 3 || index === 4 ? video(shot.title, "first", 4, {}) : shot));
    const decision = await decisionFor(fixed);
    expect(decision).toMatchObject({ ok: true });
  });

  it("不同镜头不同问题（比例 + 时长越界）也一次列全", async () => {
    const shots = [...P18_ATTEMPT_4.slice(0, 5), video("镜4·车窗外晨光", "t2v", 43, { aspectRatio: "9:16" })];
    const failure = await modelSees(shots);
    expect(failure.message).toContain("3 shots were refused");
    expect(failure.message).toContain("收到 43 秒");
    expect(failure.issues?.map((issue) => issue.path)).toEqual(["aspectRatio", "aspectRatio", "durationSec"]);
  });
});
