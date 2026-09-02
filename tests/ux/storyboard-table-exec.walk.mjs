// 分镜表 v5 Phase B 执行面走查（R13/R16）：表 = 画布节点的表格表示版。
// 种 2 场 8 镜 + 4 张参考卡；行状态机、锚卡状态、批量排除、镜级锁定、参考已变链、
// 双击放大、⏳直达 全部真机截图 + 断言。生成走 agent-runtime loopback fixture：
// **真跑完整执行通路（materialize → spendConfirm → runner → 结果回流 derive）但零真实额度**；
// 批量那条用「确认卡 → 取消」验证不花钱路径。
// 注：「生成中」的进度覆盖态是瞬时的（fixture 秒回），不强拍——快照归一化会把预种的
// running 洗掉（重启后没有活任务，产品正确行为），该态的渲染分支由单测锁。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture, FIXTURE_API_KEY, FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'
import { assertMockupContract, clickOrFail, expect, expectAbsent, expectCount, expectText, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import storyboardIntentContract from '../../docs/design/mockups/contracts/2026-09-01-storyboard-table-image-first.intent.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-exec-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'storyboard-exec-walk'
const projectRoot = path.join(projectsDir, projectId)
const outDir = process.env.STORYBOARD_EXEC_OUT || path.join(repoRoot, 'tests/ux/shots/storyboard-table-exec')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

// ── 真图素材（nomi-local:// 可显示，画面格/锚卡/放大预览都要真渲染）──
const imageSvg = (label, start, end) => `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280">
  <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>
  <rect width="720" height="1280" fill="url(#g)"/>
  <circle cx="540" cy="300" r="130" fill="#fff" opacity=".18"/>
  <text x="48" y="120" fill="white" font-size="64" font-family="sans-serif" font-weight="700">${label}</text>
</svg>`
for (const [name, label, start, end] of [
  ['hero.svg', '林薇 · 定妆', '#b56576', '#355070'],
  ['hero-old.svg', '林薇 · 旧版', '#6d597a', '#355070'],
  ['shot6.svg', '镜 06', '#e56b6f', '#22223b'],
  ['shot7.svg', '镜 07', '#84a59d', '#22223b'],
  ['shot8.svg', '镜 08', '#f6bd60', '#22223b'],
]) fs.writeFileSync(path.join(projectRoot, 'assets', 'generated', name), imageSvg(label, start, end))
const assetUrl = (name) => `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/${name}`
const img = (id, name) => ({ id, type: 'image', url: assetUrl(name), thumbnailUrl: assetUrl(name), createdAt: 1 })

// ── 方案：2 场 8 镜 + 4 锚（锚态：已锁 / 未生成×2 / 文本卡；rooftop 稍后真跑就地生成）──
const DESIGN = 'sb-exec-1'
const anchors = [
  { id: 'hero', kind: 'character', name: '林薇', description: '短发，风衣，眼神冷', carrier: 'visual' },
  { id: 'villain', kind: 'character', name: '陈默', description: '西装，金丝眼镜', carrier: 'visual' },
  { id: 'rooftop', kind: 'scene', name: '天台夜景', description: '雨后天台，霓虹反光', carrier: 'visual' },
  { id: 'mood', kind: 'style', name: '全片风格', description: '赛博霓虹，冷蓝洋红', carrier: 'text' },
]
const shot = (index, sceneId, over = {}) => ({
  index, shotId: `shot-${index}`, sceneId, shotKind: 'image', durationSec: 3,
  anchorIds: [], prompt: `第 ${index} 镜画面`, ...over,
})
const plan = {
  title: '夜风计划',
  profileKey: 'genre.short-drama',
  anchors,
  scenes: [{ id: 's1', title: '第一场 · 天台对峙' }, { id: 's2', title: '第二场 · 巷口追逐' }],
  shots: [
    shot(1, 's1', { anchorIds: ['hero'], prompt: '远景，第一镜画面', promptSegments: [{ key: 'shotSize', start: 0, end: 2 }] }), // ready（锚已就绪+锁定）
    shot(2, 's1', { anchorIds: ['rooftop', 'villain'] }),            // waiting-refs（两张卡都没生成）
    shot(3, 's1', { modelKey: FIXTURE_IMAGE_MODEL, modeId: 'edit' }), // missing-required（改图模式必填输入图）
    shot(4, 's1', { modelKey: FIXTURE_IMAGE_MODEL }),                // ready → 真跑 fixture 变 done
    shot(5, 's2'),                                                   // failed（预种 error 节点）
    shot(6, 's2', { anchorIds: ['hero'] }),                          // done（快照=当前，无参考已变）
    shot(7, 's2', { dialogue: '「你不该回来的。」' }),                 // locked
    shot(8, 's2', { anchorIds: ['hero'], durationSec: 4, modelKey: FIXTURE_IMAGE_MODEL }), // done + 参考已变
  ],
}
const meta = (shotId, extra = {}) => ({ storyboardDesignId: DESIGN, shotId, ...extra })
const nodes = [
  { id: 'n-hero', kind: 'character', categoryId: 'shots', title: '林薇', prompt: '定妆', position: { x: 0, y: 0 }, status: 'success',
    result: img('r-new', 'hero.svg'), history: [img('r-new', 'hero.svg'), img('r-old', 'hero-old.svg')],
    meta: { storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true, frozen: { at: 1, by: 'user' } } },
  { id: 'n-shot5', kind: 'image', categoryId: 'shots', title: '镜头 5', prompt: '第 5 镜画面', position: { x: 300, y: 260 }, status: 'error',
    error: '供应商超时（fixture）', meta: meta('shot-5') },
  { id: 'n-shot6', kind: 'image', categoryId: 'shots', title: '镜头 6', prompt: '第 6 镜画面', position: { x: 300, y: 520 }, status: 'success',
    result: img('r6', 'shot6.svg'), meta: meta('shot-6', { refSnapshot: { 'n-hero': 'r-new' }, imageDurationSec: 3 }) },
  { id: 'n-shot7', kind: 'image', categoryId: 'shots', title: '镜头 7', prompt: '第 7 镜画面', position: { x: 300, y: 780 }, status: 'success',
    result: img('r7', 'shot7.svg'), meta: meta('shot-7', { frozen: { at: 2, by: 'user' }, imageDurationSec: 3 }) },
  { id: 'n-shot8', kind: 'image', categoryId: 'shots', title: '镜头 8', prompt: '第 8 镜画面', position: { x: 300, y: 1040 }, status: 'success',
    result: img('r8', 'shot8.svg'), meta: meta('shot-8', { refSnapshot: { 'n-hero': 'r-old' }, imageDurationSec: 4 }) },
]
const project = {
  id: projectId, name: '分镜执行面走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{
      id: 'doc-1', version: 1, title: '夜风', updatedAt: 10,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜天台的对峙与追逐。' }] }] },
    }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlans: { 'doc-1': { plan, committed: false } },
    storyboardDesignsByDocumentId: {
      'doc-1': [{ id: DESIGN, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }],
    },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

// 零额度 loopback：真 SDK/IPC/renderer/存储，只有远端供应商是本地假的。
const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })

async function closeAppHard(instance) {
  const child = instance.process()
  await Promise.race([instance.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

// 首启只做一件事：把 fixture key 经真实 IPC 存成 safeStorage 密文再冷重启。
// 为什么这么绕（探针 2026-09-02 逐层定位，勿简化回单启动）：
// ① fixture 文件里的 plain key 执行层够用，但选项管道按 hasApiKey 闸，plain=needs_resave 不算；
// ② 渲染层选项缓存 boot 即温，手动广播事件不清模块缓存；
// ③ 渲染层改凭证会按去认证语义**自动禁用已发布 vendor**（fail-closed by design）——
//    所以存完 key 要再把 vendor 启用回来（fixture 模型 published，sanitizer 放行）。
{
  const first = await launchNomiApp({ name: 'storyboard-table-exec-seed', tempRoot, settingsDir, projectsDir, settleMs: 800 })
  const seeded = await first.win.evaluate(async ({ vendorKey, apiKey }) => {
    await window.nomiDesktop.modelCatalog.upsertVendorApiKey(vendorKey, { apiKey })
    await window.nomiDesktop.modelCatalog.upsertVendor({ key: vendorKey, enabled: true })
    const vendors = await window.nomiDesktop.modelCatalog.listVendors()
    const vendor = (Array.isArray(vendors) ? vendors : []).find((v) => v.key === vendorKey)
    return { enabled: vendor?.enabled ?? null, hasApiKey: vendor?.hasApiKey ?? null }
  }, { vendorKey: FIXTURE_VENDOR, apiKey: FIXTURE_API_KEY })
  console.log('  · fixture key 种入 →', JSON.stringify(seeded))
  if (seeded.enabled !== true || seeded.hasApiKey !== true) {
    throw new Error(`fixture vendor 种入失败（enabled=${seeded.enabled} hasApiKey=${seeded.hasApiKey}）——选项管道起不来，后续全为假红`)
  }
  await closeAppHard(first.app)
}

const { app, win } = await launchNomiApp({ name: 'storyboard-table-exec', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const failures = []
// 控制台错误留证（R16 报告用）：只记录不判红——平台/供应商噪音与真回归得由人眼分，
// 但「没记录」和「没有错误」必须可区分。
const consoleErrors = []
win.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)) })
win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error?.message || error).slice(0, 300)}`))
const snap = async (name) => { await screenshotSettled(win, { path: path.join(outDir, name) }) }
const frame = (n) => win.locator(`[data-storyboard-row="${n}"] [data-storyboard-frame]`).first()
const spendDialog = () => win.locator('div.fixed.inset-0').filter({ hasText: /开始生成|额度/ }).last()

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  // 进项目 → 创作页 → 选中分镜设计 → 打开分镜页
  const projectCard = win.locator('[data-project-card]', { hasText: '分镜执行面走查' }).first()
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const cont = projectCard.getByText('继续创作', { exact: false }).first()
    if (await cont.isVisible().catch(() => false)) await cont.click()
    else await projectCard.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN}"]`), '侧栏选中分镜设计')
  // 已建过节点 → committed 语义 derive，摘要卡主按钮是「再次编辑」；未建则「打开分镜」。
  await clickOrFail(win.getByRole('button', { name: /再次编辑|打开分镜/ }).first(), '从摘要卡进入分镜页')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')

  // ── 1. 行状态一屏对账（预种 6 态；generating 是瞬态由真跑覆盖，见文件头注）──
  // 镜 3 的红态依赖模型选项异步加载（options → 档案 mode → 必填判定），先等它就位再逐行对账。
  await expect(frame(3)).toHaveAttribute('data-storyboard-frame', 'missing-required', { timeout: 15_000 })
  const states = ['ready', 'waiting-refs', 'missing-required', 'ready', 'failed', 'done', 'locked', 'done']
  for (const [i, state] of states.entries()) {
    const got = await frame(i + 1).getAttribute('data-storyboard-frame')
    if (got !== state) failures.push(`镜 ${i + 1} 状态应为 ${state}，实为 ${got}`)
  }
  await expectVisible(win.locator('[data-storyboard-ref-changed="true"]'), '镜 8 缺「参考已变」红徽')
  const warnline = win.locator('[data-storyboard-ref-warnline="8"]')
  const warnProof = await proveProbe(warnline, '镜 8 参考已变警示行')
  await expectText(warnline, /林薇.*旧图/, '警示行没点名是哪张参考卡')
  await expectVisible(win.getByRole('button', { name: '用新图重跑' }), '缺「用新图重跑」按钮')
  await snap('01-table-all-states.png')

  // ── 2. footer：进度 + 排除原因 + 批量计数（F2 同一份 derive）──
  const footerText = await win.locator('[data-storyboard-progress="true"]').textContent()
  if (!/已生成 3\/8 镜/.test(footerText || '')) failures.push(`footer 进度应为 已生成 3/8 镜，实为「${footerText}」`)
  if (!/1 在等参考卡/.test(footerText || '')) failures.push(`footer 缺「1 在等参考卡」：「${footerText}」`)
  if (!/1 缺参考/.test(footerText || '')) failures.push(`footer 缺「1 缺参考」：「${footerText}」`)
  if (!/1 已锁/.test(footerText || '')) failures.push(`footer 缺「1 已锁」：「${footerText}」`)
  await expectText(win.locator('[data-storyboard-batch="true"]'), /生成未生成的 3 镜/, '批量按钮计数应为 3（ready×2+failed）')

  // ── 3. 组头小结与折叠 ──
  const s1Head = win.getByRole('button', { name: /第一场 · 天台对峙/ })
  await expectVisible(s1Head, '第一场组头没渲染')
  await clickOrFail(s1Head, '折叠第一场')
  // 作用域钉在编辑器内：侧栏的设计行同名 data-storyboard-row（值=design id），不属于表行。
  await expectCount(win.locator('[data-storyboard-editor="true"] [data-storyboard-row]'), 4, '折叠后应只剩第二场 4 行')
  await snap('02-scene-fold.png')
  await clickOrFail(s1Head, '展开第一场')

  // ── 4. 参考卡状态 + 「N 镜在等它」derive ──
  const anchorStat = (id) => win.locator(`[data-anchor-stat="${id}"]`)
  await expectText(anchorStat('hero'), /被 3 镜引用/, '已锁定锚应显被引用计数')
  await expectText(anchorStat('villain'), /1 镜在等它/, '未生成但被等的锚应显等它的镜数')
  await expectText(anchorStat('mood'), /不生成图/, '文本锚应显不生成图')
  await expectVisible(win.locator('[data-anchor-face="locked"]'), '林薇卡缺锁定面')
  await expectCount(win.locator('[data-anchor-face="empty"]'), 2, '陈默/天台应为两张未生成空卡')
  await expectVisible(win.locator('[data-anchor-face="text"]'), '全片风格缺文字卡')
  await snap('03-anchor-cards.png')

  // ── 5. ⏳ 直达参考卡 ──
  await clickOrFail(win.locator('[data-storyboard-frame="waiting-refs"] button').first(), '点⏳等待文案直达参考卡')
  await snap('04-jump-to-anchor.png')

  // ── 6. 悬停浮条（done）→ 锁定 → 计数实时变（F2）→ 解锁复原 ──
  await frame(6).hover()
  const actbar6 = win.locator('[data-storyboard-row="6"] [data-storyboard-actbar="true"]')
  await expectVisible(actbar6, '镜 6 悬停没出动作浮条')
  await snap('05-hover-actbar.png')
  await clickOrFail(actbar6.getByRole('button', { name: /^锁定/ }), '点浮条锁定镜 6')
  await expect(frame(6)).toHaveAttribute('data-storyboard-frame', 'locked', { timeout: 5000 })
  const footerAfterLock = await win.locator('[data-storyboard-progress="true"]').textContent()
  if (!/2 已锁/.test(footerAfterLock || '')) failures.push(`锁定镜 6 后 footer 应显 2 已锁，实为「${footerAfterLock}」`)
  await snap('06-locked-shot6.png')
  await frame(6).hover()
  await clickOrFail(actbar6.getByRole('button', { name: '解锁' }), '解锁镜 6 复原')
  await expect(frame(6)).toHaveAttribute('data-storyboard-frame', 'done', { timeout: 5000 })

  // ── 7. 双击放大 = AssetPreviewDialog（body-portal 全屏）──
  await frame(7).dblclick()
  const preview = win.locator('[role="dialog"][aria-modal="true"]').last()
  await expectVisible(preview, '双击画面格没有打开全屏预览')
  await snap('07-preview-dialog.png')
  await win.keyboard.press('Escape')
  await expect(preview).toBeHidden({ timeout: 5000 })

  // ── 8. 行内生成真跑（fixture 零额度）：镜 4 ready → spendConfirm → runner → done ──
  await clickOrFail(win.locator('[data-storyboard-row="4"]').getByRole('button', { name: '生成镜 4' }), '点镜 4 画面格生成')
  await expectVisible(spendDialog(), '行内生成没有弹花钱确认卡')
  await snap('08-row-spend-confirm.png')
  await clickOrFail(spendDialog().getByRole('button', { name: '生成', exact: true }), '确认（fixture 零额度）')
  await expect(frame(4)).toHaveAttribute('data-storyboard-frame', 'done', { timeout: 30_000 })
  const footerAfterRun = await win.locator('[data-storyboard-progress="true"]').textContent()
  if (!/已生成 4\/8 镜/.test(footerAfterRun || '')) failures.push(`镜 4 真跑后 footer 应为 4/8，实为「${footerAfterRun}」`)
  await snap('09-row-generated.png')

  // ── 9. 锚卡就地生成真跑：天台夜景 空卡 → 生成 → done；镜 2 仍等陈默（诚实）──
  await clickOrFail(win.locator('[data-anchor-card="rooftop"]').getByRole('button', { name: /^生成参考卡/ }), '点天台夜景就地生成')
  await expectVisible(spendDialog(), '锚生成没有弹花钱确认卡')
  await clickOrFail(spendDialog().getByRole('button', { name: '生成', exact: true }), '确认锚生成（fixture 零额度）')
  await expectText(anchorStat('rooftop'), /未锁定/, '天台生成后应显未锁定提示')
  const shot2State = await frame(2).getAttribute('data-storyboard-frame')
  if (shot2State !== 'waiting-refs') failures.push(`镜 2 仍缺陈默参考图，应保持 waiting-refs，实为 ${shot2State}`)
  await snap('10-anchor-generated.png')

  // ── 10. 参考已变一键补跑真跑：镜 8「用新图重跑」→ 确认 → 红标消（快照重打）──
  await clickOrFail(win.getByRole('button', { name: '用新图重跑' }), '点用新图重跑')
  await expectVisible(spendDialog(), '用新图重跑没有走花钱确认（执行通路断了）')
  // B4 R16 修复钉子：确认卡回声用户点的动作（标题/主按钮=「用新图重跑」），
  // 不是通用「重新生成」——退化回通用卡这里就红。
  await snap('11-rerun-fresh-refs-confirm.png')
  await clickOrFail(spendDialog().getByRole('button', { name: '用新图重跑', exact: true }), '确认重跑（fixture 零额度）')
  await expect(frame(8)).toHaveAttribute('data-storyboard-frame', 'done', { timeout: 30_000 })
  await expectAbsent(warnline, { provenBy: warnProof, message: '重跑后参考已变警示行应消失（快照已更新）' })
  await snap('12-ref-changed-cleared.png')

  // ── 11. 批量 → 花钱确认 → 取消（不花钱路径；剩 ready 镜 1 + failed 镜 5 = 2）──
  await expectText(win.locator('[data-storyboard-batch="true"]'), /生成未生成的 2 镜/, '真跑两镜后批量计数应降为 2')
  await clickOrFail(win.locator('[data-storyboard-batch="true"]'), '点批量生成')
  await expectVisible(spendDialog(), '批量后没有弹花钱确认卡')
  await snap('13-batch-spend-confirm.png')
  await clickOrFail(spendDialog().getByRole('button', { name: /取消|先不/ }).first(), '取消批量（不花钱路径）')
  await expect(spendDialog()).toBeHidden({ timeout: 5000 })
  const shot1After = await frame(1).getAttribute('data-storyboard-frame')
  if (shot1After !== 'ready') failures.push(`取消花钱后镜 1 应回 ready（materialize 免费副作用），实为 ${shot1After}`)
  await snap('14-batch-cancelled-final.png')

  // ── D1. 反查过滤：引用卡是入口，表行与场组小结都按过滤后重算；隐藏生成中另行报数由纯函数锁定。 ──
  await clickOrFail(anchorStat('hero'), '点「被 3 镜引用」反查主角')
  const filterBar = win.locator('[data-storyboard-filter="true"]')
  await expectVisible(filterBar, '反查后顶部过滤条未出现')
  await expectText(filterBar, /正在看引用「林薇」的 3 镜/, '过滤条没有显示过滤后的镜数')
  await expectCount(win.locator('[data-storyboard-editor="true"] [data-storyboard-row]'), 3, '反查后表应只剩 3 镜')
  await expectText(win.getByRole('button', { name: /第一场 · 天台对峙/ }), /1\/4 镜/, '过滤态第一场小结没有按过滤后重算')
  await snap('15-filtered-reference.png')
  await clickOrFail(filterBar.getByRole('button', { name: '退出过滤' }), '退出反查过滤')
  await expectCount(win.locator('[data-storyboard-editor="true"] [data-storyboard-row]'), 8, '退出过滤后应恢复 8 镜')

  // ── D1. 顺播：未生成镜自动跳过并提示，结果进入同一个 body-portal AssetPreviewDialog。 ──
  const sequenceFrameCount = await win.locator('[data-storyboard-frame]').count()
  const sequenceReadyCount = await win.locator('[data-storyboard-frame="done"], [data-storyboard-frame="locked"]').count()
  const sequenceSkippedCount = sequenceFrameCount - sequenceReadyCount
  await clickOrFail(win.getByRole('button', { name: '按镜序顺播已生成结果' }), '开始按镜序顺播')
  const playbackDialog = win.locator('[role="dialog"][aria-modal="true"]').last()
  await expectVisible(playbackDialog, '顺播没有打开全屏预览')
  await expectText(win.locator('body'), new RegExp(`已跳过 ${sequenceSkippedCount} 个未生成镜头`), '顺播没有提示被跳过的未生成镜头')
  await snap('16-sequence-playback-skipped.png')
  await win.keyboard.press('Escape')
  await expect(playbackDialog).toBeHidden({ timeout: 5000 })

  // ── D2. 结果即收：⤴ 菜单的目标镜可选，默认下一镜；选择镜 8 后真的写入它。 ──
  await frame(6).hover()
  await clickOrFail(actbar6.getByRole('button', { name: '用作…' }), '打开结果即收菜单')
  const intake = win.locator('[data-storyboard-row="6"] select[aria-label="目标镜头"]')
  await expectVisible(intake, '结果即收菜单缺目标镜选择器')
  if ((await intake.inputValue()) !== '6') failures.push(`镜 6 的结果即收默认目标应为下一镜位置 6，实为 ${await intake.inputValue()}`)
  await snap('17-result-intake-target-selector.png')
  await intake.selectOption({ label: '镜 8' })
  await clickOrFail(win.locator('[data-storyboard-row="6"]').getByRole('button', { name: '设为首帧' }), '把镜 6 结果设为镜 8 首帧')
  await expectCount(win.locator('[data-storyboard-row="8"] [data-storyboard-ref-tile="anchor"]'), 2, '设为镜 8 首帧没有把结果参考挂到目标镜')

  // ── D2. 参考 tile / @ 胶囊三层预览：悬停克制浮层，双击走同一 body-portal 全屏。 ──
  const heroFace = win.locator('[data-anchor-card="hero"] [data-anchor-face="locked"]').first()
  await heroFace.hover()
  await expectVisible(win.locator('[data-storyboard-hover-preview="true"] > span').last(), '参考 tile 悬停预览没有出现')
  await snap('18-anchor-hover-preview.png')
  await heroFace.dblclick()
  await expectVisible(win.locator('[role="dialog"][aria-modal="true"]').last(), '参考 tile 双击没有打开全屏预览')
  await snap('19-anchor-double-click-preview.png')
  await win.keyboard.press('Escape')

  const row6 = win.locator('[data-storyboard-row="6"]')
  await clickOrFail(row6.getByRole('button', { name: '输入 @ 选择参考' }), '打开镜 6 的 @ 参考入口')
  const mentionList = win.locator('[data-mention-list="true"]')
  await clickOrFail(mentionList.locator('[data-mention-item^="shot-result:"]').first(), '插入镜头结果 @ 胶囊')
  const mentionChip = row6.locator('[data-storyboard-mention-chip="true"]')
  await expectVisible(mentionChip, '@ 胶囊没有落在提示词里')
  await mentionChip.hover()
  await expectVisible(mentionChip.locator('[data-storyboard-mention-preview="true"]'), '@ 胶囊悬停预览没有出现')
  await snap('20-mention-hover-preview.png')
  await mentionChip.dblclick()
  await expectVisible(win.locator('[role="dialog"][aria-modal="true"]').last(), '@ 胶囊双击没有打开全屏预览')
  await snap('21-mention-double-click-preview.png')
  await win.keyboard.press('Escape')

  // ── D3. 行操作：插入线、grip 菜单、键盘进入提示词/焦点移动，及画布同款多选浮条。 ──
  const insertLine = win.locator('[data-storyboard-insert-line="2"]')
  await insertLine.hover()
  await expectVisible(insertLine.getByRole('button', { name: '在这里插入镜头' }), '两行交界悬停没有插入线')
  await snap('22-insert-line.png')
  await clickOrFail(insertLine.getByRole('button', { name: '在这里插入镜头' }), '就地插入镜头')
  await expectCount(win.locator('[data-storyboard-editor="true"] [data-storyboard-row]'), 9, '就地插镜后应为 9 镜')

  const gripMenu = win.locator('[data-storyboard-row="3"]')
  await clickOrFail(gripMenu.getByRole('button', { name: '镜头操作' }).last(), '打开镜头 grip 菜单')
  await expectVisible(gripMenu.getByRole('button', { name: '复制镜头' }), 'grip 菜单缺复制镜头')
  await expectVisible(gripMenu.getByRole('button', { name: '第二场 · 巷口追逐' }), 'grip 菜单缺移到场选项')
  await expectVisible(gripMenu.getByRole('button', { name: '删除镜头' }), 'grip 菜单缺删除镜头')
  await snap('23-grip-menu.png')
  await win.keyboard.press('Escape')

  const select1 = win.locator('[data-storyboard-row="1"] [aria-label="选择镜 1"]')
  const select2 = win.locator('[data-storyboard-row="2"] [aria-label="选择镜 2"]')
  await clickOrFail(select1, '选择镜 1')
  await select2.click({ modifiers: ['Shift'] })
  const selectionBar = win.locator('[data-storyboard-selection-toolbar="true"]')
  await expectVisible(selectionBar, 'Shift 连选后没有出现画布同款多选浮条')
  await expectText(selectionBar, /已选 2 镜/, '多选浮条作用域计数不对')
  await snap('24-multi-selection-toolbar.png')
  await gripMenu.focus()
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-storyboard-row="3"] [data-prompt-box="true"] [contenteditable="true"]')).toBeFocused()
  await snap('25-keyboard-prompt-focus.png')

  // ── 形态契约（意图层）：拍板样张里「哪些位置承载设计意图」的二值断言。
  // 放在这里——app 仍活、表已渲染出全部行状态，几何与结构都是真值。
  await assertMockupContract(win, storyboardIntentContract)

  fixture.assertClean()
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
  await snap('99-failure.png').catch(() => {})
} finally {
  await closeAppHard(app)
  await fixture.close().catch(() => {})
  console.log(consoleErrors.length === 0
    ? '  · 渲染层控制台错误：0 条'
    : `  · 渲染层控制台错误 ${consoleErrors.length} 条：\n${consoleErrors.map((line) => `    - ${line}`).join('\n')}`)
}

if (failures.length > 0) {
  console.error(`✖ storyboard-table-exec 走查失败 ${failures.length} 项：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`✅ storyboard-table-exec 走查通过（截图在 ${outDir}）`)
