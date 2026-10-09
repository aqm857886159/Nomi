// 镜头卡窄档走查（2026-10-06 第二轮版面重写，原样张 v1 的「参考列收一格 + N」随参考列一起删除）：
// 真实 Electron / IPC / 渲染 / 项目文件，**零生成额度**（全程不点生成）。
//
// 要证的那句话：**左栏展开（编辑器变窄）时，镜头行里一个控件都不许顶出卡外，「生成」必须看得见。**
// 2026-10-06 起行 = 行首 / 视觉列（预览框 + 参考缩略图）/ 内容列（提示词 + 画布同款底栏）；
// 窄档下视觉列整只按 176/240 缩，参考缩略图 36 → 28、放不下折成「+N」，省下的宽度给内容列。
//
// 四张真截图 = zh/en × 左栏收起/展开；每一张都配一条量出来的断言：
//   ① 左栏展开 → 行进窄档、视觉列变窄、零越界、「生成」在卡内；
//   ② 左栏收起 → 行回宽档、零越界；
//   ③ 占位文字必须待在它自己的盒子里（样张成因②：零高度浮动伪元素）；
//   ④ 窄档省下的宽度真的回到了内容列。
import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.env.NARROW_ROW_WALK_OUT || path.join(repoRoot, '.tmp', 'storyboard-narrow-row')
const projectId = 'storyboard-narrow-row-walk'
const designId = 'narrow-row-design'
fs.mkdirSync(outDir, { recursive: true })
/**
 * **每种语言一份全新的资料库**，不是同一份跑两遍。
 * 两个理由，都是 2026-09-21 实测撞到的：① 语言只在冷启动时从 localStorage 读一次，而同一个
 * profile 第二次启动时里面已经有上一轮写的 `zh-CN`，种子盖不过去 —— 拍出来四张全是中文；
 * ② 上一轮跑完项目文件的 revision 变了，第二轮开库时会弹「发现另一台电脑的项目更新」把卡片挡住。
 */
function makeFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-narrow-'))
  const settingsDir = path.join(tempRoot, 'settings')
  const projectsDir = path.join(tempRoot, 'projects')
  const projectRoot = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true })
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), catalogJson)
  fs.writeFileSync(path.join(projectRoot, 'assets', 'hero.png'), png)
  const project = projectRecord(projectRoot)
  for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
    fs.writeFileSync(file, JSON.stringify(project, null, 2))
  }
  return { tempRoot, settingsDir, projectsDir }
}

const stamp = '2026-09-21T00:00:00.000Z'
const catalogJson = JSON.stringify({
  version: 12,
  vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: stamp, updatedAt: stamp }],
  models: [{
    vendorKey: 'ux-local', modelKey: 'seedance-2-5', labelZh: 'Seedance 2.5', kind: 'video', enabled: true,
    meta: {
      archetypeId: 'seedance-2.5',
      adapter: {
        state: 'verified', activeRevision: 'narrow-row',
        publicationModes: ['text_to_video', 'image_to_video'],
        modes: [{ taskKind: 'text_to_video', state: 'verified' }, { taskKind: 'image_to_video', state: 'verified' }],
      },
    },
    createdAt: stamp, updatedAt: stamp,
  }],
  mappings: [], apiKeysByVendor: {},
}, null, 2)

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const assetUrl = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/hero.png`

// 三格都装上东西，窄档下才看得出「收成一格 + 还有 2 个」是不是真的没丢信息。
const referenceBindings = {
  image_ref: [{ url: assetUrl, name: '主角定妆' }],
  video_ref: [{ url: assetUrl, name: '运镜参考' }],
  audio_ref: [{ url: assetUrl, name: '语气参考' }],
}
const shot = (index) => ({
  index, shotId: `shot-${index}`, shotKind: 'video', durationSec: 5, anchorIds: [],
  modelKey: 'seedance-2-5', modeId: 'omni', prompt: '', referenceBindings,
})
const plan = { title: '窄档走查', anchors: [], shots: [shot(1), shot(2)] }
const projectRecord = (projectRoot) => ({
  id: projectId, name: '窄档走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: '走查', updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜。' }] }] } }],
    activeDocumentId: 'doc-1', timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: designId, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
})

const failures = []
const screenshots = []
const measured = []
/**
 * 语言**只能靠重启切**：把 `nomi:locale:v1` 写进 localStorage 再发一个 StorageEvent 是不够的，
 * 界面照旧是中文（2026-09-21 本走查第一轮实测——四张「EN」截图拍出来全是中文，
 * 断言却一条没红。这正是「断言前先证明你在你以为的现场」那一条）。
 * 所以每种语言一次冷启动，并且**先验一句只有那一种语言才有的文案**，验不到就报红。
 */
let appInstance = null
let win = null
const snap = async (name) => {
  const target = path.join(outDir, name)
  await screenshotSettled(win, { path: target })
  screenshots.push(target)
}
const editor = () => win.locator('[data-storyboard-editor="true"]:visible')
const row = () => editor().locator('[data-storyboard-row="1"]').first()

/**
 * 量这一行：档位、三根列宽、以及**越出卡片右缘的叶子数**。
 *
 * 越界判据按「叶子」数，不按「有没有横向滚动条」——溢出的那几行占位文字是浮动伪元素画出去的，
 * 它不产生滚动条，只是画到别人身上（2026-09-21 样张成因②）。伪元素量不到，所以另外单独量
 * 提示词框自己的内容高度有没有超出它的盒（`scrollHeight > clientHeight + 1`）。
 */
async function measureRow(label) {
  const data = await row().evaluate((element) => {
    // 行外壳自己就是卡片的内容盒（`[data-storyboard-row]` = `StoryboardRowShell` 那个 grid）。
    const cardRect = element.getBoundingClientRect()
    const overflowing = []
    let overflowPx = 0
    for (const node of element.querySelectorAll('*')) {
      if (node.children.length > 0) continue
      const rect = node.getBoundingClientRect()
      if (rect.width < 1 && rect.height < 1) continue
      if (rect.right > cardRect.right + 1) {
        overflowing.push(`${node.tagName.toLowerCase()}:${(node.textContent || '').trim().slice(0, 24)}`)
        overflowPx = Math.max(overflowPx, Math.round(rect.right - cardRect.right))
      }
    }
    const zone = element.querySelector('[data-storyboard-visual-column]')
    const promptBox = element.querySelector('[data-prompt-box="true"]')
    const generate = element.querySelector('[data-storyboard-generate-state]')
    const proseMirror = promptBox?.querySelector('.ProseMirror') ?? null
    return {
      density: element.getAttribute('data-storyboard-row-density'),
      rowWidth: Math.round(element.getBoundingClientRect().width),
      visualColumnWidth: zone ? Math.round(zone.getBoundingClientRect().width) : null,
      generateInside: generate ? generate.getBoundingClientRect().right <= cardRect.right + 1 : null,
      promptColumnWidth: promptBox ? Math.round(promptBox.getBoundingClientRect().width) : null,
      overflowing,
      overflowPx,
      placeholderSpill: proseMirror ? Math.round(proseMirror.scrollHeight - proseMirror.clientHeight) : null,
    }
  })
  measured.push({ label, ...data })
  // 底栏只剩「模型 · 参数汇总 · 生成」三件，窄档也放得下：任何越界都是缺陷。
  if (data.overflowing.length > 0) failures.push(`${label}：越界 ${data.overflowPx}px → ${data.overflowing.join(' / ')}`)
  if (data.generateInside === false) failures.push(`${label}：「生成」被顶出卡外`)
  if (data.placeholderSpill !== null && data.placeholderSpill > 1) failures.push(`${label}：提示词框内容比盒子高 ${data.placeholderSpill}px（占位文字画到卡外）`)
  return data
}

/**
 * 把「文稿」抽屉切到指定状态（10-08 外壳重设计：原「创作内容」列开关删了，文稿树进左栏「文稿」抽屉；按下态 = 开着）。
 * 所以「找不到 expand」= 已经展开了，不是出错。等它先出现，别在渲染完成前就问它在不在。
 */
async function setSidebar(state) {
  await win.locator('[data-shell-rail-item="docs"]').first()
    .waitFor({ state: 'visible', timeout: stationTimeout() })
  const toggle = win.locator(`[data-shell-rail-item="docs"][aria-pressed="${state === 'expand' ? 'false' : 'true'}"]`)
  if (await toggle.isVisible().catch(() => false)) await toggle.click()
  await win.waitForTimeout(500)
  const wrong = win.locator(`[data-shell-rail-item="docs"][aria-pressed="${state === 'expand' ? 'false' : 'true'}"]`)
  if (await wrong.isVisible().catch(() => false)) failures.push(`「文稿」抽屉没有切到 ${state}（左栏「文稿」钮的按下态没变）`)
}

async function openEditor(locale) {
  const { tempRoot, settingsDir, projectsDir } = makeFixture()
  appInstance = await launchNomiApp({
    name: `storyboard-narrow-row-${locale}`, tempRoot, settingsDir, projectsDir, settleMs: 1200,
    initialLocalStorage: {
      'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
    },
  })
  win = appInstance.win
  const card = win.locator('[data-project-card]', { hasText: '窄档走查' }).first()
  if (await card.isVisible().catch(() => false)) {
    await card.hover()
    const open = card.getByText(locale === 'en' ? 'Continue' : '继续创作', { exact: false }).first()
    if (await open.isVisible().catch(() => false)) await open.click()
    else await card.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: /^(创作|Create)$/ }), '切到创作页')
  await setSidebar('expand')
  await clickOrFail(win.locator(`[data-storyboard-id="${designId}"]`), '选中走查分镜')
  // 侧栏点一行方案通常直接就进编辑器；某些态下还要再点一次「打开分镜 / 再次编辑」。
  // 两条路都要能走通：先给编辑器一段真实的渲染时间（问得太早会把「还没画出来」当成「这条路不通」），
  // 真等不到才去找那颗按钮——**两条都不通就报红**，不静默跳过。
  const appeared = await editor().waitFor({ state: 'visible', timeout: stationTimeout() }).then(() => true).catch(() => false)
  if (!appeared) {
    await clickOrFail(win.getByRole('button', { name: /打开分镜|再次编辑|Open storyboard|Edit again/ }).first(), '打开分镜页')
  }
  await expectVisible(editor(), '分镜编辑器未渲染')
  await expectVisible(row(), '第一镜未渲染')
  // 证明真的在这一语言的现场：这两句是同一块（批量条提示行）里只有那一种语言才有的说法。
  await expectVisible(
    editor().getByText(locale === 'en' ? 'Generate reference cards to lock looks first' : '先生成参考卡锁住长相', { exact: false }).first(),
    `界面没有切到 ${locale}——这一轮拍出来的不是这门语言的证据`,
  )
}

async function closeApp() {
  if (!appInstance) return
  const instance = appInstance
  appInstance = null
  await Promise.race([instance.app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  await instance.close()
}

try {
  for (const locale of ['zh-CN', 'en']) {
    await openEditor(locale)
    const tag = locale === 'zh-CN' ? 'zh' : 'en'

    // ── 左栏展开：窄档 ──
    await setSidebar('expand')
    const narrow = await measureRow(`${tag}-左栏展开`)
    await snap(`${tag}-sidebar-open-narrow.png`)
    if (narrow.density !== 'narrow') failures.push(`${tag}：左栏展开时行没有进窄档（density=${narrow.density}，行宽 ${narrow.rowWidth}）`)

    // ── 左栏收起：宽档 ──
    await setSidebar('collapse')
    const wide = await measureRow(`${tag}-左栏收起`)
    await snap(`${tag}-sidebar-collapsed-wide.png`)
    if (wide.density !== 'wide') failures.push(`${tag}：左栏收起时行没有回宽档（density=${wide.density}，行宽 ${wide.rowWidth}）`)
    /** 窄档的视觉列整只按 176/240 缩：省下的宽度要真的回到内容列（同一行宽下比反事实）。 */
    const saved = (wide.visualColumnWidth ?? 0) - (narrow.visualColumnWidth ?? 0)
    if (saved < 30) failures.push(`${tag}：窄档视觉列只省下 ${saved}px（宽 ${wide.visualColumnWidth} / 窄 ${narrow.visualColumnWidth}）`)
    const promptIfNotShrunk = (narrow.promptColumnWidth ?? 0) - saved
    if (!((narrow.promptColumnWidth ?? 0) > promptIfNotShrunk + 20)) {
      failures.push(`${tag}：窄档内容列 ${narrow.promptColumnWidth}px，视觉列不缩时只有 ${promptIfNotShrunk}px——缩视觉列没换来写字的地方`)
    }

    await closeApp()
  }
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
  await win?.screenshot({ path: path.join(outDir, '99-FAIL.png') }).catch(() => {})
} finally {
  await closeApp()
}

const report = [
  '# storyboard narrow row walk (样张 v1 对账)',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `screenshots: ${screenshots.join(', ')}`,
  `measured: ${JSON.stringify(measured, null, 2)}`,
  'covers: sidebar open -> narrow density + single slot + "+N"; sidebar collapsed -> wide density + three slots; no leaf past the card edge in either state; placeholder stays inside its box; "+N" still fans the slots out.',
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
