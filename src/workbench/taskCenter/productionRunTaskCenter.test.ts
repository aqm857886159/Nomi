import { describe, expect, it } from 'vitest'

import type { ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import { buildProductionRunTaskRows } from './productionRunTaskCenter'

function summary(patch: Partial<ProductionRunSummary> = {}): ProductionRunSummary {
  return {
    runId: 'run-promo-1',
    projectId: 'project-a',
    revision: 4,
    status: 'running',
    stageId: 'generate',
    playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' },
    budget: { currency: 'CNY', authorized: 20, reserved: 5, actual: 3, unsettled: 0 },
    updatedAt: '2026-08-09T02:00:00.000Z',
    ...patch,
  }
}

const labels = {
  title: 'Nomi 制作',
  statuses: {
    draft: '等待开始',
    awaiting_direction: '等待确认方向',
    awaiting_storyboard_review: '等待审核分镜',
    awaiting_contract: '等待确认制作与预算',
    ready: '准备生成',
    running: '正在生成',
    pausing: '正在暂停',
    paused: '已暂停',
    needs_attention: '需要处理',
    awaiting_rough_cut_review: '等待审核粗剪',
    awaiting_export: '等待确认导出',
    exporting: '正在导出',
    completed: '制作完成',
    cancelled: '已取消',
  },
}

describe('production run task-center projection', () => {
  it('keeps an active Run visible without inventing progress or cancellation', () => {
    const [row] = buildProductionRunTaskRows([summary()], labels)

    expect(row).toMatchObject({
      id: 'production-run:run-promo-1',
      kind: 'production_run',
      group: 'running',
      phaseText: '正在生成',
      recoverable: false,
      cancel: 'none',
      target: { kind: 'production_run', projectId: 'project-a', runId: 'run-promo-1' },
      action: null,
    })
    expect(row).not.toHaveProperty('percent')
    expect(row).not.toHaveProperty('elapsedMs')
  })

  it('keeps human approval states active and routes to the exact Run', () => {
    const [row] = buildProductionRunTaskRows([
      summary({ status: 'awaiting_rough_cut_review', runId: 'run-review-2' }),
    ], labels)

    expect(row).toMatchObject({
      group: 'running',
      phaseText: '等待审核粗剪',
      target: { projectId: 'project-a', runId: 'run-review-2' },
    })
  })

  it('places completed and cancelled Runs in history with truthful outcomes', () => {
    const rows = buildProductionRunTaskRows([
      summary({ runId: 'run-done', status: 'completed' }),
      summary({ runId: 'run-cancelled', status: 'cancelled' }),
    ], labels)

    expect(rows[0]).toMatchObject({ group: 'done', outcome: 'success' })
    expect(rows[1]).toMatchObject({ group: 'done', outcome: 'cancelled' })
  })
})
