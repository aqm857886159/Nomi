// 「生成全部」只有一个执行口：画布组框工具条 / 右键菜单与列表分区头都走 groupGenerate，共用同一张付费确认。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGenerationNode } from '../model/graphOps'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const confirmAndRunPlan = vi.fn(async () => undefined)
vi.mock('./batchPlanPreview', async (original) => ({ ...await original<typeof import('./batchPlanPreview')>(), confirmAndRunPlan }))

const node = (id: string, status: GenerationCanvasNode['status']): GenerationCanvasNode => ({ ...createGenerationNode({ id, kind: 'image' }), status, categoryId: 'shots' })

beforeEach(() => {
  confirmAndRunPlan.mockClear()
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [node('idle', 'idle'), node('failed', 'error'), node('done', 'success'), node('running', 'running')],
    edges: [], groups: [], selectedNodeIds: [],
  })
  // 载入时会把「存盘时在跑」的收敛掉；这里要的是此刻真在跑，直接写 store。
  useGenerationCanvasStore.setState((state) => ({ nodes: state.nodes.map((candidate) => (candidate.id === 'running' ? { ...candidate, status: 'running' as const } : candidate)) }))
})

describe('runGroupGenerate (the one batch generate entrance)', () => {
  it('hands the default selection (idle / failed) and the itemized rows to the paid-confirm funnel, once', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    expect(runGroupGenerate(['idle', 'failed', 'done', 'running'])).toBe('started')
    expect(confirmAndRunPlan).toHaveBeenCalledTimes(1)
    const [plan, options] = confirmAndRunPlan.mock.calls[0] as unknown as [{ waves: string[][] }, { initiator: string; itemized: { rows: Array<{ id: string; checked: boolean; disabled?: boolean }> } }]
    expect(plan.waves.flat().sort()).toEqual(['failed', 'idle'])
    expect(options.initiator).toBe('user')
    expect(options.itemized.rows.map((row) => [row.id, row.checked, Boolean(row.disabled)])).toEqual([['idle', true, false], ['failed', true, false], ['done', false, false], ['running', false, true]])
  })

  it('nothing tickable (everything is generating) = no dispatch at all (the caller says so)', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    expect(runGroupGenerate(['running'])).toBe('empty')
    expect(runGroupGenerate([])).toBe('empty')
    expect(confirmAndRunPlan).not.toHaveBeenCalled()
  })
})

describe('greyed-out「生成整组 / 生成全部」says why (C1 / C4), from the shared owner rows', () => {
  it('a group where everything is recoverable / generating gets the reasons with counts; a tickable group gets none', async () => {
    const i18n = (await import('../../../i18n')).default
    await i18n.changeLanguage('zh')
    const { groupGenerateDisabledReason, hasGroupGenerateCandidates } = await import('./groupGenerate')
    useGenerationCanvasStore.setState((state) => ({
      nodes: [...state.nodes, { ...node('back1', 'idle'), status: 'recoverable' as const }, { ...node('back2', 'idle'), status: 'recoverable' as const }],
    }))
    expect(groupGenerateDisabledReason(['idle', 'back1'])).toBeUndefined()
    expect(groupGenerateDisabledReason(['back1', 'running', 'back2'])).toBe('这组现在都生成不了：1 个生成中、2 个可找回')
    expect(hasGroupGenerateCandidates(['back1', 'running', 'back2'])).toBe(false)
    expect(groupGenerateDisabledReason([])).toBe(i18n.t('generationCommon.canvas.group.generateEmpty'))
    await i18n.changeLanguage('en')
    expect(groupGenerateDisabledReason(['back1', 'back2'])).toBe('Nothing here can be generated right now: Recoverable (2)')
    await i18n.changeLanguage('zh')
  })
})

describe('structure: no second batch path', () => {
  it('the list section header and the canvas frame actions both go through groupGenerate; nobody else builds a batch plan from a section', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const read = (relative: string) => readFileSync(path.join(here, relative), 'utf8')
    expect(read('./useCanvasFrameActions.ts')).toContain("from './groupGenerate'")
    expect(read('../../generation/list/GenerationListSectionHeader.tsx')).toContain("from '../../generationCanvas/components/groupGenerate'")
    for (const file of ['../../generation/list/GenerationListSectionHeader.tsx', '../../generation/list/GenerationListView.tsx', '../../generation/list/GenerationListDetail.tsx']) {
      expect(read(file), `${file} must not call confirmAndRunPlan itself`).not.toMatch(/confirmAndRunPlan|planGenerationScope|planCanvasGenerationScope/)
    }
  })
})

describe('group generate row names (one source with the list cards)', () => {
  it('two untitled nodes get different names: prompt head, then kind + ordinal', async () => {
    const { groupGenerateRows } = await import('./groupGenerate')
    const { planCanvasGenerationScope } = await import('../runner/generationScopeFacts')
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { id: 'p1', kind: 'image', title: '图片', prompt: '清晨海边的灯塔', position: { x: 0, y: 0 }, categoryId: 'shots', status: 'idle' },
        { id: 'p2', kind: 'image', title: '', prompt: '', position: { x: 0, y: 0 }, categoryId: 'shots', status: 'idle' },
        { id: 'p3', kind: 'image', title: '', prompt: '', position: { x: 0, y: 0 }, categoryId: 'shots', status: 'idle' },
      ] as never,
      edges: [],
      groups: [],
    }, 'project-names')
    expect(groupGenerateRows(planCanvasGenerationScope('group', ['p1', 'p2', 'p3'], useGenerationCanvasStore.getState())).map((row) => row.label)).toEqual(['清晨海边的灯塔', '图片 2', '图片 3'])
  })
})
