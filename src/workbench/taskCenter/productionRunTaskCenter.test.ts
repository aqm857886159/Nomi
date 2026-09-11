import { describe, expect, it } from 'vitest'

import type { ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import { buildProductionRunTaskRows, mergeProductionRunSummaries } from './productionRunTaskCenter'

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
    awaiting_script_review: '等待审核剧本',
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
  // 2026-09-10 真机：agent 建完草稿，任务面板只有一句「等待开始」——模型、提示词一个字都看不到，
  // 用户无从判断 agent 定的对不对（也就发现不了「画布上的模型和 agent 说的不一致」）。
  it('草稿行说人话：模型 · 比例 · 提示词摘要，而不是只有「等待开始」', () => {
    const [row] = buildProductionRunTaskRows([
      summary({
        status: 'draft',
        draft: {
          candidateId: 'cand-1',
          revision: 1,
          vendor: 'apimart',
          modelKey: 'gpt-image-2',
          mode: 'text_to_image',
          promptLine: '雨夜便利店门口',
          aspectRatio: '9:16',
          shotCount: 1,
        },
      }),
    ], labels)
    expect(row.phaseText).toBe('gpt-image-2 · 9:16 · 雨夜便利店门口')
  })

  it('多镜草稿追加镜数（文案走 i18n 插值，不在投影里拼中文）', () => {
    const [row] = buildProductionRunTaskRows([
      summary({
        status: 'draft',
        draft: { candidateId: 'c', revision: 1, vendor: 'apimart', modelKey: 'seedance-2', mode: 'text_to_video', promptLine: '开场', shotCount: 6 },
      }),
    ], { ...labels, draftShots: (count: number) => `${count} 个镜头` })
    expect(row.phaseText).toBe('seedance-2 · 开场 · 6 个镜头')
  })

  it('老快照（没有 draft 摘要）→ 回落状态文案，不空一行', () => {
    const [row] = buildProductionRunTaskRows([summary({ status: 'draft' })], labels)
    expect(row.phaseText).toBe('等待开始')
  })

  it('uses the newest full Run revision so one card cannot be completed under a running summary', () => {
    const listed = summary({ revision: 8, status: 'running' })
    const completed = summary({ revision: 9, status: 'completed' })

    const [resolved] = mergeProductionRunSummaries([listed], completed)
    expect(resolved).toMatchObject({ revision: 9, status: 'completed' })
    expect(buildProductionRunTaskRows([resolved], labels)[0].group).toBe('done')
    expect(mergeProductionRunSummaries([completed], listed)[0]).toBe(completed)
  })

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
