// 回归钉：面板专长层 systemPrompt 必须真的上 wire。
//
// 2026-08-24 发现（B1 重构时）：生成画布助手的 buildStaticAgentSystemPrompt（本面工具手册 +
// 硬约束，见 generationCanvasAgentClient）经 runWorkbenchAgent 一路传下来，却在
// buildWorkbenchAiPayload 这一跳被静默丢弃——payload.systemPrompt 对所有现役 caller 恒为空，
// 专长层从未生效过。后端接收侧一直是齐的（agentChatV2 读 payload.systemPrompt 并入 systemParts），
// 只差渲染层没把它塞进 payload。
//
// 根因是「手工枚举字段的 payload builder 漏了一个」，而 typecheck 抓不到：
// 调用方把 request 存成变量再传，结构化子类型允许多带字段（详见 workbenchAgentRunner 的标注注释）。
// 类型标注挡住了「传了但 DTO 没声明」，这里挡另一半——「DTO 声明了但 builder 忘了转发」。
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ stream: vi.fn() }))
vi.mock('../../api/desktopClient', () => ({ workbenchAgentsChatStream: mocks.stream }))

import { WORKBENCH_AI_REQUEST_FIELDS, buildWorkbenchAiPayload, sendWorkbenchAiMessage, type WorkbenchAiRequest } from './workbenchAiClient'

type WorkbenchAiPayload = ReturnType<typeof buildWorkbenchAiPayload>

/**
 * 每个请求字段在 payload 里的落点（有几个会改名/下沉进 chatContext）。
 *
 * 注意：本文件被 tsconfig.app.json 的 exclude 挡在 typecheck 之外，所以这里的类型标注
 * **不构成编译期闸**——真正的编译期闸是源码侧的 WORKBENCH_AI_REQUEST_FIELDS。
 * 下面的用例改为遍历那份清单，缺落点/缺夹具值都当场报错，不靠类型。
 */
const FIELD_LANDING: Record<keyof WorkbenchAiRequest, (payload: WorkbenchAiPayload) => unknown> = {
  prompt: (p) => p.prompt,
  systemPrompt: (p) => p.systemPrompt,
  displayPrompt: (p) => p.displayPrompt,
  capability: (p) => p.capability,
  history: (p) => p.history,
  featureKey: (p) => p.featureKey,
  selectedNodeIds: (p) => p.selectedNodeIds,
  projectId: (p) => p.canvasProjectId,
  flowId: (p) => p.canvasFlowId,
  projectName: (p) => p.chatContext.currentProjectName,
  skillKey: (p) => p.chatContext.skill.key,
  skillName: (p) => p.chatContext.skill.name,
  mode: (p) => p.mode,
  agentModelKey: (p) => p.agentModelKey,
  agentVendorKey: (p) => p.agentVendorKey,
  attachments: (p) => p.attachments,
}

/** 全字段夹具。少给某个字段会被下面的 toBeDefined 抓住（不能靠类型，本文件不参与 typecheck）。 */
const FULL_REQUEST: Required<WorkbenchAiRequest> = {
  prompt: '把这段故事拆成三个镜头',
  systemPrompt: '你现在在「生成画布」工作：把用户的想法落成画布上的节点。',
  displayPrompt: '拆镜头',
  capability: 'canvas-agent',
  history: { kind: 'persistent', binding: { sessionKey: 'nomi:workbench:proj-1:generation', threadId: 'thread-1' } },
  featureKey: 'test-feature',
  selectedNodeIds: ['node-1'],
  projectId: 'proj-1',
  flowId: 'flow-1',
  projectName: '测试项目',
  skillKey: 'workbench.generation.canvas-planner',
  skillName: '生成区节点规划',
  mode: 'auto',
  agentModelKey: 'gpt-5.2',
  agentVendorKey: 'apimart',
  attachments: [{ url: 'nomi-local://a.png', contentType: 'image/png', fileName: 'a.png', kind: 'image' }],
}

describe('buildWorkbenchAiPayload', () => {
  it('forwards explicit capability/history/selection and keeps feature identity outside the history key', () => {
    const input: WorkbenchAiRequest = { ...FULL_REQUEST, capability: 'canvas-refine', selectedNodeIds: ['n1'], featureKey: 'feature-only',
      history: { kind: 'persistent', binding: { sessionKey: 'nomi:workbench:proj-1:generation', threadId: 'thread-a' } } }
    const payload = buildWorkbenchAiPayload(input)
    expect(payload).toMatchObject({ capability: 'canvas-refine', history: input.history, selectedNodeIds: ['n1'], featureKey: 'feature-only' })
    expect(payload).not.toHaveProperty('sessionKey')
  })
  it('systemPrompt 必须上 wire（专长层曾被整段丢弃）', () => {
    const payload = buildWorkbenchAiPayload({
      prompt: 'p',
      systemPrompt: '面板专长层',
      displayPrompt: 'd',
      capability: 'canvas-chat',
      history: { kind: 'ephemeral' },
      skillKey: 'k',
      skillName: 'n',
    })
    expect(payload.systemPrompt).toBe('面板专长层')
  })

  it('清单里每个请求字段都要真的上 wire（防再漏转发）', () => {
    const payload = buildWorkbenchAiPayload(FULL_REQUEST)
    const fields = Object.keys(WORKBENCH_AI_REQUEST_FIELDS) as Array<keyof WorkbenchAiRequest>
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      const land = FIELD_LANDING[field]
      // 新字段进了源码清单却没在这里登记落点 / 没进夹具 → 当场报错，不会静默漏检。
      expect(land, `字段 ${field} 还没在 FIELD_LANDING 里登记落点`).toBeTypeOf('function')
      expect(FULL_REQUEST[field], `字段 ${field} 还没进 FULL_REQUEST 夹具`).toBeDefined()
      expect(land(payload), `字段 ${field} 没上 wire`).toEqual(FULL_REQUEST[field])
    }
  })

  it('没给 systemPrompt 时不塞空键（省得击穿 vendor 前缀缓存）', () => {
    const payload = buildWorkbenchAiPayload({
      prompt: 'p',
      displayPrompt: 'd',
      capability: 'canvas-chat',
      history: { kind: 'ephemeral' },
      skillKey: 'k',
      skillName: 'n',
    })
    expect('systemPrompt' in payload).toBe(false)
  })

  it('keeps a structured credential code on the actionable Error', async () => {
    mocks.stream.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onEvent({ event: 'error', data: {
        message: 'Text model credential is locked', code: 'text_model_credential_locked',
      } })
      handlers.onEvent({ event: 'done', data: { reason: 'error' } })
      return () => {}
    })
    let failure: unknown
    try {
      await sendWorkbenchAiMessage(FULL_REQUEST, {})
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      name: 'WorkbenchAiError', message: 'Text model credential is locked', code: 'text_model_credential_locked',
    })
  })
})
