import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 文稿编辑器「格式标记」走查（真 Electron，零额度）。两件事，各是一个用户一眼看得见的东西：
//   A 链接不丢：工具条点「链接」→ 落盘的文稿里要有 link mark → 重开应用，文字还是链接。
//   B 一次撤销：工具条点「加粗」→ 只按一次「撤销」，加粗就该没了（不多出一条看不见的撤销记录）。
// 同一条走查还把别的行内格式逐个点一遍，落盘后逐个核对，列出「保存后丢不丢」的表。
// 红灯语义：落盘文稿缺 mark / 撤销一次后加粗还在，都是真 bug，不是走查脾气。
// 用法：pnpm run build && node tests/ux/document-format-persist-undo.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { leaveProjectIfOpen } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/document-format-persist-undo')
fs.mkdirSync(shotsDir, { recursive: true })

const projectId = 'doc-format-0001'
const projectName = '文稿格式走查'
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
// 每个要验的行内格式一行文字，互不干扰。
const INLINE = [
  { id: 'bold', mark: 'bold', text: '加粗行' },
  { id: 'italic', mark: 'italic', text: '斜体行' },
  { id: 'strike', mark: 'strike', text: '删除线行' },
  { id: 'code', mark: 'code', text: '代码行' },
  { id: 'highlight', mark: 'highlight', text: '高亮行' },
  { id: 'link', mark: 'link', text: '链接行' },
]
const contentJson = { type: 'doc', content: [paragraph('撤销行'), ...INLINE.map((item) => paragraph(item.text))] }

function seed(projectsDir) {
  const projectRoot = path.join(projectsDir, `doc-format-${projectId}`)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const project = {
    id: projectId, name: projectName, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
    lastKnownRootPath: projectRoot,
    payload: {
      workbenchDocuments: [{ id: 'doc-1', version: 1, title: '格式稿', contentJson, updatedAt: 1 }],
      activeDocumentId: 'doc-1',
      timeline: null,
      generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
      storyboardPlan: null,
      storyboardPlanCommitted: false,
    },
  }
  for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
    fs.writeFileSync(target, JSON.stringify(project, null, 2))
  }
  return projectRoot
}

const label = (key) => new RegExp(`^(${['zh-CN', 'en'].map((locale) => uiText(locale, key)).join('|')})$`)
const findings = []
function record(name, ok, detail) {
  findings.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}

/** 落盘的文稿里，包含某段文字的那个文本节点带着哪些 mark。 */
function persistedMarks(projectRoot, text) {
  // 工作区项目的真相在 .nomi/project.json（根上那份是旧版兼容壳，不随编辑更新）。
  const file = path.join(projectRoot, '.nomi', 'project.json')
  const project = JSON.parse(fs.readFileSync(file, 'utf8'))
  const docs = project.payload?.workbenchDocuments ?? []
  const marks = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text' && typeof node.text === 'string' && node.text.includes(text)) {
      for (const mark of node.marks ?? []) marks.push(mark.type)
    }
    for (const child of node.content ?? []) walk(child)
  }
  for (const doc of docs) walk(doc.contentJson)
  return marks
}

async function pollUntil(fn, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = fn()
    if (value) return value
    if (Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function openCreation(win) {
  if (await leaveProjectIfOpen(win)) await win.waitForTimeout(1400)
  const card = win.locator('[data-project-card]', { hasText: projectName }).first()
  await expectVisible(card, `项目库里找不到项目卡「${projectName}」`)
  await card.hover()
  const continueButton = card.getByText(label('library.continueCreating')).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  else await card.dblclick()
  await win.getByRole('button', { name: '创作', exact: true }).click()
  await expectVisible(win.locator('.workbench-editor'), '创作页编辑器未渲染')
}

/** 选中编辑器里整段文字（三击段落），点一下工具条按钮。 */
async function formatLine(win, text, actionKey) {
  const line = win.locator('.workbench-editor__content p', { hasText: text }).first()
  await line.click({ clickCount: 3 })
  await win.locator('.workbench-editor-toolbar').getByRole('button', { name: label(actionKey) }).click()
}

const first = makeTempDir('nomi-doc-format-')
const firstProjects = path.join(first, 'projects')
fs.mkdirSync(firstProjects, { recursive: true })
const firstRoot = seed(firstProjects)
let { app, win, close } = await launchNomiApp({ name: 'doc-format-persist-undo', tempRoot: first, settleMs: 1500 })
const copyRoot = makeTempDir('nomi-doc-format-copy-')
let exitCode = 0
try {
  await openCreation(win)

  // B：加粗后只按一次撤销。放在最前，免得别的格式把历史栈弄乱。
  const undoLine = win.locator('.workbench-editor__content p', { hasText: '撤销行' }).first()
  await formatLine(win, '撤销行', 'creationAi.selection.bold')
  const strong = undoLine.locator('strong')
  const proof = await proveProbe(strong, '加粗后该行有 <strong>')
  await win.locator('.workbench-editor-toolbar').getByRole('button', { name: label('creationAi.selection.undo') }).click()
  const goneAfterUndo = await expectAbsent(strong, { provenBy: proof, message: '撤销一次后加粗应没了' }).then(() => true, () => false)
  record('B 加粗后一次撤销', goneAfterUndo, `撤销一次后 strong=${await strong.count()}（应为 0）`)

  // A：逐个点工具条，落盘后核对。
  const toolbarKey = {
    bold: 'creationAi.selection.bold', italic: 'creationAi.selection.italic', strike: 'creationAi.selection.strike',
    code: 'creationAi.selection.code', highlight: 'creationAi.selection.highlight', link: 'creationAi.selection.link',
  }
  for (const item of INLINE) await formatLine(win, item.text, toolbarKey[item.id])
  await screenshotSettled(win, { path: path.join(shotsDir, '01-formatted.png') })
  const link = win.locator('.workbench-editor__content a').first()
  const linkVisible = await link.waitFor({ state: 'visible' }).then(() => true, () => false)
  record('A 链接·界面', linkVisible, `编辑器里 anchor ${await link.count()} 个`)

  for (const item of INLINE) {
    const marks = await pollUntil(() => {
      const found = persistedMarks(firstRoot, item.text)
      return found.includes(item.mark) ? found : null
    })
    record(`A 落盘·${item.id}`, Boolean(marks), `落盘 marks=${JSON.stringify(persistedMarks(firstRoot, item.text))}`)
  }

  // 重开：把落盘的项目目录拷到新 profile，起一个全新的应用实例，看文字还是不是链接。
  fs.cpSync(firstProjects, path.join(copyRoot, 'projects'), { recursive: true })
  await close()
  const secondRoot = path.join(copyRoot, 'projects', `doc-format-${projectId}`)
  ;({ app, win, close } = await launchNomiApp({ name: 'doc-format-reopen', tempRoot: copyRoot, settleMs: 1500 }))
  await openCreation(win)
  for (const item of INLINE) {
    const tag = { bold: 'strong', italic: 'em', strike: 's', code: 'code', highlight: 'mark', link: 'a' }[item.id]
    const markEl = win.locator('.workbench-editor__content p', { hasText: item.text }).first().locator(tag)
    await markEl.first().waitFor({ state: 'visible' }).catch(() => {})
    const count = await markEl.count()
    record(`A 重开·${item.id}`, count > 0, `重开后 <${tag}> ${count} 个`)
  }
  await screenshotSettled(win, { path: path.join(shotsDir, '02-reopened.png') })
  void secondRoot
} catch (error) {
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  console.error(error)
  exitCode = 1
} finally {
  await close().catch(() => undefined)
}
console.log(JSON.stringify(findings, null, 2))
if (findings.some((item) => !item.ok)) exitCode = 1
process.exit(exitCode)
