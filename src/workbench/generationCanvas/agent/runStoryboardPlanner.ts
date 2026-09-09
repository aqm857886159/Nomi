import { normalizeStoryboardAnchorDefaults } from './storyboardAnchorPolicy'
import { formatAvailableModelsForPrompt } from "../../../../electron/shared/agentCapabilities/availableModels";
import type { CapturedCanvasReadSnapshotHandleWire } from '../../../../electron/shared/surfacePortBinding'
import type { CanvasReadResult } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { toPublishedJsonSchema } from '../../../../electron/shared/agentCapabilities/modelVisibleJsonSchema'
import { assertTurnCanWrite } from '../../ai/agentTurnLifecycle'
import { runSingleShotAgent } from '../../ai/agentLoopMode'
import { STORYBOARD_PLANNER_SKILL, buildStoryboardPlanningMessage, type StoryboardShotMode } from './storyboardLauncher'
import type { StoryboardPlan } from './storyboardPlan'
import { parseStoryboardPlan, storyboardPlanSchema } from './storyboardPlanSchema'
import { assertIssuedCanvasReadResult } from './canvasReadResultSeal'
import { formatCanvasForAgent } from './canvasPromptContext'
import { listAvailableModelsForAgent } from './availableModels'

type StoryboardPlannerInput = {
  target: 'production'
  projectId?: string
  featureKey?: string
  canWrite: () => boolean
  storyText?: string
  shotMode?: StoryboardShotMode
  currentPlan?: StoryboardPlan | null
  revisionRequest?: string
  displayPrompt?: string
  skill?: { key: string; name: string }
  snapshot: CanvasReadResult
  capturedCanvasReadSnapshot: CapturedCanvasReadSnapshotHandleWire
}

/** Production planning returns an IR. The approved materialization operation owns every write. */
export async function runStoryboardPlanner(input: StoryboardPlannerInput) {
  assertTurnCanWrite(input.canWrite)
  assertIssuedCanvasReadResult(input.snapshot)
  const canvas = formatCanvasForAgent(input.snapshot)
  const entries = await listAvailableModelsForAgent()
  const models = formatAvailableModelsForPrompt(entries)
  assertTurnCanWrite(input.canWrite)
  const prompt = [
    '只输出 JSON 对象，不调用工具，不写入画布。',
    '输出 JSON Schema：', JSON.stringify(toPublishedJsonSchema(storyboardPlanSchema)),
    '当前画布：', canvas, models,
    buildStoryboardPlanningMessage(input),
  ].filter(Boolean).join('\n\n')
  const skill = input.skill ?? STORYBOARD_PLANNER_SKILL
  const response = await runSingleShotAgent({
    projectId: input.projectId,
    featureKey: input.featureKey ?? 'production.plan-storyboard',
    prompt, displayPrompt: input.displayPrompt ?? input.storyText ?? '',
    skillKey: skill.key,
  })
  assertTurnCanWrite(input.canWrite)
  if (response.status !== 'finished') return { text: response.text, status: response.status }
  const text = response.text.trim()
  const candidate = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? text
  const plan = normalizeStoryboardAnchorDefaults(parseStoryboardPlan(JSON.parse(candidate)), entries)
  return { text, status: response.status, plan }
}
