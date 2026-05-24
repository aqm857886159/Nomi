/**
 * Story → Storyboard demo launcher.
 *
 * The creation AI panel's "🎬 拆镜头" chip / natural-language trigger calls
 * `requestStoryboardPlanning(text)`; the generation-canvas assistant
 * panel listens on the same global event channel and runs the storyboard
 * planner skill against the supplied story text.
 *
 * We intentionally route through a CustomEvent on `window` rather than a
 * shared zustand slice so that the launcher works across React lifecycles
 * (e.g. the panel may be remounted when the user switches workspace mode).
 */

export const STORYBOARD_PLANNING_EVENT = 'nomi:generation:storyboard:request' as const

export type StoryboardPlanningRequest = {
  /** The full story text the user wrote in the creation editor. */
  storyText: string
  /** Optional source label for analytics or UI ("creation-editor", "library-try-now"). */
  source?: string
}

export const STORYBOARD_PLANNER_SKILL = {
  key: 'workbench.storyboard.planner',
  name: '故事板规划师',
} as const

/**
 * Build the user-facing message we send to the storyboard planner agent.
 * The skill body already contains the full methodology, so we just hand
 * the agent the story text and one short instruction.
 */
export function buildStoryboardPlanningMessage(storyText: string): string {
  const trimmed = storyText.trim()
  return [
    '请把下面这段故事拆成 6-12 个镜头节点，按时序连边，写入生成画布。',
    '',
    '--- 故事正文 ---',
    trimmed,
    '--- 故事正文结束 ---',
  ].join('\n')
}

/**
 * Dispatch a storyboard planning request. Returns true if at least one
 * listener (i.e. the canvas assistant panel) is mounted; callers may use
 * the return value to decide whether to show a fallback toast.
 */
export function requestStoryboardPlanning(request: StoryboardPlanningRequest): boolean {
  if (typeof window === 'undefined') return false
  const event = new CustomEvent<StoryboardPlanningRequest>(STORYBOARD_PLANNING_EVENT, {
    detail: request,
  })
  return window.dispatchEvent(event)
}
