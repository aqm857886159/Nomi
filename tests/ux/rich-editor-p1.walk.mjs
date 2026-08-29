// P1 编辑器增强走查（R13：截图 + 人眼判断，不是只跑 expect）。
// 验证四件事：
//   A 工具栏扩充：新增的删除线/行内代码/高亮/h3/分隔线/待办/表格/链接按钮真实渲染
//   B 新格式渲染：==高亮==、待办列表、表格 在正文里真实渲染
//   C 内容列宽约束：正文 max-width 680px 居中（不再铺满主区）
//   D 标题分隔线：h1/h2 有 border-bottom
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectCount, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-rich-editor-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'rich-editor-p1'
const projectRoot = path.join(projectsDir, `rich-editor-${projectId}`)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/rich-editor-p1')

fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

// 预埋一份含高亮/待办/表格的文档，直接落到创作页。
const contentJson = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '《星际信使》第二集' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '哨站传来的最后一段讯号里，夹杂着一段' },
        { type: 'text', text: '不属于人类', marks: [{ type: 'highlight' }] },
        { type: 'text', text: '的节奏。' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '本集镜头清单' }],
    },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '开场：废弃中继站全景' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '莱拉破译讯号 · 特写手部' }] }] },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '分镜资源预算' }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '镜头' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '类型' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '01' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '视频' }] }] },
          ],
        },
      ],
    },
  ],
}

const project = {
  id: projectId,
  name: '富文本编辑器 P1 走查',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    // P2 多文档：预埋两篇原稿，验证侧栏渲染 + 切换。
    workbenchDocuments: [
      { id: 'doc-1', version: 1, title: '《星际信使》第二集', contentJson, updatedAt: 1 },
      { id: 'doc-2', version: 1, title: '角色设定笔记', contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '莱拉：短发，左眼下方有一道旧疤。' }] }] }, updatedAt: 1 },
    ],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  },
}
// P3 分镜独立页：另起一个项目预埋方案，验证「分镜」第 4 tab + 分镜页渲染。
const sbProjectId = 'rich-editor-p3'
const sbProjectRoot = path.join(projectsDir, `rich-editor-${sbProjectId}`)
fs.mkdirSync(path.join(sbProjectRoot, '.nomi'), { recursive: true })
const sbPlan = {
  title: '《星际信使》第二集 — 分镜方案',
  anchors: [{ id: 'a1', kind: 'character', name: '莱拉', description: '短发女性', carrier: 'visual' }],
  shots: [
    { index: 1, durationSec: 5, anchorIds: ['a1'], prompt: '废弃中继站全景', shotKind: 'video' },
    { index: 2, durationSec: 5, anchorIds: ['a1'], prompt: '莱拉破译讯号', shotKind: 'video' },
  ],
}
const sbProject = {
  ...project,
  id: sbProjectId,
  name: '分镜独立页走查',
  lastKnownRootPath: sbProjectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: '《星际信使》第二集', contentJson, updatedAt: 1 }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    // P4:按文档索引的方案映射（key=documentId）。
    storyboardPlans: { 'doc-1': { plan: sbPlan, committed: false } },
  },
}
for (const target of [path.join(sbProjectRoot, 'project.json'), path.join(sbProjectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(sbProject, null, 2))
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

const { app, win } = await launchNomiApp({
  name: 'rich-editor-p1',
  tempRoot,
  settingsDir,
  projectsDir,
  settleMs: 1500,
})

const findings = []
function record(name, ok, detail) {
  findings.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}

async function shot(name) {
  await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
}

async function closeApp() {
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
}

// 打开项目：先回项目库（若已在某项目里），再点「继续创作」卡片 → 等到顶部「创作」导航。
async function openProject(name) {
  const backToLibrary = win.getByRole('button', { name: '项目库', exact: false }).first()
  if (await backToLibrary.isVisible().catch(() => false)) {
    await backToLibrary.click().catch(() => {})
    await win.waitForTimeout(1400)
  }
  const card = win.locator('[data-project-card]', { hasText: name }).first()
  await expectVisible(card, `项目库里找不到项目卡「${name}」`)
  await card.hover()
  const continueButton = card.getByText('继续创作', { exact: false }).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  else await card.dblclick()
  const creationButton = win.getByRole('button', { name: '创作', exact: true })
  await expectVisible(creationButton, `打开项目「${name}」后没等到顶部「创作」导航`)
}

try {
  await openProject('富文本编辑器 P1 走查')
  // 进入创作页
  const creationButton = win.getByRole('button', { name: '创作', exact: true })
  await creationButton.click()
  await expectVisible(win.locator('.workbench-editor'), '创作页编辑器未渲染')

  // A：工具栏新按钮（标题/列表/插入 三簇都验证）
  const toolbar = win.locator('.workbench-editor-toolbar')
  await expectVisible(toolbar, '工具栏未渲染')
  // 通过 title 属性定位新增按钮（WorkbenchIconButton 会带 label → title）
  for (const label of ['高亮', '删除线', '插入表格', '待办列表']) {
    const btn = toolbar.locator(`[title="${label}"]`)
    const count = await btn.count()
    record(`工具栏·${label}`, count > 0, `找到 ${count} 个`)
  }

  // B：新格式真实渲染
  const mark = win.locator('.workbench-editor__content mark')
  record('高亮渲染', (await mark.count()) > 0, `mark 元素 ${await mark.count()} 个`)

  const taskList = win.locator('.workbench-editor__content ul[data-type="taskList"]')
  record('待办列表渲染', (await taskList.count()) > 0, `taskList ${await taskList.count()} 个`)

  const table = win.locator('.workbench-editor__content table')
  record('表格渲染', (await table.count()) > 0, `table ${await table.count()} 个`)

  // D：标题分隔线（h1/h2 有 border-bottom）
  const h1Border = await win.locator('.workbench-editor__content h1').first().evaluate((el) => getComputedStyle(el).borderBottomWidth)
  record('h1 分隔线', h1Border !== '0px', `border-bottom=${h1Border}`)

  // C：内容列宽约束（.workbench-editor__content max-width 680px）
  const maxWidth = await win.locator('.workbench-editor__content').first().evaluate((el) => getComputedStyle(el).maxWidth)
  record('内容列宽 680px', maxWidth === '680px', `max-width=${maxWidth}`)

  await shot('01-creation-editor')

  // P2 多文档：左侧原稿列表
  const docList = win.locator('[aria-label="原稿列表"], [aria-label="Drafts"]').first()
  record('原稿列表渲染', (await docList.count()) > 0, `count=${await docList.count()}`)
  const docItems = win.locator('[data-document-id]')
  record('原稿列表 2 篇', (await docItems.count()) === 2, `count=${await docItems.count()}`)

  // 切换文档：点第二篇，编辑器内容应切换
  const secondDoc = docItems.nth(1)
  await secondDoc.click().catch(() => {})
  await new Promise((r) => setTimeout(r, 400))
  await shot('02-switch-document')

  // P3 分镜独立页：顶栏应有第 4 个「分镜」tab
  const storyboardTab = win.getByRole('button', { name: '分镜', exact: true })
  record('分镜 tab 存在', (await storyboardTab.count()) > 0, `count=${await storyboardTab.count()}`)
  // 无方案项目点分镜 tab → 空态
  await storyboardTab.click().catch(() => {})
  await new Promise((r) => setTimeout(r, 400))
  const emptyState = win.getByText('还没有分镜方案').first()
  record('分镜空态', (await emptyState.count()) > 0, `count=${await emptyState.count()}`)
  await shot('03-storyboard-empty')

  // 有方案的项目 → 分镜页渲染方案编辑器（不是空态）
  await openProject('分镜独立页走查')
  const sbTab2 = win.getByRole('button', { name: '分镜', exact: true })
  await sbTab2.click().catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
  const editor = win.locator('.workbench-storyboard [class*="Storyboard"]').first()
  const shotCount = await win.getByText('分镜 · 2 镜').count()
  record('分镜方案渲染', shotCount > 0 || (await win.getByText(/分镜方案/).count()) > 0, `分镜·2镜=${shotCount}`)
  await shot('04-storyboard-with-plan')

  // 关闭后报告
  console.log(JSON.stringify(findings, null, 2))
  const failed = findings.filter((f) => !f.ok)
  await closeApp()
  if (failed.length) {
    console.log(`\n${failed.length} 项未通过。截图在 ${shotsDir}`)
    process.exit(1)
  }
  console.log(`\n全部 ${findings.length} 项通过。截图在 ${shotsDir}`)
} catch (error) {
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  console.log(JSON.stringify(findings, null, 2))
  console.error(error)
  await closeApp()
  process.exit(1)
}
