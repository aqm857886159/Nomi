// 面板展示派生的纯函数测试。重点是**可取消性**——那是「不给用户假按钮」的判据。
import { describe, expect, it } from 'vitest'
import { buildTaskCenterView, formatElapsed, resolveTaskButtonTone } from './taskCenterEntries'
import type { GenerationQueueBatch, GenerationQueueEntry } from '../generationCanvas/runner/generationQueueStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

function entry(patch: Partial<GenerationQueueEntry> & { nodeId: string }): GenerationQueueEntry {
  return {
    id: `b1:${patch.nodeId}`,
    batchId: 'b1',
    waveIndex: 0,
    state: 'queued',
    enqueuedAt: 1000,
    ...patch,
  } as GenerationQueueEntry
}

function node(id: string, patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return { id, kind: 'image', title: `镜头 ${id}`, status: 'idle', ...patch } as GenerationCanvasNode
}

const batches: Record<string, GenerationQueueBatch> = {
  b1: { id: 'b1', projectId: 'project-test', createdAt: 0, total: 3, cancelRequested: false, paused: false, consecutiveFailures: 0 },
}

describe('buildTaskCenterView', () => {
  it('offers the same local-process cancel action as the canvas after receipt', () => {
    const view = buildTaskCenterView({ entries: [entry({nodeId:'agy',state:'running'})], batches,
      nodes: [node('agy', {status:'running', progress:{phase:'generating',taskId:'local-123',updatedAt:0}})], fallbackTitle:'untitled', now:2000 })
    expect(view.rows[0]).toMatchObject({cancel:'interrupt',action:{kind:'interrupt_generation',nodeId:'agy'}})
  })
  it('排队中 = 可免费取消；云端进行中 = 不给取消按钮（提交后停不下来，钱已花）', () => {
    const view = buildTaskCenterView({
      entries: [
        entry({ nodeId: 'q', state: 'queued' }),
        entry({ nodeId: 'cloud', state: 'running', startedAt: 1000 }),
      ],
      batches,
      nodes: [node('q'), node('cloud', { status: 'running', progress: { phase: 'polling', updatedAt: 0 } as never })],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.rows.find((row) => row.nodeId === 'q')?.cancel).toBe('free')
    expect(view.rows.find((row) => row.nodeId === 'cloud')?.cancel).toBe('none')
  })

  it('ComfyUI 本地进行中 = 可真中断（判据与 NodeGeneratingOverlay 同源：comfyui-* phase）', () => {
    const view = buildTaskCenterView({
      entries: [entry({ nodeId: 'local', state: 'running', startedAt: 1000 })],
      batches,
      nodes: [node('local', { status: 'running', progress: { phase: 'comfyui-node', updatedAt: 0 } as never })],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.rows[0]?.cancel).toBe('interrupt')
  })

  it('「可找回」不当成失败：不进 failed 计数，行文案走另一支', () => {
    const view = buildTaskCenterView({
      entries: [
        entry({ nodeId: 'recov', state: 'error', startedAt: 1000, endedAt: 1500 }),
        entry({ nodeId: 'dead', state: 'error', startedAt: 1000, endedAt: 1200 }),
      ],
      batches,
      nodes: [node('recov', { status: 'recoverable' }), node('dead', { status: 'error' })],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.rows.find((row) => row.nodeId === 'recov')?.recoverable).toBe(true)
    expect(view.summary.failed).toBe(1)
  })

  // 2026-09-25 用户截图：「小鹿 等待超时 · 上游可能仍在跑，可重新拉取」被放在「已完成 5」下面。
  it('等待超时（可重新拉取）不算已完成：进「等你处理」组，行上摆出「重新拉取」（查询），不挂付费重试', () => {
    const view = buildTaskCenterView({
      entries: [entry({ nodeId: 'deer', state: 'error', startedAt: 1000, endedAt: 1500 })],
      batches,
      nodes: [node('deer', { status: 'recoverable' })],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.rows[0]).toMatchObject({ group: 'attention', recoverable: true, action: { kind: 'recover_generation', nodeId: 'deer' } })
    expect(view.summary).toMatchObject({ attention: 1, failed: 0 })
  })

  it('调度结束后以节点为准：重新拉取中 = 进行中；拉到了 = 成功；都不会翻成「生成失败 + 重试」', () => {
    const fetching = buildTaskCenterView({
      entries: [entry({ nodeId: 'deer', state: 'error', startedAt: 1000, endedAt: 1500 })],
      batches,
      nodes: [node('deer', { status: 'running', progress: { phase: 'still-generating', updatedAt: 0 } as never })],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(fetching.rows[0]).toMatchObject({ group: 'running' })
    expect(fetching.rows[0]?.action?.kind).not.toBe('retry_generation')
    const recovered = buildTaskCenterView({
      entries: [entry({ nodeId: 'deer', state: 'error', startedAt: 1000, endedAt: 1500 })],
      batches,
      nodes: [node('deer', { status: 'success' })],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(recovered.rows[0]).toMatchObject({ group: 'done', outcome: 'success', action: null })
    expect(recovered.summary.failed).toBe(0)
  })

  it('同一节点更早的那条仍按它自己的结局记（只有最新一条以节点为准）', () => {
    const view = buildTaskCenterView({
      entries: [
        entry({ id: 'b1:old', nodeId: 'n', state: 'error', startedAt: 1, endedAt: 2 }),
        entry({ id: 'b2:new', batchId: 'b2', nodeId: 'n', state: 'success', startedAt: 3, endedAt: 4 }),
      ],
      batches,
      nodes: [node('n', { status: 'success' })],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.rows.find((row) => row.id === 'b1:old')).toMatchObject({ group: 'done', outcome: 'error' })
  })

  it('分组排序：进行中 → 排队中（按波次）→ 已完成（新的在前）', () => {
    const view = buildTaskCenterView({
      entries: [
        entry({ nodeId: 'done1', state: 'success', startedAt: 1, endedAt: 2 }),
        entry({ nodeId: 'wave2', state: 'queued', waveIndex: 1 }),
        entry({ nodeId: 'run', state: 'running', startedAt: 1000 }),
        entry({ nodeId: 'wave1', state: 'queued', waveIndex: 0 }),
        entry({ nodeId: 'done2', state: 'success', startedAt: 3, endedAt: 4 }),
      ],
      batches,
      nodes: ['done1', 'wave2', 'run', 'wave1', 'done2'].map((id) => node(id)),
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.rows.map((row) => row.nodeId)).toEqual(['run', 'wave1', 'wave2', 'done2', 'done1'])
  })

  it('汇总统计与「可取消个数」', () => {
    const view = buildTaskCenterView({
      entries: [
        entry({ nodeId: 'a', state: 'running', startedAt: 1000 }),
        entry({ nodeId: 'b', state: 'queued' }),
        entry({ nodeId: 'c', state: 'queued' }),
        entry({ nodeId: 'd', state: 'error', startedAt: 1, endedAt: 2 }),
      ],
      batches,
      nodes: ['a', 'b', 'c', 'd'].map((id) => node(id, id === 'd' ? { status: 'error' } : {})),
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.summary).toMatchObject({ running: 1, queued: 2, failed: 1, cancellable: 2 })
  })

  it('刹车中的批次会被面板顶到横幅（pausedBatchId）', () => {
    const view = buildTaskCenterView({
      entries: [entry({ nodeId: 'a', state: 'queued' })],
      batches: { b1: { ...batches.b1, paused: true, consecutiveFailures: 3 } },
      nodes: [node('a')],
      fallbackTitle: '未命名',
      now: 2000,
    })
    expect(view.summary.pausedBatchId).toBe('b1')
  })

  it('节点没标题时回落到占位，不出现空白行', () => {
    const view = buildTaskCenterView({
      entries: [entry({ nodeId: 'x', state: 'queued' })],
      batches,
      nodes: [node('x', { title: '   ' })],
      fallbackTitle: '未命名镜头',
      now: 2000,
    })
    expect(view.rows[0]?.title).toBe('未命名镜头')
  })
})

describe('resolveTaskButtonTone', () => {
  it('没结束的（在跑 / 排队 / 等你处理）→ busy；都结束了有失败 → failed；否则安静', () => {
    expect(resolveTaskButtonTone({ running: 1, queued: 0, attention: 0, failed: 0, cancellable: 0 })).toBe('busy')
    expect(resolveTaskButtonTone({ running: 0, queued: 2, attention: 0, failed: 3, cancellable: 2 })).toBe('busy')
    expect(resolveTaskButtonTone({ running: 0, queued: 0, attention: 1, failed: 0, cancellable: 0 })).toBe('busy')
    expect(resolveTaskButtonTone({ running: 0, queued: 0, attention: 0, failed: 2, cancellable: 0 })).toBe('failed')
    expect(resolveTaskButtonTone({ running: 0, queued: 0, attention: 0, failed: 0, cancellable: 0 })).toBe('idle')
  })
})

describe('formatElapsed', () => {
  it('分:秒，秒补零；非法值给空串', () => {
    expect(formatElapsed(84_000)).toBe('1:24')
    expect(formatElapsed(9_000)).toBe('0:09')
    expect(formatElapsed(undefined)).toBe('')
    expect(formatElapsed(-1)).toBe('')
  })
})

describe('settled attempts retain their own outcome during regeneration', () => {
  it.each(['success', 'error', 'cancelled'] as const)('%s never borrows the newer attempt narration', (state) => {
    const view = buildTaskCenterView({
      entries: [entry({ nodeId: 'n1', state, id: 'old', endedAt: 1500 }), entry({ nodeId: 'n1', state: 'running', id: 'new', enqueuedAt: 2000 })],
      batches, nodes: [node('n1', { status: 'running', progress: { phase: 'generating', updatedAt: 2000 } })],
      fallbackTitle: '图片', now: 22000,
    })
    expect(view.rows.find(row => row.id === 'old')?.phaseText).not.toContain('生成中')
    expect(view.rows.find(row => row.id === 'new')?.phaseText).toContain('生成中')
    if (state === 'success') expect(view.rows.find(row => row.id === 'old')?.phaseText).toBe('已保存到项目')
  })
})
