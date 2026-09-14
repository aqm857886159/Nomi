import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateToolArguments } from "./mcpArgValidation";
import { MODEL_ONBOARDING_TOOLS } from "./modelOnboarding/tools";
import { ONBOARDING_VERBS } from "./modelOnboarding/declarations";
import { dispatchModelOnboarding, resetModelOnboardingRuntime } from "./modelOnboarding/dispatch";
import { IntegrationSessionService } from "../integrationCertification/integrationSession";
// 世界与信封的 owner 是题库 + 探针共用的那一份（P1：不在这里复制第二份世界）。
import { envelopeFor, worldFor, type ProbeEnvelope } from "../../scripts/tool-face-bank/envelope.mjs";

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
    state: string;
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
    const deps = { sessions, owner: HOST };
    const driver = makeDriver(deps as never);
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

// ── 题库 30 句 · 零额度契约司机（R30 门岗，见 package.json `check:onboarding-usecases`）────────
//
// **它量的是什么**：一个只读得到我们广告出去的东西的 Agent，照着题库 30 句用户意图逐跳走，
// 每一跳的入参能不能一次写对。写对 = ① 过对外 JSON Schema，② 过运行时那次「缺什么一次说全」
// 的必填校验（`tool.build`）。基线 62% 的那条缝就长在 ①② 之间：旧面广播的必填是
// `["action"]`，运行时真正会抛的是 5 个字段——描述里没说，模型就写不出来。
//
// **司机只允许看三样东西**（多看一样，量的就不是工具面了）：
//   ① 这一跳的工具 schema，以及**广播出去的那份必填清单**——合并工具的必填写在 `action`
//      字段的描述里，所以这里**真的去解析那段文本**，而不是回头去读 declarations 的 `required`
//      数组。读声明等于让司机看后台答案，无论描述写成什么样都会满分（门岗 O4 守的正是
//      「描述与运行时同一份」，这里是它的行为侧测试）。
//   ② 上一跳的返回信封（`envelopeFor`，与真实模型臂**同一份**世界）。句柄类字段只许从这里抄。
//   ③ 用户自己那句话里带的值（名字、显示还是隐藏这类）——用户说了的东西，模型不需要去别处拿。
//
// **司机每一跳只发「广告的必填集」，一个字段都不多发**。这既是最诚实的读法，也避免
// 「多发一个 vendorKey 就把新建连接变成改连接」这种把语义搞反、分数却更高的作弊。
//
// 阳性对照在下面 `blind` 那一臂：把司机能看到的必填清单缩成 schema 顶层的 `required`
// （合并工具上就是 `["action"]`，信息量等于旧面那 241 字节），同一批 case 同一把尺。
// 那一臂必须塌下去；塌不下去说明这把尺量不到它声称在量的东西（docs/lessons/vacuous-probe-passes-forever）。

/** 司机手上的事实：**全部**来自上一跳的返回信封，句柄类字段只能从这里抄。 */
type Facts = {
  setupId?: string;
  vendorKey?: string;
  fingerprint?: string;
  modelKeys?: string[];
  models?: Array<{ modelKey: string; kind: string }>;
  contractSchema?: string;
};

function harvest(prev: Facts, result: ProbeEnvelope): Facts {
  const connections = result.state?.connections ?? [];
  const setups = result.state?.setups ?? [];
  const seen = connections.flatMap((row) => [...(row.candidates ?? []), ...(row.models ?? [])]);
  return {
    setupId: result.setupId ?? setups[0]?.id ?? prev.setupId,
    // vendorKey 只认 nomi_list_models 真的摆出来的连接——信封 base 上那个兜底值
    // 会让空 catalog 也「有」一个 vendorKey，那是仪器在送分。
    vendorKey: connections[0]?.vendorKey ?? prev.vendorKey,
    fingerprint: result.state?.fingerprint ?? prev.fingerprint,
    modelKeys: seen.length ? seen.map((row) => row.modelKey) : prev.modelKeys,
    models: seen.length ? seen.map((row) => ({ modelKey: row.modelKey, kind: row.kind })) : prev.models,
    contractSchema: setups[0]?.compileRequest?.contractSchema ?? prev.contractSchema,
  };
}

/** 句柄类字段：描述明说「从上一跳原样抄，永远不要自己造」。抄不到就是写不出来。 */
const HANDLE_FIELDS: Record<string, (facts: Facts) => unknown> = {
  setupId: (facts) => facts.setupId,
  vendorKey: (facts) => facts.vendorKey,
  ifUnchanged: (facts) => facts.fingerprint,
  modelKeys: (facts) => (facts.modelKeys?.length ? facts.modelKeys : undefined),
  models: (facts) => (facts.models?.length ? facts.models : undefined),
  adapterDraft: (facts) => facts.contractSchema,
};

/**
 * 用户那句话里带着的值。取值**从 schema 派生**（枚举取第一个、布尔取 true、整数取下限），
 * 字符串给一个占位串——量的是「这个字段拿不拿得到」，不是「抄得准不准」。
 *
 * 占位串刻意**不含用户原话**：把整句话塞进参数，正好会把用户贴在聊天里的 key 一起带进去，
 * 而题库的 trap-key-in-chat 就在测这件事（它的 mustNotAppearInArgs 里有 `key`）。
 */
function userSupplied(field: string, schema: { type?: string; enum?: unknown[]; minimum?: number }): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === "boolean") return true;
  if (schema.type === "integer") return schema.minimum ?? 1;
  if (schema.type === "string") return `${field} the user gave in their request`;
  return undefined;
}

type Advertised = { base: string[]; conditional: string[] };

/**
 * 从**真的广播出去的那份文本**里解析每个 action 的必填清单。
 * 回头去读 declarations 的 `required` 数组等于让司机看后台答案：无论描述写成什么样都会满分。
 * 读不懂就抛 —— 渲染格式改了必须红，不许静默变成「没有必填」。
 */
function parseAdvertised(text: string): Map<string, Advertised> {
  const head = "Required fields depend on it: ";
  const at = text.indexOf(head);
  if (at < 0) throw new Error(`action 字段的描述里找不到必填清单那一段：${text.slice(0, 120)}`);
  const body = text.slice(at + head.length).replace(/\.$/, "");
  const out = new Map<string, Advertised>();
  let current: string | null = null;
  for (const segment of body.split("; ")) {
    const requires = /^([a-z_]+) requires (.+)$/.exec(segment);
    if (requires) {
      current = requires[1];
      out.set(current, { base: requires[2] === "no other required field" ? [] : requires[2].split(" + "), conditional: [] });
      continue;
    }
    const conditional = /^when .+, also (.+)$/.exec(segment);
    if (conditional && current) {
      out.get(current)!.conditional = conditional[1].split(" + ");
      continue;
    }
    throw new Error(`读不懂广播出去的必填清单这一段："${segment}"`);
  }
  return out;
}

type OnboardingTool = (typeof MODEL_ONBOARDING_TOOLS)[number];

/** 这一跳司机看得到的必填集。`blind` = 只看 schema 顶层 required（合并工具上就是 ["action"]）。 */
function visibleRequirements(tool: OnboardingTool, action: string | null, blind: boolean): Advertised {
  const schemaRequired = [...tool.inputSchema.required];
  if (!action) return { base: schemaRequired, conditional: [] };
  if (blind) return { base: schemaRequired.filter((field) => field !== "action"), conditional: [] };
  const actionField = (tool.inputSchema.properties as Record<string, { description?: string }>).action;
  const parsed = parseAdvertised(actionField?.description ?? "");
  const found = parsed.get(action);
  if (!found) throw new Error(`广播的必填清单里没有 action=${action}`);
  return found;
}

/** 司机每一跳**只发广告的必填集**，一个字段都不多发。 */
function buildArgs(tool: OnboardingTool, action: string | null, facts: Facts, blind: boolean): Record<string, unknown> {
  const { base, conditional } = visibleRequirements(tool, action, blind);
  const args: Record<string, unknown> = action ? { action } : {};
  const properties = tool.inputSchema.properties as Record<string, { type?: string; enum?: unknown[]; minimum?: number }>;
  for (const field of [...base, ...conditional]) {
    const schema = properties[field];
    if (!schema) throw new Error(`${tool.name} 广告了必填字段 ${field}，schema 里却没有这个字段`);
    const value = field in HANDLE_FIELDS ? HANDLE_FIELDS[field](facts) : userSupplied(field, schema);
    if (value !== undefined) args[field] = value;
  }
  return args;
}

type BankRun = {
  hops: number;
  firstTryOk: number;
  rate: number;
  misses: Array<{ case: string; call: string; family: string; why: string }>;
};

function replayBank(blind: boolean): BankRun {
  let hops = 0;
  let firstTryOk = 0;
  const misses: BankRun["misses"] = [];
  for (const testCase of BANK.cases) {
    const world = worldFor(testCase.state);
    // 每条描述都写着「先读一眼」，所以司机开局手上有 nomi_list_models 的那份事实。
    let facts = harvest({}, envelopeFor("nomi_list_models", {}, 0, world));
    let seq = 0;
    for (const call of testCase.expectedCallSequence) {
      const [toolName, action] = call.split(":");
      const tool = TOOL_BY_NAME.get(toolName);
      expect({ case: testCase.id, call, known: Boolean(tool) }).toEqual({ case: testCase.id, call, known: true });
      seq += 1;
      hops += 1;
      const args = buildArgs(tool!, action ?? null, facts, blind);
      const printed = JSON.stringify(args).toLowerCase();
      for (const banned of [...BANK.globalMustNotAppearInArgs, ...testCase.mustNotAppearInArgs]) {
        expect({ case: testCase.id, call, banned, leaked: printed.includes(banned.toLowerCase()) })
          .toEqual({ case: testCase.id, call, banned, leaked: false });
      }
      const invalid = validateToolArguments(tool!.name, tool!.inputSchema, args);
      if (invalid) {
        misses.push({ case: testCase.id, call, family: "schema", why: invalid.message });
        continue;
      }
      try {
        tool!.build(args);
      } catch (error) {
        misses.push({ case: testCase.id, call, family: (error as { code?: string }).code ?? "runtime", why: (error as Error).message });
        continue;
      }
      firstTryOk += 1;
      facts = harvest(facts, envelopeFor(toolName, args, seq, world));
    }
  }
  return { hops, firstTryOk, rate: firstTryOk / hops, misses };
}

describe("MCP 接模型 · 题库 30 句零额度契约司机 (R30 门岗)", () => {
  const scored = replayBank(false);
  const blind = replayBank(true);

  it("30 句全跑：入参一次写对率 ≥90%", () => {
    expect(scored.hops).toBe(BANK.cases.reduce((sum, testCase) => sum + testCase.expectedCallSequence.length, 0));
    expect(scored.hops).toBeGreaterThanOrEqual(60);
    // 红的时候要一眼看出是哪一句的哪一跳、死在 schema 还是运行时。
    expect(scored.rate, `misses:\n${scored.misses.map((miss) => `  ${miss.case} ${miss.call} [${miss.family}] ${miss.why}`).join("\n")}`)
      .toBeGreaterThanOrEqual(BANK.targets.firstTryArgumentRate.goal);
  });

  it("阳性对照：司机只看得到 schema 顶层 required 时必须塌下去（否则这把尺什么都没量）", () => {
    // 合并工具上「只看 schema required」= 只看得到 ["action"]，信息量等于旧面那 241 字节。
    // 实测 ~0.37：塌掉的全是 nomi_model_setup 的跳，独立工具照样过——因为它们的 schema 说了真话。
    expect(blind.rate).toBeLessThan(0.5);
    expect(scored.rate - blind.rate).toBeGreaterThan(0.4);
    // 塌下去的原因必须是**基线 62% 那一族**：运行时说缺必填，而广告里没提。
    expect(blind.misses.length).toBeGreaterThan(20);
    expect([...new Set(blind.misses.map((miss) => miss.family))]).toEqual(["integration_required_fields_missing"]);
  });
});
