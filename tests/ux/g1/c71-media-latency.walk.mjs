#!/usr/bin/env node
// Real two-shot AI planning / film journey OR zero-cost manual eight-shot protocol; never timing replay.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import ffprobe from '@ffprobe-installer/ffprobe'
import { stationTimeout } from '../_station-budget.mjs'
import { launchNomiApp } from '../_launchApp.mjs'
import { expect, screenshotSettled } from '../_assert.mjs'
import { readProject, DOCUMENT } from '../agent-runtime-walk-support.mjs'
import { completedExports } from './sweep-timeline.mjs'
import { prepareReal, createBarrierFixture } from './c71-fixture.mjs'
import { twoShotScript, selectPlanner, planTwoShots, plannerMetrics } from './c71-planner.mjs'
const { values } = parseArgs({ options: { real: { type: 'boolean' }, loopback: { type: 'boolean' },
  'prepare-only': { type: 'boolean' }, 'output-dir': { type: 'string' } } })
if (Number(Boolean(values.real)) + Number(Boolean(values.loopback)) !== 1) throw Error('Choose --real or --loopback')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const output = path.resolve(root, values['output-dir'] ?? 'tests/ux/shots/c71-speed/r2')
fs.mkdirSync(output, { recursive: true })
const attempt = fs.mkdtempSync(path.join(output, 'attempt-')), profile = path.join(attempt, 'profile'), settingsDir = path.join(profile, 'settings')
const ledgerPath = path.join(output, 'real-budget-ledger.json')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const report = { mode: values.real ? 'real-two-shot-ai-film' : 'zero-cost-eight-shot-barrier-protocol', paidCalls: 0,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  gitDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'], { cwd: root })).digest('hex'),
  sourceBuild: { main: hash(path.join(root, 'dist-electron/main.js')), index: hash(path.join(root, 'dist/index.html')) },
  steps: [], seventhEighthWait: values.real ? 'N/A: two-shot real sample; no invented 7th/8th observation' : 'pending barrier assertion',
  beforeAfter: 'No comparable real pre-change baseline; no speedup claim', review: 'pending human screenshot and exported film review' }
let fixture, launched, win, project, before, started, lock, spendDialog
const save = () => fs.writeFileSync(path.join(attempt, 'report.json'), JSON.stringify(report, null, 2))
const payload = async () => (await readProject(win, project.id)).payload
const clips = p => p.timeline.tracks.flatMap(t => t.clips).filter(c => c.type === 'video').sort((a,b) => a.startFrame - b.startFrame)
async function step(id, action, run) {
  const entry = { id, action, started: new Date().toISOString() }, began = performance.now()
  report.steps.push(entry)
  try {
    await run(); entry.result = 'assertions-passed'
    if (win) { entry.screenshot = path.join(attempt, `${id}.png`); await screenshotSettled(win, { path: entry.screenshot }) }
  } catch (error) { entry.result = 'failed'; throw error }
  finally { entry.ended = new Date().toISOString(); entry.seconds = (performance.now() - began) / 1000; save() }
}
const launch = async () => {
  const next = await launchNomiApp({ name: 'c71-r2', tempRoot: profile, settingsDir, settleMs: 0,
    ...(fixture.iso ? { ...fixture.iso, userDataDir: fixture.iso.chromiumDir } : {}),
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi:locale:v1': 'zh-CN' },
    env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_E2E_PRODUCTION_FIXTURE: '0' } })
  if (values.real) {
    const bridge = path.join(profile, 'c71-main.cjs')
    fs.writeFileSync(bridge, `module.exports = import(${JSON.stringify(new URL('./c71-budget-main.mjs', import.meta.url).href)});`)
    try {
      await next.app.evaluate(async (_electron, options) => {
        const module = await process.mainModule.require(options.bridge)
        globalThis.__c71 = module.attachBudget(options)
      }, { bridge, quote: fixture.quote, ledgerPath })
    } catch (error) { await next.close(); throw error }
    finally { fs.rmSync(bridge, { force: true }) }
  }
  return next
}
try {
  if (values.real) { lock = fs.openSync(path.join(output, 'real-budget.lock'), 'wx', 0o600); fs.closeSync(lock) }
  const preflightStart = performance.now()
  fixture = values.real ? await prepareReal(root, profile, attempt) : await createBarrierFixture(root, settingsDir, path.join(attempt, 'protocol-media'))
  report.quote = fixture.quote ?? { budgetCny: 0, explanation: 'Synthetic media tests admission only; no latency simulation' }
  report.preflightSeconds = (performance.now() - preflightStart) / 1000
  if (values['prepare-only']) { report.result = 'prepared-no-dispatch'; process.exitCode = 0 }
  else {
    await step('00', '准备隔离空项目', async () => {
      launched = await launch(); win = launched.win
      expect(await win.evaluate(() => window.nomiDesktop.projects.listAsync())).toEqual([])
      expect(await win.evaluate(() => localStorage.getItem('nomi.canvas.batch-concurrency'))).toBeNull()
      await win.getByRole('button', { name: /^新建空白项目/ }).click()
      await expect(win.locator(DOCUMENT)).toBeVisible()
      ;[project] = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
      report.projectRoot = project.rootPath
      if (values.real) await selectPlanner(win, fixture.quote)
    })
    await step('01', values.real ? '导入原创两镜剧本和五约束' : '导入手动协议测试题材（非AI规划）', async () => {
      const script = values.real ? twoShotScript(fixture.quote) : '清晨河边，阳光缓缓穿过树叶。切到水面近景，一片落叶随涟漪漂远。无字幕、无对白。'
      fs.writeFileSync(path.join(attempt, 'input.md'), script)
      await win.locator(DOCUMENT).fill(script)
      await expect.poll(async () => JSON.stringify(await payload())).toContain('一片落叶随涟漪漂远')
    })
    const nodeIds = []
    await step('02', values.real ? '真实AI拆分、审批两镜分镜' : `手动创建 ${fixture.shots} 镜协议输入（非AI规划）`, async () => {
      if (values.real) {
        await planTwoShots({ win, project, payload, quote: fixture.quote, report, directory: attempt })
      } else {
      await win.getByRole('button', { name: '生成', exact: true }).click()
      for (let i = 0; i < fixture.shots; i++) {
        await win.getByRole('button', { name: '添加视频节点', exact: true }).click()
        await expect.poll(async () => (await payload()).generationCanvas.nodes.length).toBe(i + 1)
        const node = (await payload()).generationCanvas.nodes.find(n => !nodeIds.includes(n.id)); nodeIds.push(node.id)
        const prompt = `C71-S${i + 1}：${i % 2 ? '水面近景，一片落叶随涟漪漂远，阳光倒影，镜头缓缓推进。' : '清晨河边的树木，阳光穿过树叶，广角固定镜头，微风吹动叶片。'}无字幕、无对白。`
        const editor = win.locator('.generation-canvas-v2-node__composer [contenteditable="true"]').first()
        await editor.fill(prompt); await editor.blur()
        await expect.poll(async () => (await payload()).generationCanvas.nodes.find(n => n.id === node.id)?.prompt).toBe(prompt)
        await win.keyboard.press('Escape')
      }
      expect((await payload()).generationCanvas.nodes.every(n => n.meta.modelKey === fixture.model)).toBe(true)
      await win.getByLabel('适应视图').first().click()
      }
    })
    await step('03', values.real ? '从获批分镜物化视频节点' : '打开手动协议输入整批审批', async () => {
      if (values.real) {
        await win.locator('[data-storyboard-batch="true"]').click()
        await expect.poll(async () => (await payload()).generationCanvas.nodes.length).toBe(fixture.shots)
        const nodes = (await payload()).generationCanvas.nodes.sort((a,b) => a.shotIndex - b.shotIndex)
        nodeIds.push(...nodes.map(n => n.id))
        expect(nodes.every(n => n.kind === 'video')).toBe(true)
        const ledger = await launched.app.evaluate(() => globalThis.__c71.snapshot())
        expect(ledger.requests.filter(r => r.kind === 'video')).toHaveLength(0)
      } else {
        await win.locator('.generation-canvas-v2__stage').click({ position: { x: 30, y: 30 } })
        await win.keyboard.press('ControlOrMeta+a')
        await win.locator('[data-batch-scope="selection"]').click()
      }
      spendDialog = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
      await expect(spendDialog).toBeVisible()
    })
    await step('04', '批准生成、等待供应商终态并验证资产落盘', async () => {
      started = performance.now(); report.approvedAt = new Date().toISOString()
      await spendDialog.getByRole('button', { name: '生成', exact: true }).click()
      await expect.poll(async () => {
        const confirm = win.getByRole('button', { name: '确认生成', exact: true }).first()
        if (await confirm.isVisible()) await confirm.click()
        const nodes = (await payload()).generationCanvas.nodes
        const failed = nodes.find(n => n.status === 'error' || n.status === 'failed')
        if (failed) throw Error('C71_GENERATION_FAILED')
        return nodes.filter(n => n.status === 'success').length
      }, { timeout: stationTimeout({ turns: values.real ? 2 : 0, operations: fixture.shots }), intervals: [250, 500, 1000] }).toBe(fixture.shots)
      report.generationSeconds = (performance.now() - started) / 1000
      const nodes = (await payload()).generationCanvas.nodes
      expect(nodes.every(n => n.result?.url?.startsWith('nomi-local://'))).toBe(true)
      if (values.loopback) {
        expect(fixture.calls.map(c => c.shot).sort((a,b) => a-b)).toEqual(Array.from({ length: fixture.shots }, (_,i) => i + 1))
        expect(fixture.terminals.length).toBeGreaterThanOrEqual(fixture.shots)
        expect(fixture.terminals.every(t => t.admitted === fixture.shots)).toBe(true)
        report.admission = { localLifecycleQueueBeyondProvider: 0, proof: 'All eight submissions reached provider before first terminal result; no artificial service delay', calls: fixture.calls, terminals: fixture.terminals }
        report.seventhEighthWait = 'Both admitted before first terminal; protocol proof only, not a real-provider timing claim'
      }
    })
    await step('05', '按镜头顺序入轴并播放', async () => {
      await win.getByRole('button', { name: '生成', exact: true }).click()
      const clearSelection = win.getByRole('button', { name: '清除选择', exact: true })
      if (await clearSelection.isVisible()) await clearSelection.click()
      for (const [i, id] of nodeIds.entries()) {
        const collapsePreview = win.getByRole('button', { name: '收起画面小窗', exact: true })
        if (await collapsePreview.isVisible()) await collapsePreview.click()
        await win.getByLabel('适应视图').first().click()
        const node = win.locator(`[data-node-id="${id}"]`)
        await node.click({ position: { x: 35, y: 16 } })
        await node.locator('[aria-label*="加入时间轴"]').first().click()
        await expect.poll(async () => clips(await payload()).length).toBe(i + 1)
      }
      const actual = clips(await payload())
      expect(actual.map(c => c.sourceNodeId)).toEqual(nodeIds)
      for (const [i,c] of actual.entries()) expect(c.startFrame).toBe(i ? actual[i - 1].endFrame : 0)
      await win.locator('[aria-label="工作区切换"]').getByText('预览', { exact: true }).click()
      const video = win.locator('.workbench-preview-player__video').first()
      await expect(video).toBeVisible()
      await win.locator('[aria-label="播放"]:visible').first().click()
      await expect.poll(() => video.evaluate(el => el.readyState >= 2 && el.currentTime > 0)).toBe(true)
    })
    await step('06', '导出 MP4 并完整解码', async () => {
      await win.locator('[aria-label="导出 MP4"]').first().click()
      const exported = () => completedExports(project.rootPath)
      await expect.poll(() => exported().length, { timeout: stationTimeout({ turns: 1, operations: 0 }) }).toBe(1)
      const file = path.join(project.rootPath, exported()[0])
      await expect.poll(() => { try { execFileSync(ffprobe.path, ['-v', 'error', '-show_format', file], { stdio: 'pipe' }); return true } catch { return false } }).toBe(true)
      const probe = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }))
      const timeline = await payload()
      const expectedSeconds = clips(timeline).at(-1).endFrame / timeline.timeline.fps
      expect(Number(probe.format.duration)).toBeCloseTo(expectedSeconds, 1)
      const video = probe.streams.find(stream => stream.codec_type === 'video')
      expect(video.width / video.height).toBeCloseTo(16 / 9, 2)
      execFileSync(ffmpeg.path, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { stdio: 'pipe' })
      report.export = { path: file, sha256: hash(file), bytes: fs.statSync(file).size, probe }
      const duration = Number(probe.format.duration)
      for (const [name, at] of [['first', 0], ['middle', duration / 2], ['last', Math.max(0, duration - 0.25)]])
        execFileSync(ffmpeg.path, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', path.join(attempt, `${name}.png`)], { stdio: 'pipe' })
    })
    await step('07', '冷重启恢复同一项目与成片', async () => {
      before = await payload()
      if (values.real) await launched.app.evaluate(() => globalThis.__c71.snapshot())
      await launched.close(); launched = undefined
      launched = await launch(); win = launched.win
      const after = await payload()
      expect(after.generationCanvas.nodes.map(n => ({ id: n.id, result: n.result }))).toEqual(before.generationCanvas.nodes.map(n => ({ id: n.id, result: n.result })))
      expect(clips(after)).toEqual(clips(before))
      await win.locator(`[data-project-id="${project.id}"]`).click()
      await win.locator('[aria-label="工作区切换"]').getByText('预览', { exact: true }).click()
      await expect(win.locator('.workbench-preview-player__video').first()).toBeVisible()
    })
    report.result = 'assertions-passed-review-pending'
  }
} catch (error) {
  report.result = 'failed'; report.error = values.real ? (String(error.message).match(/C71_[A-Z_]+/)?.[0] ?? 'C71_WALK_FAILED') : String(error)
  report.diagnostic = { name: error.name, message: String(error.message).replace(/Bearer\s+[^\s]+|sk-[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 3000),
    source: String(error.stack ?? '').split('\n').filter(line => line.includes('/tests/ux/g1/c71-')).slice(0, 4) }
  if (win) await win.screenshot({ path: path.join(attempt, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  if (values.real && project && !report.r30?.toolWriteRate?.correct) report.r30 = plannerMetrics(project.rootPath, false)
  if (values.real && fs.existsSync(ledgerPath)) {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    report.paidCalls = ledger.requests.length; report.reservedCny = ledger.reservedCny
    report.outbound = ledger.requests; report.polls = ledger.polls
    report.billing = 'Conservative live-price reservation; actual account bill not queried'
  }
  await launched?.close(); await fixture?.close()
  fs.rmSync(settingsDir, { recursive: true, force: true })
  if (lock !== undefined) fs.rmSync(path.join(output, 'real-budget.lock'), { force: true })
  save(); console.log(JSON.stringify({ result: report.result, paidCalls: report.paidCalls, evidence: attempt }))
}
