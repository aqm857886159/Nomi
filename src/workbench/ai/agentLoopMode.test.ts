import { afterEach, describe, expect, it, vi } from 'vitest'

// runSingleShotAgent 把「单次任务=先清会话→发 mode:'chat' 消息→自动带模型偏好」收成一个显式入口（B1d）。
// mock 三个协作方，验：① 循环模式声明为 single-shot；② 清会话在发消息之前；
// ③ 请求字段逐项透传且 mode 恒 'chat'；④ 助手模型偏好自动附加。
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
vi.mock('./agentSessionKey', () => ({
  safeClearAgentSession: vi.fn(async () => {
    clearOrder.push('clear')
  }),
}))

import { sendWorkbenchAiMessage } from './workbenchAiClient'
import { getAssistantModelPref } from './assistantModelPref'
import { safeClearAgentSession } from './agentSessionKey'
import { runSingleShotAgent, AGENT_LOOP_MODE } from './agentLoopMode'

const mockSend = sendWorkbenchAiMessage as unknown as ReturnType<typeof vi.fn>
const mockPref = getAssistantModelPref as unknown as ReturnType<typeof vi.fn>
const mockClear = safeClearAgentSession as unknown as ReturnType<typeof vi.fn>

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

  it('先清会话，再发消息（框架托管清会话时机）', async () => {
    await runSingleShotAgent({
      sessionKey: 'nomi:production-directions:p1',
      prompt: 'hi',
      displayPrompt: '构思创意方向',
      skillKey: 'workbench.production.direction-planner',
      skillName: '方向候选规划',
    })
    expect(mockClear).toHaveBeenCalledWith('nomi:production-directions:p1')
    expect(clearOrder).toEqual(['clear', 'send'])
  })

  it('mode 恒为 chat；prompt/displayPrompt/sessionKey/skill 逐项透传；projectId 有则带无则省', async () => {
    await runSingleShotAgent({
      sessionKey: 'nomi:shot-verify:p2',
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
      sessionKey: 'nomi:shot-verify:p2',
      projectId: 'p2',
      skillKey: 'workbench.shot-verify',
      skillName: '镜级画面校验',
      mode: 'chat',
    })
    // 空 handlers（单次流不订阅流事件，与现状一致）
    expect(handlers).toEqual({})
  })

  it('projectId 缺省时不塞进请求（避免 canvasProjectId 落空串）', async () => {
    await runSingleShotAgent({
      sessionKey: 'k',
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
      sessionKey: 'k',
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
    await runSingleShotAgent({ sessionKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn' })
    const [req] = mockSend.mock.calls[0]
    expect('agentModelKey' in req).toBe(false)
    expect('agentVendorKey' in req).toBe(false)
  })

  it('attachments 有则透传（shot-verify 喂首帧图）', async () => {
    const attachments = [{ url: 'nomi-local://x.png', contentType: 'image/png', fileName: 'shot-frame.png', kind: 'image' as const }]
    await runSingleShotAgent({ sessionKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn', attachments })
    const [req] = mockSend.mock.calls[0]
    expect(req.attachments).toEqual(attachments)
  })

  it('返回底层响应原样', async () => {
    mockSend.mockResolvedValueOnce({ text: 'candidate json', usage: { totalTokens: 5 } })
    const res = await runSingleShotAgent({ sessionKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn' })
    expect(res.text).toBe('candidate json')
  })
})
