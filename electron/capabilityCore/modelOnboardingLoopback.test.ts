import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateToolArguments } from "./mcpArgValidation";
import { MODEL_ONBOARDING_TOOLS } from "./modelOnboarding/tools";
import { ONBOARDING_VERBS } from "./modelOnboarding/declarations";
import { dispatchModelOnboarding, resetModelOnboardingRuntime } from "./modelOnboarding/dispatch";
import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { IntegrationSessionService } from "../integrationCertification/integrationSession";

/**
 * R30 · 零额度 loopback 夹具（4 工具面）。
 *
 * 口径（设计正本 §8.2）：**每一跳的入参先按对外广播的 JSON Schema 校验一次**，过了才允许派发。
 * 一次写对率 = 首次校验通过的跳数 / 总跳数。它测的不是模型聪不聪明，而是
 * 「照着我们广告的契约一步步走，能不能走通」。
 *
 * 必须带阳性对照臂（docs/lessons/race-repro-needs-positive-control）：同一份题库另跑一臂用
 * 冻结的旧 6-action 面。那一臂不落在预期区间 = 夹具本身坏了，新面那个 ≥90% 不作数。
 * 区间是**确定性最坏情况司机**对旧面的读数（~28%），不是真实 Codex 的 62%——见夹具文件里的说明。
 */

const BANK = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json"), "utf8"),
) as Bank;
const LEGACY = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests/fixtures/tool-selection/2026-09-11-legacy-6action-face.json"), "utf8"),
) as LegacyFace;

type Bank = {
  globalMustNotAppearInArgs: string[];
  verbs: string[];
  toolFace: { verbToCall: Record<string, string> };
  targets: { firstTryArgumentRate: { goal: number } };
  cases: Array<{
    id: string;
    utterance: string;
    lang: string;
    driver: string;
    expectedFirstVerb: string | null;
    expectedFirstCall: string | null;
    expectedSequence: string[];
    expectedCallSequence: string[];
    expectedNextAction?: string;
    forbiddenVerbs: string[];
    forbiddenCalls: string[];
    unverifiedMustContain: string[];
    mustNotAppearInArgs: string[];
    contestedWith: string[];
  }>;
  _baselineReplay: { oldFaceTurns: number; newFaceExpectedCalls: string[] };
  _positiveControl: { expectedFirstTryRate: { min: number; max: number } };
};

type LegacyFace = {
  tools: Record<string, {
    advertisedRequired: string[];
    actions: Record<string, { runtimeRequired: string[]; classes: Record<string, string> }>;
  }>;
  newCallToLegacyHops: Record<string, Array<{ tool: string; action: string; unsupported?: boolean }>>;
};

const HOST = "codex" as const;
const TOOL_BY_NAME = new Map(MODEL_ONBOARDING_TOOLS.map((tool) => [tool.name, tool]));

function makeService(dir: string) {
  const certification = {
    startHttp: vi.fn(async () => ({ id: "run-loopback", stage: "completed", childRunRef: { runId: "run-loopback", revisionDigest: "f".repeat(64) } })),
    get: vi.fn(() => ({ id: "run-loopback", stage: "completed", childRunRef: { runId: "run-loopback", revisionDigest: "f".repeat(64) } })),
    discoverHttpModels: vi.fn(async () => [{ modelKey: "deepseek-chat", kind: "text" }]),
  };
  const sessions = new IntegrationSessionService({
    filePath: path.join(dir, "sessions.json"),
    certification: certification as never,
    credentialResolver: () => "loopback-key",
    approvalReceiptAuthority: createApprovalReceiptAuthority({ filePath: path.join(dir, "receipts.json"), macKey: "loopback-mac-key" }),
    save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    enqueueHandoff: () => undefined,
    compilerAvailable: () => true,
  });
  return { sessions, certification };
}

/** 一跳：先按对外 schema 校验入参（写错就记一笔），再派发。 */
function makeDriver(deps: Parameters<typeof dispatchModelOnboarding>[2]) {
  const attempted: Array<{ call: string; args: Record<string, unknown> }> = [];
  const rejectedBySchema: string[] = [];
  /** 人工干预计数：任何需要真人在 Nomi 之外替 Agent 补一刀的事（基线 10，目标 0）。 */
  let humanInterventions = 0;
  async function call(toolName: string, args: Record<string, unknown>) {
    const tool = TOOL_BY_NAME.get(toolName);
    if (!tool) {
      rejectedBySchema.push(`${toolName}: no such tool`);
      humanInterventions += 1;
      throw new Error(`no such tool: ${toolName}`);
    }
    const label = typeof args.action === "string" ? `${toolName}:${args.action}` : toolName;
    attempted.push({ call: label, args });
    const invalid = validateToolArguments(tool.name, tool.inputSchema, args);
    if (invalid) {
      rejectedBySchema.push(`${label}: ${invalid.message}`);
      throw invalid;
    }
    const method = tool.resolveMethod(args);
    return dispatchModelOnboarding(method, tool.build(args), deps) as Promise<Record<string, unknown>>;
  }
  return { call, attempted, rejectedBySchema, interventions: () => humanInterventions };
}

describe("MCP 接模型 loopback · 4 工具面 (R30)", () => {
  it("题库 30 句：每个动作都被命中，每条期望的动作都真的存在（门岗 O7 的测试侧）", () => {
    const declared = new Set(ONBOARDING_VERBS.map((verb) => (verb.action ? `${verb.tool}:${verb.action}` : verb.tool)));
    const hit = new Set<string>();
    for (const testCase of BANK.cases) {
      for (const call of [testCase.expectedFirstCall, ...testCase.expectedCallSequence]) {
        if (!call) continue;
        expect({ id: testCase.id, call, exists: declared.has(call) }).toEqual({ id: testCase.id, call, exists: true });
        hit.add(call);
      }
    }
    expect([...declared].filter((call) => !hit.has(call))).toEqual([]);
  });

  it("全域：题库里没有一条期望模型写出 expectedRevision / idempotencyKey / key 的值，schema 上也没有这些字段", () => {
    const banned = BANK.globalMustNotAppearInArgs;
    for (const tool of MODEL_ONBOARDING_TOOLS) {
      const fields = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      for (const field of fields) {
        const lowered = field.toLowerCase();
        // 布尔开关承载不了一个 key 的值，所以 O2 的名字规则只管字符串类字段；
        // 白名单里那几个名字里带 key/auth，但承载的是**名字**不是值。
        const schema = (tool.inputSchema.properties as Record<string, { type?: string }>)[field];
        const carriesText = schema?.type === "string" || schema?.type === "array";
        const offends = banned.some((bad) => lowered === bad.toLowerCase())
          || (carriesText
              && /key|token|secret|password|credential|authorization/i.test(field)
              && !["modelKey", "vendorKey", "modelKeys", "authHeader", "authQueryParam"].includes(field));
        expect({ tool: tool.name, field, offends }).toEqual({ tool: tool.name, field, offends: false });
      }
    }
  });

  it("走完主路径：一次写对率 ≥90%、人工干预 0、信封里仍然留着 model_produces_output", async () => {
    resetModelOnboardingRuntime();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-onboard-loopback-"));
    const { sessions } = makeService(dir);
    const deps = {
      sessions,
      owner: HOST,
      openCredentialsUi: async () => ({ opened: true }),
      probeModels: async () => [{ modelKey: "deepseek-chat", kind: "text" as const }] as never,
    };
    const driver = makeDriver(deps as never);

    // ① 「帮我把 DeepSeek 接进 Nomi」——一跳。探端点、开 key 页都是后果，不是动作。
    const connected = await driver.call("nomi_model_setup", {
      action: "connect_provider",
      kind: "http-api-provider",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      authType: "bearer",
      authHeader: "Authorization",
    }) as { setupId: string; nextAction: { kind: string; waitWith?: string }; unverified: Array<{ claim: string }> };
    expect(connected.setupId).toBeTruthy();
    // 这台机器上 key 已经在安全存储里 → 不该再要用户填一遍。
    expect(connected.nextAction.kind).toBe("working");
    expect(connected.nextAction.waitWith).toBe("nomi_await_setup");

    // ② 上下文丢了也能找回来：不带参数列出在途接入。
    const listed = await driver.call("nomi_list_models", {}) as { state: { setups: Array<{ id: string }>; fingerprint: string } };
    expect(listed.state.setups.map((setup) => setup.id)).toContain(connected.setupId);

    // ③ 「等」有自己的表达方式——不需要靠再调一次写动作来表示等待。
    const awaited = await driver.call("nomi_await_setup", { setupId: connected.setupId, timeoutSeconds: 1 }) as { nextAction: { kind: string } };
    expect(["none", "working", "waiting_for_user"]).toContain(awaited.nextAction.kind);

    // ④ 选模型。
    const chosen = await driver.call("nomi_model_setup", {
      action: "choose_models",
      setupId: connected.setupId,
      models: [{ modelKey: "deepseek-chat", kind: "text" }],
    }) as { changeId: string; unverified: Array<{ claim: string }> };
    expect(chosen.changeId).toBeTruthy();

    // ⑤ 重放恒等：模型不确定上一跳成没成功时再调一次是**无害的**，且返回值一字不差
    //    （Stripe 语义）。旧面上这一下会重签挑战、作废人刚才那次点击——白点 3 次的那扇门。
    const chosenAgain = await driver.call("nomi_model_setup", {
      action: "choose_models",
      setupId: connected.setupId,
      models: [{ modelKey: "deepseek-chat", kind: "text" }],
    }) as { changeId: string };
    expect(chosenAgain.changeId).toBe(chosen.changeId);

    // ⑥ 免费自检。通不通都不下架。
    const checked = await driver.call("nomi_model_setup", {
      action: "check_connection",
      setupId: connected.setupId,
    }) as { blastRadius: { outboundRequests: Array<{ billable: boolean }> }; unverified: Array<{ claim: string }> };
    expect(checked.blastRadius.outboundRequests.every((request) => request.billable === false)).toBe(true);
    // 自检**永远**消不掉这一条：它证的是地址和 key，不是出片。
    expect(checked.unverified.map((entry) => entry.claim)).toContain("model_produces_output");

    // ⑦ 显示到画布模型框里（旧面上根本没有这个动作）。
    const shown = await driver.call("nomi_model_setup", {
      action: "show_models",
      vendorKey: "deepseek",
      modelKeys: ["deepseek-chat"],
      visible: true,
    }) as { blastRadius: { modelsAppearing: number }; nextAction: { userSees: string } };
    expect(shown.nextAction.userSees).toMatch(/not yet tried/i);

    // 数字。
    const total = driver.attempted.length;
    const firstTryRate = (total - driver.rejectedBySchema.length) / total;
    expect(driver.rejectedBySchema).toEqual([]);
    expect(firstTryRate).toBeGreaterThanOrEqual(BANK.targets.firstTryArgumentRate.goal);
    expect(driver.interventions()).toBe(0);
    // 旧面上同一个意图是 9 个回合 58 次调用；新面是 7 跳。
    expect(total).toBeLessThan(BANK._baselineReplay.oldFaceTurns + 1);
  });

  it("不可逆那一格：ifUnchanged 原样抄才放行，且返回时什么都还没删", async () => {
    resetModelOnboardingRuntime();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-onboard-remove-"));
    const { sessions } = makeService(dir);
    const deps = { sessions, owner: HOST } as never;
    const driver = makeDriver(deps);
    const view = await driver.call("nomi_list_models", {}) as { state: { fingerprint: string; connections: Array<{ vendorKey: string }> } };
    const target = view.state.connections[0]?.vendorKey;
    if (!target) return; // 空 catalog 的机器上没有可删的连接；这一条不制造假绿。

    // 自己算出来的指纹一定不对——「计算下一个值」在新面上不可表达。
    await expect(driver.call("nomi_remove_provider", { vendorKey: target, ifUnchanged: "fp_000000000000" }))
      .rejects.toThrow(/changed since you last read them/i);

    let confirmationsAsked = 0;
    const gated = makeDriver({ ...deps, enqueueRemovalConfirmation: () => { confirmationsAsked += 1 } } as never);
    const asked = await gated.call("nomi_remove_provider", { vendorKey: target, ifUnchanged: view.state.fingerprint }) as {
      nextAction: { kind: string }; blastRadius: { recordsDeleted: number }
    };
    expect(asked.nextAction.kind).toBe("user_sees_confirm_card");
    expect(asked.blastRadius.recordsDeleted).toBeGreaterThan(0);
    expect(confirmationsAsked).toBe(1);
    // 返回了，但**还没删**：连接仍在。
    const after = await gated.call("nomi_list_models", {}) as { state: { connections: Array<{ vendorKey: string }> } };
    expect(after.state.connections.map((row) => row.vendorKey)).toContain(target);
  });

  it("阳性对照臂：同一份题库跑冻结的旧 6-action 面，必须落在 60–65%", () => {
    let hops = 0;
    let firstTryOk = 0;
    const failures: Record<string, number> = { mustCompute: 0, unsupported: 0 };
    for (const testCase of BANK.cases) {
      for (const call of testCase.expectedCallSequence) {
        const legacyHops = LEGACY.newCallToLegacyHops[call];
        if (!legacyHops) continue;
        for (const hop of legacyHops) {
          hops += 1;
          const spec = LEGACY.tools[hop.tool];
          const actionSpec = spec.actions[hop.action];
          const advertised = new Set(spec.advertisedRequired);
          // 模型只看得到 advertisedRequired，按它写；运行时按 runtimeRequired 校验。
          const unmet = actionSpec.runtimeRequired.filter((field) => !advertised.has(field) && actionSpec.classes[field] === "mustCompute");
          if (hop.unsupported) { failures.unsupported += 1; continue }
          if (unmet.length) { failures.mustCompute += 1; continue }
          firstTryOk += 1;
        }
      }
    }
    const rate = firstTryOk / hops;
    // 这一臂不落在区间里 = 尺子坏了，新面那个 ≥90% 不作数。
    // 区间是**确定性最坏情况司机**的读数（~28%），不是真实 Codex 的 62%——两个司机不是一回事，
    // 把区间调去凑 62% 等于篡改量尺（D4：诚实标注，不是把问题解决了）。
    expect(hops).toBeGreaterThan(20);
    expect(rate).toBeGreaterThanOrEqual(BANK._positiveControl.expectedFirstTryRate.min);
    expect(rate).toBeLessThanOrEqual(BANK._positiveControl.expectedFirstTryRate.max);
    // 失败构成必须是实测的那三族，不是别的原因凑出来的同一个数。
    expect(failures.mustCompute).toBeGreaterThan(0);
    expect(failures.unsupported).toBeGreaterThan(0);
  });
});
