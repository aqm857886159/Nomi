// 镜头卡窄档走查（R13 · 2026-09-21 样张 v1 逐项对账）：真实 Electron / IPC / 渲染 / 项目文件，
// **零生成额度**（全程不点生成）。
//
// 要证的那句话：**左栏展开时，镜头卡里一个字都不许被切、一个控件都不许顶出卡外。**
// 现场（样张第 1 节量过）：左栏展开 → 分镜编辑器只剩 585px → 行里的固定列雷打不动吃掉 415px →
// 提示词列只剩 136px。v1 的修法是窄档下参考列从三格收成一格 + 「+N」。
//
// 四张真截图 = zh/en × 左栏收起/展开；每一张都配一条量出来的断言，不是「看着还行」：
//   ① 左栏展开 → 行进窄档、参考列 = 一只固定盒、「+N」在、提示词列变宽；
//   ② 左栏收起 → 行回宽档、三格并排；
//   ③ 占位文字必须待在它自己的盒子里（样张成因②：零高度浮动伪元素）；
//   ④ 点「+N」→ 三格真的摊开（收成一格不是把信息删掉）。
//
// 关于底栏越界：胶囊装不下时的让位规则是 2026-09-17 用户逐字拍板的（模型可缩到下限、
// 模式/时长不缩不降、只有档案枚举能进 ⋯）。所以这里**不**断言「永远零越界」——那会逼人
// 去改用户拍过板的规则。断言的是：**一旦还有越界，行尾 ⋯ 必须已经在场**，即让位机制已经
// 走到它的下限，剩下的是几何缺口而不是漏掉的一步；缺口多少像素照实记进 report。
import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectCount, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

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
    const zone = element.querySelector('[data-storyboard-refzone]')
    const promptBox = element.querySelector('[data-prompt-box="true"]')
    const proseMirror = promptBox?.querySelector('.ProseMirror') ?? null
    return {
      density: element.getAttribute('data-storyboard-row-density'),
      rowWidth: Math.round(element.getBoundingClientRect().width),
      referenceColumnWidth: zone ? Math.round(zone.getBoundingClientRect().width) : null,
      promptColumnWidth: promptBox ? Math.round(promptBox.getBoundingClientRect().width) : null,
      slotCount: element.querySelectorAll('[data-storyboard-ref-slot]').length,
      moreBadge: element.querySelectorAll('[data-storyboard-ref-more]').length,
      overflowing,
      overflowPx,
      hasOverflowDots: element.querySelectorAll('[data-storyboard-composer-switches]').length > 0,
      placeholderSpill: proseMirror ? Math.round(proseMirror.scrollHeight - proseMirror.clientHeight) : null,
    }
  })
  measured.push({ label, ...data })
  // 越界还在，但行尾 ⋯ 不在 = 让位机制少走了一步，这才是 bug。
  if (data.overflowing.length > 0 && !data.hasOverflowDots) {
    failures.push(`${label}：越界 ${data.overflowPx}px 且行尾 ⋯ 不在场——让位机制没走到下限 → ${data.overflowing.join(' / ')}`)
  }
  if (data.placeholderSpill !== null && data.placeholderSpill > 1) failures.push(`${label}：提示词框内容比盒子高 ${data.placeholderSpill}px（占位文字画到卡外）`)
  return data
}

/**
 * 把左栏切到指定状态。开关只渲染**当前可做的那一个动作**（展开时它写 collapse，反之写 expand），
 * 所以「找不到 expand」= 已经展开了，不是出错。等它先出现，别在渲染完成前就问它在不在。
 */
async function setSidebar(state) {
  await win.locator('[data-creation-resource-tree-toggle]:visible').first()
    .waitFor({ state: 'visible', timeout: stationTimeout() })
  const toggle = win.locator(`[data-creation-resource-tree-toggle="${state}"]:visible`)
  if (await toggle.isVisible().catch(() => false)) await toggle.click()
  await win.waitForTimeout(500)
  const wrong = win.locator(`[data-creation-resource-tree-toggle="${state}"]:visible`)
  if (await wrong.isVisible().catch(() => false)) failures.push(`左栏没有切到 ${state}（开关还写着 ${state}）`)
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
    if (narrow.moreBadge !== 1) failures.push(`${tag}：窄档下没有「+N」计数（找到 ${narrow.moreBadge} 个）`)
    if (narrow.slotCount !== 1) failures.push(`${tag}：窄档下参考列露了 ${narrow.slotCount} 格，v1 说好只露一格`)
    // 下面那条「宽档下不该有 +N」的基线：先在这里证明这个选择器真的测得到东西。
    const moreProof = await proveProbe(row().locator('[data-storyboard-ref-more]'), '窄档下「+N」真的在场')

    // ── 左栏收起：宽档，三格并排 ──
    await setSidebar('collapse')
    const wide = await measureRow(`${tag}-左栏收起`)
    await snap(`${tag}-sidebar-collapsed-wide.png`)
    if (wide.density !== 'wide') failures.push(`${tag}：左栏收起时行没有回宽档（density=${wide.density}，行宽 ${wide.rowWidth}）`)
    if (wide.slotCount !== 3) failures.push(`${tag}：宽档下参考列只有 ${wide.slotCount} 格，三格并排没了`)
    await expectAbsent(row().locator('[data-storyboard-ref-more]'),
      { provenBy: moreProof, message: `${tag}：宽档三格并排，不该再出现「+N」` })
    /**
     * v1 的整句承诺：收掉的那 146px **真的回到了提示词列**。
     * 拿两个不同宽度的数直接比是错的（窄档那一态本来行就窄）；要比的是**同一个行宽下**
     * 窄档给的宽度 vs 旧的固定三格给的宽度——后者是算出来的反事实：`行宽 − 宽档固定开销`。
     */
    const savedByCollapsing = wide.referenceColumnWidth - narrow.referenceColumnWidth
    const promptIfStillThreeSlots = narrow.promptColumnWidth - savedByCollapsing
    if (savedByCollapsing < 100) failures.push(`${tag}：收参考列只省下 ${savedByCollapsing}px`)
    if (!(narrow.promptColumnWidth > promptIfStillThreeSlots + 100)) {
      failures.push(`${tag}：窄档提示词列 ${narrow.promptColumnWidth}px，三格不让路时只有 ${promptIfStillThreeSlots}px——收参考列没换来写字的地方`)
    }

    // ── 「点一下仍摊开」：收成一格不是把信息删掉 ──
    await setSidebar('expand')
    const more = row().locator('[data-storyboard-ref-more]').first()
    await expectVisible(more, '窄档下「+N」没渲染')
    await clickOrFail(more, '点开「+N」')
    await expectCount(row().locator('[data-storyboard-ref-slot]'), 3, '点「+N」没有把三格摊开')
    await snap(`${tag}-sidebar-open-expanded.png`)
    await clickOrFail(row().locator('[data-storyboard-ref-more]').first(), '再点一次收回')
    await expectCount(row().locator('[data-storyboard-ref-slot]'), 1, '再点一次没有收回一格')

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
