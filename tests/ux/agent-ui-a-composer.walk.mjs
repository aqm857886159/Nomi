/**
 * Agent UI A 段零额度真实 Electron 走查：composer 五按钮、模式弹层、Skill、运行反馈和 storyboard 入口。
 * 这条走查只使用本地 loopback fixture，不调用供应商。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'

const root = path.resolve(new URL('../..', import.meta.url).pathname)
const outputDir = path.join(root, '.tmp', 'agent-ui-a')
fs.mkdirSync(outputDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-ui-a-'))
const settingsDir = path.join(tempRoot, 'settings')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })
let fixture
let app
const evidence = []
const check = (condition, message) => { if (!condition) throw new Error(message); evidence.push(message) }

try {
  fixture = await createAgentRuntimeFixture({ rootDir: root, settingsDir })
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  for (const model of catalog.models || []) if (model.kind === 'text') model.published = true
  for (const vendor of catalog.vendors || []) vendor.authType = 'none'
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
  app = await launchNomiApp({ name: 'agent-ui-a-composer', settingsDir, userDataDir, projectsDir, args: ['--disable-gpu'], settleMs: 1800 })
  const page = app.win
  await page.evaluate(() => { localStorage.setItem('nomi-color-scheme', 'light'); for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen') })
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1800)
  const blank = page.locator('button, [role=\"button\"]', { hasText: '新建空白项目' }).first()
  await blank.waitFor({ state: 'visible', timeout: 15000 }); await blank.click(); await page.waitForTimeout(2400)
  const panel = page.locator('[data-agent-resident="true"][data-agent-panel="true"]').first()
  await panel.waitFor({ state: 'visible', timeout: 10000 })
  const collapsed = page.locator('[data-agent-resident-collapsed="true"]').first()
  if (await collapsed.isVisible().catch(() => false)) { await collapsed.click(); await page.waitForTimeout(400) }
  const composer = panel.locator('[data-agent-composer]')
  const composerProof = await proveProbe(composer, 'composer 面板已渲染')
  const order = await composer.locator('button[data-agent-composer-attach], button[data-agent-composer-model], button[data-agent-composer-skill], button[data-agent-composer-mode], button[data-agent-composer-send]').evaluateAll((buttons) => buttons.map((button) => button.dataset.agentComposerAttach !== undefined ? 'attach' : button.dataset.agentComposerModel !== undefined ? 'model' : button.dataset.agentComposerSkill !== undefined ? 'skill' : button.dataset.agentComposerMode !== undefined ? 'mode' : 'send'))
  check(JSON.stringify(order) === JSON.stringify(['attach', 'model', 'skill', 'mode', 'send']), `composer 顺序 ${order.join(' → ')}`)
  const spacing = await composer.locator('[data-agent-composer-skill]').evaluate((skill) => {
    const mode = document.querySelector('[data-agent-composer-mode]')
    const send = document.querySelector('[data-agent-composer-send]')
    if (!mode || !send) return null
    const skillRect = skill.getBoundingClientRect()
    const modeRect = mode.getBoundingClientRect()
    const sendRect = send.getBoundingClientRect()
    return { gap: modeRect.left - skillRect.right, modeToSend: sendRect.left - modeRect.right }
  })
  check(Boolean(spacing && spacing.gap > spacing.modeToSend), `composer 留白在左组三钮与右组之间（gap=${spacing?.gap ?? 'n/a'}，mode→send=${spacing?.modeToSend ?? 'n/a'}）`)
  await expectAbsent(composer.locator('[data-agent-composer-prompt]'), { provenBy: composerProof, message: '提示词库没有第二个常驻按钮' })
  await page.screenshot({ path: path.join(outputDir, '01-composer-order.png') })

  await composer.locator('[data-agent-composer-mode]').click()
  const modeMenu = page.locator('[data-agent-menu="Mode"], [data-agent-menu="模式"]').last()
  await modeMenu.waitFor({ state: 'visible', timeout: 3000 })
  check(await modeMenu.locator('[role="radiogroup"]').count() === 1, '模式弹层只保留一个工作模式分段控件')
  const modeProof = await proveProbe(modeMenu.locator('[role="radiogroup"]'), '模式弹层工作模式分段控件已渲染')
  await expectAbsent(modeMenu.locator('[data-agent-menu-item^="approval-mode-"]'), { provenBy: modeProof, message: '模式弹层已删除审批档位入口' })
  await expectAbsent(modeMenu.locator('[data-agent-menu-item^="spend-policy-"]'), { provenBy: modeProof, message: '模式弹层已删除花费策略入口' })
  await page.screenshot({ path: path.join(outputDir, '02-mode-popover.png') })
  await page.keyboard.press('Escape')

  await composer.locator('[data-agent-composer-skill]').click()
  const skillMenu = page.locator('[data-agent-menu="技能"], [data-agent-menu="Skill"]').last()
  await skillMenu.waitFor({ state: 'visible', timeout: 3000 })
  check(await skillMenu.locator('[data-agent-menu-item="prompt-library"]').count() === 1, 'Skill 菜单承载提示词库入口')
  await page.screenshot({ path: path.join(outputDir, '03-skill-menu.png') })
  await page.keyboard.press('Escape')

  const hold = fixture.expectText({ label: 'composer-running', reply: { type: 'hold' } })
  const input = composer.locator('[data-agent-input]')
  await input.fill('请保持运行状态用于反馈走查')
  await composer.locator('[data-agent-composer-send]').click()
  await hold.received
  await composer.locator('[data-agent-running-feedback="true"]').waitFor({ state: 'visible', timeout: 5000 })
  check(await composer.locator('[data-agent-stop="true"]').count() === 1, '运行中停止按钮同时可见')
  await page.screenshot({ path: path.join(outputDir, '04-running-feedback.png') })
  hold.release({ type: 'text', text: '已完成' })
  await composer.locator('[data-agent-running-feedback="true"]').waitFor({ state: 'detached', timeout: 10000 })
  check(true, '本轮结束后呼吸光消失')
  await page.screenshot({ path: path.join(outputDir, '05-composer-settled.png') })

  await expectAbsent(page.locator('[data-storyboard-card]'), { provenBy: composerProof, message: '编辑器下方没有 StoryboardPlanCard' })
  const storyboardEntry = page.locator('[data-storyboard-id]').first()
  await storyboardEntry.waitFor({ state: 'visible', timeout: 5000 })
  await storyboardEntry.click()
  await page.locator('.workbench-storyboard').waitFor({ state: 'visible', timeout: 10000 })
  check(true, '左侧分镜条目直接打开分镜页')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(outputDir, '06-storyboard-row-open.png') })
  console.log(JSON.stringify({ result: 'passed', outputDir, evidence }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ result: 'failed', outputDir, evidence, error: String(error?.stack || error) }, null, 2))
  process.exitCode = 1
} finally {
  await fixture?.close().catch(() => {})
  await closeNomiApp(app?.app)
}
