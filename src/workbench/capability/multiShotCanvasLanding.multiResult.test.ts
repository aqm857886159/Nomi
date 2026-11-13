// 一次出 N 张（张数 1–4）全部进同一镜的版本历史：Agent 制作 Run 那条路（落画布投影 → 节点）。
// 设计卡 docs/plan/2026-11-09-multi-result-landing.md ★9 第 3、8 条。
//
// 主进程那一半（这一镜那笔作业账上有几份产物就投几份、都挂这笔作业的运行记录号）见
// electron/productionRun/multiShotCanvasLanding.test.ts；这里只走渲染层的唯一入口 materializeShots，
// 报文形状照主进程真投的那样带 results + runRecordId。以前这一镜只带一个 result：付 N 张、节点上 1 张。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { materializeShots, type MaterializeShotInput } from './multiShotCanvasLanding'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'

const PROJECT = 'project-a'
const RUN = 'run-multi'
const OP = `canvas-landing:${RUN}`
const RECORD = 'production-job-shot-1'

/** 主进程投的这一镜 N 份结果：第一份的号 = 运行记录号，第 k 份加 `-k`（electron/productionRun/multiShotCanvasLanding.ts）。 */
const resultsOf = (count: number, record = RECORD): GenerationNodeResult[] => Array.from({ length: count }, (_, index) => ({
  id: index === 0 ? record : `${record}-${index + 1}`, type: 'image', url: `nomi-local://asset/${PROJECT}/out/${record}-${index + 1}.png`, createdAt: 10 + index,
}))

let project: ProjectSessionTestHarness
const node = (id: string): GenerationCanvasNode | undefined => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
const versions = (target: GenerationCanvasNode | undefined) => [...(target?.history ?? [])].sort((left, right) => (left.versionNo ?? 0) - (right.versionNo ?? 0))

function follow(shot: Partial<MaterializeShotInput>, existingOnly = true, nodeId?: string) {
  return materializeShots({
    projectId: PROJECT, runId: RUN, materializationOperationId: OP, existingOnly,
    shots: [{ shotId: 'shot-1', kind: 'image', prompt: 'one', ...(existingOnly ? { existingOnly: true as const } : {}), ...(nodeId ? { nodeId } : {}), ...shot } as MaterializeShotInput],
  })
}

/** 确认即落：落成占位节点，这一镜已交给供应商（节点上挂着本制作的「生成中」）。 */
async function landRunning(): Promise<string> {
  const landed = await follow({ generation: { state: 'running', runRecordId: RECORD, startedAt: 1 } }, false)
  const nodeId = landed.bindings[0]?.nodeId
  if (!nodeId) throw new Error('fixture: shot-1 did not land')
  return nodeId
}

beforeEach(async () => {
  resetClientIdRegistry()
  project = createProjectSessionTestHarness()
  await project.open(PROJECT)
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] }, PROJECT)
})
afterEach(() => { vi.restoreAllMocks(); project.dispose() })

describe('Agent 制作 ↑ 一镜一次出 N 张', () => {
  it.each([1, 2, 4])('N=%i：版本历史 N 条、同一条运行记录收尾并指向当前那张、当前是最后一张；跟随再投不重复落', async (count) => {
    const id = await landRunning()
    const results = resultsOf(count)

    await follow({ results, runRecordId: RECORD })
    await follow({ results, runRecordId: RECORD })

    const landed = node(id)
    expect(versions(landed).map((entry) => [entry.versionNo, entry.id])).toEqual(results.map((result, index) => [index + 1, result.id]))
    expect(landed?.runs).toHaveLength(1)
    expect(landed?.runs?.[0]).toMatchObject({ id: RECORD, status: 'success', resultId: results.at(-1)!.id })
    expect(landed?.result?.id).toBe(results.at(-1)!.id)
    expect(landed?.resultVersionMax).toBe(count)
    expect(landed?.status).toBe('success')
  })

  it('同一镜返工（新作业 = 新运行记录号）又出 2 张：两笔各归各的记录，不串；当前是返工那笔的最后一张', async () => {
    const id = await landRunning()
    await follow({ results: resultsOf(2), runRecordId: RECORD })
    const rework = 'production-job-shot-1-rework'
    await follow({ generation: { state: 'running', runRecordId: rework, startedAt: 20 } })
    await follow({ results: resultsOf(2, rework), runRecordId: rework })

    const landed = node(id)
    expect(versions(landed).map((entry) => entry.id)).toEqual([RECORD, `${RECORD}-2`, rework, `${rework}-2`])
    const byId = new Map((landed?.runs ?? []).map((run) => [run.id, run]))
    expect(byId.get(RECORD)).toMatchObject({ status: 'success', resultId: `${RECORD}-2` })
    expect(byId.get(rework)).toMatchObject({ status: 'success', resultId: `${rework}-2` })
    expect(landed?.result?.id).toBe(`${rework}-2`)
  })

  it.each([2, 4])('节点生成中被删、%i 张到达：暂存 N 份，撤销删除把节点带回来时 N 份都落上、只落一次', async (count) => {
    const id = await landRunning()
    useGenerationCanvasStore.getState().deleteNode(id)
    const results = resultsOf(count)

    await follow({ results, runRecordId: RECORD }, true, id)
    await follow({ results, runRecordId: RECORD }, true, id)
    expect(node(id)).toBeUndefined()
    useGenerationCanvasStore.getState().undo()

    const restored = node(id)
    expect(versions(restored).map((entry) => entry.id)).toEqual(results.map((result) => result.id))
    expect(restored?.runs?.[0]).toMatchObject({ id: RECORD, status: 'success', resultId: results.at(-1)!.id })
    expect(restored?.result?.id).toBe(results.at(-1)!.id)
  })
})
