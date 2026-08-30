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

export type AdapterRunStage = typeof ADAPTER_RUN_STAGES[number];
