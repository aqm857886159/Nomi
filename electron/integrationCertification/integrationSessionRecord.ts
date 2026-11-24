/**
 * 落盘会话记录的深校验，以及「上游失败 → 封闭可本地化的原因码」的映射。
 *
 * 单独成文件的理由：这两件事都只认数据形状，不认会话状态机——把它们留在 integrationSession.ts
 * 里只会继续喂那个巨壳（R9/R12）。原因码尤其不能散落：上游错误字符串一旦被原样落盘，
 * 投影就会把供应商的内部信息带给调用方。
 */
import fs from "node:fs";
import type { ProviderAdapterRun } from "../providerAdapter/types";
import { assertRecord } from "./integrationWorkflowBinding";
import type { IntegrationSession, PersistedIntegrationState } from "./integrationSession";
import {
  INTEGRATION_CREDENTIAL_STATUSES,
  INTEGRATION_STAGES,
  IntegrationRequestError,
  type IntegrationCredentialStatus,
  type IntegrationStage,
} from "../shared/integrationContract";
import { logWarn } from "../logging/logger";
import { CERTIFICATION_MAX_FILE_BYTES, certificationJsonBytes } from "./certificationPersistence";
import { BUILTIN_MCP_CLIENTS, type CapabilityOriginHost } from "../capabilityCore/security";
import {
  integrationCertifyingDeadlineAt,
  isCertifyingIntegrationStage,
  isTerminalIntegrationStage,
} from "./integrationSessionTerminal";

/**
 * 这份状态的**容量合同**，两根轴（记录条数 / 落盘字节）共一个 owner：`capIntegrationSessions`。
 *
 * 为什么它必须有 owner，而不只是一句断言：2026-09-21 之前这两个上限都只在**读**或**写**的
 * 一侧断言，没有任何一层负责让它成立，于是 app 自己生产出一份自己读不回、写不下的盘——
 * 第 101 条落盘后启动即 `app.quit()`（用户看到「双击没反应」），序列化超 1MiB 后
 * 看门狗收尾那一次写同样把启动打挂。一个没人执行的上限不是上限，是定时炸弹。
 * 同模块的 handoffQueue 早就是写时挤掉最旧的（见其 MAX_ENTRIES），这份漏了。
 * 完整经过与取证：docs/fixes/2026-09-21-integration-session-cap.root-cause.json。
 */
const MAX_INTEGRATION_SESSIONS = 100;

/** Convert connector/runtime failures into the closed, localizable reason-code
 * set exposed by the session projection. Never persist upstream error strings. */
export function safeCertificationFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (/credential|api.?key|safe.?storage/i.test(code)) return "credential_unavailable";
  if (/balance|billing|payment|insufficient/i.test(code)) return "provider_balance";
  if (/quota|rate.?limit|429/i.test(code)) return "provider_quota";
  if (/workflow|candidate|binding|input|missing_media|prompt_missing/i.test(code)) return "invalid_input";
  if (/timeout|network|fetch|connect|socket/i.test(code)) return "provider_network";
  if (/unavailable|runner/i.test(code)) return "certification_unavailable";
  return "provider_failed";
}
export function integrationStageFromAdapterRun(stage: ProviderAdapterRun["stage"]): IntegrationStage {
  if (stage === "completed" || stage === "partial") return stage;
  if (["queued", "discovering_docs", "compiling", "testing", "repairing", "reconciling"].includes(stage))
    return "certifying";
  return "failed";
}

export function adapterTerminalReasonCode(stage: ProviderAdapterRun["stage"]): string {
  if (stage === "needs_ai") return "certification_needs_ai";
  if (stage === "timed_out") return "certification_timed_out";
  if (stage === "cancelled") return "certification_cancelled";
  if (stage === "stale") return "certification_stale";
  return "provider_failed";
}

/**
 * 2026-09-12 删掉花费确认那一关之后，**旧盘上**还躺着它的痕迹：三个已退役的 stage
 * 和五个只为收据/挑战存在的字段。这不是并行代码路径，是一次性读旧数据——
 * 就地改写成新词表，读完盘上就不再有它们。
 *
 * 为什么是改写不是丢弃：停在 `needs_spend_confirmation` 的会话恰恰是被那条死路卡住的那些
 * （外部宿主永远走不出去，见 docs/research/2026-09-12-real-onboarding-acceptance §P0-1）。
 * 丢掉等于让用户重来一遍；改写成 `ready_to_certify` 等于把他直接放出来。
 */
const RETIRED_SPEND_GATE_STAGES = new Set([
  "needs_spend_confirmation",
  "awaiting_human_confirmation",
  "human_confirmed",
]);
const RETIRED_SPEND_GATE_FIELDS = [
  "startReceiptDigest",
  "pendingReceiptId",
  "startReceiptStatus",
  "pendingChallengeId",
  "pendingConfirmationKey",
] as const;
function migrateRetiredSpendGate(item: Record<string, unknown>): void {
  if (typeof item.stage === "string" && RETIRED_SPEND_GATE_STAGES.has(item.stage)) item.stage = "ready_to_certify";
  for (const field of RETIRED_SPEND_GATE_FIELDS) delete item[field];
}

/**
 * 修复之前落盘的 `certifying`/`committing` 会话没有 `certifyingDeadlineAt`，
 * 于是会话看门狗按「没根据不判死」原则永远不碰它们——用户盘上那几条已经卡死的会话
 * 会继续卡到手动删文件。这里按它**最后一次动过的时间**补一个到期时间：
 * 那是我们对「这次认证什么时候还活着」唯一有据可查的时刻，比重新从现在起算诚实
 * （从现在起算等于每次重启都给它续命一轮）。
 */
function backfillCertifyingDeadline(item: Record<string, unknown>): void {
  if (typeof item.stage !== "string" || !isCertifyingIntegrationStage(item.stage)) return;
  if (typeof item.certifyingDeadlineAt === "string" && item.certifyingDeadlineAt) return;
  const anchor = typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt))
    ? item.updatedAt
    : undefined;
  if (!anchor) return;
  item.certifyingDeadlineAt = integrationCertifyingDeadlineAt(anchor);
}

/**
 * 字节轴的预算。留 20% 余量是为了让**预算先响、兜底后响**：兜底（写盘那 1MiB）只会抛
 * `oversized`，兜底才保得住「fail-closed 最后一道」的身份。0.8 与同族 promotionJournal
 * 的压缩触发同源（见其 compact()）。
 */
const INTEGRATION_SESSION_BYTE_BUDGET = Math.floor(CERTIFICATION_MAX_FILE_BYTES * 0.8);

/** 裁剪结果的可诊断摘要。**只放聚合量与时间**：id / URL / 供应商字段一概不进日志。 */
type IntegrationSessionCapReport = {
  from: number;
  to: number;
  dropped: number;
  /** 被裁记录的 stage 分布，形如 `completed:9,failed:1`。 */
  stages: string;
  oldestDroppedAt?: string;
  newestDroppedAt?: string;
  reason: "count" | "bytes" | "count+bytes";
};

function sessionTouchedAt(entry: IntegrationSession): number {
  const stamp = Date.parse(entry.updatedAt || entry.createdAt || "");
  return Number.isFinite(stamp) ? stamp : 0;
}

function capReport(
  before: readonly IntegrationSession[],
  dropped: readonly IntegrationSession[],
  reason: IntegrationSessionCapReport["reason"],
): IntegrationSessionCapReport {
  const stages = new Map<string, number>();
  for (const entry of dropped) stages.set(entry.stage, (stages.get(entry.stage) || 0) + 1);
  const stamps = dropped.map(sessionTouchedAt).filter((value) => value > 0).sort((left, right) => left - right);
  return {
    from: before.length,
    to: before.length - dropped.length,
    dropped: dropped.length,
    stages: [...stages].map(([stage, count]) => `${stage}:${count}`).join(","),
    ...(stamps.length ? { oldestDroppedAt: new Date(stamps[0]).toISOString() } : {}),
    ...(stamps.length ? { newestDroppedAt: new Date(stamps[stamps.length - 1]).toISOString() } : {}),
    reason,
  };
}

/**
 * 容量合同的唯一执行者：超限时**只**挤掉终态会话，最旧的先走；非终态（还在进行中的）
 * 一条都不动。
 *
 * 为什么不按「最旧的一律挤掉」：一条 `draft`/`needs_credential`/`certifying` 会话代表用户
 * 手上还没做完的活（甚至挂着一条在飞的 child run）。把它悄悄删掉＝用户填到一半的接入凭空消失，
 * 而这正是上限本来要保护他免于遇到的那种事。终态会话则只是历史，挤掉只丢一条记录。
 *
 * `overCapacity` = 光非终态就已经越界（条数或字节），裁剪救不回来。这时照样把它们**全部**还回去
 * （宁可状态偏大，也不丢用户在做的事），由写侧据此拒绝新建——见 `assertIntegrationSessionCapacity`。
 *
 * **两根轴合在一个函数里**：条数与落盘字节是同一条不变量的两种越界方式——「这份状态必须始终
 * 写得回、也读得起」。分开写就会长出第二个裁剪器，两边迟早对同一份状态给出不同答案，
 * 而那正是本次根因（上限只在读侧断言、写侧无人执行）的同一个形状。
 */
export function capIntegrationSessions(
  sessions: readonly IntegrationSession[],
): { sessions: IntegrationSession[]; overCapacity: boolean; report?: IntegrationSessionCapReport } {
  const overCount = Math.max(0, sessions.length - MAX_INTEGRATION_SESSIONS);
  // 常规路径只量一次，和写盘那一次同量级；绝大多数时候到此为止。
  if (overCount === 0 && stateBytes(sessions) <= INTEGRATION_SESSION_BYTE_BUDGET)
    return { sessions: [...sessions], overCapacity: false };
  // 终态会话排成「最旧先走」的队；Array#sort 规范保证稳定，同一时刻的几条保持盘上原始顺序。
  const queue = sessions
    .filter((entry) => isTerminalIntegrationStage(entry.stage))
    .sort((left, right) => sessionTouchedAt(left) - sessionTouchedAt(right));
  const doomed = new Set(queue.slice(0, overCount));
  let kept = sessions.filter((entry) => !doomed.has(entry));
  const overBytes = stateBytes(kept) > INTEGRATION_SESSION_BYTE_BUDGET;
  // 字节轴沿同一条队列继续挤：一条超大记录就能顶翻整份状态，所以逐条复量，不按估算批量丢。
  for (let index = overCount; index < queue.length && stateBytes(kept) > INTEGRATION_SESSION_BYTE_BUDGET; index += 1) {
    doomed.add(queue[index]);
    kept = sessions.filter((entry) => !doomed.has(entry));
  }
  return {
    sessions: kept,
    overCapacity: kept.length > MAX_INTEGRATION_SESSIONS || stateBytes(kept) > INTEGRATION_SESSION_BYTE_BUDGET,
    // 「有没有丢记录」的**唯一**判据。越界不等于丢得动：全是非终态时一条都挤不掉，
    // `doomed` 是空的，于是没有 report、也就没有日志。日志那头不再重复判一次
    // （重复的守卫拆掉也不会红，等于看着在守、其实永远走不到）。
    ...(doomed.size ? { report: capReport(sessions, [...doomed], overCount > 0 && overBytes ? "count+bytes" : overBytes ? "bytes" : "count") } : {}),
  };
}

function stateBytes(sessions: readonly IntegrationSession[]): number {
  return certificationJsonBytes({ version: 1, revision: 0, sessions });
}

/**
 * 裁剪留痕。**丢了记录才写**——没丢就是例行检查，写了只会把日志淹掉；
 * 「没丢」的判据在 `capIntegrationSessions` 里（不生成 report），这里只认它的结论。
 *
 * 为什么非写不可：裁剪是我们背着用户删他的数据。不留痕＝他下次问「我那条接入记录呢」时，
 * 没有任何东西能把「盘被我们改过」和「盘本来就那样」分开。字段只放聚合量与时间，
 * 不放 id / URL / 供应商字段——日志是会被贴进 issue 的。
 *
 * `outcome` 分两种，**不能长一样**：`persisted` = 内存与盘都少了这些记录；
 * `memory-only` = 只有内存少了，盘上还是旧内容（内存与盘就此分叉，分叉本身另案，
 * 这里如实说出来就是它唯一的线索）。
 */
function logIntegrationSessionCompaction(
  report: IntegrationSessionCapReport | undefined,
  outcome: "persisted" | "memory-only",
  failure?: unknown,
): void {
  if (!report) return;
  logWarn("onboarding", "integration-sessions-compacted", {
    ...report,
    outcome,
    ...(failure === undefined ? {} : { failure: failure instanceof Error ? failure.name : "unknown" }),
  });
}

/**
 * 写这份状态的唯一出口：先过容量合同（两根轴），再落盘。
 * 每一次写都过，所以日后任何新增会话的路径都不必自己记得封顶。
 *
 * **留痕放在 `finally`**：裁剪一执行，记录就已经从内存里没了；而下一次 cap 看到的已经是裁剪后的
 * 数组、不会再生成 report。所以写日志这件事一旦押在 `save` 成功上，`save` 抛出的那一次删除就
 * **永远**不会被记录（2026-09-21 验收实测：盘上删了 3 条、日志只有 2 条）。`save` 的异常照旧抛出去。
 */
export function persistIntegrationSessionState(
  state: PersistedIntegrationState,
  save: (state: PersistedIntegrationState) => void,
): void {
  const capped = capIntegrationSessions(state.sessions);
  state.sessions = capped.sessions;
  try {
    save(state);
  } catch (error) {
    logIntegrationSessionCompaction(capped.report, "memory-only", error);
    throw error;
  }
  logIntegrationSessionCompaction(capped.report, "persisted");
}

/**
 * 新建会话前的容量闸。写侧的 `persist` 会替我们挤掉最旧的终态会话，但挤不动非终态：
 * 光是没做完的活就占满上限时，唯一诚实的答复是当场拒绝并说清怎么出去——
 * 悄悄删掉用户填到一半的接入，恰恰是这个上限本来要保护他免于遇到的事。
 */
export function assertIntegrationSessionCapacity(
  existing: readonly IntegrationSession[],
  incoming: IntegrationSession,
): void {
  const capped = capIntegrationSessions([...existing, incoming]);
  if (!capped.overCapacity) return;
  // 两根轴的说法不能混：条数满和「存不下了」对用户是两件事，但出路是同一条（取消一条）。
  const byCount = capped.sessions.length > MAX_INTEGRATION_SESSIONS;
  const escape = "Cancel one you no longer need (nomi_model_setup action=cancel) before starting another";
  throw new IntegrationRequestError(
    "integration_session_limit_reached",
    byCount
      ? `This machine already holds ${MAX_INTEGRATION_SESSIONS} unfinished model setups. ${escape}`
      : `The unfinished model setups on this machine already fill the space reserved for them. ${escape}`,
    byCount ? { limit: MAX_INTEGRATION_SESSIONS } : { limitBytes: INTEGRATION_SESSION_BYTE_BUDGET },
  );
}

/**
 * 读这份状态的唯一入口。**形状坏了照抛**（那是真需要被看见的信号），**容量超了就地裁剪
 * 并把结果写回去**——修复前这两件事共用一句 throw，正是启动静默退出的成因。
 *
 * 回写失败不许拖垮启动：返回的状态已经是对的，下次启动会再裁一次。这不是吞错——
 * 回写只是把自愈结果落盘的优化，它失败不改变任何不变量。
 */
export function readIntegrationSessionState(
  filePath: string,
  writeBack: (state: PersistedIntegrationState) => void,
): PersistedIntegrationState {
  if (!fs.existsSync(filePath)) return { version: 1, revision: 0, sessions: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Integration session storage is corrupt");
  }
  const validated = validateState(raw);
  const capped = capIntegrationSessions(validated.sessions);
  const state = { ...validated, sessions: capped.sessions };
  if (!capped.report) return state;
  // 和写侧同一个事件、同一套字段：丢了记录这件事只有一个说法，`outcome` 区分盘有没有跟上。
  try {
    writeBack(state);
  } catch (error) {
    logIntegrationSessionCompaction(capped.report, "memory-only", error);
    return state;
  }
  logIntegrationSessionCompaction(capped.report, "persisted");
  return state;
}

/**
 * 读侧只判**形状**，不判容量：条数多、字节大都是我们自己写出来的，不是文件坏了，
 * 把两件事共用一句 `throw` 正是「启动静默退出」的成因。容量交给
 * `capIntegrationSessions`，回写与留痕交给 `readIntegrationSessionState`。
 */
export function validateState(raw: unknown): PersistedIntegrationState {
  assertRecord(raw);
  if (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || !Array.isArray(raw.sessions))
    throw new Error("Invalid integration session state");
  const stages = new Set<IntegrationStage>(INTEGRATION_STAGES);
  // 与 handoffQueue 同源：内置 client 全量允许（2026-09-11 workbuddy 漏抄修复）。
  const owners = new Set<CapabilityOriginHost>(["external", "nomi", ...BUILTIN_MCP_CLIENTS]);
  for (const item of raw.sessions) {
    assertRecord(item);
    migrateRetiredSpendGate(item);
    backfillCertifyingDeadline(item);
    const allowedKeys = new Set([
      "schemaVersion",
      "id",
      "revision",
      "ownerClientId",
      "capabilityDigest",
      "kind",
      "stage",
      "configDigest",
      "credentialStatus",
      "childRunRef",
      "unresolvedFields",
      "blockingReason",
      "persistenceProof",
      "createdAt",
      "updatedAt",
      "config",
      "candidates",
      "selections",
      "credentialRef",
      "startIdempotencyKey",
      "compileRequest",
      "adapterDraft",
      "certifyingDeadlineAt",
    ]);
    const unknown = Object.keys(item).find((key) => !allowedKeys.has(key));
    if (unknown) throw new Error(`Invalid integration session field: ${unknown}`);
    if (
      item.schemaVersion !== 1 ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9._-]+$/.test(item.id) ||
      !Number.isSafeInteger(item.revision) ||
      !owners.has(item.ownerClientId as CapabilityOriginHost) ||
      !stages.has(item.stage as IntegrationStage) ||
      !Array.isArray(item.unresolvedFields) ||
      !Array.isArray(item.candidates) ||
      !Array.isArray(item.selections) ||
      !item.config ||
      typeof item.config !== "object" ||
      !INTEGRATION_CREDENTIAL_STATUSES.includes(item.credentialStatus as IntegrationCredentialStatus)
    )
      throw new Error("Invalid integration session record");
  }
  return { version: 1, revision: Number(raw.revision), sessions: raw.sessions as IntegrationSession[] };
}