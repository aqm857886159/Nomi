/**
 * 一次工具失败的**结构化信封**——给用户面用的那一份（C5，2026-09-18）。
 *
 * 为什么要它：失败在这套系统里是 `throw` 出去的（G-02：return 一个失败对象会让 pi 记
 * `isError: false`），而 throw 只带得走一个 `message`。于是 `renderLaneToolFailure` 把
 * code / nextAction / allowed / issues 全部拍平成一段**英文散文**，面板拿到的就只有那段散文。
 * `laneViewModel.ts:380` 只摘掉成功信封的尾行，失败正文原样进 `.tsx`——中文界面上于是出现
 * `The current target could not accept this action (surface_port_stale). Next: …`
 * （审计 §5 / B03 截图）。
 *
 * 唯一的出路是把**结构**送到渲染层，让它按 `code` 查 i18n 词条，而不是去正则那段英文
 * （`residentToolDisplay.humanizeValidationProse` 就是那条老路：它只认得出 schema 校验那一种，
 * 其余一律 `?? text` 落回英文）。运送方式用的是 pi 自己给的 `after_tool` 钩子——
 * 它的 result 支持 `details`（`harness/agent-harness.d.ts:564`），和成功那条路
 * （`details.nextAction`）逐字同形，不是第二套机制。
 *
 * 本文件**只依赖同样零依赖的 `generationProblem.ts`**，理由与 `laneToolNextAction.ts` 逐字相同：渲染层要 import 它，
 * 而它不能把 `agentCapabilities/*` → zod 那条链拖进浏览器 bundle（#614 白屏）。
 */
import { generationProblemOf, type GenerationProblem } from "../generationProblem";

/**
 * 一条入参问题属于哪一类。面板按它出本地话（「没有这个字段，是不是要写 X」「要填 A、B 之一」……），
 * 模型那一行也按它写（`toolInputIssues.ts` 的 `renderToolInputIssue`）。闭合词表。
 */
export type ToolInputIssueKind =
  | "unknown_field" | "not_allowed" | "wrong_type" | "missing" | "out_of_range" | "too_few" | "too_many" | "invalid";

const ISSUE_KINDS: ReadonlySet<string> = new Set<ToolInputIssueKind>([
  "unknown_field", "not_allowed", "wrong_type", "missing", "out_of_range", "too_few", "too_many", "invalid",
]);

/**
 * 一条入参问题的**公开**形状：字段路径 + 合法值 / 近似键 / 期望类型 / 范围。**绝不含收到的值**
 * （用户文稿正文可能在参数里）。2026-11-07 前只有 `path / expected / receivedType` 三格，
 * 老转录里的信封仍是那个形状，所以 `kind` 之外全是可选的。
 */
export interface LaneToolPublicIssue {
  readonly path: string;
  readonly kind?: ToolInputIssueKind;
  /** 期望的类型名（`object` / `array` / `number`……）。 */
  readonly expected?: string;
  readonly receivedType?: string;
  /** 不在表里时：合法值；未知字段时：这一层可填的字段名。 */
  readonly allowed?: readonly string[];
  /** 最接近的合法键 / 值（只在真的接近时才有）。 */
  readonly nearest?: string;
  readonly min?: number;
  readonly max?: number;
}

/**
 * 进转录、过 IPC、到渲染层的那一份。**刻意只带闭合词表与结构化事实，不带任何散文**：
 * `message`/`nextAction` 是给模型读的英文，带上来只会诱使渲染层再印一次。
 */
export interface LaneToolPublicFailure {
  /** 闭合词表，UI 按它查 i18n 词条。 */
  readonly code: string;
  /** 枚举/operation 的全部合法值（模型自纠用；UI 只在「参数不合法」那一档展开）。 */
  readonly allowed?: readonly string[];
  /** 出错的字段：字段名、合法值 / 近似键 / 类型名，**绝不含收到的值**（用户文稿正文可能在参数里）。 */
  readonly issues?: readonly LaneToolPublicIssue[];
  /** `code === "wrong_verb"` 时正确的动词名。 */
  readonly useInstead?: string;
  /**
   * `code === "generation_input_invalid"` 时的闭合原因（2026-11-08 起）。面板按 `problem.code` 说原因，遥测记它。
   * 0.24 及以前的转录没有这一格：面板照旧按 `code` + `issues` 说，一个字都不变。
   */
  readonly problem?: GenerationProblem;
}

/** 从工具结果的 `details` 里读回信封。形状不对就当没有——历史转录里什么版本都可能有。 */
export function laneToolFailureOf(details: unknown): LaneToolPublicFailure | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const candidate = (details as { failure?: unknown }).failure;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  if (typeof record.code !== "string" || !record.code) return undefined;
  return {
    code: record.code,
    ...(Array.isArray(record.allowed) && record.allowed.every((item) => typeof item === "string")
      ? { allowed: record.allowed as string[] } : {}),
    ...(Array.isArray(record.issues) ? { issues: record.issues.flatMap(publicIssueOf) } : {}),
    ...(typeof record.useInstead === "string" ? { useInstead: record.useInstead } : {}),
    ...(problemOf(record.problem)),
  };
}

const problemOf = (value: unknown): { problem?: GenerationProblem } => {
  const problem = generationProblemOf(value);
  return problem ? { problem } : {};
};

const stringList = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : undefined;

/** 一条 issue 的逐格读回：形状不对的格丢掉，整条没有 `path` 就不要（历史转录里什么版本都可能有）。 */
function publicIssueOf(value: unknown): LaneToolPublicIssue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.path !== "string") return [];
  const allowed = stringList(record.allowed);
  return [{
    path: record.path,
    ...(typeof record.kind === "string" && ISSUE_KINDS.has(record.kind) ? { kind: record.kind as ToolInputIssueKind } : {}),
    ...(typeof record.expected === "string" ? { expected: record.expected } : {}),
    ...(typeof record.receivedType === "string" ? { receivedType: record.receivedType } : {}),
    ...(allowed ? { allowed } : {}),
    ...(typeof record.nearest === "string" ? { nearest: record.nearest } : {}),
    ...(typeof record.min === "number" ? { min: record.min } : {}),
    ...(typeof record.max === "number" ? { max: record.max } : {}),
  }];
}

/**
 * lane 工具**自己**产出的失败码（不含从域里流过来的传输码）。
 *
 * 传输那一族的唯一值源在 `surfacePortBinding.ts`（C4）；这里只列 lane 工具这一层自有的。
 * 两者合起来就是「面板需要有一句本地话」的闭合集合，由 `check:error-surface` 规则④ 逐条比对。
 *
 * 码不在这个集合里时（域里还有大量更专门的码），面板退到 `unknown` 那一条——
 * 它是本语言的一句人话，**不带码**（码是给排查看的，不是给创作者看的），也**绝不是**模型收到的那段英文散文。
 */
export const LANE_TOOL_OWN_FAILURE_CODE_LIST = [
  "tool_arguments_invalid",
  "tool_execution_failed",
  "tool_timed_out",
  "wrong_verb",
  "generation_surface_unavailable",
  "task_reference_required",
  "generation_operation_not_found",
  "production_run_not_found",
  "generation_execution_failed",
  // 与上面那条的区别是**事实**，不是措辞：账本里没有任何一份提交意图落过盘，
  // 所以「没发起」是可验证的，不是安慰话。分两个码，是因为用户下一步该做的事不一样：
  // 一个是「改一下再按」，另一个是「先去核对，别再付一次」。
  "generation_not_started",
  "generation_provider_unavailable",
  // 准入层（模型档案）拒收入参的粗码。它不是 lane 自己铸的，但它是 Agent 起草时**最常见**的失败
  // （11-07 用户反馈「经常参数不合法」）；不在这张表里时面板只能落到兜底那一句。
  "generation_input_invalid",
  // 入参边界：同一工具同一处连错 3 次，这一次被拦下没执行（`laneToolInputBoundary.mts`）。
  "tool_retry_stopped",
] as const;

export type LaneToolOwnFailureCode = (typeof LANE_TOOL_OWN_FAILURE_CODE_LIST)[number];
