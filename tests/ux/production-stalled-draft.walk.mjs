// 未实现 playbook 的坏 Run —— R13 走查（plan docs/plan/2026-08-18-production-playbook-registry.md）。
// 用法: node tests/ux/production-stalled-draft.walk.mjs
// 产出: tests/ux/shots/production-stalled-draft/*.png
//
// 走三件事，都用真 app、真 IPC、真磁盘：
// ① 起草闸：传一个没实现的 playbook（film.scene-recreation）必须**当场被拒**、错误说人话、盘上不留 run。
//    （原先它静默建出一个 stages/gates 全空、永远停在 draft 的坏 Run，工具还回「成功」。）
// ② 基线：正常的 brand.promo 草稿在任务卡上**确实**会渲染主操作键——否则 ③ 的「没有主操作键」是空话。
// ③ 诚实终态：修复前落盘的坏 Run 仍读得出来。它的卡必须说清「无法继续」、只留取消这一个出口，
//    且不再挂主操作键（原先挂「查看当前阶段」，点了只切到一张空画布）。这种 run 现在造不出来了，
//    所以按用户盘上的真实形态（events.ndjson 里只有一条 run.created）手写进去。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectAbsent, proveProbe, scopedText, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-stalled-draft-'))
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-stalled-draft')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const STALLED_RUN_ID = 'run-legacy-stalled'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const findings = []
function record(name, ok, detail) {
  findings.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} —— ${detail}`)
}

/**
 * 用户盘上那个坏 Run 的真实形态：一条 run.created，stages/gates/jobs 全空，状态停在 draft。
 * updatedAt 给「现在」，好让它成为 store 眼里最新的活动 run（列表按 updatedAt 倒序，见 repository.list）。
 */
function writeLegacyStalledRun(projectDir, projectId) {
  const at = new Date().toISOString()
  const run = {
    schemaVersion: 1,
    runId: STALLED_RUN_ID,
    projectId,
    revision: 0,
    status: 'draft',
    stageId: 'brief',
    playbook: { name: 'film.scene-recreation', version: '1.0.0' },
    origin: { host: 'codex', actorId: 'codex' },
    brief: { goal: '复刻一个电影场景' },
    policy: { mode: 'balanced', trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1,
    snapshotCursor: 1,
    stages: [],
    gates: [],
    jobs: [],
    artifacts: [],
    createdAt: at,
    updatedAt: at,
  }
  const dir = path.join(projectDir, '.nomi', 'runs', STALLED_RUN_ID)
  fs.mkdirSync(dir, { recursive: true })
  // 只写 events.ndjson（不写 run.json 快照）：repository.read 会自己从事件重建并补快照，
  // 免得在走查里复刻一遍 checksum 算法——那等于把实现抄进测试。
  fs.writeFileSync(path.join(dir, 'events.ndjson'), `${JSON.stringify({
    schemaVersion: 1,
    eventId: 'evt-legacy-1',
    cursor: 1,
    runId: STALLED_RUN_ID,
    runRevision: 0,
    commandId: `create:${STALLED_RUN_ID}`,
    type: 'run.created',
    message: 'film.scene-recreation',
    emittedAt: at,
    payload: { run },
  })}\n`, 'utf8')
}

let app
let win
try {
  ;({ app, win } = await launchNomiApp({
    name: 'production-stalled-draft',
    tempRoot,
    projectsDir,
    settleMs: 0,
  }))
  await win.setViewportSize({ width: 1280, height: 860 })
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 15_000 })
  const projectId = await win.evaluate(() =>
    new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  if (!projectId) throw new Error('项目没打开')
  await delay(1500)

  // ── ① 起草闸 ────────────────────────────────────────────────────────────────────
  const rejection = await win.evaluate(async (pid) => {
    try {
      const run = await window.nomiDesktop?.productionRuns?.createDraft({
        projectId: pid,
        playbook: { name: 'film.scene-recreation', version: '1.0.0' },
        origin: { host: 'codex', actorId: 'codex' },
        brief: { goal: '复刻一个电影场景' },
      })
      return { rejected: false, runId: run?.runId ?? null }
    } catch (error) {
      return { rejected: true, message: String(error?.message ?? error) }
    }
  }, projectId)
  const saysBoth = rejection.rejected
    && rejection.message.includes('film.scene-recreation')
    && rejection.message.includes('brand.promo')
  record('① 未实现的 playbook 当场被拒，且错误说清了「传的是什么」「可用的是什么」', saysBoth,
    rejection.rejected ? rejection.message : `竟然建出了 ${rejection.runId}`)

  const listedAfterReject = await win.evaluate((pid) => window.nomiDesktop?.productionRuns?.list(pid), projectId)
  record('① 被拒的起草在盘上一个字节都没留', (listedAfterReject?.length ?? 0) === 0,
    `盘上 run 数 = ${listedAfterReject?.length ?? 0}（应为 0）`)

  // ── ② 基线：正常草稿的卡上确实有主操作键 ──────────────────────────────────────────
  const healthy = await win.evaluate(async (pid) => window.nomiDesktop?.productionRuns?.createDraft({
    projectId: pid,
    playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex', actorId: 'codex' },
    brief: { goal: '做一支真实的 Nomi 产品短片', durationSeconds: 30 },
  }), projectId)
  record('② 已实现的 playbook 正常起草', Boolean(healthy?.runId) && healthy?.status === 'awaiting_direction',
    `runId=${healthy?.runId} status=${healthy?.status} gates=${healthy?.gates?.length}`)
  await delay(1200)

  await win.locator('[data-task-center-trigger="true"]').click({ timeout: 10_000 })
  await win.locator('[data-production-task-card]').waitFor({ timeout: 15_000 })
  await delay(600)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-healthy-draft-card.png') })
  const primaryAction = win.locator('[data-production-primary-action]')
  // proveProbe 形式①：先在**它会出现**的现场证一次，再切到不该出现的现场断言它没了。
  const actionProof = await proveProbe(primaryAction, '正常草稿的任务卡上确实会渲染主操作键').catch(() => null)
  record('② 基线成立：正常草稿的卡上有主操作键', actionProof !== null,
    actionProof !== null ? '找到了主操作键（说明 ③ 的「没有主操作键」测得到东西）' : '正常草稿也没有主操作键 —— ③ 的断言不算数')

  // ── ③ 诚实终态 ─────────────────────────────────────────────────────────────────
  const projectDir = (fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDir, entry.name))
    .find((dir) => fs.existsSync(path.join(dir, '.nomi'))))
  if (!projectDir) throw new Error(`找不到项目目录：${projectsDir} 下是 ${fs.readdirSync(projectsDir).join(', ')}`)
  console.log('  → 项目目录:', projectDir)
  writeLegacyStalledRun(projectDir, projectId)
  // 关掉再打开任务中心：store 的 load 挂在「面板 enabled 变化」上，这样它才会重新挑最新的活动 run
  // （坏 Run 的 updatedAt 最新 ⇒ 被选中）。别用 win.reload()——原地刷新不会重建项目会话，
  // 那是走查独有的路径，不是用户走的路。
  await win.keyboard.press('Escape')
  await delay(800)

  const loaded = await win.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), { pid: projectId, rid: STALLED_RUN_ID })
  record('③ 修复前落盘的坏 Run 仍按原样读得出来（没被新校验挡住读取）',
    loaded?.status === 'draft' && (loaded?.stages?.length ?? -1) === 0 && (loaded?.gates?.length ?? -1) === 0,
    `status=${loaded?.status} stages=${loaded?.stages?.length} gates=${loaded?.gates?.length}`)

  await win.locator('[data-task-center-trigger="true"]').click({ timeout: 10_000 })
  await win.locator('[data-production-task-card]').waitFor({ timeout: 15_000 })
  await delay(800)
  const card = win.locator('[data-production-task-card]')
  await screenshotSettled(win, { path: path.join(shotsDir, '02-task-center-stalled-draft.png') })
  const box = await card.boundingBox()
  if (box) {
    await screenshotSettled(win, {
      path: path.join(shotsDir, '03-stalled-draft-card.png'),
      clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 },
    })
  }

  await expectVisible(win.locator('[data-production-status-title]'), '任务卡应当有状态标题')
  const title = await scopedText(win.locator('[data-production-status-title]'))
  record('③ 标题说清了推不动，不再说「草稿等待开始」', title.includes('这个制作无法继续'), `标题：「${title}」`)
  const cardText = await scopedText(card)
  record('③ 说明里给了原因和出路，且明确没花钱',
    cardText.includes('playbook') && cardText.includes('没有产生任何花费'), `卡片文案：「${cardText.slice(0, 120)}…」`)
  await expectVisible(win.locator('[data-production-tone="danger"]'), '色调应当是「需要处理」')
  await expectVisible(win.locator('[data-production-control="cancel"]'), '取消出口应当在')

  let noDeadButton = true
  try {
    if (!actionProof) throw new Error('基线不成立，这条无从判定')
    await expectAbsent(primaryAction, { provenBy: actionProof, message: '推不动的 Run 不该再挂一个去了也没用的主操作键' })
  } catch (error) {
    noDeadButton = false
    console.error(String(error?.message ?? error).split('\n')[0])
  }
  record('③ 不再挂「查看当前阶段」这种点了只切到空画布的按钮', noDeadButton,
    noDeadButton ? '卡上没有主操作键，只剩取消' : '仍然渲染了主操作键')

  // 取消是唯一出口 ⇒ 必须有按钮的分量，不能是角落里的灰色小字（那就又成了「没看到点的地方」）。
  const cancelTag = await win.locator('[data-production-control="cancel"]').evaluate((el) => el.tagName)
  const cancelWeight = await win.locator('[data-production-control="cancel"]').evaluate((el) => {
    const style = getComputedStyle(el)
    return { color: style.color, border: style.borderStyle, bg: style.backgroundColor }
  })
  record('③ 唯一出口有按钮的分量（不是灰色小字）', cancelWeight.border !== 'none',
    `<${cancelTag}> ${JSON.stringify(cancelWeight)}`)

  await win.locator('[data-production-control="cancel"]').click({ timeout: 10_000 })
  await delay(600)
  // 确认框里的确认键（卡上那个也叫「取消制作」，所以必须限定在对话框内点）。
  const confirm = win.locator('[role="dialog"]', { hasText: '取消这次制作' })
    .getByRole('button', { name: '取消制作', exact: true })
  await confirm.click({ timeout: 8_000 })
  await delay(2000)
  const afterCancel = await win.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), { pid: projectId, rid: STALLED_RUN_ID })
  await screenshotSettled(win, { path: path.join(shotsDir, '04-after-cancel.png') })
  record('③ 取消这个出口真的走得通', afterCancel?.status === 'cancelled', `取消后状态 = ${afterCancel?.status}`)

  console.log('\n──────── 小结 ────────')
  const failed = findings.filter((finding) => !finding.ok)
  await app?.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
  if (failed.length > 0) {
    console.error(`${failed.length} 项未通过：${failed.map((finding) => finding.name).join('、')}`)
    process.exit(1)
  }
  console.log(`全部 ${findings.length} 项通过。截图在 ${shotsDir}`)
} catch (error) {
  console.error('❌ 走查失败:', error)
  await win?.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  console.log(JSON.stringify(findings, null, 2))
  await app?.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
  process.exit(1)
}
