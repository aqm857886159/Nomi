/**
 * Nomi adaptation boundary for Vercel AI Elements (Apache-2.0).
 * Source anatomy: docs/research/2026-09-06-ai-elements-anatomy.md.
 * We retain the presentational contracts only; React 18, Tailwind 3 and
 * Mantine stay authoritative in this repository.
 */
export const AI_ELEMENTS_TOOL_STATUSES = [
  'input-streaming', 'input-available', 'approval-requested',
  'approval-responded', 'output-available', 'output-denied', 'output-error',
] as const
export type AiElementsToolStatus = (typeof AI_ELEMENTS_TOOL_STATUSES)[number]

export const AI_ELEMENTS_BUILDING_BLOCKS = [
  'Message', 'Response', 'Actions', 'Tool', 'Task', 'Confirmation',
  'Plan', 'Queue', 'PromptInput', 'ModelSelector', 'Attachments', 'Context',
] as const
export type AiElementsBuildingBlock = (typeof AI_ELEMENTS_BUILDING_BLOCKS)[number]

/**
 * icon 家族的真身是 `../AgentPanelV4Icons.tsx` 的 ACTION_ICONS —— 唯一 owner。
 * 这里曾抄过一份 6 条的表，两处对不上（timeline 抄成 IconTimelineEvent、video 抄成 IconVideo，
 * 定稿样张的 path 反查出来的是 IconTimeline / IconMovie），正是同一语义两份定义的典型。
 */
