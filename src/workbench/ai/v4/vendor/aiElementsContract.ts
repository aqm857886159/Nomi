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

export const NOMI_ICON_RULES = {
  timeline: 'IconTimelineEvent',
  document: 'IconFileText',
  canvas: 'IconLayersSubtract',
  image: 'IconPhoto',
  video: 'IconVideo',
  status: 'spinner/check/alert',
} as const
