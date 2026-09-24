import { describe, expect, it } from 'vitest'

import type { ProductionJob, ProductionRun, ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
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
    budget: { currency: 'CNY', authorized: 20, reserved: 5, actual: 3, unsettled: 0, unknownInFlight: 0 },
    updatedAt: '2026-08-09T02:00:00.000Z',
    dispatched: true,
    ...patch,
  }
}

/** 任务中心拿到的「打开着的那一份」是完整 Run（不是摘要），`dispatched` 要从它的计划与 job 当场判。 */
function fullRun(patch: Partial<ProductionRun> = {}): ProductionRun {
  const { dispatched: _dispatched, ...base } = summary()
  return {
    ...base, schemaVersion: 1, planVersion: 1, snapshotCursor: 1, stages: [], gates: [], jobs: [], artifacts: [],
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    createdAt: '2026-08-09T02:00:00.000Z',
    ...patch,
  } as ProductionRun
}

function job(status: ProductionJob['status']): ProductionJob {
  return { jobId: `job-${status}`, stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'm', idempotencyKey: 'k', createdAt: '2026-08-09T02:00:00.000Z', updatedAt: '2026-08-09T02:00:00.000Z' }
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
    const completed = fullRun({ revision: 9, status: 'completed' })

    const [resolved] = mergeProductionRunSummaries([listed], completed)
    expect(resolved).toMatchObject({ revision: 9, status: 'completed' })
    expect(buildProductionRunTaskRows([resolved], labels)[0].group).toBe('done')
    const newer = summary({ revision: 9, status: 'completed' })
    expect(mergeProductionRunSummaries([newer], fullRun({ revision: 8 }))[0]).toBe(newer)
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

  // 2026-09-24 真模型走查：Agent 按「先别生成」建的草稿让任务按钮变蓝、亮着 1——那一刻 0 个 job、0 次请求。
  // 用户拍板：还没点头的草稿列出来（看得见 Agent 选了什么），但单独一组，不算在跑。
  it('还没点头的草稿 → 草稿组，不进「进行中」（任务按钮只数 running/queued，于是不亮）', () => {
    const [row] = buildProductionRunTaskRows([summary({ status: 'draft', dispatched: false })], labels)
    expect(row.group).toBe('draft')
  })

  it('状态仍是 draft 但已经点过头（单镜「批准 → 供应商受理」之间）→ 进行中', () => {
    const [row] = buildProductionRunTaskRows([summary({ status: 'draft', dispatched: true })], labels)
    expect(row.group).toBe('running')
  })

  it('其余在等人的状态不归草稿组（它们有各自的门卡），分组不变', () => {
    for (const status of ['awaiting_direction', 'awaiting_script_review', 'awaiting_storyboard_review', 'awaiting_contract', 'ready'] as const) {
      expect(buildProductionRunTaskRows([summary({ status, dispatched: false })], labels)[0].group, status).toBe('running')
    }
  })

  it('打开着的完整 Run 并进来时，dispatched 由同一个判据当场判：草稿 0 个 job → 草稿组；job 已过人工门 → 进行中', () => {
    const listed = summary({ revision: 1, status: 'draft', dispatched: true })
    const drafted = fullRun({ revision: 2, status: 'draft', jobs: [] })
    expect(buildProductionRunTaskRows(mergeProductionRunSummaries([listed], drafted), labels)[0].group).toBe('draft')
    const waitingOnCard = fullRun({ revision: 2, status: 'draft', jobs: [job('authorization_required')] })
    expect(buildProductionRunTaskRows(mergeProductionRunSummaries([listed], waitingOnCard), labels)[0].group).toBe('draft')
    const approved = fullRun({ revision: 2, status: 'draft', jobs: [job('submitting')] })
    expect(buildProductionRunTaskRows(mergeProductionRunSummaries([listed], approved), labels)[0].group).toBe('running')
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
