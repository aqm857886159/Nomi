// Unified creation workspace walkthrough: drafts and multiple storyboard designs
// share one resource tree, remain isolated, and survive a project reload.
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-creation-surfaces-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'creation-surfaces-e2e'
const projectRoot = path.join(projectsDir, `creation-surfaces-${projectId}`)
const outDir = path.join(repoRoot, 'tests/ux/shots/creation-work-surfaces')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const document = (id, title, text, updatedAt) => ({
  id,
  version: 1,
  title,
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  updatedAt,
})
const plan = (title, prompt) => ({
  title,
  anchors: [],
  shots: [{ index: 1, shotKind: 'video', durationSec: 5, anchorIds: [], prompt }],
})
const design = (id, documentId, title, prompt, sourceDocumentUpdatedAt, committed = false) => ({
  id,
  documentId,
  title,
  plan: plan(title, prompt),
  committed,
  status: committed ? 'committed' : 'draft',
  sourceDocumentUpdatedAt,
  createdAt: sourceDocumentUpdatedAt + 1,
  updatedAt: sourceDocumentUpdatedAt + 2,
})

const documents = [
  document('doc-a', '原稿 A · 雨夜追凶', 'ORIGINAL_A_SENTINEL：雨夜中的追逐。', 10),
  document('doc-b', '原稿 B · 天台告白', 'ORIGINAL_B_SENTINEL：天台上的告白。', 20),
  document('doc-c', '原稿 C · 产品短片', 'ORIGINAL_C_SENTINEL：产品缓缓转动。', 30),
]
const storyboardDesignsByDocumentId = {
  'doc-a': [
    design('sb-a1', 'doc-a', '雨夜追凶 · 动作版', 'PLAN_A1_SENTINEL：手持追拍。', 10),
    design('sb-a2', 'doc-a', '雨夜追凶 · 悬疑版', 'PLAN_A2_SENTINEL：慢推悬疑。', 10),
    design('sb-a3', 'doc-a', '雨夜追凶 · 竖屏版', 'PLAN_A3_SENTINEL：竖屏近景。', 10, true),
  ],
  'doc-b': [design('sb-b1', 'doc-b', '天台告白 · 黄昏版', 'PLAN_B1_SENTINEL：黄昏环绕。', 20)],
}
const payload = {
  workbenchDocuments: documents,
  activeDocumentId: 'doc-a',
  timeline: null,
  generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
  storyboardPlans: {
    'doc-a': { plan: storyboardDesignsByDocumentId['doc-a'][0].plan, committed: false },
    'doc-b': { plan: storyboardDesignsByDocumentId['doc-b'][0].plan, committed: false },
  },
  storyboardDesignsByDocumentId,
}
const project = {
  id: projectId,
  name: '统一创作工作区回归',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload,
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

const { app, win } = await launchNomiApp({
  name: 'creation-work-surfaces',
  tempRoot,
  settingsDir,
  projectsDir,
  settleMs: 1200,
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function dismissOnboarding() {
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 1000 }).catch(() => {})
  }
}

async function openFixtureCreationSurface() {
  await dismissOnboarding()
  const tree = win.locator('[data-creation-resource-tree="true"]')
  await tree.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await tree.isVisible().catch(() => false)) return

  const creationButton = win.getByRole('button', { name: '创作', exact: true })
  if (await creationButton.isVisible().catch(() => false)) {
    await creationButton.click()
    await tree.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
    if (await tree.isVisible().catch(() => false)) return
  }

  const projectCard = win.locator('[data-project-card]', { hasText: '统一创作工作区回归' }).first()
  await projectCard.waitFor({ state: 'visible', timeout: 7000 })
  await projectCard.hover()
  const continueButton = projectCard.getByText('继续创作', { exact: false }).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  else await projectCard.dblclick()
  await creationButton.waitFor({ state: 'visible', timeout: 7000 })
  await creationButton.click()
  await tree.waitFor({ state: 'visible', timeout: 7000 })
}

function readSavedPayload() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8')).payload
}

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1200)
  await openFixtureCreationSurface()

  assert(await win.locator('[data-document-row]').count() === 3, '资源树没有显示 3 篇原稿')
  assert(await win.locator('[data-storyboard-row]').count() === 4, '资源树没有显示各原稿的分镜设计')
  const initialStoryboardIds = await win.locator('[data-storyboard-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-storyboard-row')))
  const topModes = win.locator('nav.nomi-stepper [data-mode]')
  assert(JSON.stringify(await topModes.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-mode')))) === JSON.stringify(['creation', 'generation', 'preview']), '顶栏没有收敛为创作、生成、预览')
  assert(await win.getByText('ORIGINAL_A_SENTINEL', { exact: false }).isVisible(), '默认没有打开原稿 A')

  const thirdDocumentRow = win.locator('[data-document-row="doc-c"]')
  await thirdDocumentRow.locator('[data-resource-menu-trigger="document"]').click()
  await win.locator('[data-resource-action="rename"]').click()
  const documentRenameInput = thirdDocumentRow.locator('input')
  await documentRenameInput.fill('原稿 C · 产品短片修订')
  await documentRenameInput.press('Enter')
  await expectVisible(thirdDocumentRow.getByText('原稿 C · 产品短片修订', { exact: true }), '第三篇原稿无法通过资源菜单重命名')

  await win.locator('[data-storyboard-id="sb-a1"]').click()
  await expect(win.getByLabel('镜 1 提示词'), '没有打开原稿 A 的第一份分镜').toHaveValue('PLAN_A1_SENTINEL：手持追拍。')
  assert(!(await win.getByText('ORIGINAL_A_SENTINEL', { exact: false }).isVisible().catch(() => false)), '分镜编辑器与原稿编辑器发生重叠')

  await win.locator('[data-storyboard-id="sb-a2"]').click()
  await expect(win.getByLabel('镜 1 提示词'), '同一原稿的第二份分镜无法独立切换').toHaveValue('PLAN_A2_SENTINEL：慢推悬疑。')
  const secondRow = win.locator('[data-storyboard-row="sb-a2"]')
  await secondRow.locator('[data-resource-menu-trigger="storyboard"]').click()
  await win.locator('[data-resource-action="rename"]').click()
  const renameInput = secondRow.locator('input')
  await renameInput.fill('雨夜追凶 · 悬疑修订版')
  await renameInput.press('Enter')
  assert(await secondRow.getByText('雨夜追凶 · 悬疑修订版', { exact: true }).isVisible(), '分镜重命名没有生效')

  const firstRow = win.locator('[data-storyboard-row="sb-a1"]')
  await firstRow.locator('[data-resource-menu-trigger="storyboard"]').click()
  await win.locator('[data-resource-action="duplicate"]').click()
  await expect(win.locator('[data-storyboard-row]'), '复制分镜后资源树数量没有增加').toHaveCount(5)
  const storyboardIdsAfterDuplicate = await win.locator('[data-storyboard-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-storyboard-row')))
  const duplicatedStoryboardId = storyboardIdsAfterDuplicate.find((id) => id && !initialStoryboardIds.includes(id))
  assert(duplicatedStoryboardId, '无法追踪复制出的分镜设计 ID')
  const duplicatedRow = win.locator(`[data-storyboard-row="${duplicatedStoryboardId}"]`)
  await expect(duplicatedRow.locator('[data-storyboard-id]'), '副本没有归属原稿 A').toHaveAttribute('data-document-id', 'doc-a')
  await expect(duplicatedRow.locator('[data-storyboard-title="true"]'), '副本标题没有按同稿版本递增').toHaveText('雨夜追凶 · 动作版 4')
  await duplicatedRow.locator('[data-storyboard-id]').click()
  await expect(win.getByLabel('镜 1 提示词'), '分镜副本没有保留原方案内容').toHaveValue('PLAN_A1_SENTINEL：手持追拍。')

  const obsoleteRow = win.locator('[data-storyboard-row="sb-a3"]')
  const obsoleteProof = await proveProbe(obsoleteRow, '删除前竖屏版分镜确实存在')
  await obsoleteRow.locator('[data-resource-menu-trigger="storyboard"]').click()
  await win.locator('[data-resource-action="delete"]').click()
  const deleteDialog = win.getByRole('dialog')
  await expectVisible(deleteDialog, '删除分镜确认框没有出现')
  await deleteDialog.getByRole('button', { name: '删除', exact: true }).click()
  await expectAbsent(obsoleteRow, { provenBy: obsoleteProof, message: '删除后竖屏版分镜不应重新出现' })

  const documentBStoryboardRow = win.locator('[data-storyboard-row="sb-b1"]')
  await expect(documentBStoryboardRow, '未编辑的原稿 B 分镜初始状态错误').toHaveAttribute('data-storyboard-status', 'draft')
  await win.locator('[data-document-id="doc-b"]:not([data-storyboard-id])').click()
  assert(await win.getByText('ORIGINAL_B_SENTINEL', { exact: false }).isVisible(), '跨原稿切换没有回到原稿 B')
  await expect(documentBStoryboardRow, '仅打开原稿 B 不应把分镜标为需同步').toHaveAttribute('data-storyboard-status', 'draft')
  await win.locator('[data-storyboard-id="sb-b1"]').click()
  await expect(win.getByLabel('镜 1 提示词'), '原稿 B 的分镜被原稿 A 的选择污染').toHaveValue('PLAN_B1_SENTINEL：黄昏环绕。')
  await win.locator('[data-document-id="doc-a"]:not([data-storyboard-id])').click()
  assert(await win.getByText('ORIGINAL_A_SENTINEL', { exact: false }).isVisible(), '返回原稿 A 后正文丢失')
  const sourceEditor = win.locator('[data-creation-editor="true"] .ProseMirror')
  await expectVisible(sourceEditor, '返回原稿后编辑器没有恢复')
  await sourceEditor.click()
  await sourceEditor.press('End')
  await sourceEditor.type(' 新增修订。')
  await expect(win.locator('[data-storyboard-row="sb-a1"]')).toHaveAttribute('data-storyboard-status', 'stale')
  await expect(win.locator('[data-storyboard-row="sb-a2"]')).toHaveAttribute('data-storyboard-status', 'stale')
  await expect(duplicatedRow, '同稿副本没有跟随原稿更新进入需同步状态').toHaveAttribute('data-storyboard-status', 'stale')
  await expect(duplicatedRow.locator('[data-storyboard-id]'), '需同步状态没有可访问语义').toHaveAttribute('aria-label', /需同步/)
  await expect(documentBStoryboardRow, '编辑原稿 A 污染了原稿 B 的分镜状态').toHaveAttribute('data-storyboard-status', 'draft')

  await win.setViewportSize({ width: 1440, height: 900 })
  await screenshotSettled(win, { path: path.join(outDir, '01-unified-creation-desktop.png') })

  await win.locator('[data-storyboard-id="sb-a2"]').click()
  await expect(win.locator('[data-creation-surface]'), '分镜选择没有切换主编辑面').toHaveAttribute('data-creation-surface', 'storyboard')
  // v5：中列是方案摘要卡（完整编辑器住分镜页）——卡上的镜头预览须恢复对应方案的内容。
  await expect(win.locator('[data-creation-surface="storyboard"]'), '分镜摘要卡没有恢复对应方案').toContainText('PLAN_A2_SENTINEL：慢推悬疑。')
  await screenshotSettled(win, { path: path.join(outDir, '02-unified-storyboard-desktop.png') })
  await win.locator('[data-document-id="doc-a"]:not([data-storyboard-id])').click()
  await expect(win.locator('[data-creation-surface]'), '返回原稿后没有切回原稿编辑面').toHaveAttribute('data-creation-surface', 'source')

  await win.setViewportSize({ width: 1100, height: 720 })
  const geometry = await win.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect()
      return value ? { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null
    }
    return {
      tree: rect('[data-creation-resource-tree="true"]'),
      surface: rect('[data-creation-surface]'),
      assistant: rect('[aria-label="AI 创作区"]'),
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
    }
  })
  assert(geometry.tree && geometry.surface && geometry.assistant, '最小窗口下有工作区区域没有渲染')
  assert(geometry.tree.right <= geometry.surface.x + 1, '最小窗口下资源树压住主编辑区')
  assert(geometry.assistant.x >= geometry.surface.x - 1, '最小窗口下 AI 助手掉到资源树列')
  assert(geometry.assistant.y >= geometry.surface.bottom - 1, '最小窗口下 AI 助手与主编辑区重叠')
  assert(geometry.tree.bottom >= geometry.assistant.bottom - 1, '资源树没有覆盖统一工作区的两行高度')
  assert(geometry.viewport.scrollWidth <= geometry.viewport.width + 1, '最小窗口出现水平溢出')
  assert(geometry.viewport.scrollHeight <= geometry.viewport.height + 1, '最小窗口出现垂直溢出')
  assert(geometry.tree.bottom <= geometry.viewport.height + 1, '最小窗口资源树被底部裁切')
  assert(geometry.assistant.bottom <= geometry.viewport.height + 1, '最小窗口创作助手被底部裁切')
  const clippedResourceTitles = await win.locator('[data-document-title="true"], [data-storyboard-title="true"]').evaluateAll((titles) => titles
    .filter((title) => title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1)
    .map((title) => title.textContent))
  assert(clippedResourceTitles.length === 0, `最小窗口下资源标题被裁切：${clippedResourceTitles.join('、')}`)
  await screenshotSettled(win, { path: path.join(outDir, '02-unified-creation-min-window.png') })

  await win.locator('[data-storyboard-id="sb-a2"]').click()
  await expect(win.locator('[data-creation-surface="storyboard"]'), '最小窗口无法打开分镜摘要').toBeVisible()
  await expect(win.locator('[data-creation-surface="storyboard"]'), '最小窗口打开了错误的分镜设计').toContainText('PLAN_A2_SENTINEL：慢推悬疑。')
  await expect(win.getByRole('button', { name: '打开分镜', exact: true }), '最小窗口分镜主操作不可见').toBeVisible()
  const narrowStoryboardGeometry = await win.evaluate(() => {
    const surface = document.querySelector('[data-creation-surface="storyboard"]')?.getBoundingClientRect()
    const assistant = document.querySelector('[aria-label="AI 创作区"]')?.getBoundingClientRect()
    return surface && assistant ? {
      surface: { right: surface.right, bottom: surface.bottom },
      assistant: { x: assistant.x, y: assistant.y, right: assistant.right, bottom: assistant.bottom },
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    } : null
  })
  assert(narrowStoryboardGeometry, '最小窗口分镜区域没有渲染')
  assert(narrowStoryboardGeometry.surface.right <= narrowStoryboardGeometry.viewport.width + 1, '最小窗口分镜编辑器右侧被裁切')
  assert(narrowStoryboardGeometry.assistant.right <= narrowStoryboardGeometry.viewport.width + 1, '最小窗口分镜态助手右侧被裁切')
  assert(narrowStoryboardGeometry.assistant.y >= narrowStoryboardGeometry.surface.bottom - 1, '最小窗口分镜编辑器与助手重叠')
  assert(narrowStoryboardGeometry.assistant.bottom <= narrowStoryboardGeometry.viewport.height + 1, '最小窗口分镜态助手底部被裁切')
  await screenshotSettled(win, { path: path.join(outDir, '02-unified-storyboard-min-window.png') })
  await win.locator('[data-document-id="doc-a"]:not([data-storyboard-id])').click()

  await expect.poll(() => {
    try {
      const saved = readSavedPayload()
      const savedDocumentA = saved.workbenchDocuments?.find((item) => item.id === 'doc-a')
      const savedDesignsA = saved.storyboardDesignsByDocumentId?.['doc-a'] ?? []
      const savedDuplicate = savedDesignsA.find((item) => item.id === duplicatedStoryboardId)
      return saved.workbenchDocuments?.some((item) => item.id === 'doc-c' && item.title === '原稿 C · 产品短片修订')
        && JSON.stringify(savedDocumentA?.contentJson).includes('新增修订。')
        && savedDesignsA.length === 3
        && savedDesignsA.some((item) => item.id === 'sb-a2' && item.title === '雨夜追凶 · 悬疑修订版')
        && savedDuplicate?.documentId === 'doc-a'
        && savedDuplicate.title === '雨夜追凶 · 动作版 4'
        && savedDuplicate.plan?.shots?.[0]?.prompt === 'PLAN_A1_SENTINEL：手持追拍。'
        && !savedDesignsA.some((item) => item.id === 'sb-a3')
    } catch {
      return false
    }
  }, { message: '统一资源树修改没有持久化到项目 manifest', timeout: 12_000 }).toBe(true)
  await win.reload()
  await openFixtureCreationSurface()
  await expect(win.locator('[data-document-row]'), '重载后原稿数量丢失').toHaveCount(3)
  await expect(win.locator('[data-storyboard-row]'), '重载后复制或删除分镜的结果不正确').toHaveCount(4)
  await expect(win.getByText('原稿 C · 产品短片修订', { exact: true }), '重载后第三篇原稿重命名丢失').toBeVisible()
  await expect(win.getByText('雨夜追凶 · 悬疑修订版', { exact: true }), '重载后分镜重命名丢失').toBeVisible()
  await expect(win.locator(`[data-storyboard-row="${duplicatedStoryboardId}"]`), '重载后分镜副本丢失').toBeVisible()
  await expect(win.locator('[data-storyboard-row="sb-a3"]'), '重载后被删除的分镜重新出现').toHaveCount(0)
  await win.locator(`[data-storyboard-id="${duplicatedStoryboardId}"]`).click()
  await expect(win.getByLabel('镜 1 提示词'), '重载后分镜副本内容丢失').toHaveValue('PLAN_A1_SENTINEL：手持追拍。')
  await win.locator('[data-storyboard-id="sb-a2"]').click()
  await expect(win.getByLabel('镜 1 提示词'), '重载后分镜 A2 内容丢失').toHaveValue('PLAN_A2_SENTINEL：慢推悬疑。')
  await expect(win.locator('[data-storyboard-row="sb-a2"]'), '重载后需同步状态丢失').toHaveAttribute('data-storyboard-status', 'stale')
  await expect(win.locator('[data-storyboard-row="sb-b1"]'), '重载后原稿 B 分镜状态被污染').toHaveAttribute('data-storyboard-status', 'draft')
  await win.locator('[data-document-id="doc-a"]:not([data-storyboard-id])').click()
  await expect(win.getByText('ORIGINAL_A_SENTINEL', { exact: false }), '重载后没有回到持久化的原稿').toBeVisible()
  await expect(win.locator('[data-creation-editor="true"] .ProseMirror'), '重载后原稿新增文字丢失').toContainText('新增修订。')
  await screenshotSettled(win, { path: path.join(outDir, '03-unified-creation-reloaded.png') })

  console.log(JSON.stringify({ ok: true, documents: 3, storyboardDesigns: 4, geometry }))
  await closeApp()
  process.exit(0)
} catch (error) {
  console.error(error)
  console.error('Creation workspace state:', await win.evaluate(() => ({
    url: location.href,
    creation: document.querySelector('[aria-label="创作区"]')?.textContent?.slice(0, 3000) ?? null,
  })).catch(() => null))
  await win.screenshot({ path: path.join(outDir, 'creation-work-surfaces-error.png') }).catch(() => {})
  await closeApp()
  process.exit(1)
}
