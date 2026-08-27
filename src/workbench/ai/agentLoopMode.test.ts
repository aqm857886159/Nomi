import { afterEach, describe, expect, it, vi } from 'vitest'

// Single-shot has no durable lifecycle; feature attribution is not storage.
const clearOrder: string[] = []

vi.mock('./workbenchAiClient', () => ({
  sendWorkbenchAiMessage: vi.fn(async () => {
    clearOrder.push('send')
    return { text: 'ok', usage: undefined }
  }),
}))
vi.mock('./assistantModelPref', () => ({
  getAssistantModelPref: vi.fn(() => null),
}))
vi.mock('../../api/desktopClient', () => ({
  clearWorkbenchAgentSession: vi.fn(async () => {
    clearOrder.push('clear')
  }),
}))

import { sendWorkbenchAiMessage } from './workbenchAiClient'
import { getAssistantModelPref } from './assistantModelPref'
import { clearWorkbenchAgentSession } from '../../api/desktopClient'
import { runSingleShotAgent, AGENT_LOOP_MODE } from './agentLoopMode'

const mockSend = sendWorkbenchAiMessage as unknown as ReturnType<typeof vi.fn>
const mockPref = getAssistantModelPref as unknown as ReturnType<typeof vi.fn>
const mockClear = clearWorkbenchAgentSession as unknown as ReturnType<typeof vi.fn>

afterEach(() => {
  vi.clearAllMocks()
  clearOrder.length = 0
  mockPref.mockImplementation(() => null)
})

describe('runSingleShotAgent —— 单次循环模式的显式入口（B1d）', () => {
  it('循环模式常量声明齐全（single-shot / multi-turn）', () => {
    expect(AGENT_LOOP_MODE.singleShot).toBe('single-shot')
    expect(AGENT_LOOP_MODE.multiTurn).toBe('multi-turn')
  })

  it('单次任务显式 ephemeral，不读写或清理任一持久会话', async () => {
    await runSingleShotAgent({
      featureKey: 'nomi:production-directions:p1',
      prompt: 'hi',
      displayPrompt: '构思创意方向',
      skillKey: 'workbench.production.direction-planner',
      skillName: '方向候选规划',
    })
    expect(mockClear).not.toHaveBeenCalled()
    expect(clearOrder).toEqual(['send'])
    expect(mockSend.mock.calls[0][0]).toMatchObject({ capability: 'single-shot', history: { kind: 'ephemeral' } })
  })

  it('追踪 feature key 与 ephemeral 生命周期分离，其余请求字段保留', async () => {
    await runSingleShotAgent({
      featureKey: 'nomi:shot-verify:p2',
      prompt: 'judge this',
      displayPrompt: 'judge',
      projectId: 'p2',
      skillKey: 'workbench.shot-verify',
      skillName: '镜级画面校验',
    })
    const [req, handlers] = mockSend.mock.calls[0]
    expect(req).toMatchObject({
      prompt: 'judge this',
      displayPrompt: 'judge',
      featureKey: 'nomi:shot-verify:p2',
      projectId: 'p2',
      skillKey: 'workbench.shot-verify',
      skillName: '镜级画面校验',
      mode: 'chat',
      capability: 'single-shot',
      history: { kind: 'ephemeral' },
    })
    expect(req).not.toHaveProperty('sessionKey')
    // 空 handlers（单次流不订阅流事件，与现状一致）
    expect(handlers).toEqual({})
  })

  it('projectId 缺省时不塞进请求（避免 canvasProjectId 落空串）', async () => {
    await runSingleShotAgent({
      featureKey: 'k',
      prompt: 'p',
      displayPrompt: 'd',
      skillKey: 'sk',
      skillName: 'sn',
    })
    const [req] = mockSend.mock.calls[0]
    expect('projectId' in req).toBe(false)
  })

  it('自动附加助手模型偏好（agentModelKey/agentVendorKey）', async () => {
    mockPref.mockImplementation(() => ({ modelKey: 'm-x', vendorKey: 'v-y' }))
    await runSingleShotAgent({
      featureKey: 'k',
      prompt: 'p',
      displayPrompt: 'd',
      skillKey: 'sk',
      skillName: 'sn',
    })
    const [req] = mockSend.mock.calls[0]
    expect(req).toMatchObject({ agentModelKey: 'm-x', agentVendorKey: 'v-y' })
  })

  it('无偏好时不附加模型键', async () => {
    mockPref.mockImplementation(() => null)
    await runSingleShotAgent({ featureKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn' })
    const [req] = mockSend.mock.calls[0]
    expect('agentModelKey' in req).toBe(false)
    expect('agentVendorKey' in req).toBe(false)
  })

  it('attachments 有则透传（shot-verify 喂首帧图）', async () => {
    const attachments = [{ url: 'nomi-local://x.png', contentType: 'image/png', fileName: 'shot-frame.png', kind: 'image' as const }]
    await runSingleShotAgent({ featureKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn', attachments })
    const [req] = mockSend.mock.calls[0]
    expect(req.attachments).toEqual(attachments)
  })

  it('返回底层响应原样', async () => {
    mockSend.mockResolvedValueOnce({ text: 'candidate json', usage: { totalTokens: 5 } })
    const res = await runSingleShotAgent({ featureKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn' })
    expect(res.text).toBe('candidate json')
  })
})
