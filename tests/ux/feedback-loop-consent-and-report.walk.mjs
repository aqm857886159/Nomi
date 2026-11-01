// R13 走查：反馈回路的两条真实用户旅程，一个隔离资料库里跑完。
//
//   ① 第一次打开 Agent 面板 → 「帮 Nomi 变好」卡出现 → 点「愿意」→ 卡消失、开关真的打开
//      → **冷启动重开** App → 卡不再出现（用户拍板②：只问一次）。
//   ② 规范入口（设置 → 关于 → 反馈）→ 卡 → 「查看」清单 → 发送 → 拿到编号。
//   ③ **真失败面**：往素材库的真文件选择器丢一个策略拒收的文件（`.txt`，必被拒、不花钱）
//      → 内联行说这个文件认不得 → 点那颗「反馈」→ 摘要行就是**那一句**
//      （不是兜底话）→ 发送 → 编号。这一条同时证明失败面那条路**没有设置外壳**。
//
// 两条纪律，都是踩过的坑：
//   · **不用 `win.reload()`**（`walkthrough-no-win-reload` 那条）。第二次开 App 是真的
//     重启一个 Electron 实例、复用同一个 userData —— 那才是「只问一次」要证明的事；
//     原地刷新连 localStorage 都不会重读一遍宿主状态。
//   · **接收端是本机真起的一个 HTTP 服务**，不是 mock 掉 fetch。编号那一行必须真的从
//     一个回了 JSON 的端点拿回来，否则这条走查证明不了「整条链接通了」。
//     它跑在 127.0.0.1，所以 intakeEndpoint 的回环口子就是为这一刻留的。
//
// 用法: node tests/ux/feedback-loop-consent-and-report.walk.mjs
// 产出: docs/evidence/2026-11-01-feedback-delivery/consent-and-report/*.png（人眼逐张看）
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { require as tsxRequire } from 'tsx/cjs/api'
import { launchNomiApp } from './_launchApp.mjs'
import { prepareIsolation, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled, expectAbsent, expectVisible, expectHidden, clickOrFail, proveProbe } from './_assert.mjs'
import { ensureAgentPanelOpen, newProjectEntry, openRailDrawer, openSettings, switchWorkspace } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'docs/evidence/2026-11-01-feedback-delivery/consent-and-report')
const { zhAssetLibrary } = tsxRequire('../../src/i18n/locales/assetLibrary.ts', import.meta.url)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const failures = []
let shotNumber = 0
async function shot(win, name) {
  shotNumber += 1
  const tag = `${String(shotNumber).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

// ── 本机接收端（就是 infra/feedback-worker 的三条路由，最小实现）────────────────────
const received = []
let sequence = 0
const intake = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    received.push({ url: request.url, authorization: request.headers.authorization, body })
    // 只有 /v1/feedback 回编号（真接收端也是这样）。编号递增，因为下面断言两条必须不同。
    if (request.url === '/v1/feedback') sequence += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ok: true,
      ref: 'walk-ref',
      ...(request.url === '/v1/feedback' && { id: `NF-0915-${String(sequence).padStart(4, '0')}` }),
    }))
  })
})
await new Promise((resolve, reject) => { intake.once('error', reject); intake.listen(0, '127.0.0.1', resolve) })
const port = intake.address().port
const intakeEnv = { NOMI_INTAKE_ENDPOINT: `http://127.0.0.1:${port}`, NOMI_INTAKE_TOKEN: 'walk-token' }
console.log(`  · local intake on http://127.0.0.1:${port}`)

// 同一个隔离资料库跑两次启动 —— 「只问一次」只有跨启动才证明得了。
const iso = prepareIsolation(path.join(os.tmpdir(), 'nomi-feedback-loop-walk'), { requireCatalog: false })
const logsDir = path.join(os.tmpdir(), 'nomi-feedback-loop-walk', 'logs')
fs.mkdirSync(logsDir, { recursive: true })
const started = new Date()
const today = [started.getFullYear(), String(started.getMonth() + 1).padStart(2, '0'), String(started.getDate()).padStart(2, '0')].join('-')
fs.writeFileSync(path.join(logsDir, `nomi-${today}.log`), `[${started.toISOString()}] INFO  main           session-start version=walk\n`)
async function launch(name) {
  const instance = await launchNomiApp({
    name,
    userDataDir: iso.chromiumDir,
    settingsDir: iso.settingsDir,
    projectsDir: iso.projectsDir,
    env: { ...intakeEnv, NODE_ENV: 'production' },
  })
  // 日志路径不随 userData 走，不换就读到这台机器的真实日志。
  await instance.app.evaluate(({ app }, dir) => app.setAppLogsPath(dir), logsDir)
  // 两次启动的收尾逐字相同，所以住在这里：抄两份的代价不是多几行，是其中一份悄悄漂掉。
  await dismissSplashIfPresent(instance.win)
  await instance.app.evaluate(({ BrowserWindow }) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    if (window_) { window_.setSize(1680, 1050); window_.center() }
  }).catch(() => {})
  await instance.win.locator('body').waitFor({ state: 'visible' }).catch(() => {})
  return instance
}

async function seedLocale(win) {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
    window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
    // 刻意**不**碰 nomi:agent-consent-asked:v1 —— 那正是这条走查要看的东西。
  })
}

/** 新建一个项目并让右侧 Agent 面板的空态出现（空库是动作卡、有项目时是右上角的钮，都经 newProjectEntry 找）。 */
async function openAgentPanel(win) {
  await clickOrFail(newProjectEntry(win), '新建项目')
  await ensureAgentPanelOpen(win)
  await expectVisible(win.locator('[data-v4-block="empty"]').first(), 'Agent 面板的空态应当出现')
}

let first
try {
  // ── 旅程 ①：首次询问卡 ──────────────────────────────────────────────────────
  first = await launch('feedback-loop-consent')
  await seedLocale(first.win)
  await shot(first.win, 'library')

  await openAgentPanel(first.win)
  const consent = first.win.locator('[data-v4-block="consent"]').first()
  await expectVisible(consent, '第一次打开 Agent 面板应当出现「帮 Nomi 变好」卡')
  await shot(first.win, 'consent-first-ask')

  // 两个钮同等大小（不是「不用了」缩成一行灰字）：量出来比，不靠肉眼。
  const acceptBox = await consent.locator('[data-v4-consent-accept]').first().boundingBox()
  const declineBox = await consent.locator('[data-v4-consent-decline]').first().boundingBox()
  if (!acceptBox || !declineBox) failures.push('两个钮应当都在卡上')
  else if (Math.abs(acceptBox.height - declineBox.height) > 2) {
    failures.push(`两个钮高度应当一致（拒绝不许被做小）：愿意 ${acceptBox.height} vs 不用了 ${declineBox.height}`)
  }

  await clickOrFail(consent.locator('[data-v4-consent-accept]').first(), '点「愿意」')
  await first.win.waitForTimeout(1500)
  await expectHidden(first.win.locator('[data-v4-block="consent"]').first(), '答完之后卡应当收起')
  await shot(first.win, 'consent-answered')

  // 同意真的写进了主进程的同意合同，不只是把卡藏起来。
  const enabled = await first.win.evaluate(async () => {
    const view = await window.nomiDesktop?.settings?.telemetry?.get?.()
    return view?.enabled === true
  })
  if (enabled !== true) failures.push('点了「愿意」之后 telemetry.enabled 应当为 true')

  await first.app.close()
  first = null

  // ── 旅程 ①续：冷启动重开，卡不该再出现 ─────────────────────────────────────
  const second = await launch('feedback-loop-consent-again')
  try {
    await openAgentPanel(second.win)
    await expectHidden(second.win.locator('[data-v4-block="consent"]').first(), '第二次打开不该再问（只问一次）')
    await shot(second.win, 'consent-not-asked-again')

    // ── 旅程 ②：一键反馈 → 真发到本机接收端 → 拿到编号 ─────────────────────────
    //
    // 走的是**规范入口**（设置 → 关于 → 反馈与分享 → 告诉我们一件事），它渲染的和四个
    // 失败面上那颗钮打开的是**同一份** `FeedbackReportCard`（同一个组件、同一条 IPC）。
    //
    // 为什么不在这里点四个失败面上的那颗钮：每一个都要先造出一次**真失败**——
    // Agent 那条要一次真模型调用（这台机器上它其实成功了，见 05 那张图，而且每跑一次都花钱）、
    // 生成节点那条要一次真生成、导入那条要一个真被拒的文件、模型验证那条要先经 onboarding
    // 接一个假 key 的供应商。四者各是一条独立走查的量，硬塞进这一条只会让它变成
    // 「哪一步挂了都说不清」的长链。四处接线本身由类型（FeedbackSurface 联合）、
    // 单测与设计实验室那两格盯着；这一条走查盯的是**发送这条链真的通**。
    await openSettings(second.win, { tab: 'about', label: '打开设置 → 关于' })
    await shot(second.win, 'settings-about')

    // 关于页那一行写的是「反馈」（不是「反馈与分享」——那是它点进去之后的标题）。
    // 按那一行的**说明文字**找，不按标题找：标题「反馈」两个汉字在 JS 正则里两边都没有 \b
    // 边界（CJK 不是 \w），`^\s*反馈\b` 这种写法永远匹配不上——正是 dead-selector 那一族。
    const card = second.win.locator('[data-feedback-card]').first()
    const entry = second.win.locator('button, [role="button"]')
      .filter({ hasText: /遇到问题或想分享|Report a problem or share/i }).first()
    const report = second.win.locator('button, [role="button"]').filter({ hasText: /告诉我们一件事|Tell us one thing/i }).first()
    if (!(await entry.count())) failures.push('设置 → 关于里应当有「反馈」那一行')
    else {
      await clickOrFail(entry, '点「反馈」那一行')
      // 等「告诉我们一件事」真的出现，而不是等一个固定秒数。
      await report.waitFor({ state: 'visible' }).catch(() => {})
    }
    if (!(await report.count())) failures.push('设置 → 关于里应当有「告诉我们一件事」入口')
    else {
      await clickOrFail(report, '点「告诉我们一件事」')
      await card.waitFor({ state: 'visible' }).catch(() => {})
    }
    await expectVisible(card, '反馈卡应当打开')
    const summary = (await card.locator('[data-feedback-summary]').first().innerText().catch(() => '')).trim()
    if (!summary) failures.push('反馈卡应当自带一行摘要（用户零输入）')
    // 摘要是机器凑的：至少带上时间那一格。
    if (!/\d{2}:\d{2}/.test(summary)) failures.push(`摘要行应当含时间：${JSON.stringify(summary)}`)
    // 这个入口不在对话里，没有内容可带，所以没有那个勾（勾选框和默认不勾在 feedback-delivery.walk.mjs）。
    await expectAbsent(card.locator('input[type="checkbox"]'), {
      provenBy: await proveProbe(card.locator('[data-feedback-send]'), '这张卡渲染出来了'),
      message: '不在对话里的入口不该有内容勾选框',
    })
    await shot(second.win, 'feedback-card-idle')

    await clickOrFail(card.locator('[data-feedback-view]').first(), '点「查看」')
    await second.win.waitForTimeout(2000)
    const manifest = second.win.locator('[data-feedback-manifest]').first()
    await expectVisible(manifest, '「查看」应当展开清单')
    // 清单必须把「没带什么、为什么」也写出来（D4 诚实交付）。机器码在属性上，界面上是译文。
    await manifest.locator('[data-feedback-why]').first().waitFor({ state: 'visible' }).catch(() => {})
    const reasons = await manifest.locator('[data-feedback-why]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-feedback-why')))
    if (!reasons.includes('never-collected-by-design')) failures.push('清单里应当写明永远不收的那几类及原因')
    if (!reasons.includes('no-conversation-in-context')) failures.push('不在对话里时清单里应当写明内容为什么没带')
    await shot(second.win, 'feedback-manifest')

    await clickOrFail(second.win.locator('[data-feedback-send]').first(), '点「发送」')
    await second.win.waitForTimeout(3500)
    const receipt = (await second.win.locator('[data-feedback-receipt]').first().innerText().catch(() => '')).trim()
    if (!/NF-\d{4}-\d{4}/.test(receipt)) failures.push(`发完应当收成一行编号，实际：${JSON.stringify(receipt)}`)
    await shot(second.win, 'feedback-receipt')

    // 接收端真的收到了，而且收到的东西里没有路径、没有密钥。
    const posted = received.find((item) => item.url === '/v1/feedback')
    if (!posted) failures.push('本机接收端没有收到 /v1/feedback')
    else {
      if (posted.authorization !== 'Bearer walk-token') failures.push(`应当带 bearer 令牌，实际 ${posted.authorization}`)
      for (const needle of [iso.projectsDir, iso.settingsDir, iso.chromiumDir]) {
        if (posted.body.includes(needle)) failures.push(`报文里泄漏了本机路径：${needle}`)
      }
      if (!/"contentIncluded":false/.test(posted.body)) failures.push('没勾内容时信封应当写明 contentIncluded:false')
      // 落证据时**只留清单与上下文，不留 attachments**：那一格里是这台机器真实的模型目录
      // （密钥已抹，但供应商名与自建中转地址还在），而 docs/evidence/ 是要进 git 的。
      // 证据要能复核，但不该顺手把一份本机配置公开出去。
      const envelope = JSON.parse(posted.body)
      const logTail = envelope.attachments?.['logs/tail.txt']
      if (!Array.isArray(logTail) || logTail.length === 0) failures.push('接收端收到的包里应当有日志尾巴（线上 29 份全是空的）')
      fs.writeFileSync(path.join(shotsDir, 'posted-feedback.summary.json'), JSON.stringify({
        route: posted.url,
        authorizationScheme: String(posted.authorization || '').split(' ')[0],
        totalBytes: Buffer.byteLength(posted.body, 'utf8'),
        context: envelope.context,
        manifest: { entries: envelope.manifest.entries, excluded: envelope.manifest.excluded, totalBytes: envelope.manifest.totalBytes },
        attachmentKeys: Object.keys(envelope.attachments ?? {}),
      }, null, 2))
    }

    // ── 旅程 ③：真失败面（导入被拒）→ 一键反馈 → 编号 ────────────────────────
    //
    // 为什么挑「不支持的类型」：它是**确定性**的策略拒收——不花钱、不碰模型、不依赖网络，
    // 每次都必失败。超大文件也行，但要先造一个几百 MB 的文件，那是白花的磁盘和时间。
    // 先退出设置（Esc 两下：一下收反馈卡那一页、一下关设置弹窗），回到工作台。
    for (let index = 0; index < 2; index += 1) {
      await second.win.keyboard.press('Escape').catch(() => {})
      await second.win.locator('[data-settings-tab-id]').first().waitFor({ state: 'detached' }).catch(() => {})
    }
    await expectHidden(second.win.locator('[data-settings-tab-id]').first(), '设置弹窗应当关掉了')

    // 素材库住在**生成**面的左栏，不是创作面。先切过去。
    await switchWorkspace(second.win, 'generation', '切到生成面')
    await openRailDrawer(second.win, 'assets', '打开素材库')

    // **按 aria-label 精确拿素材库自己那个 <input type=file>**。页面上还有 composer 的附件
    // 输入框——按 `input[type=file]` 取 first 会喂到它那里去（`两个 file input` 那条教训，
    // 第一次跑就真撞了：txt 变成了 Agent 的附件，素材库毫无反应）。
    const fileInput = second.win.getByLabel(zhAssetLibrary.filePicker).first()
    await fileInput.waitFor({ state: 'attached' }).catch(() => {})
    const rejectedFile = path.join(os.tmpdir(), 'nomi-feedback-loop-rejected.txt')
    const rejectionLine = zhAssetLibrary.rejectedUnsupportedUnknown.replace('{{name}}', path.basename(rejectedFile))
    fs.writeFileSync(rejectedFile, '这不是图片也不是视频，导入策略必须拒收它。\n')
    if (!(await fileInput.count())) failures.push('素材库里应当有真实的文件选择器')
    else await fileInput.setInputFiles(rejectedFile).catch((error) => failures.push(`喂文件失败：${error?.message}`))
    const rejectionRow = second.win.locator('[data-asset-library-feedback]').first()
    await rejectionRow.waitFor({ state: 'visible' }).catch(() => {})

    if (!(await rejectionRow.count())) {
      // 找不到就把现场量出来再报（`assert-you-are-in-the-situation-you-claim`）。
      const probe = await second.win.evaluate(() => ({
        fileInputs: document.querySelectorAll('input[type="file"]').length,
        railLabels: [...document.querySelectorAll('button,[role="button"],[role="tab"]')]
          .map((node) => (node.textContent || '').trim()).filter((text) => text && text.length <= 8).slice(0, 20),
        assetMarkers: [...document.querySelectorAll('[data-asset-library-feedback],[data-asset-library-rejection]')].length,
        bodyHas: (document.body.innerText || '').slice(0, 400),
      }))
      console.log(`  · probe ${JSON.stringify(probe)}`)
    }
    await expectVisible(rejectionRow, '导入被拒应当在常驻内联行上说出来')
    const rejectionText = (await rejectionRow.innerText().catch(() => '')).trim()
    if (!rejectionText.includes(rejectionLine)) failures.push(`内联行应当说清是被拒了：${JSON.stringify(rejectionText)}`)
    // 码也露在 DOM 上（给走查和分诊用，不是给用户读的）。
    const rejectionCode = await second.win.locator('[data-asset-library-rejection]').first()
      .getAttribute('data-asset-library-rejection').catch(() => null)
    if (rejectionCode !== 'asset-import-unsupported') failures.push(`被拒的码应当是 asset-import-unsupported，实际 ${rejectionCode}`)
    await shot(second.win, 'import-rejected')

    await clickOrFail(second.win.locator('[data-asset-library-feedback] [data-feedback-open]').first(), '在导入被拒那一行点「反馈」')
    await card.waitFor({ state: 'visible' }).catch(() => {})
    await expectVisible(card, '失败面上的反馈卡应当打开')

    // ① 摘要行必须是**那一句真话**，不是兜底的「这一步没成功」。
    const failureSummary = (await card.locator('[data-feedback-summary]').first().innerText().catch(() => '')).trim()
    // 卡上那一行是「那句人话 · 时间 · 版本」。
    if (!failureSummary.startsWith(`${rejectionLine} · `)) failures.push(`摘要应当派生自导入被拒那句人话，实际：${JSON.stringify(failureSummary)}`)
    if (/这一步没成功/.test(failureSummary)) failures.push('摘要落到了兜底话——说明调用处没把 summary 传进来')

    // ② 从失败面进来时**不许套设置外壳**（用户 09-15 看截图时点出来的那条）。
    await expectHidden(second.win.locator('[data-settings-tab-id]').first(), '失败面进来时不该出现设置侧栏')
    if (await second.win.locator('[data-feedback-back="about"]').count()) failures.push('失败面进来时不该有「‹ 关于」面包屑')
    const backCount = await second.win.locator('[data-feedback-card]').locator('..')
      .getByRole('button', { name: '返回', exact: true }).count().catch(() => 0)
    if (backCount > 0) failures.push('失败面进来时不该有「返回」')
    await shot(second.win, 'failure-surface-card')

    await clickOrFail(second.win.locator('[data-feedback-send]').first(), '在失败面的卡上点「发送」')
    await second.win.locator('[data-feedback-receipt]').first().waitFor({ state: 'visible' }).catch(() => {})
    const failureReceipt = (await second.win.locator('[data-feedback-receipt]').first().innerText().catch(() => '')).trim()
    if (!/NF-\d{4}-\d{4}/.test(failureReceipt)) failures.push(`失败面那条也应当收成编号，实际：${JSON.stringify(failureReceipt)}`)
    // 两条反馈必须拿到**不同**的编号 —— 编号是「用户能口述的把手」，两条共用一个就没法指认了。
    // （这条断言同时让本机接收端里那个递增计数器有人查；没人查的计数器等于摆设。）
    if (failureReceipt === receipt) failures.push(`两条反馈拿到了同一个编号：${failureReceipt}`)
    await shot(second.win, 'failure-surface-receipt')

    // 接收端收到的第二条：surface 必须是 import，码必须带上。
    const postedFailure = received.filter((item) => item.url === '/v1/feedback').at(-1)
    if (!postedFailure) failures.push('接收端没有收到失败面那一条')
    else {
      const envelope = JSON.parse(postedFailure.body)
      if (envelope.context.surface !== 'import') failures.push(`surface 应当是 import，实际 ${envelope.context.surface}`)
      if (envelope.context.errorCode !== 'asset-import-unsupported') failures.push(`errorCode 应当是 asset-import-unsupported，实际 ${envelope.context.errorCode}`)
      if (envelope.context.summary !== rejectionLine) failures.push(`报文里的摘要应当是那句真话，实际 ${envelope.context.summary}`)
      fs.writeFileSync(path.join(shotsDir, 'posted-feedback-import.summary.json'), JSON.stringify({
        route: postedFailure.url,
        context: envelope.context,
        manifest: { entries: envelope.manifest.entries, excluded: envelope.manifest.excluded },
      }, null, 2))
    }
    fs.rmSync(rejectedFile, { force: true })

    if (failures.length) throw new Error(failures.join('; '))
    console.log(`PASS: feedback loop walk; ${shotNumber} shots → ${path.relative(repoRoot, shotsDir)}`)
  } finally {
    await second.app.close().catch(() => undefined)
  }
} catch (error) {
  console.error(`FEEDBACK LOOP WALK FAIL: ${error?.stack || error}`)
  process.exitCode = 1
} finally {
  await first?.app.close().catch(() => undefined)
  intake.close()
}
