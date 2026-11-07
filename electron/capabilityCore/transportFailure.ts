// 「抛出来的异常 → 模型看得见的失败」**唯一的组装处**（2026-09-22）。
//
// ── 为什么它非存在不可 ──
//
// 2026-09-21 真实模型 18 句实测（`docs/evidence/2026-09-21-askback-real-model/`）：121 次调用里 45 次是
// 重试，其中 **23 次**收到的是同一句「The generation action could not be completed; its submission
// outcome may be unknown. Next: Query the same domain-qualified task and reconcile…」。`draft_shots`
// **只是起草**，一分钱都花不出去，却被告知「提交结果可能未知、先去核对别再提交」——模型于是原地
// 打转（A3 那一轮 27 次调用 / 696 秒）。
//
// 复现拿到的真异常是两句**完全可行动**的话（`docs/fixes/2026-09-22-domain-refusal-becomes-unknown-outcome.root-cause.json`）：
//   `参考素材 gen-v2-asset-… 不在这个项目的素材库里，请先用 look_at_media 找到它的 assetId`
//   `Video mode omni does not match transport task text_to_video`
// 两条都是 `new Error(...)`——**没有 `code`**。于是 adapter 的兜底把它们收敛成
// `generation_execution_failed`，措辞层再按码查出那句「结果可能未知」。**兜底吃掉的是我们自己写的
// 那句人话，不是供应商文本。**
//
// ── 为什么修在这里，而不是在 `draft_shots` 上打一个补丁 ──
//
// 这个「把异常收敛成一个裸码」的函数，全仓**有 8 份手写副本**（canvasRead / canvasWrite /
// documentRead / documentWrite / generation / phase4Surface / productionRun / timeline），
// 四种不同的写法、三种不同的 message 处置。C4 那一刀已经把**放行码表**收敛到
// `CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES` 一个 owner；这一刀把**函数本身**收敛掉。
// 只修 generation 那一份，等于让同一个缺陷在另外 7 扇门后面继续活着。
//
// ── 不变量：兜底只留给真的未知 ──
//
// 供应商 / 凭据的原始文本**永远**不许到模型那里（`generationTransportAdapters.test.ts` 的 C18
// 「synthetic secrets never become public failures」逐字守着这条）。所以分两档：
//   · 我们**有意**拒绝一次调用 → `ModelFacingRefusal`，message 是我们自己写的，原样交给模型；
//   · 其它任何异常（TypeError、供应商抛的、上游库抛的）→ 只给码，一个字的正文都不带。
// 判据不是「看起来像不像内部信息」，是**谁写的这句话**——后者有单一答案，前者没有。
import type { RuntimeToolDecision } from "../shared/agentCapabilities/transportContracts";
import { GENERATION_INPUT_INVALID_CODE } from "../shared/agentCapabilities/admissionRejectionHints";
import type { ToolInputIssue } from "../shared/agentLane/toolInputIssues";

export type TransportFailure = Extract<RuntimeToolDecision, { ok: false }>;

/**
 * 我们**有意**拒绝这次调用时抛的错：`message` 是我们自己写的一句可行动的话，因此可以原样给模型看。
 *
 * 别拿它包供应商/上游的异常——那一档走 `safeTransportFailure` 的兜底，只给码。
 */
export class ModelFacingRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelFacingRefusal";
    this.code = code;
  }
}

/** 抛一条模型读得懂的拒绝。`code` 必须是本 adapter 放行表里的码，否则它会被收敛成兜底码。 */
export function refuseToModel(code: string, message: string): never {
  throw new ModelFacingRefusal(code, message);
}

export type SafeTransportFailureOptions = Readonly<{
  /** 这条传输路允许送到模型那里的码（`CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES` + 本路自有的几个）。 */
  allowedCodes: ReadonlySet<string>;
  /** 码不在放行表里时用它。 */
  fallbackCode: string;
  /** 本路认得的错误类 → 码（如 `ProductionRunNotFoundError` → `production_run_not_found`）。 */
  classify?: (error: unknown) => string | undefined;
  /** 我们自己 schema 产生的逐字段理由（**字段名**，不是收到的值）。 */
  detail?: (error: unknown) => string | undefined;
  /** 准入层拒绝的具体码（`ParameterRejectionCode`）：`code` 是放行表里的粗码，这一格才说清哪一种。 */
  admission?: (error: unknown) => string | undefined;
  /**
   * 准入层拒绝的**字段事实**（哪个字段、合法值 / 近似键 / 范围），收成和形状校验同一份清单（`toolInputIssues`）。
   * 面板按它说「哪个字段 · 该填什么」，熔断按它的字段路径认墙；正文仍是 `ownMessage` 那句我们自己写的话。
   */
  issues?: (error: unknown) => readonly ToolInputIssue[] | undefined;
  /** 结构化 reason（媒体导入那一族）。 */
  reason?: (error: unknown) => TransportFailure["reason"] | undefined;
  /** 本路对**落到兜底码**这件事的留痕（兜底盖住的也可能是我们自己的缺陷）。 */
  onFallback?: (rawCode: string | undefined, error: unknown) => void;
  /** 我们自己写的、可以原样送出的正文（`ModelFacingRefusal` 之外的既有错误类）。 */
  ownMessage?: (error: unknown) => string | undefined;
}>;

function rawCodeOf(error: unknown): string | undefined {
  return error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

/**
 * 把一个抛出来的异常翻成模型看得见的失败。**8 条传输路唯一的那一个实现。**
 */
export function safeTransportFailure(error: unknown, options: SafeTransportFailureOptions): TransportFailure {
  const raw = rawCodeOf(error);
  // `classify` 是**我们**认出来的（错误类 → 码），所以它说了算；`error.code` 是一个**可能来自上游**的
  // 字符串，必须在放行表里才作数。两者不能合流：合流之后，上游只要在异常上挂一个 `code:
  // "generation_operation_not_found"`，就能让模型相信「这个任务不存在」——
  // `generationTransportAdapters.test.ts` 的 C18「provider forged absence」守的正是这条。
  const code = options.classify?.(error)
    ?? (raw && options.allowedCodes.has(raw) ? raw : options.fallbackCode);
  if (code === options.fallbackCode) options.onFallback?.(raw, error);
  const own = error instanceof ModelFacingRefusal ? error.message : options.ownMessage?.(error);
  const detail = options.detail?.(error);
  const message = own && own.trim() ? own.trim()
    : detail && detail.trim() ? `${code} — ${detail.trim()}`
      : code;
  const reason = options.reason?.(error);
  const admission = options.admission?.(error);
  const issues = options.issues?.(error);
  return {
    ok: false, code, message,
    ...(reason ? { reason } : {}), ...(admission ? { admission } : {}), ...(issues && issues.length > 0 ? { issues } : {}),
  };
}

/**
 * 生成域「模型写的入参我们收不了」那一档的码。
 *
 * 它本来就在这条路的放行表里（`GENERATION_PUBLIC_FAILURE_CODES`），2026-09-22 起同时承载域里
 * **有意**抛出的拒绝：一次 `refuseToModel(GENERATION_ARGUMENT_REFUSAL, "…")` 写清「哪个字段不行、
 * 该改成什么」，模型读到的就是那句话，而不是兜底的「提交结果可能未知」。
 */
export const GENERATION_ARGUMENT_REFUSAL = GENERATION_INPUT_INVALID_CODE;
