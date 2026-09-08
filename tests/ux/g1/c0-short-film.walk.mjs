#!/usr/bin/env node
// C0: one UI journey, with either synthetic or budgeted real provider dispatch.
import fs from 'node:fs'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import ffprobe from '@ffprobe-installer/ffprobe'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const { values } = parseArgs({ options: {
  'dry-run': { type: 'boolean' }, real: { type: 'boolean' },
  packaged: { type: 'string' }, help: { type: 'boolean' },
}, allowPositionals: false })
if (values.help) {
  console.log('node tests/ux/g1/c0-short-film.walk.mjs (--dry-run | --real) [--packaged /absolute/Nomi.app]')
  console.log('--real uses APIMart application settings; all-in budget CNY 8, current prices checked before dispatch.')
  process.exit(0)
}
if (Boolean(values['dry-run']) === Boolean(values.real)) throw new Error('Select exactly one of --dry-run / --real')
if (values.packaged) values.packaged = path.resolve(root, values.packaged)
const outputDir = path.join(root, 'tests/ux/shots/g1-c0')
fs.mkdirSync(outputDir, { recursive: true })
const attemptDir = fs.mkdtempSync(path.join(outputDir, 'attempt-'))
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const scriptFile = path.join(root, 'tests/ux/g1/c0-script.md')
const script = fs.readFileSync(scriptFile, 'utf8')
const report = {
  mode: values.real ? 'real' : 'dry-run', sourceSha: sha, sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(), platform: `${os.platform()} ${os.arch()}`,
  executor: 'Codex', reviewer: 'pending', attemptDir, inputSha256: hash(scriptFile),
  paidCalls: 0, costCny: 0, budgetCny: values.real ? 8 : 0, c0Accepted: false,
  r30: { real: { firstTool: 'N/A (0/0)', turns: 'N/A (0/0)' }, simulated: { firstTool: 'N/A (0/0)', turns: 'N/A (0/0)' } },
  steps: [],
}
fs.copyFileSync(scriptFile, path.join(attemptDir, 'input.md'))
function save() {
  fs.writeFileSync(path.join(attemptDir, 'report.json'), JSON.stringify(report, null, 2))
  const log = ['# C0 情绪摩擦日志', '', `模式：${report.mode}；源码：${sha}；证据：${attemptDir}`,
    '人眼复核尚未完成；自动断言成功不等于无摩擦，也不等于真实 C0 通过。', '',
    ...report.steps.flatMap((step) => [
      `## ${step.id} ${step.action}`, `开始：${step.started}；结束：${step.ended}；等待/操作合计：${step.seconds}s`,
      `预期：${step.expected}`, `实际：${step.actual}`, `情绪：${step.emotion}`,
      `打断：${step.interruption}；处理：${step.treatment}`, `截图：${step.screenshot ?? '无（未到稳定画面）'}`, '',
    ]), `结果：${report.result ?? 'running'}；费用 ¥${report.costCny}；${report.blocker ?? ''}`, '']
  fs.writeFileSync(path.join(attemptDir, 'emotion-log.md'), log.join('\n'))
  fs.writeFileSync(path.join(outputDir, 'emotion-log.md'), log.join('\n'))
}
let app, win, scheduler, screenshotSettled, expect, stopRuntimeApp
async function step(id, action, expected, run, interruption = '无自动检测到的审批；待人眼核对') {
  const began = performance.now()
  const entry = { id, action, expected, started: new Date().toISOString(), interruption }
  report.steps.push(entry)
  try {
    await run()
    entry.actual = values.real ? '观察点断言通过（真实供应商）' : '观察点断言通过（仅模拟供应商）'
    entry.emotion = '待人眼逐图复核，不能自动判无'
    entry.treatment = '复核后补充具体摩擦或明确无'
    const screenshot = path.join(attemptDir, `C0-${sha.slice(0, 8)}-${id}.png`)
    await screenshotSettled(win, { path: screenshot })
    entry.screenshot = screenshot
  } catch (error) {
    entry.actual = values.real ? '失败：C0_WALK_STEP_FAILED（原始异常不进入证据）' : `失败：${error.message}`
    entry.emotion = '阻塞，任务不能继续'
    entry.treatment = '保留现场；修复后重新执行，不删除失败样本'
    throw error
  } finally {
    entry.ended = new Date().toISOString()
    entry.seconds = Number(((performance.now() - began) / 1000).toFixed(3))
    save()
  }
}
try {
  // Check before importing Playwright so a missing development environment leaves a report.
  const missing = ['node_modules', ...(!values.packaged ? ['dist/index.html', 'dist-electron/main.js'] : [])]
    .filter((name) => !fs.existsSync(path.join(root, name)))
  if (missing.length) throw new Error(`Missing local build/dependencies: ${missing.join(', ')}. No packages installed by this walk.`)
  const assertions = await import('../_assert.mjs')
  ;({ expect, screenshotSettled } = assertions)
  const { clickOrFail, proveProbe, expectAbsent } = assertions
  const { launchNomiApp } = await import('../_launchApp.mjs')
  const support = await import('../agent-runtime-walk-support.mjs')
  const { DOCUMENT, CREATION_PANEL, APPROVAL_CARD, INTERVENTION_CONFIRM,
    readProject, openCanvas } = support
  ;({ stopRuntimeApp } = support)
  const { createDryScheduler, shots } = await import('./c0-fixture.mjs')
  const tempRoot = path.join(attemptDir, 'profile')
  const settingsDir = path.join(tempRoot, 'settings')
  let executablePath = values.packaged
  if (executablePath?.endsWith('.app')) {
    report.packagedAsarSha256 = hash(path.join(executablePath, 'Contents/Resources/app.asar'))
    const binary = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(executablePath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
    executablePath = path.join(executablePath, 'Contents/MacOS', binary)
  }
  if (executablePath) report.executableSha256 = hash(executablePath)
  scheduler = values.real
    ? await (await import('./c0-real-scheduler.mjs')).createRealScheduler({ tempRoot, attemptDir, outputDir, report })
    : await createDryScheduler(root, settingsDir, path.join(attemptDir, 'fixture-media'), report)
  const MODEL = scheduler.model
  const launch = async () => {
    const launched = await launchNomiApp({ name: 'g1-c0', tempRoot, settingsDir, settleMs: 0,
    ...(scheduler.iso ? { ...scheduler.iso, userDataDir: scheduler.iso.chromiumDir } : {}),
    ...(executablePath ? { executablePath } : {}),
    env: { NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability'), NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '',
      NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' }, args: ['--no-proxy-server'],
    })
    try { await scheduler.attach(launched) } catch (error) { await launched.close(); throw error }
    return launched
  }
  let projectId, projectRoot, nodeIds, before, exportPath
  const payload = async () => (await readProject(win, projectId)).payload
  const videoClips = (p) => p.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'video').sort((a, b) => a.startFrame - b.startFrame)
  await step('00', '准备隔离空项目', '独立 profile、版本可核对、项目库为空', async () => {
    const launched = await launch()
    ;({ app, win } = launched)
    win.setDefaultTimeout(30_000)
    report.build = await app.evaluate(({ app: main }) => ({ version: main.getVersion(), packaged: main.isPackaged, appPath: main.getAppPath(), userData: main.getPath('userData') }))
    expect(report.build.userData).toBe(launched.userDataDir)
    expect(report.build.packaged).toBe(Boolean(executablePath))
    expect(await win.evaluate(() => window.nomiDesktop.projects.listAsync())).toEqual([])
    await win.evaluate(() => {
      localStorage.setItem('nomi:locale:v1', 'zh-CN')
      for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
    })
    await win.reload({ waitUntil: 'domcontentloaded' })
    await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }), '创建 C0 空项目')
    await expect(win.locator(DOCUMENT)).toBeVisible()
    const projects = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
    expect(projects).toHaveLength(1)
    projectId = projects[0].id
    projectRoot = projects[0].rootPath
    expect(path.relative(launched.projectsDir, projectRoot).startsWith('..')).toBe(false)
    report.projectId = projectId
    report.projectRoot = projectRoot
    expect((await payload()).generationCanvas.nodes).toEqual([])
  })
  await step('01', '导入原创剧本和五约束', '全文在编辑区可编辑，落盘保留人物地点结局和占位说明', async () => {
    await win.locator(DOCUMENT).fill(script)
    await expect(win.locator(DOCUMENT)).toContainText('五约束')
    await expect.poll(async () => JSON.stringify(support.requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))), { timeout: 30_000 }).toContain('今天没有拍下整座城市')
    for (const constraint of ['16:9', '64 秒', '小禾', '修鞋摊', '合上电脑']) await expect(win.locator(DOCUMENT)).toContainText(constraint)
  })
  await step('02', '拆分并审阅八镜分镜', '真实提案审批，八镜共64秒，尚无媒体生成调用', async () => {
    report.r30[values.real ? 'real' : 'simulated'].turns = '0/1 (0%; attempted, not yet successful)'
    scheduler.preparePlan()
    await win.locator(DOCUMENT).click()
    await win.locator(DOCUMENT).selectText()
    await clickOrFail(win.locator('.workbench-selection-popover').getByRole('button', { name: '拆成镜头', exact: true }), '从原文拆镜头')
    await scheduler.planRequested()
    report.r30[values.real ? 'real' : 'simulated'].firstTool = '0/1 (0%; result not yet verified)'
    const approval = win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}`)
    const proof = await proveProbe(approval, '真实分镜审批已出现')
    await screenshotSettled(win, { path: path.join(attemptDir, `C0-${sha.slice(0, 8)}-02-approval.png`) })
    await clickOrFail(approval.locator(INTERVENTION_CONFIRM), '批准分镜')
    await expectAbsent(approval.locator(INTERVENTION_CONFIRM), { provenBy: proof, message: '分镜审批已消费' })
    await scheduler.planCompleted({ win, panel: CREATION_PANEL, expect, projectRoot })
    await expect.poll(async () => {
      const p = await payload()
      return p.storyboardDesignsByDocumentId?.[p.activeDocumentId]?.[0]?.plan?.shots?.length
    }).toBe(8)
    const p = await payload()
    const actual = p.storyboardDesignsByDocumentId[p.activeDocumentId][0].plan.shots
    expect(actual.reduce((sum, s) => sum + s.durationSec, 0)).toBe(64)
    scheduler.verifyPlan(actual, expect)
    await scheduler.assertNoGeneration(expect)
    await clickOrFail(win.locator('[data-storyboard-id]').first(), '进入可编辑分镜表')
    await expect(win.getByRole('textbox', { name: '方案标题', exact: true })).toHaveValue('日落前的一分钟')
  }, '分镜审批 1 次')
  let spendDialog, spendProof
  await step('03', '分镜物化到画布', '八个节点顺序、参数对应；生成前仍零媒体请求', async () => {
    await clickOrFail(win.locator('[data-storyboard-batch="true"]'), '生成未生成的八镜')
    await expect.poll(async () => (await payload()).generationCanvas.nodes.length).toBe(8)
    const nodes = (await payload()).generationCanvas.nodes.sort((a, b) => a.shotIndex - b.shotIndex)
    nodeIds = nodes.map((n) => n.id)
    expect(nodes.map((n) => n.shotIndex)).toEqual(shots.map((s) => s.index))
    expect(nodes.every((n) => n.kind === 'video' && n.meta.duration === 8)).toBe(true)
    // Row model parameters sync to nodes after generation approval.
    const p = await payload()
    expect(p.storyboardDesignsByDocumentId[p.activeDocumentId][0].plan.shots.every((s) => s.modelKey === MODEL)).toBe(true)
    spendDialog = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
    spendProof = await proveProbe(spendDialog, '生成确认出现')
    await scheduler.assertNoGeneration(expect)
  })
  await step('04', values.real ? '确认并生成八段真实视频' : '确认并生成八段模拟视频', '八个不同请求，各自产物落为项目本地视频；禁止重复请求', async () => {
    scheduler.prepareGeneration()
    await clickOrFail(spendDialog.getByRole('button', { name: '生成', exact: true }), values.real ? '批准预算内生成' : '批准零额度生成')
    await expectAbsent(spendDialog, { provenBy: spendProof, message: '生成确认已消费' })
    await screenshotSettled(win, { path: path.join(attemptDir, `C0-${sha.slice(0, 8)}-04-submitted.png`) })
    await expect.poll(async () => {
      const nodes = (await payload()).generationCanvas.nodes
      const failed = nodes.find((n) => n.status === 'error')
      if (failed) throw new Error(`Generation failed: ${failed.error}`)
      return nodes.filter((n) => n.result?.type === 'video' && n.result.url.startsWith('nomi-local://')).length
    }, { timeout: 180_000 }).toBe(8)
    expect((await payload()).generationCanvas.nodes.every((n) => n.meta.modelKey === MODEL)).toBe(true)
    await scheduler.generationCompleted({ expect })
    await openCanvas(win)
    await clickOrFail(win.getByLabel('适应视图').first(), '检查画布全貌')
    expect((await payload()).generationCanvas.nodes.every((n) => Boolean(n.result.url))).toBe(true)
  }, values.real ? '预算内生成确认 1 次' : '零额度生成确认 1 次')
  await step('05', '按叙事加入时间轴并预览', '八段引用对应节点、无空隙、64秒；预览真实推进', async () => {
    for (const [i, id] of nodeIds.entries()) {
      const node = win.locator(`[data-node-id="${id}"]`)
      // The minimum zoom can leave the last row below the viewport after the timeline opens.
      if (await node.count() === 0) {
        const stage = await win.locator('.generation-canvas-v2__stage').boundingBox()
        await win.mouse.move(stage.x + stage.width / 3, stage.y + stage.height * 0.75)
        await win.mouse.down({ button: 'middle' })
        await win.mouse.move(stage.x + stage.width / 3, stage.y + stage.height * 0.25, { steps: 12 })
        await win.mouse.up({ button: 'middle' })
      }
      await node.click({ position: { x: 35, y: 16 } })
      await clickOrFail(node.locator('[aria-label*="加入时间轴"]').first(), `镜头 ${i + 1} 入轴`)
      await expect.poll(async () => videoClips(await payload()).length).toBe(i + 1)
    }
    const p = await payload()
    const clips = videoClips(p)
    expect(clips.map((c) => c.sourceNodeId)).toEqual(nodeIds)
    for (const [i, clip] of clips.entries()) expect(clip.startFrame).toBe(i ? clips[i - 1].endFrame : 0)
    expect(clips.at(-1).endFrame / p.timeline.fps).toBeCloseTo(64, 1)
    await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('预览', { exact: true }), '预览成片')
    const video = win.locator('.workbench-preview-player__video').first()
    await expect(video).toBeVisible()
    await clickOrFail(win.locator('[aria-label="播放"]:visible').first(), '播放时间轴')
    await expect.poll(() => video.evaluate((el) => el.readyState >= 2 && el.currentTime > 0)).toBe(true)
  })
  await step('06', '通过 Nomi 导出 MP4', '实际导出可完整解码，16:9、60–120秒、含音轨', async () => {
    await clickOrFail(win.locator('[aria-label="导出 MP4"]').first(), '导出 MP4')
    const findExport = () => {
      const candidates = fs.readdirSync(projectRoot, { recursive: true }).filter((name) => name.endsWith('.mp4') && name.split(path.sep).includes('exports'))
      return candidates.length === 1 ? path.join(projectRoot, candidates[0]) : undefined
    }
    await expect.poll(() => {
      const file = findExport()
      if (!file) return false
      try { execFileSync(ffprobe.path, ['-v', 'error', '-show_format', file], { stdio: 'pipe' }); return true } catch { return false }
    }, { timeout: 180_000 }).toBe(true)
    exportPath = findExport()
    const probe = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', exportPath], { encoding: 'utf8' }))
    const video = probe.streams.find((s) => s.codec_type === 'video')
    expect(video.width / video.height).toBeCloseTo(16 / 9, 2)
    expect(probe.streams.some((s) => s.codec_type === 'audio')).toBe(true)
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(60)
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(120)
    execFileSync(ffmpeg.path, ['-v', 'error', '-xerror', '-i', exportPath, '-f', 'null', '-'], { stdio: 'pipe' })
    report.export = { path: exportPath, sha256: hash(exportPath), bytes: fs.statSync(exportPath).size, probe }
    for (const [name, at] of [['first', 0], ['middle', 32], ['last', 63]]) {
      execFileSync(ffmpeg.path, ['-v', 'error', '-ss', String(at), '-i', exportPath, '-frames:v', '1', path.join(attemptDir, `${name}.png`)], { stdio: 'pipe' })
    }
  })
  await step('07', '冷重启检查资产和时间轴', '同一项目八个资产和八段剪辑均保留；完整看片仍须人眼签收', async () => {
    before = await payload()
    await scheduler.finish({ projectRoot })
    await stopRuntimeApp(app)
    app = undefined
    ;({ app, win } = await launch())
    const after = await payload()
    expect(after.generationCanvas.nodes.map((n) => ({ id: n.id, result: n.result }))).toEqual(before.generationCanvas.nodes.map((n) => ({ id: n.id, result: n.result })))
    expect(videoClips(after)).toEqual(videoClips(before))
    await clickOrFail(win.locator(`[data-project-id="${projectId}"]`), '重开同一个隔离项目')
    await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('预览', { exact: true }), '重启后查看已保存成片')
    await expect(win.locator('.workbench-preview-player__video').first()).toBeVisible()
    expect(videoClips(await payload())).toHaveLength(8)
    await scheduler.finish({ projectRoot })
    report.review = 'Pending human inspection: inspect story, identity, continuity, audio and all screenshots.'
  })
  report.result = `${report.mode}-assertions-passed-review-pending`
} catch (error) {
  report.result = error.message === 'C0_BLOCKED_BUDGET' ? 'blocked-budget' : 'failed'
  report.blocker = values.real ? (String(error.message).match(/C0_[A-Z_]+/)?.[0] ?? 'C0_WALK_FAILED_RAW_ERROR_SUPPRESSED') : error.message
  if (win) {
    try { await win.screenshot({ path: path.join(attemptDir, 'FAIL.png') }) }
    catch { report.failureScreenshot = 'unavailable' }
  }
  console.error(`C0 ${report.result}: ${report.blocker}`)
  process.exitCode = 1
} finally {
  try { if (scheduler) await scheduler.close() } catch { report.cleanupError = 'C0_SCHEDULER_CLEANUP_FAILED'; process.exitCode = 1 }
  try { if (app) await stopRuntimeApp(app) } catch { report.cleanupError = 'C0_APP_CLEANUP_FAILED'; process.exitCode = 1 }
  if (values.real) fs.rmSync(path.join(attemptDir, 'profile/settings'), { recursive: true, force: true })
  save()
  console.log(`C0 ${report.result}; evidence: ${attemptDir}; paid calls: ${report.paidCalls}`)
}
