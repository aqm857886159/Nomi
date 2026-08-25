// P4 §3.2 形象确认卡（锚检查点渲染层）—— R13 零额度走查。接 #156 决议链（plan 2026-08-25-p4-anchor-checkpoint-card）。
// 用法: node tests/ux/anchor-checkpoint-card.walk.mjs   （EN: NOMI_E2E_LOCALE=en node ...）
// 产出: tests/ux/shots/anchor-checkpoint-card/*.png（光/暗各一组）
//
// 走真 app、真 IPC、真磁盘。链路（渲染层半程——headless 半程由 anchorCheckpointApproval.e2e.test.ts 盖）：
//   ① 造数据：seed 一个「停在锚检查点」的 durable Run（只写 events.ndjson 让 repo 自算 checksum，不抄实现）——
//      status:running、gates=[waiting anchor_checkpoint(jobIds=2 锚)]、jobs=[2 ready 锚 job(metadata.shotId)]、
//      artifacts=[2 ready image(真 png 落盘 → 缩略图能显)]、generationPlan.shots=[2 锚 + 2 镜]。gate 形状照 e2e。
//   ② 卡弹：任务中心开 → 主操作「过目后开拍」→ SpendConfirmDialog 家族里弹出形象卡。
//      断言标题/副标题/两张形象卡/新拍+复用徽标/两句承诺可见 + **零内部词**（阳性对照：先证探针测得到词，
//      再断言卡上没有「锚/检查点/冻结/封存/物化/合同」）。
//   ③ 开拍：点主按钮 → 断言真发 gate.decide approved（读 durable Run 门变 approved）+ 卡收。
//   ④ 重开：门保持 waiting 时任务中心卡再点能重新弹卡（重开入口 = 既有 run 状态卡，不新造控件）。
//   ⑤ 重拍：点「重拍这张」→ 断言卡进选中态 + 主按钮变形为「先重拍选中的」。
//   光/暗截图各一组，自己 Read 亲眼看。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectHidden, expectText, proveProbe, expectAbsent, scopedText, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-anchor-checkpoint-'))
const projectsDir = path.join(tempRoot, 'projects')
const locale = process.env.NOMI_E2E_LOCALE === 'en' ? 'en' : 'zh-CN'
const shotPrefix = locale === 'en' ? 'en-' : ''
const shotsDir = path.join(repoRoot, 'tests/ux/shots/anchor-checkpoint-card')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const RUN_ID = 'op-anchor-checkpoint'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const findings = []
function record(name, ok, detail) {
  findings.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} —— ${detail}`)
}

const L = locale === 'en'
  ? {
      newProject: 'New blank project',
      title: 'The lead character look is out',
      approvePrefix: 'Looks right', // 「Looks right — shoot 2 shots」
      defer: 'Not yet',
      reworkThis: 'Reshoot this',
      reworkSelected: 'Reshoot the selected ones first',
      badgeNew: 'Fresh',
      badgeReuse: 'Reused',
      noCost: 'adds no cost',
      onlyPay: 'only pay for that one',
      // 内部词红线（英文别名一并挡）
      forbidden: ['anchor', 'checkpoint', 'freeze', 'seal', 'materialize', 'contract'],
    }
  : {
      newProject: '新建空白项目',
      title: '主角形象出片了',
      approvePrefix: '形象都对', // 「形象都对，开拍 2 镜」
      defer: '先不拍',
      reworkThis: '重拍这张',
      reworkSelected: '先重拍选中的',
      badgeNew: '新拍',
      badgeReuse: '复用上集',
      noCost: '不新增花费',
      onlyPay: '只花那一张的钱',
      forbidden: ['锚', '检查点', '冻结', '封存', '物化', '合同'],
    }

// 64×48 纯色 PNG（缩略图真落盘 → 卡上 <img> 能取到 nomi-local 资产、不走占位；两张不同色便于人眼看截图）。
const PNG_BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZElEQVR4nO3PUQkAIBTAwBfbEAYzliH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY8dgHBeJE8lWpuzQAAAABJRU5ErkJggg==', 'base64')
const PNG_GREEN = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZElEQVR4nO3PwQkAIBDAsNsf307igA7hIwiFDpDOPuvrhgsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS147AK4+AlL3d7qaAAAAABJRU5ErkJggg==', 'base64')

/**
 * 停在锚检查点的 durable Run，照 anchorCheckpointApproval.e2e.test.ts 的 gate 形状造。
 * 只写 events.ndjson（一条 run.created），repository.read 自会重建 + 补快照 —— 不在走查里复刻 checksum 算法。
 */
function writeCheckpointRun(projectDir, projectId) {
  const at = new Date().toISOString()
  const anchor = (shotId, jobId, prompt, rel) => ({ shotId, jobId, prompt, rel })
  const anchors = [
    anchor('anchor-1', 'job-anchor-1', '男生 · 阿澈 的定妆照', '.nomi/out/anchor-1.png'),
    anchor('anchor-2', 'job-anchor-2', '女生 · 小满 的定妆照', '.nomi/out/anchor-2.png'),
  ]
  // 真落盘缩略图（两张不同色）
  const pngs = [PNG_BLUE, PNG_GREEN]
  anchors.forEach((a, i) => {
    const abs = path.join(projectDir, a.rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, pngs[i % pngs.length])
  })
  const jobs = anchors.map((a) => ({
    jobId: a.jobId, stageId: 'generate', status: 'ready', attempt: 1,
    provider: 'apimart', model: 'image-model', idempotencyKey: `${a.jobId}:1`,
    metadata: { shotId: a.shotId }, nodeId: `node-${a.shotId}`,
    createdAt: at, updatedAt: at,
  }))
  const artifacts = anchors.map((a) => ({
    artifactId: `art-${a.jobId}`, stageId: 'generate', jobId: a.jobId, kind: 'image', status: 'ready',
    projectRelativePath: a.rel, thumbnailRelativePath: a.rel, createdAt: at,
  }))
  const shots = [
    ...anchors.map((a) => ({ shotId: a.shotId, role: 'anchor', candidate: candidate(a.prompt, 'image-model', 'text-to-image'), updatedAt: at })),
    { shotId: 'shot-1', role: 'shot', candidate: candidate('雨夜推门', 'video-model', 'image-to-video'), updatedAt: at },
    { shotId: 'shot-2', role: 'shot', candidate: candidate('货架对视', 'video-model', 'image-to-video'), updatedAt: at },
  ]
  const run = {
    schemaVersion: 1, runId: RUN_ID, projectId, revision: 0, status: 'running', stageId: 'generate',
    playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'nomi', actorId: 'nomi' },
    brief: { goal: '雨夜便利店', durationSeconds: 30 },
    policy: { mode: 'balanced', trustedHosts: ['nomi'], allowedProviders: ['apimart'], allowedModels: ['image-model', 'video-model'], maxSpend: 18, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 18, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1, snapshotCursor: 1,
    stages: [{ stageId: 'generate', title: 'Generate', status: 'running', order: 0 }],
    gates: [{
      gateId: `gate-anchor-checkpoint-${RUN_ID}`, scope: 'anchor_checkpoint', status: 'waiting',
      planHash: 'plan-hash-batch', jobIds: anchors.map((a) => a.jobId),
      title: 'Review the character look before shooting',
      summary: 'Nomi generated the lead character and scene references first. Approve the look, then it generates each shot.',
      createdAt: at, expiresAt: new Date(Date.parse(at) + 24 * 3600 * 1000).toISOString(),
    }],
    jobs, artifacts,
    generationPlan: {
      operationId: RUN_ID, state: 'sealed',
      candidate: candidate('', 'image-model', 'text-to-image'), shots, updatedAt: at,
    },
    createdAt: at, updatedAt: at,
  }
  const dir = path.join(projectDir, '.nomi', 'runs', RUN_ID)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'events.ndjson'), `${JSON.stringify({
    schemaVersion: 1, eventId: 'evt-checkpoint-1', cursor: 1, runId: RUN_ID, runRevision: 0,
    commandId: `create:${RUN_ID}`, type: 'run.created', message: 'brand.promo', emittedAt: at, payload: { run },
  })}\n`, 'utf8')
}

function candidate(prompt, modelId, mode) {
  return { candidateId: `c-${crypto.randomUUID().slice(0, 8)}`, revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId, mode, prompt, parameters: {}, references: [] }
}

async function openTaskCenter(win) {
  await win.locator('[data-task-center-trigger="true"]').click({ timeout: 10_000 })
  await win.locator('[data-production-task-card]').waitFor({ timeout: 15_000 })
  await win.locator('[data-production-status-title]').waitFor({ timeout: 10_000 })
}

/**
 * 点任务卡主操作把检查点卡唤出来。onPrimaryAction 读的是 hook 里 poll 进来的 run 副本——
 * 刚 seed 完/刚重开时那份可能还没到，requestConfirm 就不弹。给它有界重试（每次点前等卡真出现）。
 */
async function openCheckpointCard(win, card) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await win.locator('[data-production-primary-action]').click({ timeout: 10_000 }).catch(() => {})
    try {
      await card.waitFor({ timeout: 3_000 })
      return
    } catch {
      await delay(1_600) // 等下一轮 poll 把 run 副本刷新
    }
  }
  await card.waitFor({ timeout: 5_000 }) // 最后一次，让它抛出真错
}

async function readRun(win, projectId) {
  return win.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), { pid: projectId, rid: RUN_ID })
}

let app
let win
try {
  ;({ app, win } = await launchNomiApp({ name: 'anchor-checkpoint-card', tempRoot, projectsDir, settleMs: 0 }))
  await win.setViewportSize({ width: 1280, height: 900 })
  if (locale === 'en') {
    await win.evaluate(() => window.localStorage.setItem('nomi:locale:v1', 'en'))
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
  }
  await win.getByText(L.newProject, { exact: false }).first().click()
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 15_000 })
  const projectId = await win.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  if (!projectId) throw new Error('项目没打开')
  await delay(1200)

  // ── ① 造数据：seed 停在检查点的 Run ─────────────────────────────────────────────
  const projectDir = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => path.join(projectsDir, e.name))
    .find((dir) => fs.existsSync(path.join(dir, '.nomi')))
  if (!projectDir) throw new Error(`找不到项目目录：${projectsDir}`)
  writeCheckpointRun(projectDir, projectId)
  await win.keyboard.press('Escape')
  await delay(600)

  const loaded = await readRun(win, projectId)
  record('① 停在检查点的 Run 读得出来（门 waiting、锚 job ready、镜未派）',
    loaded?.status === 'running'
    && loaded?.gates?.find((g) => g.scope === 'anchor_checkpoint')?.status === 'waiting'
    && loaded?.jobs?.length === 2,
    `status=${loaded?.status} gateStatus=${loaded?.gates?.find((g) => g.scope === 'anchor_checkpoint')?.status} jobs=${loaded?.jobs?.length}`)

  // ── ② 卡弹 ──────────────────────────────────────────────────────────────────────
  await openTaskCenter(win)
  await screenshotSettled(win, { path: path.join(shotsDir, `${shotPrefix}01-task-center-checkpoint.png`) })
  const card = win.locator('[data-anchor-checkpoint-card]')
  await openCheckpointCard(win, card)
  await delay(400)
  await screenshotSettled(win, { path: path.join(shotsDir, `${shotPrefix}02-checkpoint-card-light.png`) })

  await expectText(win.locator('[data-anchor-checkpoint-subtitle]').first(), /2/, '副标题应报 2 张形象卡')
  await expectVisible(win.locator('[data-anchor-checkpoint-grid] [data-anchor-entry]').first(), '至少一张形象卡')
  record('② 两张形象卡都在', await win.locator('[data-anchor-checkpoint-grid] [data-anchor-entry]').count() === 2,
    `卡数 = ${await win.locator('[data-anchor-checkpoint-grid] [data-anchor-entry]').count()}`)
  // 缩略图真显（不是占位）——<img> 元素在
  record('② 定妆照缩略图真显（nomi-local 资产，不是占位）',
    await win.locator('[data-anchor-thumb] img').count() === 2,
    `img 数 = ${await win.locator('[data-anchor-thumb] img').count()}`)
  // 徽标：一张新拍、一张…这里两张都新拍（reuse 机制未合，默认全新拍）
  await expectVisible(win.locator('[data-anchor-badge="new"]').first(), '「新拍」徽标应在')
  record('② 徽标语义正确（当前 reuse 未合 → 全「新拍」）',
    await win.locator('[data-anchor-badge="new"]').count() === 2 && await win.locator('[data-anchor-badge="reuse"]').count() === 0,
    `新拍=${await win.locator('[data-anchor-badge="new"]').count()} 复用=${await win.locator('[data-anchor-badge="reuse"]').count()}`)

  // 两句承诺可见
  const noteText = await scopedText(win.locator('[data-anchor-checkpoint-note]'))
  record('② 两句承诺都在（不新增花费 + 只花重拍那张的钱）',
    noteText.includes(L.noCost) && noteText.includes(L.onlyPay), `承诺行：「${noteText}」`)

  // 零内部词（阳性对照：先证「重拍这张」这类真词探针测得到，再断言禁词不在卡内）
  const reworkProbe = await proveProbe(win.locator('[data-anchor-checkpoint-card]', { hasText: L.reworkThis }), '卡上确有「重拍这张」这类可见词（证明扫描测得到卡内文本）')
  const cardText = await scopedText(card)
  const hit = L.forbidden.filter((w) => cardText.includes(w))
  // 阳性对照落地：用 expectAbsent 对每个禁词断言（provenBy 已证卡内文本可扫）
  for (const w of L.forbidden) {
    await expectAbsent(win.locator('[data-anchor-checkpoint-card]', { hasText: w }), { provenBy: reworkProbe, message: `卡上不该出现内部词「${w}」` })
  }
  record('② 卡上零内部词（锚/检查点/冻结/封存/物化/合同）', hit.length === 0, hit.length ? `命中禁词：${hit.join('、')}` : '一个都没有')

  // ── ⑤ 重拍：选中态 + 主按钮变形（在开拍前测，避免决议后卡消失）──────────────────
  const primary = win.locator('[data-anchor-checkpoint-primary]')
  const approveLabelBefore = await scopedText(primary)
  record('⑤ 选中前主按钮 = 开拍', approveLabelBefore.includes(L.approvePrefix), `主按钮：「${approveLabelBefore}」`)
  await win.locator('[data-anchor-rework]').first().click()
  await delay(300)
  await screenshotSettled(win, { path: path.join(shotsDir, `${shotPrefix}03-rework-selected.png`) })
  record('⑤ 点「重拍这张」→ 卡进选中态',
    await win.locator('[data-anchor-entry][data-anchor-selected="true"]').count() === 1,
    `选中卡数 = ${await win.locator('[data-anchor-entry][data-anchor-selected="true"]').count()}`)
  await expectText(primary, new RegExp(L.reworkSelected.slice(0, 6)), '主按钮应变形为「先重拍选中的」')
  record('⑤ 主按钮变形为「先重拍选中的」', (await scopedText(primary)).includes(L.reworkSelected),
    `变形后主按钮：「${await scopedText(primary)}」`)
  // 取消选中，回到开拍态准备走 ③
  await win.locator('[data-anchor-rework]').first().click()
  await delay(300)
  record('⑤ 再点一次取消选中 → 主按钮回到开拍', (await scopedText(primary)).includes(L.approvePrefix),
    `恢复后主按钮：「${await scopedText(primary)}」`)

  // ── ④ 重开：先「先不拍」关卡，门保持 waiting，再从任务中心重开 ───────────────────
  await win.locator('[data-anchor-checkpoint-defer]').click({ timeout: 8_000 })
  await expectHidden(card, '「先不拍」后卡应关闭')
  await delay(600)
  const afterDefer = await readRun(win, projectId)
  record('④ 先不拍 = 不 decide、门保持 waiting（不产生费用）',
    afterDefer?.gates?.find((g) => g.scope === 'anchor_checkpoint')?.status === 'waiting'
    && afterDefer?.budget?.actual === 0,
    `门=${afterDefer?.gates?.find((g) => g.scope === 'anchor_checkpoint')?.status} 已花=${afterDefer?.budget?.actual}`)
  // 重开：任务中心可能随对话框一起收了（面板点外面就收）——重开面板，主操作仍在 → 再点能重新弹卡。
  await openTaskCenter(win)
  const reopenProof = await proveProbe(win.locator('[data-production-primary-action]'), '任务中心卡的主操作键仍在（门 waiting → 可重开）')
  record('④ 重开入口 = 既有任务中心 run 卡（未新造常驻控件）', reopenProof !== null, '主操作键仍在，可重新唤出检查点卡')
  await openCheckpointCard(win, card)
  record('④ 从任务中心重新弹出检查点卡', await card.count() === 1, '卡再次可见')

  // ── ③ 开拍：decide approved + 卡收 ───────────────────────────────────────────────
  await screenshotSettled(win, { path: path.join(shotsDir, `${shotPrefix}04-before-approve.png`) })
  await win.locator('[data-anchor-checkpoint-primary]').click({ timeout: 8_000 })
  await expectHidden(card, '开拍后卡应关闭')
  const approved = await (async () => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const run = await readRun(win, projectId)
      if (run?.gates?.find((g) => g.scope === 'anchor_checkpoint')?.status === 'approved') return run
      await delay(200)
    }
    return await readRun(win, projectId)
  })()
  record('③ 开拍 = 真发 gate.decide approved（门落 approved）',
    approved?.gates?.find((g) => g.scope === 'anchor_checkpoint')?.status === 'approved',
    `门=${approved?.gates?.find((g) => g.scope === 'anchor_checkpoint')?.status}`)
  await delay(600)
  await screenshotSettled(win, { path: path.join(shotsDir, `${shotPrefix}05-after-approve.png`) })

  // 关掉浅色实例——暗色另起一个干净实例拍（真机切暗色只能走 app 启动读取：主题是 React Context 不是 window
  // 全局，DOM 直改会被下次 provider 重渲染覆盖回浅色，reload 又会丢工作台会话让 run 卡不再完整。最稳=冷启动
  // 时 localStorage 已是 dark，整条链和浅色一模一样、无特例）。
  await app?.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })

  // ── ⑥ 暗色：全新实例，冷启动即暗色（seedLocalStorage 在首帧前写好），整条链复用浅色那套 ──────────
  const darkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-anchor-checkpoint-dark-'))
  const darkProjectsDir = path.join(darkRoot, 'projects')
  fs.mkdirSync(darkProjectsDir, { recursive: true })
  let darkApp, darkWin, isDark = false
  try {
    ;({ app: darkApp, win: darkWin } = await launchNomiApp({
      name: 'anchor-checkpoint-card-dark', tempRoot: darkRoot, projectsDir: darkProjectsDir, settleMs: 0,
    }))
    await darkWin.setViewportSize({ width: 1280, height: 900 })
    // 存 dark（+ EN 时连 locale 一起存，否则 reload 后回默认 zh，找不到英文「New blank project」）后 reload——
    // 此刻还没建项目，reload 不丢工作台会话（这是「reload 丢会话」坑的安全窗口）；启动读到 dark，整窗 token 即翻。
    await darkWin.evaluate((loc) => {
      window.localStorage.setItem('nomi-color-scheme', 'dark')
      if (loc === 'en') window.localStorage.setItem('nomi:locale:v1', 'en')
    }, locale)
    await darkWin.reload()
    await darkWin.waitForLoadState('domcontentloaded')
    await delay(800)
    isDark = await darkWin.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark')
    await darkWin.getByText(L.newProject, { exact: false }).first().click()
    await darkWin.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 15_000 })
    const darkPid = await darkWin.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
    await delay(1200)
    const darkProjectDir = fs.readdirSync(darkProjectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => path.join(darkProjectsDir, e.name))
      .find((dir) => fs.existsSync(path.join(dir, '.nomi')))
    writeCheckpointRun(darkProjectDir, darkPid)
    await darkWin.keyboard.press('Escape'); await delay(600)
    await darkWin.locator('[data-task-center-trigger="true"]').click({ timeout: 10_000 })
    await darkWin.locator('[data-production-task-card]').waitFor({ timeout: 15_000 })
    await darkWin.locator('[data-production-status-title]').waitFor({ timeout: 10_000 })
    const darkCard = darkWin.locator('[data-anchor-checkpoint-card]')
    await openCheckpointCard(darkWin, darkCard)
    await delay(400)
    // 断真 token 翻转（不只属性）：读 :root 计算出的 --nomi-bg，暗色应是 oklch(0.18 …)（L≈0.18），浅色是 0.985。
    // ⚠️ 权威信号是这个计算色断言，不是截图——headless 抓图对 oklch() 支持不全，暗色 DOM 会被拍成浅色像素
    //    （实测 rootBg/paper/bodyBg/卡背景全 = 暗色 oklch，仅 PNG 渲染回退成浅），别拿那张截图当「没翻」的证据。
    const bg = await darkWin.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nomi-bg').trim())
    const cardBg = await darkCard.evaluate((el) => getComputedStyle(el).backgroundColor)
    const bgIsDark = /0\.1[0-9]|0\.18/.test(bg) // 暗色 L=0.18；浅色 L=0.985
    await screenshotSettled(darkWin, { path: path.join(shotsDir, `${shotPrefix}06-checkpoint-card-dark.png`) })
    record('⑥ 暗色主题下卡真翻转（--nomi-bg + 卡背景计算色变暗；截图 oklch 回退不作数）',
      await darkCard.count() === 1 && isDark && bgIsDark, `isDark=${isDark} --nomi-bg=${bg} cardBg=${cardBg}`)
  } finally {
    await darkApp?.close().catch(() => {})
    fs.rmSync(darkRoot, { recursive: true, force: true })
  }

  console.log('\n──────── 小结 ────────')
  const failed = findings.filter((f) => !f.ok)
  if (failed.length > 0) {
    console.error(`${failed.length} 项未通过：${failed.map((f) => f.name).join('、')}`)
    process.exit(1)
  }
  console.log(`ANCHOR CHECKPOINT CARD WALK PASS (${locale}): 全部 ${findings.length} 项通过。截图在 ${shotsDir}`)
} catch (error) {
  console.error('❌ 走查失败:', error?.stack || error)
  await win?.screenshot({ path: path.join(shotsDir, `${shotPrefix}failure.png`) }).catch(() => {})
  console.log(JSON.stringify(findings, null, 2))
  await app?.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
  process.exit(1)
}
