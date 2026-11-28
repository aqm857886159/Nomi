// Provider Adapter 跨主进程、IPC 与渲染层的中立运行阶段合同（单一真源）。
export const ADAPTER_RUN_STAGES = [
  "queued",
  "discovering_docs",
  "compiling",
  "testing",
  "repairing",
  "reconciling",
  "completed",
  "partial",
  "failed",
  "needs_ai",
  "cancelled",
  "timed_out",
  "stale",
] as const;

export type AdapterRunStage = (typeof ADAPTER_RUN_STAGES)[number];

/** Provider Adapter 终态阶段词表（单一 `as const` 真源，与 `isTerminalAdapterRunStage` 共用）。 */
export const TERMINAL_RUN_STAGES = [
  "completed",
  "partial",
  "failed",
  "needs_ai",
  "cancelled",
  "timed_out",
  "stale",
] as const satisfies readonly AdapterRunStage[];

export type TerminalAdapterRunStage = (typeof TERMINAL_RUN_STAGES)[number];

const TERMINAL_RUN_STAGE_SET: ReadonlySet<AdapterRunStage> = new Set(TERMINAL_RUN_STAGES);

/** 全仓唯一「Adapter Run 是否已进入终态」判据，禁止各层自建终态 Set。 */
export function isTerminalAdapterRunStage(stage: AdapterRunStage): stage is TerminalAdapterRunStage {
  return TERMINAL_RUN_STAGE_SET.has(stage);
}
