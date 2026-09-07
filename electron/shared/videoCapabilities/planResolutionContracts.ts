import type { MergeProposal, PlanIssue, PlanShotInput, SplitProposal } from "./planResolver";

/**
 * Generation Strategy Resolver —— GUI 窄 IPC 的线上契约（nomi:generation:resolve-plan）。
 *
 * 与 agent/MCP 的 `resolve` operation 共用**同一输入结构（shots/goals）与同一 planning seam**，
 * 所以这里只定义「信封 + 线上形状」，不含任何决策逻辑——决策唯一真相在 planResolver + seam。
 * 渲染层 import 本文件做类型，绝不自行构造候选集（候选只存在于主进程 seam 内）。
 */

/** GUI 窄 IPC resolve 请求。projectId 用于与主进程 committed surface selection 比对（防串项目/旧标签页）。 */
export type GenerationResolvePlanRequest = {
  projectId: string;
  /** 逻辑镜头（PlanShotInput 子集，字段语义见 planResolver）。 */
  shots: PlanShotInput[];
  goals?: { allowAdvisoryMerge?: boolean };
};

/** resolve 输出的单镜视图（seam resolve 分支的 host-facing 形状，渲染层直接消费）。 */
export type GenerationResolveShotView = {
  id: string;
  modelKey: string | null;
  modeId: string;
  modeLabel: string;
  durationMin: number | null;
  durationMax: number | null;
  params: Record<string, string | number | boolean>;
  issues: PlanIssue[];
};

/** seam resolve 分支成功载荷（与 agent/MCP 返回形状一致 → 两端同源）。 */
export type GenerationResolvePlanValue = {
  resolvedShots: GenerationResolveShotView[];
  mergeProposals: MergeProposal[];
  splitProposals: SplitProposal[];
  planIssues: PlanIssue[];
};

/** 窄 IPC 信封：ok=false 携带结构化 code（渲染层据此 i18n / fail-closed，不把裸异常抛给 UI）。 */
export type GenerationResolvePlanEnvelope =
  | { ok: true; value: GenerationResolvePlanValue }
  | { ok: false; error: { code: string; message: string } };

/** 信封错误码（稳定字符串；渲染层按 code 映射 i18n 文案，message 只作开发者兜底）。 */
export const GenerationResolveErrorCode = {
  /** 请求形状非法（projectId/shot 缺失、非数组等）。 */
  InputInvalid: "generation_input_invalid",
  /** 当前没有打开项目，或请求的 projectId 与 committed selection 不一致（切了项目/旧标签页）。 */
  ProjectStale: "project_binding_stale",
  /** 能力核未启动 / planning seam 未装配。 */
  CoreUnavailable: "generation_core_unavailable",
  /** seam 返回形状异常（防御性；正常不应发生）。 */
  InvalidResult: "generation_resolve_invalid_result",
  /** 其它未分类失败（携带原始 code 时优先用原始 code）。 */
  Failed: "generation_resolve_failed",
} as const;
