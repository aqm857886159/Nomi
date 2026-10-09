import { afterEach, describe, expect, it, vi } from 'vitest'

// S1-5 同类（2026-10-03，搞破坏线复现）：画布单点生成，请求还没回来就返回项目库、再切回来——
// 画布从磁盘重装时把「存盘时在跑、没有任务号」的节点当成上一个进程留下的幽灵转圈，收成空闲；
// 底栏于是出现「生成全部 1 个」，用户一点，供应商收到第二笔，扣两次钱。
// 这一笔明明还挂在这个窗口的提交口上：只要它在路上，节点就是「生成中」，也不进「生成全部」。
const desktop = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ tasks: { run: desktop.run } }) }))

import { runWorkbenchTaskByVendor } from '../../api/taskApi'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { eligibleGenerationNodeIds } from '../components/canvasProductionScope'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { classifyGenerationError } from '../../observability/classifyError'
import i18n from '../../../i18n'

const persistedMidFlight = (id: string): GenerationCanvasNode => ({
  id, kind: 'image', title: id, position: { x: 0, y: 0 }, categoryId: 'shots', prompt: '渔港清晨',
  status: 'running', runs: [{ id: `run-${id}`, status: 'running', startedAt: 1 }],
}) as GenerationCanvasNode

afterEach(() => { desktop.run.mockReset() })

describe('a canvas submit still in flight survives a project switch', () => {
  it('reported case: reopening the project while the request is out keeps the node generating and out of "generate all"', async () => {
    let answer!: (value: unknown) => void
    desktop.run.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const request = runWorkbenchTaskByVendor('fixture', { kind: 'text_to_image', prompt: '渔港清晨', extras: { nodeId: 'node-a' } } as never, 'project-a')

    // 切回来：项目从磁盘重装（离开时存下的是「在跑、还没有任务号」）。
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [persistedMidFlight('node-a')], edges: [], groups: [] })
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'node-a')!
    expect(node.status).toBe('running')
    expect(node.runs?.[0]?.status).toBe('running')
    expect(eligibleGenerationNodeIds(useGenerationCanvasStore.getState().nodes)).toEqual([])

    answer({ id: 'task-1', status: 'succeeded', assets: [] })
    await request
  })

  it('class: after a restart (nothing in flight in this window) the stale spinner is still collected as before', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [persistedMidFlight('node-b')], edges: [], groups: [] })
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'node-b')!
    expect(node.status).toBe('idle')
    expect(eligibleGenerationNodeIds(useGenerationCanvasStore.getState().nodes)).toEqual(['node-b'])
  })
})

it('the main-process refusal of a second submit is told as "still generating, nothing was sent", not as a provider failure', () => {
  const structured = Buffer.from(JSON.stringify({ code: 'node_generation_in_flight', reason: 'in_flight' }), 'utf8').toString('base64')
  const report = classifyGenerationError(`Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::${structured}:: node_generation_in_flight: node-a`)
  expect(report.reason).toBe(i18n.t('generationCommon.observability.error.nodeInFlight.reason'))
  expect(report.vendorSide).toBe(false)
})

// 先落节点、再发请求（架构③）：升级前留下的批量确认草稿没记来源节点，主进程不发它、按「没交」收尾——
// 节点上那一句必须如实说「升级后这批没有发出，需要重新确认」，不能悄悄没了，也不对钱下断言（协调会话 10-09）。
it('a pre-upgrade batch consent that was not sent says so on the node, in both languages, without talking about money', async () => {
  const structured = Buffer.from(JSON.stringify({ code: 'canvas_consent_predates_upgrade', reason: 'predates_upgrade' }), 'utf8').toString('base64')
  const message = `Error invoking remote method 'nomi:tasks:canvas-shot-submit': Error: NOMI_VENDOR_ERR_B64::${structured}:: canvas_consent_predates_upgrade: canvas-run-a`
  const zh = classifyGenerationError(message)
  expect(zh.reason).toBe(i18n.t('generationCommon.observability.error.consentPredatesUpgrade.reason'))
  expect(`${zh.reason}${zh.hint}`).toContain('升级后这批没有发出')
  expect(`${zh.reason}${zh.hint}`).toContain('再确认一次')
  expect(zh.vendorSide).toBe(false)
  await i18n.changeLanguage('en')
  try {
    const en = classifyGenerationError(message)
    expect(en.reason).toBe('This batch was not sent after the update')
    expect(`${en.reason}${en.hint}`).not.toMatch(/charge|credit|refund|cost/i)
  } finally {
    await i18n.changeLanguage('zh-CN')
  }
  expect(`${zh.reason}${zh.hint}`).not.toMatch(/扣|费|钱/)
})
