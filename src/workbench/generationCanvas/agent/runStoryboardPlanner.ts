import { sendGenerationCanvasAgentMessage } from './generationCanvasAgentClient'
import { generationCanvasTools } from './generationCanvasTools'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { evaluateGate } from './gate'
import { buildLockGateContext } from './lockGateContext'
import { STORYBOARD_PLANNER_SKILL, buildStoryboardPlanningMessage, type StoryboardShotMode } from './storyboardLauncher'
import type { StoryboardPlan } from './storyboardPlan'

/**
 * 在**创作区**就地跑分镜规划师（流程 A：不切到生成区，无弹区闪屏）。
 *
 * 规划阶段只该产出方案对象（propose_storyboard_plan，gate=allow→落创作 store）或读画布
 * （read_canvas_state）；写画布的工具一律 deny——创作区没有画布审批卡，且方案没确认前不该碰画布、
 * 不该花钱（规划免费铁律）。propose_storyboard_plan 落库时会把工作区切到 creation（本就在），编辑器随即展开。
 */
export async function runStoryboardPlanner(input: {
  /** 首次拆镜头：剧本正文。*/
  storyText?: string
  /** 首拆的分镜模式（image=图片分镜默认 / video=视频分镜）；改方案不传（保留现方案每镜 shotKind）。*/
  shotMode?: StoryboardShotMode
  /** 修改现方案（P0-9 Slice 3）：当前方案 + 修改要求。*/
  currentPlan?: StoryboardPlan | null
  revisionRequest?: string
  onContent?: (text: string) => void
  onCancelReady?: (cancel: () => void) => void
}): Promise<{ text: string }> {
  const response = await sendGenerationCanvasAgentMessage({
    message: buildStoryboardPlanningMessage({
      storyText: input.storyText,
      currentPlan: input.currentPlan,
      revisionRequest: input.revisionRequest,
      ...(input.shotMode ? { shotMode: input.shotMode } : {}),
    }),
    snapshot: generationCanvasTools.read_canvas(),
    selectedNodes: [],
    mode: 'agent',
    skill: STORYBOARD_PLANNER_SKILL,
    onContent: (_delta, text) => input.onContent?.(text),
    ...(input.onCancelReady ? { onCancelReady: input.onCancelReady } : {}),
    onToolCall: (event) => {
      const decision = evaluateGate(
        { kind: 'tool-call', toolName: event.toolName, args: event.args },
        buildLockGateContext(),
      )
      if (decision.outcome === 'allow') {
        // 只读 / 产出方案：经单一真相源 applyCanvasToolCall 执行（propose_storyboard_plan 落 store）。
        void (async () => {
          try {
            const result = await applyCanvasToolCall(event.toolName, event.args)
            await event.confirm({ ok: true, result, silent: true })
          } catch (error: unknown) {
            await event.confirm({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        })()
        return
      }
      // 写/破坏性/花钱工具：规划阶段拒绝，人话回喂让模型改用 propose_storyboard_plan（不静默写画布）。
      void event.confirm({
        ok: false,
        message: '现在是分镜规划阶段，请用 propose_storyboard_plan 产出方案给用户审阅，不要直接创建或修改画布节点。',
        denied: true,
      })
    },
  })
  return { text: response.response.text?.trim() ?? '' }
}
