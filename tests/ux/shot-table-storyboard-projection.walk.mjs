// R13: one real Electron window, UI-created project and real model storyboard.
// No store writes, fixture projects, mocked provider responses, reloads, or paid media generation.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/shot-table-storyboard-projection')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-table-storyboard-'))
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.mkdirSync(settingsDir); fs.mkdirSync(projectsDir); fs.mkdirSync(shotsDir, { recursive: true })
const sourceSettings = process.env.NOMI_SETTINGS_DIR || path.join(os.homedir(), 'Library/Application Support/Nomi')
// Only encrypted model connections; never copy project locations or the user's library.
fs.copyFileSync(path.join(sourceSettings, 'model-catalog.json'), path.join(settingsDir, 'model-catalog.json'))
const story = '雨后清晨，一只白色纸船停在窗边的水盆里。微风吹动窗帘，纸船缓慢转向。阳光落到水面，一圈涟漪扩散。请拆为三个无人物镜头，每镜3秒，以图片镜头表达。'
// Keep the user's three-minute no-transition ceiling below the shared model-turn safety budget.
const modelStationBudget = Math.min(stationTimeout({ turns: 1 }), 3 * 60 * 1000)
const editedPrompt = '月光映照纸船，水面安静。'
const { app, win } = await launchNomiApp({ name: 'shot-table-storyboard-projection', settingsDir, projectsDir, userDataDir: path.join(base, 'user'), settleMs: 0 })
const snap = name => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
let step = 'library'
try {
  await expectVisible(win.getByText('新建空白项目', { exact: true }), '隔离项目库')
  await snap('replay-01-before-library')
  await clickOrFail(win.getByText('新建空白项目', { exact: true }), '新建空白项目')
  await clickOrFail(win.locator('[contenteditable="true"]').first(), '文稿编辑器')
  await win.keyboard.type(story, { delay: 15 })
  await clickOrFail(win.locator('[data-v4-control="model"]'), '选择模型')
  await clickOrFail(win.locator('[data-v4-model-row="对话"] button'), '选择对话模型')
  await clickOrFail(win.getByRole('option', { name: 'GPT-5.5', exact: true }), 'GPT-5.5')
  await clickOrFail(win.locator('[data-v4-control="model"]'), '收起模型菜单')
  await snap('replay-02-before-document')
  step = 'real-storyboard-approval'
  await clickOrFail(win.getByText('新建分镜方案', { exact: true }), '从文稿拆分镜')
  // User discipline: stop this station at three minutes without a usable UI transition.
  await expectVisible(win.getByRole('button', { name: '确认', exact: true }), '真实模型保存分镜审批', modelStationBudget)
  await snap('replay-03-plan-approval')
  await clickOrFail(win.getByRole('button', { name: '确认', exact: true }), '确认保存分镜')
  await expectVisible(win.locator('[data-storyboard-row^="storyboard-"]').first(), '已保存的分镜方案', modelStationBudget)
  step = 'immediate-table'
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
