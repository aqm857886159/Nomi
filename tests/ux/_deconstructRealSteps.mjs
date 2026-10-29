// 拆解「点取消 + 整片拆完」走查的步骤本体（设计卡 docs/plan/2026-10-27-deconstruct-cancel.md ★9 D1 / D2）。
// 真付费走查（deconstruct-real.paid.mjs）与零花费演练（deconstruct-real.rehearsal.walk.mjs）跑**同一份**步骤：
// 差别只在读图那个「远端模型」——真付费是 App 里接好的真供应商，演练是本机回环夹具。两边各自直接调 openPaidWalk。
//
// 全程走真界面（真 Electron、真 IPC、真拆解编排、真 ffmpeg、真主进程日志），不直连拆解 IPC：
//   开项目 → 画布 → 从登记的真素材里切一条 8 镜快剪片并导入成视频节点 → 浮条「拆解 ▾ → 拆成镜头表」→ 拆解栏选读图模型 →
//   场景 1「取消」：点「拆解」→ 读图并发起跑 → 等第一镜读完 → 点「取消拆解」→ 表停在「已取消」→ 等主进程把在途的收尾（日志出现 deconstruct.cancelled）→
//                 再等满 60 秒，出站付费调用数一次不再涨；出站收据 = 日志里「已过付费闸」的行数；
//   场景 2「整片拆完」：同一张表再点「拆解」（取消不是死胡同）→ 整片拆完 → 判旧付费 e2e 那一套质量。
// 量具：主进程订阅 undici 的出站（diagnostics_channel）数付费 POST（App 唯一出站入口抓的是原生 fetch，补丁 globalThis.fetch 拦不到它：
// 2026-10-11 分镜表读图走查实测计数全 0）；演练里夹具自己数收到几个，两个数必须相等——用地面真值证明计数器本身是对的。
//
// 短片（≤ 30 次调用）不弹报价卡（2026-10-18 用户拍板「短片不弹，长片才弹」）：这条 8 次读图的片子点「拆解」那一下就是确认，没有卡可点。
// 走查盯着确认框，它一出现就判红（回归），不替它点确认。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { clickOrFail, expect, waitForVisualQuiescence } from './_assert.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { SPEND_DIALOG } from './_paidRun.mjs'
import { canvasFitView } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { uiText } from './full-walk/invariants.mjs'
import {
  CANCEL_EVENT, FASTCUT_SOURCE_ASSET, MIN_SHOTS_FOR_CANCEL, QUIET_AFTER_CANCEL_MS,
  describeVerdict, failureLinesOf, fastCutFilter, judgeCancelScenario, judgeFullScenario, lineCount, logSince, parseCancelLines, readMainLog,
} from './_deconstructRealScore.mjs'

/** 拆解的读图并发数（electron/video/deconstructVideo.ts 的 DECONSTRUCT_CONCURRENCY）：开拆后最先发出的读图就是这么多个。 */
const READ_CONCURRENCY = 4
/** 出站里算「付费请求」的路径：读图 / 转写走 chat completions 与 audio transcriptions（别家协议的两条一并认）。 */
const PAID_REQUEST_PATH = '/chat/completions|/audio/transcriptions|/v1/messages|generateContent'

const L = (key) => uiText('zh-CN', key)
const escapeForRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 取样间隔，不是完成信号：「这一段时间里什么都没再发生」只能靠真的等过这段时间来证明。 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 从登记的真素材里切出那条 8 镜快剪片（无音轨），返回文件路径。 */
export function deriveFastCutClip({ dir = makeTempDir('nomi-deconstruct-real-') } = {}) {
  const source = requireRealMediaAssets([FASTCUT_SOURCE_ASSET]).assets.get(FASTCUT_SOURCE_ASSET).file
  const file = path.join(dir, 'fastcut-8-shots.mp4')
  const ffmpegPath = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path
  const cut = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-i', source, '-filter_complex', fastCutFilter(), '-map', '[v]', '-an',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '24', '-preset', 'veryfast', file])
  if (cut.status !== 0) throw new Error(`从登记真素材切快剪片失败：${String(cut.stderr).slice(0, 400)}`)
  return file
}

// ── 量具 ──────────────────────────────────────────────────────────────────────

/** 在被测 App 的主进程里订阅 undici 出站：付费 POST 的「已创建 / 完整回来 / 出错」三个计数。 */
export async function installWire(app) {
  await app.evaluate((_electron, source) => {
    const pattern = new RegExp(source)
    const wire = { created: 0, completed: 0, errored: 0 }
    globalThis.__deconstructWire = wire
    const channels = process.getBuiltinModule('node:diagnostics_channel')
    const isPaid = (request) => request?.method === 'POST' && pattern.test(String(request.path ?? ''))
    channels.subscribe('undici:request:create', ({ request }) => { if (isPaid(request)) wire.created += 1 })
    channels.subscribe('undici:request:trailers', ({ request }) => { if (isPaid(request)) wire.completed += 1 })
    channels.subscribe('undici:request:error', ({ request }) => { if (isPaid(request)) wire.errored += 1 })
  }, PAID_REQUEST_PATH)
}

export const readWire = (app) => app.evaluate(() => ({ ...globalThis.__deconstructWire }))


/** 分镜表节点的文档（画布 store 里读，和用户眼里那张表同一份）。 */
const readTable = (win) => win.evaluate(() => {
  const node = window.__nomiCanvasStore.getState().nodes.find((candidate) => candidate.kind === 'shot_table')
  const doc = node?.meta?.shotTable
  if (!doc) return null
  return {
    nodeId: node.id, status: doc.source.status, durationSeconds: doc.source.durationSeconds ?? null,
    failedShotIndexes: doc.source.failedShotIndexes ?? null, errorMessage: doc.source.errorMessage ?? null,
    rows: doc.rows.map((row) => ({
      order: row.order, startSeconds: row.startSeconds, endSeconds: row.endSeconds, durationSeconds: row.durationSeconds,
      keyframeRef: row.keyframeRef ?? null, visionFailed: Boolean(row.visionFailed), failureReason: row.failureReason ?? null,
      cells: { shotSize: row.cells?.shotSize ?? '', visual: row.cells?.visual ?? '', dialogue: row.cells?.dialogue ?? '' },
    })),
  }
})

/** 盯出站计数直到 `done(wire)` 为真。每次都先核上限：这一场景的付费调用越过镜数（= 逐镜一次）就当场抛，不等判分。 */
async function waitWire(app, { label, done, base, cap, timeout }) {
  for (let tick = 0; tick < Math.ceil(timeout / 50); tick += 1) {
    const wire = await readWire(app)
    if (wire.created - base.created > cap) throw new Error(`出站付费调用 ${wire.created - base.created} 次，超过本场景的上限 ${cap}（逐镜一次、不重试）——当场停`)
    if (done(wire)) return wire
    await sleep(50)
  }
  throw new Error(`等不到：${label}（出站计数 ${JSON.stringify(await readWire(app))}）`)
}

// ── 步骤 ──────────────────────────────────────────────────────────────────────

/** 项目里导入那条快剪片并摆成画布上的视频节点（和用户把素材拖进来走同一条路：importFile → 画布节点）。 */
async function seedReferenceVideo(win, { projectId, clip }) {
  const seeded = await win.evaluate(async ({ b64, id }) => {
    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const saved = await window.nomiDesktop.assets.importFile({ projectId: id, bytes: binary.buffer, contentType: 'video/mp4', fileName: 'fastcut-8-shots.mp4', kind: 'upload' })
    if (!saved.ok) return { error: String(saved.failure?.reason ?? 'unknown') }
    const url = saved.asset.data?.url || ''
    if (!url) return { error: 'asset import returned no url' }
    const store = window.__nomiCanvasStore.getState()
    const video = store.addNode({ kind: 'video', title: '参考片', position: { x: 120, y: 160 } })
    store.updateNode(video.id, { result: { id: `seed-${Date.now()}`, type: 'video', url, createdAt: Date.now() } })
    return { videoId: video.id, url }
  }, { b64: fs.readFileSync(clip).toString('base64'), id: projectId })
  if (!seeded.videoId) throw new Error(`导入快剪片失败：${seeded.error}`)
  return seeded
}

/** 开拆前先用产品自己的切点检测（和拆解同一个 detectShotCuts）数镜：读图调用 = 镜数。 */
async function countShotsLocally(win, { projectId, videoId }) {
  const detected = await win.evaluate(async ({ id, nodeId }) => {
    const node = window.__nomiCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    const result = await window.nomiDesktop.video.detectShotCuts({ videoUrl: node.result.url, projectId: id })
    return { cuts: result.cuts?.length ?? 0, durationSeconds: result.durationSeconds ?? 0 }
  }, { id: projectId, nodeId: videoId })
  return { preShots: detected.cuts + 1, durationSeconds: detected.durationSeconds }
}

/** 浮条「拆解 ▾ → 拆成镜头表」：只建表、不开拆，没有报价卡、一个请求都不发。 */
async function createShotTable(win, { videoId }) {
  const videoNode = win.locator(`[data-node-id="${videoId}"]`)
  await expect(videoNode, '画布上有那个视频节点').toBeVisible({ timeout: stationTimeout() })
  await waitForVisualQuiescence(win)
  await videoNode.click()
  await clickOrFail(win.getByRole('button', { name: L('generationCommon.videoToolbar.breakDown'), exact: true }).first(), '浮条「拆解」')
  await clickOrFail(win.getByRole('menuitem', { name: new RegExp(`^${escapeForRegExp(L('generationCommon.videoToolbar.shotTable'))}`) }), '菜单「拆成镜头表」')
  const table = win.locator('[data-testid="shot-table-node"]').first()
  await expect(table, '建出了分镜表节点').toBeAttached({ timeout: stationTimeout() })
  // 新表落在源视频右边、可能在屏外：画布不自动挪视口，点边缘「新节点在右侧」框进来。
  const arrival = win.locator('[data-canvas-arrival-hint]')
  if (await arrival.count()) await clickOrFail(arrival.first(), '边缘「新节点在右侧」')
  await waitForVisualQuiescence(win)
  const bar = win.locator('.react-flow__node:has([data-testid="shot-table-node"]) [data-shot-table-composer="deconstruct"]').first()
  await expect(bar, '新表被选中，下方拆解栏出现').toBeVisible({ timeout: stationTimeout() })
  // 整张表（1100 宽）连同下方拆解栏框进视口：不然右端的「取消拆解」钮在屏外，截图上看不见要点的那颗钮。
  await canvasFitView(win, '整张表与拆解栏框进视口')
  await waitForCanvasViewportSettled(win)
  await waitForVisualQuiescence(win)
  return { table, bar }
}

/** 拆解栏「读图」选被授权的那个读图模型（真付费只授权这一个；演练里是同名的夹具）。 */
async function pickVisionModel(win, { bar, label }) {
  if (!label) throw new Error('读不到被授权读图模型的显示名（接入完成后目录里没有它）——一个付费请求都没发')
  const picker = bar.getByRole('button', { name: L('shotTable.visionModel') }).or(bar.getByRole('combobox', { name: L('shotTable.visionModel') })).first()
  await clickOrFail(picker, '拆解栏「读图」')
  await clickOrFail(win.getByRole('option', { name: new RegExp(escapeForRegExp(label)) }).first(), `选读图模型「${label}」`)
  await expect(picker, '读图选的就是被授权的那个模型').toContainText(label)
}

/** 场景 1：取消。 */
async function runCancelScenario(ctx) {
  const { win, app, walk, bar, table, tableId, preShots, control, fixture, quietMs } = ctx
  const startButton = bar.locator('[data-testid="shot-table-restart-deconstruction"]')
  const cancelButton = bar.locator('[data-testid="shot-table-cancel-deconstruction"]')
  const base = await readWire(app)
  const fixtureBase = fixture ? fixture.requests.length : 0
  const logBase = lineCount(readMainLog(walk.userDataDir))
  const cap = preShots
  await control.beforeCancelRun?.()

  await clickOrFail(startButton, '拆解栏「拆解」', { noWaitAfter: true })
  await expect(cancelButton, '拆解跑起来：主按钮换成「取消拆解」').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  // 读图并发起跑：最先发出的读图就是并发数那么多个（真实供应商与夹具一样）。
  await waitWire(app, { label: `读图并发起跑（${Math.min(READ_CONCURRENCY, preShots)} 个读图已发出）`, base, cap, timeout: stationTimeout({ operations: 4 }),
    done: (wire) => wire.created - base.created >= Math.min(READ_CONCURRENCY, preShots) })
  await walk.snap('cancel-1-reads-in-flight')

  // 第一镜读完：出站里有一次读图完整回来。演练在这里才放第一个应答；真付费是供应商自己回。
  await control.firstReadMayComplete?.()
  await waitWire(app, { label: '第一镜读完（一次读图完整回来）', base, cap, timeout: stationTimeout({ turns: 1 }), done: (wire) => wire.completed - base.completed >= 1 })
  await cancelButton.click({ noWaitAfter: true })
  const atClick = await readWire(app)

  await expect.poll(async () => (await readTable(win))?.status, { message: '点取消：表立即落「已取消」', timeout: stationTimeout({ operations: 2 }) }).toBe('cancelled')
  const notice = table.locator('[data-testid="shot-table-interrupted-notice"]')
  await expect(notice, '表顶上有「已取消」那句').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  const noticeText = (await notice.innerText()).replace(/\s+/g, ' ').trim()
  await walk.snap('cancel-2-cancelled')

  // 取消那一刻已经发出去的那几次照常回来、照常结算；等主进程把它们收完尾（日志里出现 deconstruct.cancelled）。
  await control.afterCancel?.()
  const cancelLinesOf = () => parseCancelLines(logSince(readMainLog(walk.userDataDir), logBase)).filter((line) => line.nodeId === tableId)
  await expect.poll(() => cancelLinesOf().length, { message: `主进程日志出现 ${CANCEL_EVENT}（在途的收完尾之后）`, timeout: stationTimeout({ turns: 1 }), intervals: [250] }).toBeGreaterThan(0)
  const atLog = await readWire(app)
  const fixtureAtLog = fixture ? fixture.requests.length - fixtureBase : 0

  // 取消收尾之后再等满 quietMs：付费调用数一次不再涨。涨了就当场停（每多一次都是一笔钱），不等满。
  const quiet = []
  for (let second = 0; second < Math.round(quietMs / 1000); second += 1) {
    await sleep(1000)
    const wire = await readWire(app)
    quiet.push(wire.created - base.created)
    if (wire.created !== atLog.created) break
  }
  const afterQuiet = (await readWire(app)).created - base.created
  const logText = logSince(readMainLog(walk.userDataDir), logBase)
  const facts = {
    preShots, expectedNotice: L('shotTable.cancelled'), firstReadDoneAtClick: atClick.completed - base.completed >= 1,
    wire: { atClick: atClick.created - base.created, atLog: atLog.created - base.created, quiet, afterQuiet },
    ...(fixture ? { groundTruth: { atLog: fixtureAtLog, afterQuiet: fixture.requests.length - fixtureBase } } : {}),
    cancelLines: cancelLinesOf(), failureLines: failureLinesOf(logText), table: { status: (await readTable(win))?.status, notice: noticeText },
  }
  return { facts, verdict: judgeCancelScenario(facts) }
}

/** 场景 2：同一张表再拆一次，整片拆完。 */
async function runFullScenario(ctx) {
  const { win, app, walk, bar, preShots, durationSeconds, control, fixture } = ctx
  const startButton = bar.locator('[data-testid="shot-table-restart-deconstruction"]')
  const base = await readWire(app)
  const fixtureBase = fixture ? fixture.requests.length : 0
  const logBase = lineCount(readMainLog(walk.userDataDir))
  const cap = preShots
  await control.beforeFullRun?.()

  await clickOrFail(startButton, '拆解栏「拆解」（取消之后再拆一次）', { noWaitAfter: true })
  // 一边等表落终态、一边盯确认框与出站上限：框出现 = 回归（短片不弹卡），越过上限 = 重发。
  await expect.poll(async () => {
    if (await win.locator(SPEND_DIALOG).count()) return 'card'
    if ((await readWire(app)).created - base.created > cap) return 'over-cap'
    return (await readTable(win))?.status ?? 'none'
  }, { message: '整片拆完：表落终态（不弹报价卡、不越过一镜一次）', timeout: stationTimeout({ turns: 2 }), intervals: [250] }).toMatch(/^(ready|failed|interrupted|cancelled|card|over-cap)$/)
  await waitForVisualQuiescence(win)
  const table = await readTable(win)
  await walk.snap('full-1-ready')
  const wire = await readWire(app)
  const logText = logSince(readMainLog(walk.userDataDir), logBase)
  const facts = {
    preShots, durationSeconds: table?.durationSeconds ?? durationSeconds,
    table: { status: table?.status, rows: table?.rows ?? [], failedShotIndexes: table?.failedShotIndexes, hasAudio: false },
    wire: { created: wire.created - base.created },
    ...(fixture ? { groundTruth: { arrived: fixture.requests.length - fixtureBase } } : {}),
    cancelLines: parseCancelLines(logText), failureLines: failureLinesOf(logText),
  }
  return { facts, verdict: judgeFullScenario(facts), tableError: table?.errorMessage ?? null }
}

/**
 * 整条旅程。`journey` 由调用方传入并就地填写：中途出错时调用方手里仍有已跑完的那一段（证据照写）。
 * `control`（演练专用，真付费不传）：{ beforeCancelRun, firstReadMayComplete, afterCancel, beforeFullRun } 四个可选的钩子，
 * 演练在这里摆夹具的应答节奏；步骤本身一个字不因演练 / 真付费而不同。
 */
export async function runDeconstructJourney(journey, { walk, modelLabel, control = {}, fixture = null, quietMs = QUIET_AFTER_CANCEL_MS }) {
  journey.scenarios = {}
  const { win, app } = await walk.start({ first: true })
  // 画布 store 的走查桥（localStorage.__nomiE2E，开项目之前置上）：导入后摆节点、读表的状态都走它。
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  const { projectId } = await walk.newProject()
  // 窗口放大：1100 宽的分镜表 + 左边的源视频 + 下方拆解栏要一屏装得下，截图才拍得到「取消拆解」钮。
  await walk.resizeWindow(1680, 1050)
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: stationTimeout() })

  const clip = deriveFastCutClip()
  const seeded = await seedReferenceVideo(win, { projectId, clip })
  const { preShots, durationSeconds } = await countShotsLocally(win, { projectId, videoId: seeded.videoId })
  journey.clip = { source: FASTCUT_SOURCE_ASSET, preShots, durationSeconds }
  console.log(`[deconstruct-real] 本地切点数出 ${preShots} 镜、片长 ${durationSeconds.toFixed(2)}s（读图 ${preShots} 次；> ${MIN_SHOTS_FOR_CANCEL - 1} 镜取消才有得拦）`)
  if (preShots < MIN_SHOTS_FOR_CANCEL) throw new Error(`场景不成立，没有拆（一个付费请求都没发）：只切出 ${preShots} 镜，要 ≥ ${MIN_SHOTS_FOR_CANCEL}`)

  await installWire(app)
  const { table, bar } = await createShotTable(win, { videoId: seeded.videoId })
  const tableId = (await readTable(win)).nodeId
  await pickVisionModel(win, { bar, label: modelLabel() })
  const ctx = { win, app, walk, bar, table, tableId, preShots, durationSeconds, control, fixture, quietMs }

  journey.scenarios.cancel = await runCancelScenario(ctx)
  console.log(describeVerdict('场景 1 · 取消', journey.scenarios.cancel.verdict))
  journey.scenarios.full = await runFullScenario(ctx)
  console.log(describeVerdict('场景 2 · 整片拆完', journey.scenarios.full.verdict))

  const verdicts = Object.values(journey.scenarios).map((scenario) => scenario.verdict)
  journey.productFailures = verdicts.flatMap((verdict) => verdict.checks.filter((entry) => !entry.ok).map((entry) => `${entry.id}：${entry.detail}`))
  journey.gaugeProblems = verdicts.flatMap((verdict) => verdict.gaugeProblems)
  journey.receipt = { totalPaidCalls: (await readWire(app)).created, byScenario: { cancel: journey.scenarios.cancel.facts.wire.afterQuiet, full: journey.scenarios.full.facts.wire.created } }
  return journey
}

/**
 * 证据摘要（写进走查报告 report.json 的 deconstructReal 字段；不进仓库）：量具读数、每个场景的判据逐条、量具问题。
 * 日志只摘 deconstruct.cancelled 那一行与失败行，不整份搬。
 */
export function deconstructEvidence({ script, mode, journey, failure }) {
  const scenarios = Object.fromEntries(Object.entries(journey.scenarios ?? {}).map(([name, scenario]) => [name, {
    ok: scenario.verdict.ok, checks: scenario.verdict.checks, gaugeProblems: scenario.verdict.gaugeProblems, facts: scenario.facts,
    ...(scenario.tableError ? { tableError: scenario.tableError } : {}),
  }]))
  return {
    script, mode, buildMarker: CANCEL_EVENT, result: failure ? 'failed' : 'passed', failure: failure ? String(failure?.message ?? failure).slice(0, 2000) : null,
    clip: journey.clip ?? null, receipt: journey.receipt ?? null, productFailures: journey.productFailures ?? null, gaugeProblems: journey.gaugeProblems ?? null, scenarios,
  }
}
