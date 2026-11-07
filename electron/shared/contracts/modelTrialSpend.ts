// 试跑「上一笔结果不确定时开新单」的跨进程契约（设计卡 docs/plan/2026-10-30-try-model-intent-lock.md）。

/** 付费确认卡按它查表取专用措辞（src/workbench/capability/spendCardByIntent.ts）。 */
export const UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT = "model-trial-uncertain-prior";
