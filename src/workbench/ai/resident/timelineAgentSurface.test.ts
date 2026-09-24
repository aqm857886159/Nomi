// 「哪一次待决是一份时间轴计划」由动词声明回答，不由一张手抄的名单回答。
//
// 2026-09-14 的 20 动词改名（afe85411d8，不留别名）把时间轴写动词改成了 `edit_timeline`，
// 而这里原来是一张手抄的 `['propose_edit_plan', 'apply_edit_plan', 'nomi_timeline_edit']`——
// 一个旧工具名、一个传输层方法词、一个对外 MCP 名，没有一个是面板此刻真会收到的名字。
// 十天里 Agent 的每一份时间轴计划都没被认成计划：卡上没有逐条人话、时间轴上不画待定色带，
// 退回成一张通用「可撤销」卡并多出「不再问 →」（2026-09-24 走查 agent-real-user-conversation 暴露）。
import { describe, expect, it } from 'vitest'
import { MODEL_FACING_TOOL_SPECS } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { isTimelinePlanTool, timelinePlanOperationsForTool } from './timelineAgentSurface'

const captionPlan = {
  baseRevision: 'revision-1',
  summary: '片头加一条字幕',
  operations: [{ kind: 'text', action: 'add', id: 'caption-1', text: '汤先到，人后到', style: 'caption', startFrame: 0, endFrame: 60 }],
}

describe('时间轴计划由动词声明认出', () => {
  it('edit_timeline 是计划，它平铺的 operations 能拿去画预览', () => {
    expect(isTimelinePlanTool('edit_timeline')).toBe(true)
    expect(timelinePlanOperationsForTool('edit_timeline', captionPlan)).toEqual(captionPlan.operations)
  })

  it('同类：声明里每一个「落在 timeline.write、用户先看审阅卡」的动词都被认出，别的一个都不认', () => {
    const declared = MODEL_FACING_TOOL_SPECS
      .filter((spec) => spec.contractId === 'timeline.write' && spec.nextAction === 'user_sees_review_card')
      .map((spec) => spec.name)
    // 先证判据非空，免得「一个都不认」在声明被改空时恒真。
    expect(declared).toContain('edit_timeline')
    for (const spec of MODEL_FACING_TOOL_SPECS) {
      expect(isTimelinePlanTool(spec.name), spec.name).toBe(declared.includes(spec.name))
    }
  })

  it('退役的工具名、传输层方法词、对外 MCP 名都不是面板会收到的工具名', () => {
    for (const name of ['apply_edit_plan', 'propose_edit_plan', 'nomi_timeline_edit', 'undo_timeline_edit']) {
      expect(isTimelinePlanTool(name), name).toBe(false)
      expect(timelinePlanOperationsForTool(name, captionPlan), name).toEqual([])
    }
    // `undo` 同样落在 timeline.write 上，但它不带计划——撤销不该长成一张计划卡。
    expect(isTimelinePlanTool('undo')).toBe(false)
  })
})
