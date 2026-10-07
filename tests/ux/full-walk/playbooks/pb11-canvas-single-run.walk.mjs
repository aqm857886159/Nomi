#!/usr/bin/env node
// 剧本 PB11 · 「画布上点 ↑：钱只从一个口子出去」（发动机收敛第一刀 第 1–2 步）
//
// 设计卡：docs/plan/2026-10-05-engine-convergence-cut1-step12-design-card.md。真 App 这一步由独立验收线跑（pending-real-app）。
// 真实创作者会做的三件事，依次发生在同一张卡上：
//   A. 点 ↑ 出图：不弹卡；供应商只收到一笔；项目里多一个单镜 Run（canvas-…），里面记着一份手势批准、一次交、一份产物，已收尾；
//      任务中心「制作」那一栏不多出这一行（F5）；
//   B. 供应商当场明确拒绝（400，参数不对）→ 卡上失败、说的是原话；这一笔在 Run 里记成「没受理」（provider_rejected，没花钱）；
//      用户再点 ↑ → 能重新发，供应商收到下一笔（F3，2026-10-05 拍板）；
//   C. 供应商回 500（可能已经收下）→ 卡上是「结果没法确认」，给的是「去核对」；这一笔在 Run 里是 submission_unknown；
//      用户再点 ↑ → 被拦下，供应商一笔都没多收（核对前不许再发）。
// 乱用：C 里连点两次 ↑。
//
// 零花费：本机回环的「Fixture 图片」模型（画布这台的传输就在本机），任何打向真实供应商的请求都会被出网闸拦下并记成违反。
// 重启那一格（C 之后关掉 App 再开，再点 ↑ 仍被拦）走查框架还没有「同一份资料重开」的口子，由验收线手动做，见设计卡格 9。
import { DEFAULT_TIMEOUT_MS, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from '../../agent-runtime-fixture.mjs'
import { clickNodeGenerate } from '../actions.mjs'
import { startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'
const SEED_EN = process.env.NOMI_FULL_WALK_LOCALE === 'en'
const CARD = 'run-card'

const base = { categoryId: 'shots', references: [], runs: [] }
const pb = await startPlaybook({
  id: 'pb11-canvas-single-run',
  needs: ['loopbackProvider'],
  seed: () => ({
    nodes: [{
      ...base, id: CARD, kind: 'image', title: SEED_EN ? 'Lighthouse' : '灯塔', prompt: SEED_EN ? 'A lighthouse on a cliff at dawn' : '黎明时悬崖上的灯塔', position: { x: 200, y: 140 }, status: 'idle', history: [],
      meta: { modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR, imageModel: FIXTURE_IMAGE_MODEL, imageModelVendor: FIXTURE_VENDOR },
    }],
    groups: [],
    edges: [],
  }),
})
const { smoke, fixture, monitor } = pb
const win = () => smoke.win
const node = async () => ((await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []).find((entry) => entry.id === CARD)
/** 画布这张卡的单镜 Run（目录名以 canvas- 开头，一次 ↑ 一个），按建的先后。 */
const canvasRuns = () => monitor.readRuns().filter((run) => String(run.runId).startsWith('canvas-') && run.origin?.host === 'canvas')
const submissions = () => fixture.images.filter((record) => record.path === '/v1/images/generations').length

fixture.setMediaBehavior(({ index }) => {
  // 第 2 笔：当场明确拒绝（参数不对）；第 4 笔：500（可能已经收下）。其余照常出图。
  if (index === 1) return { reject: { status: 400, json: { error: { message: "Invalid value for 'size': not supported by this model.", type: 'invalid_request_error', param: 'size', code: null } } } }
  if (index === 3) return { fail: { message: 'upstream gateway error' } }
  return undefined
})

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })

  // ── A：点 ↑ 出图 ───────────────────────────────────────────────────────────────
  await monitor.step('A · 点这张卡的 ↑', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '画布卡的 ↑' })
    const how = await clickNodeGenerate(win(), CARD)
    if (how !== 'direct') throw new Error('用户自己点一张卡的 ↑ 不该弹付费确认框（09-25 拍板）')
  }, { surfaces: ['modal', 'canvasGesture'] })
  await monitor.step('A · 等出图，核对 Run 账本', async () => {
    await expect.poll(async () => (await node())?.status, { message: '卡落成 success', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
    expect(submissions(), '供应商只收到一笔').toBe(1)
    await expect.poll(() => canvasRuns().length, { message: '项目里多了一个单镜 Run', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
    const run = canvasRuns()[0]
    expect(run.status, '出图之后这个 Run 收尾了').toBe('completed')
    expect(run.jobs.map((job) => job.status), '一次交、出了图').toEqual(['ready'])
    expect(run.gates.filter((gate) => gate.status === 'approved').length, '一份批准（这一下点击）').toBe(1)
    expect(run.artifacts.some((artifact) => artifact.kind === 'image' && artifact.status === 'ready'), 'Run 里记着这份产物').toBe(true)
    await monitor.screenshot('A-success')
  }, { user: false, surfaces: [] })

  // ── B：当场明确拒绝 → 改了再点 ──────────────────────────────────────────────────────
  await monitor.step('B · 再点一次 ↑（供应商当场拒绝）', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '画布卡的 ↑（第二次）' })
    await clickNodeGenerate(win(), CARD)
  }, { surfaces: ['modal', 'canvasGesture'] })
  await monitor.step('B · 卡上失败，Run 里记成没受理', async () => {
    await expect.poll(async () => (await node())?.status, { message: '卡落成 error', timeout: stationTimeout({ operations: 2 }) }).toBe('error')
    expect(submissions(), '供应商收到第二笔（被它拒了）').toBe(2)
    await expect.poll(() => canvasRuns().at(-1)?.jobs?.[0]?.errorCode, { message: '第二个 Run 记成 provider_rejected', timeout: DEFAULT_TIMEOUT_MS }).toBe('provider_rejected')
    await monitor.screenshot('B-rejected')
  }, { user: false, surfaces: [] })
  await monitor.step('B · 再点 ↑，能重新发（被拒的那一笔没受理、没花钱）', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '画布卡的 ↑（被拒之后）' })
    await clickNodeGenerate(win(), CARD)
    await expect.poll(async () => (await node())?.status, { message: '卡落成 success', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
    expect(submissions(), '供应商收到第三笔').toBe(3)
  }, { surfaces: ['modal', 'canvasGesture'] })

  // ── C：500（可能已经收下）→ 结果没法确认 → 再点被拦 ─────────────────────────────────────────
  await monitor.step('C · 点 ↑（供应商回 500）', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '画布卡的 ↑（会遇到 500）' })
    await clickNodeGenerate(win(), CARD)
  }, { surfaces: ['modal', 'canvasGesture'] })
  await monitor.step('C · 卡上是结果没法确认，Run 里是 submission_unknown', async () => {
    await expect.poll(async () => (await node())?.status, { message: '卡落成 error', timeout: stationTimeout({ operations: 2 }) }).toBe('error')
    expect(submissions(), '供应商收到第四笔').toBe(4)
    await expect.poll(() => canvasRuns().at(-1)?.jobs?.[0]?.status, { message: '第四个 Run 是 submission_unknown', timeout: DEFAULT_TIMEOUT_MS }).toBe('submission_unknown')
    await expect.poll(async () => String((await node())?.runs?.[0]?.error ?? ''), { message: '节点上记的是「结果未知」', timeout: DEFAULT_TIMEOUT_MS }).toMatch(/submission-unknown/)
    await monitor.screenshot('C-unknown')
  }, { user: false, surfaces: [] })
  await monitor.step('C · 乱用：连点两次 ↑，都被拦下，供应商一笔不多收', async () => {
    const runsBefore = canvasRuns().length
    for (const attempt of [1, 2]) {
      await clickNodeGenerate(win(), CARD)
      await expect.poll(async () => String((await node())?.runs?.[0]?.error ?? ''), { message: `第 ${attempt} 次被拦：说的是「先去核对」`, timeout: DEFAULT_TIMEOUT_MS }).toMatch(/needs_reconcile/)
    }
    expect(submissions(), '核对前一笔都没多发').toBe(4)
    expect(canvasRuns().length, '被拦的点击不建 Run').toBe(runsBefore)
    await monitor.screenshot('C-blocked')
  }, { surfaces: ['modal', 'canvasGesture'] })

  await monitor.settle('四次点击走完')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb11 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
