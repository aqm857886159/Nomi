import type { AgentChatHistory, AgentChatStatus } from '../../../../electron/harness/agentChatContracts'
import type { GenerationCanvasSnapshot } from '../model/generationCanvasTypes'
import { assertTurnCanWrite } from '../../ai/agentTurnLifecycle'
import { sendGenerationCanvasAgentMessage } from './generationCanvasAgentClient'
import { generationCanvasTools } from './generationCanvasTools'
import { applyCanvasToolCall, type StoryboardPlanApplicationResult } from './applyCanvasToolCall'
import { formatCanvasForAgent } from './canvasPromptContext'
import { evaluateGate } from './gate'
import { buildLockGateContext } from './lockGateContext'
import { STORYBOARD_PLANNER_SKILL, buildStoryboardPlanningMessage, type StoryboardShotMode } from './storyboardLauncher'
import { parseStoryboardPlan, type StoryboardPlan } from './storyboardPlan'

type StoryboardPlannerInput = {
  projectId?: string
  featureKey?: string
  canWrite: () => boolean
  storyText?: string
  shotMode?: StoryboardShotMode
  currentPlan?: StoryboardPlan | null
  revisionRequest?: string
  /** P4：方案归属的原稿 documentId（发起拆镜头时捕获，异步期间切文档不串稿）。 */
  documentId?: string
  /** Existing design to revise. Omit when the planner should create a new design. */
  storyboardId?: string
  skill?: { key: string; name: string }
  onContent?: (text: string) => void
  onCancelReady?: (cancel: () => void) => void
} & (
  | { target: 'creation'; history: Extract<AgentChatHistory, { kind: 'persistent' }> }
  | { target: 'production'; history: Extract<AgentChatHistory, { kind: 'ephemeral' }>; snapshot: GenerationCanvasSnapshot }
)

/** Same planner capability for inline and production. Only the inline caller
 * projects the parsed plan into the editor; production owns the returned plan. */
export async function runStoryboardPlanner(input: StoryboardPlannerInput): Promise<{
  text: string
  status: AgentChatStatus
  plan?: StoryboardPlan
  application?: StoryboardPlanApplicationResult
}> {
  const snapshot = input.target === 'production' ? input.snapshot : generationCanvasTools.read_canvas()
  const target = input.target
  const canWrite = input.canWrite
  let plan: StoryboardPlan | undefined
  let application: StoryboardPlanApplicationResult | undefined
  const { response } = await sendGenerationCanvasAgentMessage({
    message: buildStoryboardPlanningMessage({
      storyText: input.storyText, currentPlan: input.currentPlan, revisionRequest: input.revisionRequest,
      ...(input.shotMode ? { shotMode: input.shotMode } : {}),
    }),
    projectId: input.projectId,
    history: input.history,
    featureKey: input.featureKey,
    capability: 'storyboard',
    canWrite,
    snapshot,
    selectedNodes: [],
    mode: 'agent',
    skill: input.skill || STORYBOARD_PLANNER_SKILL,
    onContent: (_delta, text) => { if (canWrite()) input.onContent?.(text) },
    onCancelReady: input.onCancelReady,
    onToolCall: async (event) => {
      if (!canWrite() || !['read_canvas_state', 'propose_storyboard_plan'].includes(event.toolName)) {
        await event.confirm({ ok: false, denied: true, message: 'storyboard turn cannot perform this action' })
        return
      }
      try {
        let result: unknown
        if (target === 'creation') {
          const gate = evaluateGate({ kind: 'tool-call', toolName: event.toolName, args: event.args }, buildLockGateContext())
          if (gate.outcome !== 'allow') {
            await event.confirm({ ok: false, denied: true, message: gate.outcome === 'deny' ? gate.reason : 'storyboard action requires approval' })
            return
          }
          result = await applyCanvasToolCall(event.toolName, event.args, undefined, canWrite, input.documentId, input.storyboardId)
          if (event.toolName === 'propose_storyboard_plan') application = result as StoryboardPlanApplicationResult
        } else if (event.toolName === 'read_canvas_state') {
          // This snapshot was captured by the capability host before its first await.
          result = formatCanvasForAgent(snapshot)
        }
        assertTurnCanWrite(canWrite)
        if (event.toolName === 'propose_storyboard_plan') {
          const parsedPlan = parseStoryboardPlan(event.args)
          if (target === 'production') {
            plan = parsedPlan
            result = { title: plan.title, anchorCount: plan.anchors.length, shotCount: plan.shots.length }
          } else if (application?.status === 'applied') {
            plan = parsedPlan
          }
        }
        await event.confirm({ ok: true, result, silent: true })
      } catch (error: unknown) {
        await event.confirm({ ok: false, message: error instanceof Error ? error.message : String(error), ...(!canWrite() ? { denied: true } : {}) })
      }
    },
  })
  return { text: response.text.trim(), status: response.status, ...(plan ? { plan } : {}), ...(application ? { application } : {}) }
}
