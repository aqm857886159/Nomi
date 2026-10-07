// 真实测试 ④（DeepSeek，3D-BOX）：用户说「撤销」，模型正确地调了 `undo`（带画布 changeId），闸却弹出一张
// 「调整时间线」复审卡——`undo` 与 `edit_timeline` 同属 timeline.write，契约整体声明了 requiresPlanReview，
// 而闸只看模型参数（里面没有 operation），认不出「这是撤销、不是一份编辑计划」。
// 修在共享边界：动词名定死的 operation（aliasBoundInput）进审批对象；timeline.write 只给编辑计划复审。
import { describe, expect, it } from 'vitest'
import { createLaneApprovalGate } from './laneApprovalGate'
import { LANE_DEFERRED_TOOL_CATALOG } from './laneToolCatalog'
import { DEFAULT_PROJECT_AGENT_APPROVAL_POLICY } from '../shared/agentCapabilities/capabilityApprovalPolicy'

const gate = () => createLaneApprovalGate({
  specs: LANE_DEFERRED_TOOL_CATALOG,
  hasUserInterface: true,
  policy: () => DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
  workMode: () => 'agent',
})

describe('undo 不走「编辑计划」复审，edit_timeline 仍然走', () => {
  it('默认档（safe-auto）下撤销一笔画布改动直接放行，不出卡', async () => {
    const lane = gate()
    const outcome = await lane.preflight({ toolCallId: 'call-undo', toolName: 'undo', args: { changeId: 'canvas:v1:receipt-1' } }, undefined)
    expect(outcome.allow).toBe(true)
    expect(outcome.decision).toBe('auto-granted')
    expect(lane.pending()).toBeUndefined()
  })

  it('撤销时间线上的一笔同样不复审（撤销没有可读的计划载荷）', async () => {
    const lane = gate()
    const outcome = await lane.preflight({ toolCallId: 'call-undo-t', toolName: 'undo', args: { changeId: 'timeline:v1:receipt-2', expectedRevision: 'revision-2' } }, undefined)
    expect(outcome.allow).toBe(true)
    expect(lane.pending()).toBeUndefined()
  })

  it('edit_timeline 的第一笔仍然先出复审卡', async () => {
    const lane = gate()
    const controller = new AbortController()
    const waiting = lane.preflight({ toolCallId: 'call-edit', toolName: 'edit_timeline', args: { baseRevision: 'revision-1', summary: 'Move clip', operations: [{ kind: 'move', clipId: 'clip-1', startFrame: 0 }] } }, controller.signal)
    expect(lane.pending()?.toolCallId).toBe('call-edit')
    controller.abort()
    lane.cancelAll('stopped')
    expect((await waiting).allow).toBe(false)
  })
})
