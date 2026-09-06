/**
 * Agent UI A 段零额度真实 Electron 走查：composer 五按钮、权限弹层、`/` 命令菜单、运行反馈和
 * storyboard 入口。这条走查只使用本地 loopback fixture，不调用供应商。
 *
 * 2026-09-06 面板换成 v4 积木：底栏定稿为 `[+] [模型名 ▾] ｜ [Skill] …… [权限 ▾] [↑/■]`。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'
import {
  AGENT_PANEL, COLLAPSED_DOCK, COLLAPSED_SHELL, COMPOSER, COMPOSER_ADD_FILE, COMPOSER_INPUT,
  COMPOSER_MODEL, COMPOSER_PERMISSION, COMPOSER_SEND, COMPOSER_SKILL, PERMISSION_POPOVER,
  SKILL_POPOVER,
} from './agent-runtime-walk-support.mjs'

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
  const panel = page.locator(AGENT_PANEL).first()
  await panel.waitFor({ state: 'visible', timeout: 10000 })
  const collapsed = page.locator(COLLAPSED_SHELL).first()
  if (await collapsed.isVisible().catch(() => false)) {
    await collapsed.locator(`${COLLAPSED_DOCK} button`).first().click()
    await page.waitForTimeout(400)
  }
  const composer = panel.locator(COMPOSER)
  const composerProof = await proveProbe(composer, 'composer 面板已渲染')
  const order = await composer.locator([
    `button${COMPOSER_ADD_FILE}`, `button${COMPOSER_MODEL}`, `button${COMPOSER_SKILL}`,
    `button${COMPOSER_PERMISSION}`, `button${COMPOSER_SEND}`,
  ].join(', ')).evaluateAll((buttons) => buttons.map((button) => button.dataset.v4Control))
  check(JSON.stringify(order) === JSON.stringify(['add-file', 'model', 'skill', 'permission', 'send']), `composer 顺序 ${order.join(' → ')}`)
  const spacing = await composer.locator(COMPOSER_SKILL).evaluate((skill, [permissionSel, sendSel]) => {
    const permission = document.querySelector(permissionSel)
    const send = document.querySelector(sendSel)
    if (!permission || !send) return null
    const skillRect = skill.getBoundingClientRect()
    const permissionRect = permission.getBoundingClientRect()
    const sendRect = send.getBoundingClientRect()
    return { gap: permissionRect.left - skillRect.right, permissionToSend: sendRect.left - permissionRect.right }
  }, [COMPOSER_PERMISSION, COMPOSER_SEND])
  check(Boolean(spacing && spacing.gap > spacing.permissionToSend), `composer 留白在左组三钮与右组之间（gap=${spacing?.gap ?? 'n/a'}，permission→send=${spacing?.permissionToSend ?? 'n/a'}）`)
  await page.screenshot({ path: path.join(outputDir, '01-composer-order.png') })

  // 2026-09-06 拍板①：工作方式三档（Ask / 编辑选中 / Agent）已删，权限是唯一的授权控件。
  // 原来这里断言的「模式弹层只有一个 radiogroup、且不含审批/花费入口」随那个控件一起没了；
  // 换成对现役唯一授权控件的同类断言：三档在同一个弹层里，且当前档恰有一个。
  await composer.locator(COMPOSER_PERMISSION).click()
  const permissionMenu = page.locator(PERMISSION_POPOVER).last()
  await permissionMenu.waitFor({ state: 'visible', timeout: 3000 })
  check(await permissionMenu.locator('[data-tier]').count() === 3, '权限弹层给出三档（每步问 / 自动改 / 全自动）')
  check(await permissionMenu.locator('[data-tier][data-active="true"]').count() === 1, '三档里当前档恰有一个')
  await page.screenshot({ path: path.join(outputDir, '02-permission-popover.png') })
  await page.keyboard.press('Escape')

  // 2026-09-06 拍板③：提示词库并进同一个 `/` 命令菜单，底栏不再有第二颗「提示词」钮
  //（上面的顺序断言已经钉死底栏恰是这五颗）。这里验它在菜单里有自己的一段。
  await composer.locator(COMPOSER_SKILL).click()
  const skillMenu = page.locator(SKILL_POPOVER).last()
  await skillMenu.waitFor({ state: 'visible', timeout: 3000 })
  check(await skillMenu.getByRole('button', { name: '提示词', exact: true }).count() === 1, '`/` 命令菜单承载提示词那一段')
  // 「底栏没有第二颗提示词钮」不另写缺席断言：上面的顺序断言已经钉死底栏**恰是**这五颗，
  // 多一颗就红。对着一个源码里根本不存在的挂点写 expectAbsent 只会得到一条恒真的死断言。
  await page.screenshot({ path: path.join(outputDir, '03-skill-menu.png') })
  await page.keyboard.press('Escape')

  const hold = fixture.expectText({ label: 'composer-running', reply: { type: 'hold' } })
  const input = composer.locator(COMPOSER_INPUT)
  await input.fill('请保持运行状态用于反馈走查')
  await composer.locator(COMPOSER_SEND).click()
  await hold.received
  // v4 的「正在跑」写在 composer 自己身上（data-mode），发送钮就地变成停止（aria-label「停止」）。
  const running = panel.locator(`${COMPOSER}[data-mode="running"]`)
  await running.waitFor({ state: 'visible', timeout: 5000 })
  check(await running.locator(`${COMPOSER_SEND}[aria-label="停止"]`).count() === 1, '运行中停止按钮同时可见')
  await page.screenshot({ path: path.join(outputDir, '04-running-feedback.png') })
  hold.release({ type: 'text', text: '已完成' })
  await running.waitFor({ state: 'detached', timeout: 10000 })
  check(true, '本轮结束后运行态标记消失')
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
