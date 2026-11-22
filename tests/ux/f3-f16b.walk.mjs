import { makeTempDir } from '../../scripts/_test-temp.mjs'
// F3 真 UI 走查：选区拆镜入口；F16b 按次托管确认状态已撤。
// 只用本地文稿与回环模型，不调用真实供应商；隔离目录由启动器统一注入。
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { createAgentRuntimeFixture, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { chooseAssistantModel } from './agent-runtime-walk-support.mjs'
import { clickOrFail, expect, expectVisible, proveProbe } from './_assert.mjs'
import { AGENT_PANEL } from './_shell.mjs'
import fs from 'node:fs'
import path from 'node:path'

const root = makeTempDir('nomi-f3-f16b-')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectRoot = path.join(projectsDir, 'f3-f16b-project')
const shotsDir = path.resolve(process.env.NOMI_F3_SHOTS || 'tests/ux/shots/f3-f16b')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const story = '林薇在雨夜的老码头被人追赶，她穿过积水的巷子，霓虹灯牌在水面上碎成一片。'
const project = {
  id: 'f3-f16b-project', name: 'F3 F16b 走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: 'F3 F16b', updatedAt: 1, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: story }] }] } },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project))

const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
fixture.respond({ label: 'selection-route', match: () => true, reply: { type: 'text', text: 'F3_SELECTION_ROUTED' } })
const { app, win } = await launchNomiApp({ name: 'f3-f16b', userDataDir: path.join(root, 'user-data'), settingsDir, projectsDir, settleMs: 900 })

try {
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  const projectCard = win.locator('[data-project-card]', { hasText: 'F3 F16b 走查' }).first()
  await expectVisible(projectCard, 'F3/F16b 走查项目存在')
  await projectCard.dblclick()
  const creationNav = win.getByRole('button', { name: '创作', exact: true })
  await expectVisible(creationNav, '创作入口可见')
  await creationNav.click()

  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  const editor = win.locator('.ProseMirror').first()
  await expectVisible(editor, '创作编辑器可见')
  await editor.evaluate((el) => {
    const textNode = el.firstChild?.firstChild
    if (!textNode) throw new Error('文稿文本节点不存在')
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, Math.min(12, textNode.textContent?.length || 0))
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  })
  const popover = win.locator('[role="toolbar"][aria-label="选中文本工具"]')
  await expectVisible(popover, '选中文字后浮条出现')
  const persistentSelection = editor.locator('.nomi-persistent-selection')
  await expectVisible(persistentSelection, '编辑器选区 decoration 初始可见')
  await expect(persistentSelection, '选区 decoration 包含待替换文本').toContainText('林薇在雨夜的老码头')
  // 认创作面 Agent 面板的输入框（数据属性）：「创作 AI 输入」这个标签 09-03 随死词条清理删掉了，这里一直按它找。
  const assistantInput = win.locator(`${AGENT_PANEL}[data-agent-surface="creation"] [data-v4-control="input"]`)
  await expectVisible(assistantInput, '创作助手输入框可见')
  await assistantInput.focus()
  await assistantInput.fill('已选中，准备替换')
  await expect.poll(() => editor.locator('.nomi-persistent-selection').count(), {
    message: '助手获得焦点后仍保留持久选区 decoration',
  }).toBeGreaterThan(0)
  await expect(editor.locator('.nomi-persistent-selection'), '助手获得焦点后高亮仍覆盖待替换文本').toContainText('林薇在雨夜的老码头')
  const nativeSelection = await win.evaluate(() => window.getSelection()?.toString() ?? '')
  if (nativeSelection !== '') throw new Error('走查前提失效：助手获得焦点后原生 selection 应为空')
  const splitButton = popover.getByRole('button', { name: '拆成镜头', exact: true })
  await proveProbe(splitButton, '选中浮条上的「拆成镜头」探针可测到')
  await expectVisible(splitButton, '选中浮条上「拆成镜头」可见')
  await clickOrFail(splitButton, '选中浮条「拆成镜头」')
  await expectVisible(win.getByText('分镜规划', { exact: true }).first(), '点击选区入口后带分镜规划技能')
  await expect.poll(() => fixture.requests.some(request => flattenRequestText(request.body).includes('林薇在雨夜的老码头')), { message: '选中文字进入回环模型请求' }).toBe(true)
  fs.writeFileSync(path.join(shotsDir, 'route.json'), JSON.stringify({ requests: fixture.requests, images: fixture.images.length }, null, 2))
  await win.screenshot({ path: path.join(shotsDir, '01-f3-selection-light.png') })

  // The hosting-disclosure states were withdrawn by the user's 2026-11-17 decision.
  console.log('✅ F3 走查通过；按次托管确认状态已撤')
} finally {
  await app.close().catch(() => {})
  await fixture.close()
  fs.rmSync(root, { recursive: true, force: true })
}
