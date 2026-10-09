// 生成确认卡上「将生成几段 / 几张」的文案：每个会弹卡的入口都说对数量与类型，不编时长。
// （「×N 一次生成几个」入口 2026-10-06 按用户拍板删除，原来这里的连发语义测试随之删掉。）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndRunNode, regenerateNodeInPlace, spendCostKindForNodes } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { describeGenerationCost, useSpendConfirmStore } from '../spend/spendConfirm'
import i18n from '../../../i18n'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => `grant-${Math.random().toString(36).slice(2)}`),
}))

let projectSession: ProjectSessionTestHarness
beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  await projectSession.open('project-test')
})
afterEach(() => projectSession.dispose())

describe('generation confirmation copy', () => {
  let confirmCalls = 0
  let confirmAnswer = true
  let confirmMessages: string[] = []

  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
    confirmCalls = 0
    confirmAnswer = true
    confirmMessages = []
    useSpendConfirmStore.setState({
      requestConfirm: async (request) => {
        confirmCalls += 1
        confirmMessages.push(request.message)
        return confirmAnswer
      },
    } as Partial<ReturnType<typeof useSpendConfirmStore.getState>>)
  })

  afterEach(async () => {
    setCanvasEventSinkForTests(null)
    await i18n.changeLanguage('zh-CN')
  })

  it('describes text at every confirmation entry without inventing an image count or duration', async () => {
    confirmAnswer = false
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: '改写这句话' })
    // 确认卡的文案只在会弹卡的路径上出现：用户自己点的单个生成不弹（2026-09-25），所以单个入口用 Agent 发起来验卡上写什么。
    await confirmAndRunNode(node.id, { initiator: 'agent' })
    await regenerateNodeInPlace(node.id, { initiator: 'agent' })
    expect(confirmMessages).toEqual([
      '将生成 1 段文本',
      '将生成 1 段文本',
    ])
  })

  it('keeps text-only batches distinct from image and mixed batches', () => {
    const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: '改写' })
    const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '画面' })
    expect(spendCostKindForNodes([text.id])).toBe('text')
    expect(spendCostKindForNodes([text.id, image.id])).toBe('mixed')
    expect(describeGenerationCost(2, spendCostKindForNodes([text.id]))).toBe('将生成 2 段文本')
    expect(describeGenerationCost(1, spendCostKindForNodes([image.id]))).toBe('将生成 1 张画面 · 预计约 1–3 分钟')
  })

  it('localizes text confirmation counts in English without a made-up duration', async () => {
    await i18n.changeLanguage('en')
    confirmAnswer = false
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'Rewrite' })
    // 确认卡的文案只在会弹卡的路径上出现：用户自己点的单个生成不弹（2026-09-25），所以单个入口用 Agent 发起来验卡上写什么。
    await confirmAndRunNode(node.id, { initiator: 'agent' })
    expect(confirmMessages).toEqual(['Will generate 1 text result'])
    expect(describeGenerationCost(3, 'text')).toBe('Will generate 3 text results')
  })
})
