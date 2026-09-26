// R13: one real Electron window, UI-created project and real model storyboard.
// No store writes, fixture projects, mocked provider responses, reloads, or paid media generation.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { seedRealCredentials } from './_realProfile.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { AGENT_PANEL, COMPOSER_MODEL, CREATION_PANEL, MODEL_POPOVER, TOOL_RECEIPT, chooseAssistantModel, sendCreation, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/shot-table-storyboard-projection')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-table-storyboard-'))
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
const userDataDir = path.join(base, 'user')
fs.mkdirSync(settingsDir); fs.mkdirSync(projectsDir); fs.mkdirSync(shotsDir, { recursive: true })
// Only encrypted model connections (plus the Windows Local State key that decrypts them);
// never copy project locations or the user's library.
seedRealCredentials({ settingsDir, userDataDir })
const story = '雨后清晨，一只白色纸船停在窗边的水盆里。微风吹动窗帘，纸船缓慢转向。阳光落到水面，一圈涟漪扩散。请拆为三个无人物镜头，每镜3秒，以图片镜头表达。'
// Keep the user's three-minute no-transition ceiling below the shared model-turn safety budget.
const modelStationBudget = Math.min(stationTimeout({ turns: 1 }), 3 * 60 * 1000)
const editedPrompt = '月光映照纸船，水面安静。'
const { app, win } = await launchNomiApp({ name: 'shot-table-storyboard-projection', settingsDir, projectsDir, userDataDir, settleMs: 0 })
const snap = name => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
let step = 'library'
try {
  await expectVisible(win.getByText('新建空白项目', { exact: true }), '隔离项目库')
  await snap('replay-01-before-library')
  await clickOrFail(win.getByText('新建空白项目', { exact: true }), '新建空白项目')
  await clickOrFail(win.locator('[contenteditable="true"]').first(), '文稿编辑器')
  await win.keyboard.type(story, { delay: 15 })
  // 模型弹层是「每类一行 + 行尾 NomiSelect」，走全仓共用的那把选法（别再手写 option 角色）。
  await chooseAssistantModel(win, 'GPT-5.5')
  const modelPopover = win.locator(`${CREATION_PANEL} ${MODEL_POPOVER}`)
  if (await modelPopover.isVisible().catch(() => false)) await clickOrFail(win.locator(`${CREATION_PANEL} ${COMPOSER_MODEL}`), '收起模型菜单')
  await snap('replay-02-before-document')
  step = 'real-storyboard'
  // Explicit Agent authoring is separate from the sidebar's local blank creation.
  await sendCreation(win, '请读取当前文稿并新建一份三个镜头的分镜方案，不生成媒体。')
  // 面板不钉 surface：方案一落地工作区就切到分镜页，常驻面板的 data-agent-surface 随之变成 storyboard，
  // 钉 creation 的定位器会在回合还在跑时就「找不到 running」而假绿。起飞/落地都按 AGENT_PANEL 的 composer 运行态判。
  // User discipline: stop this station at three minutes without a usable UI transition.
  await waitForV4TurnIdle(win, { panel: AGENT_PANEL, doneTimeout: modelStationBudget })
  // 工具回执是折叠的 <details>（默认收起 → toBeVisible 会说 hidden），落地证据看它在不在，不看展开没展开。
  await expect(win.locator(`${AGENT_PANEL} ${TOOL_RECEIPT}`), '回合结束却没有任何工具回执（方案不是经保存分镜方案工具落的）').not.toHaveCount(0)
  await expectVisible(win.locator('[data-storyboard-row][data-storyboard-status]').first(), '回合结束后侧栏没有长出方案行')
  await snap('replay-03-plan-saved')
  step = 'immediate-table'
  // ⚠️ 2026-09-18：这一步红是**产品真回归**，不是走查过期——方案已落盘（侧栏有行、project.json 里 designs 有内容），
  // 但 `payload.generationCanvas.nodes` 是空的：Agent 写方案没有建出 shot_table 节点。
  // `ensureStoryboardShotTable.ts` 写着「Explicit design writes create one view」，`docs/audit/2026-09-10-shot-table-storyboard-walk.md`
  // 记过「复验立即生成表节点成功」，所以是 09-10 之后退的。断言**刻意保持原样**（改绿=掩盖真 bug）。
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }).first(), '生成画布')
  await clickOrFail(win.getByRole('button', { name: '适应视图', exact: true }), '适应全部节点')
  const table = win.locator('[data-testid="shot-table-node"]')
  await proveProbe(table, '拆镜之后立即出现表节点')
  await expect(table.locator('[data-shot-table-row]')).toHaveCount(3)
  await snap('replay-04-table-created')
  step = 'full-page-and-materialize'
  await table.locator('[data-shot-table-row]').first().dblclick()
  const first = win.locator('[data-storyboard-rows] [data-storyboard-row="1"]')
  await proveProbe(first, '双击表行进入全页')
  await clickOrFail(first.getByRole('button', { name: '生成镜 1', exact: true }).last(), '生成第一镜以建立镜头节点')
  await expectVisible(win.getByRole('button', { name: '取消', exact: true }), '生成前额度确认')
  await snap('replay-05-before-spend')
  await clickOrFail(win.getByRole('button', { name: '取消', exact: true }), '取消付费生成')
  step = 'edit-and-sync'
  await clickOrFail(first.locator('[contenteditable="true"]'), '第一镜画面描述')
  await win.keyboard.press('Meta+A')
  await win.keyboard.type(editedPrompt, { delay: 30 })
  await win.keyboard.press('Tab')
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }).first(), '回画布查看同步')
  await clickOrFail(win.getByRole('button', { name: '适应视图', exact: true }), '适应全部节点')
  const imageNode = win.locator('[data-kind="image"]').first()
  await proveProbe(imageNode, '生成动作建立的镜头节点')
  await expect(imageNode).toContainText(editedPrompt)
  // Reset is the product's explicit 100% view action; wheel deltas are platform-dependent.
  await clickOrFail(win.getByRole('button', { name: '重置视图', exact: true }), '重置为100%')
  await expect(win.getByRole('slider', { name: '缩放比例', exact: true })).toHaveValue('100')
  await expect(table).toHaveAttribute('data-density', 'full')
  await expect(table.locator('[data-shot-table-row]').first()).toContainText(editedPrompt)
  await snap('replay-06-table-and-shot-synced')
  step = 'row-navigation'
  await table.locator('[data-shot-table-row]').nth(2).dblclick()
  const third = win.locator('[data-storyboard-rows] [data-storyboard-row="3"]')
  await expect(third).toHaveAttribute('data-selected', 'true')
  await expect(third).toBeFocused()
  await expect(third).toBeInViewport()
  await snap('replay-07-third-row-focused')
  console.log(JSON.stringify({ status: 'passed', profile: base, screenshots: shotsDir, realStoryboardRequests: 1, paidMediaSubmissions: 0 }))
} catch (error) {
  await snap(`replay-blocked-${step}`)
  console.error(JSON.stringify({ status: 'blocked', step, profile: base, message: String(error) }))
  process.exitCode = 1
} finally {
  await app.close()
}
