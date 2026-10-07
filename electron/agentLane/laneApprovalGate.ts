// Agent lane · 审批状态机的**运行时那一半**（等待、grant 表、四个动作、恢复）
//
// 判据在 `../shared/agentLane/laneApproval.ts`（纯函数）；这里是那张图上会动的部分：
// 一次调用停在 `before_tool` 里等人，用户点了什么，等待期被什么打断。
//
// ── 三条踩过的坑，写在最前面（探针 `docs/research/2026-09-07-agent-lane-stage3-probes.md`）──
//
// ① **被打断时必须 resolve，不能 reject。** pi 的 `hooks.js:121-125` 把钩子里抛出的任何
//    异常洗成 `block.reason`，于是模型看到的是 `signal.reason.message`——那是
//    `"Abort requested"`，一个用户从没说过的内部串。resolve 那一臂拿到的才是 pi 自己的
//    `abortedOutcome`（"Tool execution was cancelled before completion."）。
// ② **等待中的 promise pi 不替我们打断。** `runToolWithGate` 只在**进入前** `throwIfAborted`
//    （`hooks.js:40-47`），所以 race 那个 signal 是我们的活；忽略它就是「按停止没反应」。
// ③ **等待期写进转录的记录不会被 abort 冲出去**（abort 不是一个边界，探针 §2.1）。
//    所以 `cancelled` 的记录不在钩子里写——它进 `drainNotes()`，由宿主在 abort **之后**的
//    idle 路径上补。写在钩子里的那条会悬在 `queues` 里，用户永远看不到。
import {
  laneApprovalGrantable,
  preflightLaneApproval,
  type LaneApprovalSubject,
  type LaneApprovalSubjectResolver,
} from "../shared/agentLane/laneApproval";
import {
  capabilityContractById,
  capabilityEffectClassOf,
  capabilityPlanReviewOf,
} from "../shared/agentCapabilities/registry";
import type {
  LaneApprovalAction,
  LaneApprovalCancelCause,
  LaneApprovalDecision,
  LaneApprovalNote,
  LaneHoldOutcome,
  LanePendingApproval,
} from "../shared/agentLane/laneContracts";
import { aliasBoundInputOf, modelToolCapabilityId, toSemanticInput } from "../shared/agentCapabilities/modelFacingTools";
import type { LaneToolSpec } from "../shared/agentLane/laneToolContract";
import type { ProjectAgentApprovalPolicy, ProjectAgentWorkMode } from '../shared/agentCapabilities/capabilityApprovalPolicy';

export type LaneApprovalRequest = Readonly<{
  toolCallId: string;
  toolName: string;
  args: unknown;
}>;

/** 闸对一次调用的**结局**。`allow: false` 的三种各有各的文案，不折成一个「没批准」。 */
export type LaneApprovalOutcome = Readonly<{
  allow: boolean;
  decision: LaneApprovalDecision;
  /** 拒绝/取消时给模型看的那句可行动的话。`granted` 那几支没有。 */
  reason?: string;
  cause?: LaneApprovalCancelCause;
  undoable?: boolean;
}>;

export interface LaneApprovalGateOptions {
  /** 这条 lane 装了哪些工具的说明书。用来把工具名换成它投影的那个能力契约 id（`contractId`）。 */
  readonly specs: readonly LaneToolSpec[];
  /** Trusted native effects may require more confirmation, never originate in renderer input. */
  readonly resolveSubject?: LaneApprovalSubjectResolver;
  /** 用户当前的档位。给函数不给快照——用户在等待期改档位是允许的。 */
  policy?(): ProjectAgentApprovalPolicy | undefined;
  workMode?(): ProjectAgentWorkMode | undefined;
  /**
   * 这条 lane 有没有一个能问的人。MCP stdio / 走查 / 后台批一律 `false`，
   * 预检直接 `denied-by-policy`，不静默放行（`laneApproval.ts` 的 `NO_UI_REASON`）。
   */
  readonly hasUserInterface: boolean;
  /**
   * 重开一条会话时**已经在飞、但没有结果**的那些 toolCallId。
   *
   * 探针 ③ 实核：真崩溃之后 `resume()` 对停在预检里的调用走 `startToolInvocation`，
   * `before_tool` **再问一次**——放行就真的跑了。裁决是不复活卡：重启前没确认的动作
   * 一律取消，让模型说一句「再发一次」。这比替用户复活一张他没看见过的卡诚实
   * （与 §1.5「诚实交付」、`projectAgentExecutionRecovery.ts` 的既有语义一致）。
   */
  readonly restoredToolCallIds?: Iterable<string>;
  /** 「在等你」变了。宿主据此重发投影。 */
  onPendingChange?(pending: LanePendingApproval | undefined): void;
}

export interface LaneApprovalGate {
  /** 挂在 `before_tool` 里的那一段。`signal` = `hookContext.abortSignal`。 */
  preflight(request: LaneApprovalRequest, signal: AbortSignal | undefined): Promise<LaneApprovalOutcome>;
  /** 用户在卡上点了什么。答的不是当前那张卡就返回 `false`（卡已经翻篇了，别把答案落到新的一张上）。 */
  answer(toolCallId: string, action: LaneApprovalAction, reason?: string): boolean;
  pending(): LanePendingApproval | undefined;
  /**
   * 这一次调用**真的**是怎么过闸的（2026-09-18 · T-ED-02）。工具回执据此说人话：
   * `auto-granted` = 用户这一档下压根没出过卡，`granted-once` / `granted-session` = 他点过。
   *
   * 为什么回执不能查一张静态表：`laneExtendedTools.ts` 原来对 `edit_timeline` **无条件**回
   * 「一张复审卡正在问用户要不要应用」——而这道闸跑在 `before_tool`，回执写出来的时候
   * 那张卡早就答完了、改动也已经落下去了。模型照着那句话让用户去点一张不存在的卡
   * （2026-09-12 「劈成两半」那次）。事实在这里，回执就该从这里取。
   */
  decisionFor(toolCallId: string): LaneApprovalDecision | undefined;
  /**
   * 用户回答这道题时的**原话**（只有 `answered` 有）。`ask_user` 的 execute 读它，
   * 把这句话作为成功形状的 tool result 交回模型——「他答上了」不是一次工具失败。
   */
  answerFor(toolCallId: string): string | undefined;
  /** 这次调用结束了，忘掉它的结论（宿主在 `after_tool` 调）。 */
  forget(toolCallId: string): void;
  describe(request: LaneApprovalRequest): string;
  /**
   * 替一张**画在别处的卡**等用户（见 `LaneHoldOutcome`）。与 `preflight` 的等待同性质：race 那个 signal、
   * 被打断时兑现成 `cancelled`、不设超时、`cancelAll` 一并收尾。**不投影成闸卡**——那张卡已经有人画了，
   * 再投影一张就是同一个问题问两遍。
   */
  hold(request: Pick<LaneApprovalRequest, "toolCallId" | "toolName">, signal: AbortSignal | undefined): Promise<LaneHoldOutcome>;
  /** 那张卡上的结论到了（面板点了「生成」/ ×，或用户打了字）。只认第一次；没有这笔等待返回 `false`。 */
  settleHold(toolCallId: string, outcome: Exclude<LaneHoldOutcome, { kind: "cancelled" }>): boolean;
  /** 此刻替哪次调用等着（E：宿主据此把用户打的字送给它）。 */
  holding(): Readonly<{ toolCallId: string; toolName: string }> | undefined;
  /** 关窗 / 切项目 / 按停止：等待中的卡一律以 `cancelled` 收尾。 */
  cancelAll(cause: LaneApprovalCancelCause): void;
  /** 还没落盘的结局记录（只有 `cancelled` 会走这里，理由见文件头 ③）。取走即清空。 */
  drainNotes(): LaneApprovalNote[];
}

const DEFAULT_DENY_REASON =
  "The user declined this action. Do not retry the same call: say what you were going to do and ask what to do instead.";

const RESTART_REASON =
  "Nomi restarted while this action was waiting for the user's confirmation, so it was cancelled and never ran. "
  + "Tell the user it did not happen and offer to do it again.";

const CANCEL_REASONS: Readonly<Record<LaneApprovalCancelCause, string>> = Object.freeze({
  stopped: "The user stopped the run before confirming this action, so it never ran.",
  "window-closed": "The Nomi window closed before the user confirmed this action, so it never ran.",
  restart: RESTART_REASON,
});

/** 一次等待中的卡：投影给面板的那一份 + 谁来兑现它。 */
interface WaitingCard {
  readonly pending: LanePendingApproval;
  /** 「本会话允许这类」记在哪个能力上。**不过桥**——渲染层不需要它，也不该拿它当授权凭据。 */
  readonly capabilityId: string;
  readonly settle: (outcome: LaneApprovalOutcome) => void;
}

export function createLaneApprovalGate(options: LaneApprovalGateOptions): LaneApprovalGate {
  const specByTool = new Map(options.specs.map((spec) => [spec.name, spec]));
  /** 本会话的「这类不用再问」。**内存表，不落盘**——关 app 即忘，「本会话」是字面意思。 */
  const sessionGrants = new Set<string>();
  const restored = new Set<string>(options.restoredToolCallIds ?? []);
  const waiting = new Map<string, WaitingCard>();
  /** 「卡画在别处」的等待（`hold`）。键同样是 toolCallId；不进 `waiting`——那张表是要投影成闸卡的。 */
  const holds = new Map<string, { toolName: string; settle: (outcome: LaneHoldOutcome) => void }>();
  const undrained: LaneApprovalNote[] = [];
  /**
   * 已经记过一条结局的调用。
   *
   * 「按停止」这条路上有两个东西同时想记：`cancelAll('stopped')` 和钩子自己 race 出来的
   * 那个 abort signal。两者顺序取决于微任务什么时候轮到，所以**记录只认第一次**——
   * 不去猜顺序，也不让用户在转录里看到同一次取消出现两遍。
   */
  const noted = new Set<string>();
  /**
   * `toolCallId` → 这次调用真的是怎么过闸的。回执（`laneExtendedTools.ts`）读它。
   *
   * 宿主在 `after_tool` 里 `forget`，所以正常只会存着在飞的那一两条。上限是兜底：
   * 被闸拦下的调用在某些路径上不走 `after_tool`，而一条永远只涨不落的表在一条活一整天的
   * lane 上就是泄漏。超了丢最老的（Map 按插入序），丢掉的后果只是那条回执少一句限定语。
   */
  const decisions = new Map<string, LaneApprovalDecision>();
  /** `toolCallId` → 用户答这道题时的原话。只有 `answered` 有，随 `decisions` 同生同死。 */
  const answers = new Map<string, string>();
  const DECISION_MEMORY = 256;

  function rememberDecision(toolCallId: string, decision: LaneApprovalDecision): void {
    if (!toolCallId) return;
    decisions.set(toolCallId, decision);
    while (decisions.size > DECISION_MEMORY) {
      const oldest = decisions.keys().next();
      if (oldest.done) break;
      answers.delete(oldest.value);
      decisions.delete(oldest.value);
    }
  }

  function rememberAnswer(toolCallId: string, text: string): void {
    if (!toolCallId) return;
    answers.set(toolCallId, text);
  }

  function note(entry: LaneApprovalNote): void {
    if (noted.has(entry.toolCallId)) return;
    noted.add(entry.toolCallId);
    undrained.push(entry);
  }

  const publish = () => options.onPendingChange?.(currentPending());

  function currentPending(): LanePendingApproval | undefined {
    // 串行执行下最多一张；并行读那一批理论上能同时进预检，所以按插入序取第一张、
    // 并把总数交给面板（「还有 N 条」），不静默藏起来。
    const first = waiting.values().next();
    return first.done ? undefined : first.value.pending;
  }

  /**
   * 闸判的必须是执行端将要执行的那一份语义输入（`toSemanticInput`：别名定死的字段 + 动词参数的翻译），不是模型的原参数。
   * 真实测试 ④：`undo` 的参数里没有 operation，闸认不出「这是撤销」，按 timeline.write 整体的「编辑计划要复审」
   * 给撤销一笔画布改动弹了「调整时间线」卡。参数不成立、翻译抛错时退回「别名定死字段 + 原参数」，随后的 schema 校验会拒。
   */
  function approvalInputOf(spec: LaneToolSpec, raw: unknown): unknown {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const record = raw as Record<string, unknown>;
    try { return toSemanticInput(spec, record); } catch { return { ...aliasBoundInputOf(spec), ...record }; }
  }

  function subjectOf(request: LaneApprovalRequest): LaneApprovalSubject {
    const spec = specByTool.get(request.toolName);
    const args = spec ? approvalInputOf(spec, request.args) : request.args;
    const capabilityId = spec ? modelToolCapabilityId(spec, args) : undefined;
    const contract = capabilityId === undefined ? undefined : capabilityContractById(capabilityId);
    return {
      toolName: request.toolName,
      // 认不出的工具名给一个不会撞上任何真能力的 id：它解不出契约，于是
      // `effectClass` 是 `undefined`，于是每条判据都对它 fail-closed。
      capabilityId: capabilityId ?? `unknown:${request.toolName}`,
      effect: contract?.effect,
      effectClass: capabilityEffectClassOf(contract, args),
      ...capabilityPlanReviewOf(contract, args),
      // 「这个能力就是问用户一句」。从契约上原样带过来，不在这里按工具名判——
      // 按名字判就是第二份真相源，而提问工具正是最容易长出第二份的那一个。
      ...(contract?.alwaysAsksUser ? { alwaysAsksUser: true as const } : {}),
      // 原生 lane 工具没有外部服务器的 hint。MCP 工具进 lane 是阶段 5 的事，
      // 那时它从工具声明上读，且**只能抬高摩擦**（`CapabilityApprovalSubject` 的注释）。
      destructiveHint: false,
    };
  }

  /**
   * Projection and execution share subject resolution, grants and the canonical policy.
   *
   * 2026-09-12：这里原来把 `forceConfirmation` 实现成 `{ mode: 'step', spend: 'confirm' }`——
   * 一个调用点**伪造一份用户从没选过的档位**交给下游。档位是用户此刻选的那一档，而且是
   * 「全自动下付费不再逐笔问」的唯一依据（`spendDecidedByPolicy`），它不能有第二个答案。
   * 现在这条事实作为 `hostMustConfirm` 挂在 subject 上（只抬不降），由那一份判据去裁决；
   * 用户自己答过的「这类以后别问」仍然算数，所以那个按钮不会因此消失。
   */
  function decisionOf(request: LaneApprovalRequest) {
    const resolved = options.resolveSubject?.(request);
    const base = resolved?.subject ?? subjectOf(request);
    const subject = resolved?.forceConfirmation ? { ...base, hostMustConfirm: true } : base;
    const policy = options.policy?.();
    const decided = resolved?.denialReason
      ? { state: 'denied-by-policy' as const, grantable: false as const, reason: resolved.denialReason }
      : preflightLaneApproval(subject, {
          policy,
          workMode: options.workMode?.(), hasUserInterface: options.hasUserInterface, sessionGrants,
        });
    return { resolved, subject, policy, decided };
  }

  function settleWaiting(toolCallId: string, outcome: LaneApprovalOutcome): boolean {
    const card = waiting.get(toolCallId);
    if (!card) return false;
    waiting.delete(toolCallId);
    card.settle(outcome);
    publish();
    return true;
  }

  /**
   * 预检那一趟本身。外面那层 `preflight` 只多做一件事：**把结论记下来**，
   * 好让工具回执从真实的这一条派生，而不是从一张静态表上抄（T-ED-02）。
   */
  async function runPreflight(
    request: LaneApprovalRequest, signal: AbortSignal | undefined,
  ): Promise<LaneApprovalOutcome> {
    // 重启后被 pi 再问一次的那些调用：不复活卡，直接取消（探针 ③ 的裁决）。
    if (restored.delete(request.toolCallId)) {
      // 记录由宿主在钩子里当场写：这一支**没有 abort 在飞**，所以它不会被 stranded
      // （文件头 ③ 只管被 abort 打断的那两支）。
      return { allow: false, decision: "cancelled", cause: "restart", reason: RESTART_REASON };
    }
    const { resolved, subject, policy, decided } = decisionOf(request);
    if (decided.state === "auto-granted") return { allow: true, decision: "auto-granted",
      undoable: subject.effect !== 'read' && subject.effectClass === 'reversible_local' };
    if (decided.state === "denied-by-policy") {
      return { allow: false, decision: "denied-by-policy", reason: decided.reason };
    }

    let settle!: (outcome: LaneApprovalOutcome) => void;
    const answered = new Promise<LaneApprovalOutcome>((resolve) => { settle = resolve; });
    waiting.set(request.toolCallId, {
      settle,
      capabilityId: subject.capabilityId,
      pending: Object.freeze({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        args: request.args,
        ...(subject.effectClass ? { effectClass: subject.effectClass } : {}),
        grantable: laneApprovalGrantable(subject, policy) && resolved?.grantable !== false,
        pendingCount: waiting.size + 1,
      }),
    });
    publish();

    // 文件头 ①②：race 那个 signal，**被打断时 resolve**。等待本身不设超时——
    // 等待期没有请求在飞、不花一分钱，「你没在五分钟内回答」不是一个我们要替用户
    // 编出来的事件（方案 §1.2）。关窗 / 切项目 / 按停止走 `cancelAll`，文案不同。
    //
    // 监听器用一次性的 controller 摘掉：不摘的那一版会在这次调用**早就批过之后**、
    // 下一次 abort 时再兑现一遍，往 `drainNotes()` 里塞一条不存在的取消记录——
    // 一条用户从没经历过的「你取消了」。
    const detach = new AbortController();
    try {
      return await Promise.race([answered, abortedTo(signal, request, detach.signal)]);
    } finally {
      detach.abort();
      if (waiting.delete(request.toolCallId)) publish();
    }
  }

  return {
    pending: currentPending,
    decisionFor: (toolCallId) => decisions.get(toolCallId),
    answerFor: (toolCallId) => answers.get(toolCallId),
    forget: (toolCallId) => { answers.delete(toolCallId); decisions.delete(toolCallId); },
    describe: (request) => {
      const { subject, decided } = decisionOf(request);
      if (decided.state === 'denied-by-policy') return '当前策略禁止此动作';
      if (decided.state === 'awaiting-user') return '此动作会向用户确认';
      return subject.effect === 'read' ? '只读，不修改项目' : '此动作直接生效并可撤销';
    },

    drainNotes: () => undrained.splice(0, undrained.length),

    answer: (toolCallId, action, reason) => {
      if (action === "answer") {
        const text = reason?.trim();
        // 空答案不成立：卡自己已经挡住了（`questionAnswerFromInput` 对空串回 undefined），
        // 这里再挡一次是因为**这一侧不该相信渲染层送来的东西**——一个空的「答案」会变成
        // 一段空白 tool result，模型只能接着猜，而用户以为自己答过了。
        if (!text) return false;
        /**
         * `allow: true`——**「他答上了」是成功，不是失败**（2026-09-22，run4 六次全中）。
         *
         * 这里原来写 `allow: false`，注释自陈「与 deny 走同一条既有通路」。那条通路的下游是
         * `laneHost` 的 `block`，而 pi 对 `block` 是硬编码的 `immediateError(isError: true)`
         * （`pi-agent-core/dist/harness/execution/tools.js`），再由 `pi-ai` 原样映射成 Anthropic
         * `tool_result.is_error: true`。于是**用户每答一次卡，模型都收到一条「ask_user 失败了」**，
         * 正文恰好是他那句答案；Nomi 自己还拿 `event.isError` 计「连续撞墙」——他答一次，熔断计数器加一格。
         * 既是错误形状，又在教模型「问了会失败」。
         *
         * 放行之后没有东西会被执行：`ask_user` 的 execute 读 `context.approvalAnswer`，
         * 把这句原话原样作为**成功形状**的 tool result 交回去（`laneDesktopTools.ts`）。
         * 读不到才是 fail-closed 的那一支（没装闸 = 这条会话没有能问的人）。
         */
        rememberAnswer(toolCallId, text);
        return settleWaiting(toolCallId, { allow: true, decision: "answered", reason: text });
      }
      if (action === "deny") {
        const text = reason?.trim();
        return settleWaiting(toolCallId, {
          allow: false,
          decision: "denied",
          // 用户那句话**一字不改**成为模型看到的 tool result（探针 §4.2 臂 B）。
          // 所以「不对，横屏」这四个字就是模型下一步的输入——这正是它该有的样子。
          reason: text ? text : DEFAULT_DENY_REASON,
        });
      }
      const card = waiting.get(toolCallId);
      if (!card) return false;
      if (action === "allow-session") {
        // 只有卡自己说可以，才写 grant。渲染层送来的按钮不是授权的依据——
        // 它是不可信的那一侧（#546 V10：身份与权限都不在桥的渲染侧铸造）。
        if (!card.pending.grantable) return false;
        sessionGrants.add(card.capabilityId);
        return settleWaiting(toolCallId, { allow: true, decision: "granted-session" });
      }
      return settleWaiting(toolCallId, { allow: true, decision: "granted-once" });
    },

    hold: async (request, signal) => {
      let settle!: (outcome: LaneHoldOutcome) => void;
      const answered = new Promise<LaneHoldOutcome>((resolve) => { settle = resolve; });
      holds.set(request.toolCallId, { toolName: request.toolName, settle });
      const detach = new AbortController();
      const stopped = new Promise<LaneHoldOutcome>((resolve) => {
        if (!signal) return;
        const cancelled: LaneHoldOutcome = { kind: "cancelled", cause: "stopped" };
        if (signal.aborted) { resolve(cancelled); return; }
        signal.addEventListener("abort", () => resolve(cancelled), { once: true, signal: detach.signal });
      });
      try {
        return await Promise.race([answered, stopped]);
      } finally {
        detach.abort();
        holds.delete(request.toolCallId);
      }
    },

    settleHold: (toolCallId, outcome) => {
      const held = holds.get(toolCallId);
      if (!held) return false;
      // 只认第一次：面板确认与「用户打字」同时到时，先到的那个算数（方案反方评审 Q1-b）。
      holds.delete(toolCallId);
      held.settle(outcome);
      return true;
    },

    holding: () => {
      const first = holds.entries().next();
      return first.done ? undefined : { toolCallId: first.value[0], toolName: first.value[1].toolName };
    },

    cancelAll: (cause) => {
      for (const [toolCallId, held] of [...holds]) {
        holds.delete(toolCallId);
        held.settle({ kind: "cancelled", cause });
      }
      for (const [toolCallId, card] of [...waiting]) {
        waiting.delete(toolCallId);
        // 记录不在这里写：abort 不是一个转录边界，钩子里追加的条目会悬在 `queues` 里
        // （探针 §2.1）。宿主在 abort 之后的 idle 路径上把 `drainNotes()` 冲出去。
        note({
          toolCallId, toolName: card.pending.toolName, decision: "cancelled", cause,
          reason: CANCEL_REASONS[cause],
        });
        card.settle({ allow: false, decision: "cancelled", cause, reason: CANCEL_REASONS[cause] });
      }
      publish();
    },

    preflight: async (request, signal) => {
      const outcome = await runPreflight(request, signal);
      rememberDecision(request.toolCallId, outcome.decision);
      return outcome;
    },
  };

  /** signal 触发时**兑现**（不是拒绝）成一条 `cancelled`，理由是「你按了停」。 */
  function abortedTo(
    signal: AbortSignal | undefined, request: LaneApprovalRequest, detach: AbortSignal,
  ): Promise<LaneApprovalOutcome> {
    const cancelled: LaneApprovalOutcome = {
      allow: false, decision: "cancelled", cause: "stopped", reason: CANCEL_REASONS.stopped,
    };
    const remember = () => note({
      toolCallId: request.toolCallId, toolName: request.toolName,
      decision: "cancelled", cause: "stopped", reason: CANCEL_REASONS.stopped,
    });
    return new Promise<LaneApprovalOutcome>((resolve) => {
      if (!signal) return;
      if (signal.aborted) { remember(); resolve(cancelled); return; }
      signal.addEventListener("abort", () => { remember(); resolve(cancelled); }, { once: true, signal: detach });
    });
  }
}
