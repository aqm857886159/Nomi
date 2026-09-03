// 静态样张走查：验证参考区不是并列 fixture，而是随真实 mode slots 形状 derive。
// 这条走查消费 intent + auto 两层契约；无 Electron、无额度，只验证设计关系与可见输出。
import { chromium } from '/Users/aoqimin/Desktop/Nomi/node_modules/playwright/index.mjs'
import storyboardIntentContract from '../../docs/design/mockups/contracts/2026-09-03-storyboard-anchor-row-and-param-rail.intent.mjs'
import storyboardAutoContract from '../../docs/design/mockups/contracts/2026-09-03-storyboard-anchor-row-and-param-rail.auto.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const mockup = path.join(repoRoot, 'docs/design/mockups/2026-09-03-storyboard-anchor-row-and-param-rail.html')
const outDir = process.env.STORYBOARD_MODE_OUT || repoRoot
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 })
await page.goto(`file://${mockup}`, { waitUntil: 'networkidle' })

// 当前 mockup worktree 按 brief 不装依赖，不能通过仓内 _assert.mjs 引入 @playwright/test。
// 这里保留同样的契约语义：结构关系与数量级几何先断言，再跑动态模式 proof。
const failures = []
const failContract = (message) => { failures.push(`契约：${message}`) }
const failMode = (message) => { failures.push(`模式：${message}`) }
const fail = failContract
for (const rule of storyboardIntentContract.structure) {
  if (rule.ancestor && rule.descendant) {
    const total = await page.locator(rule.descendant).count()
    const inside = await page.locator(`${rule.ancestor} ${rule.descendant}`).count()
    if (total < (rule.minCount || 1) || inside < (rule.minCount || 1)) fail(`意图包含关系不符：${rule.name}`)
  }
  if (rule.before && rule.after) {
    const ordered = await page.evaluate(({ before, after }) => {
      const a = document.querySelector(before), b = document.querySelector(after)
      return Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
    }, rule)
    if (!ordered) fail(`意图顺序关系不符：${rule.name}`)
  }
  if (rule.sameClass) {
    const shared = await page.evaluate((selectors) => selectors.every((selector) => document.querySelector(selector)?.classList.contains('shot-row')), rule.sameClass)
    if (!shared) fail(`意图共享类关系不符：${rule.name}`)
  }
}
for (const rule of storyboardAutoContract.geometry) {
  const box = await page.locator(rule.selector).first().boundingBox()
  if (!box) { failContract(`自动层找不到可测量挂点：${rule.name}`); continue }
  const actual = Math.round(rule.dimension === 'width' ? box.width : box.height)
  if (Math.abs(actual - rule.expected) > Math.max(4, rule.expected * 0.25)) fail(`自动层几何不符：${rule.name}，实测 ${actual}`)
}
const select = page.locator('#modelSelect')
const zone = page.locator('[data-reference-zone-view]')
if (!(await select.isVisible())) failMode('真实模式选择器不可见')
if (await select.locator('option').count() !== storyboardIntentContract.modeProof.length) failMode('样张取样模式数量与意图契约不符')

const anchorPanel = page.locator('[data-storyboard-anchors]')
const anchorRows = anchorPanel.locator('.shot-row[data-storyboard-anchor-row]')
if (await anchorRows.count() !== 3) failMode('锚区必须由角色、场景、风格文本三条 shot-row 同构锚行组成')
if (await anchorPanel.locator('.anchor-card').count() !== 0) failMode('锚区仍残留旧的 anchor-card 布局')
const layoutParity = await page.evaluate(() => {
  const anchor = document.querySelector('[data-storyboard-anchor-row]')
  const shot = document.querySelector('[data-storyboard-row]')
  if (!anchor || !shot) return false
  const anchorGrid = getComputedStyle(anchor).gridTemplateColumns
  const shotGrid = getComputedStyle(shot).gridTemplateColumns
  return anchor.classList.contains('shot-row') && anchorGrid === shotGrid
})
if (!layoutParity) failMode('锚行没有复用 shot-row 的同一套四栏栅格')
if (await anchorPanel.locator('[data-anchor-references]').count() !== 3) failMode('锚行缺少“谁引用了我”的反向引用格')
if (await anchorPanel.locator('[data-anchor-frame]').count() !== 3) failMode('三种锚没有各自的画面格')
if (await anchorPanel.locator('[data-anchor-frame] .generate').count() < 2) failMode('可生成锚的生成按钮没有留在画面格里')
if (await anchorPanel.locator('[data-anchor-frame] .anchor-generate').count() !== 0) failMode('锚行生成按钮使用了未声明的画面格动作挂点')
const anchorStates = new Set(await anchorPanel.locator('[data-anchor-state]').evaluateAll((elements) => elements.map((element) => element.dataset.anchorState)))
for (const state of ['loading', 'failed', 'generated', 'locked']) if (!anchorStates.has(state)) failMode(`锚画面格状态缺少 ${state}`)
for (const railText of await anchorPanel.locator('[data-parameter-rail]').allTextContents()) if (/\d+\s*s/.test(railText)) failMode('锚行参数条误带时长胶囊')
const hasLegacyGridRule = await page.evaluate(() => document.documentElement.outerHTML.includes('.anchor-card') || document.documentElement.outerHTML.includes('108px 1fr'))
if (hasLegacyGridRule) failMode('样张仍残留 .anchor-card 的 108px 1fr 旧布局规则')

const inlineModel = page.locator('#modelPill')
const inlineModelTag = await inlineModel.evaluate((element) => element.tagName.toLowerCase())
if (inlineModelTag !== 'select' && !(await inlineModel.getAttribute('role'))?.includes('button')) {
  failMode('行内模型胶囊是纯文字节点，不可交互')
} else if (inlineModelTag === 'select') {
  await inlineModel.selectOption('seedance-2:first')
  if (await select.inputValue() !== 'seedance-2:first') failMode('行内模型选择没有回写顶部共享模型入口')
  if (!(await page.locator('#modeTag').textContent()).includes('首帧')) failMode('行内模型选择没有触发顶部同一套 render() 状态')
  await page.screenshot({ path: path.join(outDir, 'storyboard-anchor-row-fixed-model-switch.png') })
}

for (const proof of storyboardIntentContract.modeProof) {
  await select.selectOption(proof.key)
  if (!await page.locator('#modeTag').textContent()) failMode(`${proof.key} 没有更新模式标签`)
  if (proof.zone === 'none-accepted') {
    if (!(await zone.locator('[data-reference-zone="none-accepted"]').isVisible())) failMode(`${proof.key} 应显示不吃参考`)
    if (await zone.locator('[data-storyboard-ref-tile]').count() !== proof.tiles) failMode(`${proof.key} 参考 tile 数量不符`)
  } else {
    if (!(await zone.locator('[data-reference-zone="slots"]').isVisible())) failMode(`${proof.key} 应显示槽投影`)
    if (await zone.locator('[data-storyboard-ref-tile]').count() !== proof.tiles) failMode(`${proof.key} 参考格数量应来自 slots`)
    if (await zone.locator('[data-reference-array]').count() !== (proof.array ? 1 : 0)) failMode(`${proof.key} 数组参考入口不符`)
    const zoneText = await zone.textContent()
    for (const text of proof.contains || []) if (!zoneText.includes(text)) failMode(`${proof.key} 缺少诚实声明 ${text}`)
  }
  // 每一个真实取样模式都留一张可供主会话逐张人眼复核的截图，而不是只拍默认态。
  const screenshotKey = proof.key.replaceAll(':', '-').replaceAll('.', '-')
  await page.screenshot({ path: path.join(outDir, `storyboard-anchor-mode-${screenshotKey}.png`) })
}

await select.selectOption('seedance-2:omni')
await page.locator('[data-parameter-summary]').click()
if (!(await page.locator('[data-parameter-panel]').isVisible())) failMode('摘要 pill 未打开统一参数面板')
await page.screenshot({ path: path.join(outDir, 'storyboard-anchor-modes-light.png'), fullPage: true })
await page.locator('#themeToggle').click()
await page.screenshot({ path: path.join(outDir, 'storyboard-anchor-modes-dark.png'), fullPage: true })

if (failures.length) { await browser.close(); throw new Error(`\n${failures.join('\n')}`) }
console.log(`✅ 分镜真实模式走查通过：${storyboardIntentContract.modeProof.length} 个模式输出已逐一切换并断言`)
await browser.close()
