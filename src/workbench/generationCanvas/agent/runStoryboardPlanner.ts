import type { AgentChatHistory, AgentChatStatus } from '../../../../electron/harness/agentChatContracts'
import type { CapturedCanvasReadSnapshotHandleWire } from '../../../../electron/shared/surfacePortBinding'
import type { CanvasReadResult } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { assertTurnCanWrite } from '../../ai/agentTurnLifecycle'
import { sendGenerationCanvasAgentMessage, type ToolCallEvent } from './generationCanvasAgentClient'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import type { StoryboardPlanApplicationResult } from './applyCanvasToolCall'
import { evaluateGate } from './gate'
import { buildLockGateContext } from './lockGateContext'
import { STORYBOARD_PLANNER_SKILL, buildStoryboardPlanningMessage, type StoryboardShotMode } from './storyboardLauncher'
import { parseStoryboardPlan, type StoryboardPlan } from './storyboardPlan'

type StoryboardPlannerInput = {
  turnId?: string
  projectId?: string
  featureKey?: string
  canWrite: () => boolean
  storyText?: string
  shotMode?: StoryboardShotMode
  currentPlan?: StoryboardPlan | null
  revisionRequest?: string
  displayPrompt?: string
  /** P4：方案归属的原稿 documentId（发起拆镜头时捕获，异步期间切文档不串稿）。 */
  documentId?: string
  /** Existing design to revise. Omit when the planner should create a new design. */
  storyboardId?: string
  skill?: { key: string; name: string }
  onContent?: (text: string) => void
  onCancelReady?: (cancel: () => void) => void
} & (
  | { target: 'creation'; history: AgentChatHistory }
  | {
      target: 'production'
      history: Extract<AgentChatHistory, { kind: 'ephemeral' }>
      snapshot: CanvasReadResult
      capturedCanvasReadSnapshot: CapturedCanvasReadSnapshotHandleWire
    }
)

/** Same planner capability for inline and production. Only the inline caller
 * projects the parsed plan into the editor; production owns the returned plan. */
export async function runStoryboardPlanner(
  input: StoryboardPlannerInput,
): Promise<{ text: string; status: AgentChatStatus; plan?: StoryboardPlan; application?: StoryboardPlanApplicationResult }> {
  const target = input.target
  const canWrite = input.canWrite
  let plan: StoryboardPlan | undefined
  let application: StoryboardPlanApplicationResult | undefined
  const agentRequestBase = {
    ...(input.turnId ? { turnId: input.turnId } : {}),
    message: buildStoryboardPlanningMessage({
      storyText: input.storyText,
      currentPlan: input.currentPlan,
      revisionRequest: input.revisionRequest,
      ...(input.shotMode ? { shotMode: input.shotMode } : {}),
    }),
    ...(input.displayPrompt ? { displayMessage: input.displayPrompt } : {}),
    projectId: input.projectId,
    featureKey: input.featureKey,
    capability: 'storyboard' as const,
    canWrite,
    selectedNodes: [],
    mode: 'agent' as const,
    skill: input.skill || STORYBOARD_PLANNER_SKILL,
    onContent: (_delta: string, text: string) => {
      if (canWrite()) input.onContent?.(text)
    },
    onCancelReady: input.onCancelReady,
    onToolCall: async (event: ToolCallEvent) => {
      // canvas.read is intercepted and executed by the main-process capability
      // registry. Anything except the planner proposal reaching this renderer
      // callback is an ownership violation and fails closed.
      if (!canWrite() || event.toolName !== 'propose_storyboard_plan') {
        await event.confirm({ ok: false, denied: true, message: 'storyboard turn cannot perform this action' })
        return
      }
      try {
        let result: unknown
        if (target === 'creation') {
          const gate = evaluateGate(
            { kind: 'tool-call', toolName: event.toolName, args: event.args },
            buildLockGateContext(),
          )
          if (gate.outcome !== 'allow') {
            await event.confirm({
              ok: false,
              denied: true,
              message: gate.outcome === 'deny' ? gate.reason : 'storyboard action requires approval',
            })
            return
          }
          result = await applyCanvasToolCall(event.toolName, event.args, undefined, canWrite, input.documentId, input.storyboardId)
          application = result as StoryboardPlanApplicationResult
        }
        assertTurnCanWrite(canWrite)
        const parsedPlan = parseStoryboardPlan(event.args)
        if (target === 'production' || application?.status === 'applied') plan = parsedPlan
        if (target === 'production')
          result = { title: parsedPlan.title, anchorCount: parsedPlan.anchors.length, shotCount: parsedPlan.shots.length }
        await event.confirm({ ok: true, result, silent: true })
      } catch (error: unknown) {
        const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined
        await event.confirm({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          ...(typeof code === 'string' ? { code } : {}),
          ...(!canWrite() ? { denied: true } : {}),
        })
      }
    },
  }
  const { response } = await sendGenerationCanvasAgentMessage(
    input.target === 'production'
      ? {
          ...agentRequestBase,
          history: input.history,
          snapshot: input.snapshot,
          capturedCanvasReadSnapshot: input.capturedCanvasReadSnapshot,
        }
      : {
          ...agentRequestBase,
          history: input.history,
          snapshot: readGenerationCanvasSnapshot(),
        },
  )
  return { text: response.text.trim(), status: response.status, ...(plan ? { plan } : {}), ...(application ? { application } : {}) }
}
