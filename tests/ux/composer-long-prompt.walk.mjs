// R13 走查：composer 超长 prompt 溢出修复（截图人眼判断 + 几何断言 + A/B 定罪）。
// 症状（用户截图）：图片节点选中后浮出的 composer，超长 prompt 整片下溢、盖住底栏（选择模型/优化/生成钮）。
// 根因：overflow-auto 曾挂在「无高度约束的内层静态块」上 → 该块按内容长到全高、overflow-auto 永不触发。
// 修：overflow-auto 挂到 flex-1 有界伸缩区（被卡片 maxHeight 卡住 → 有界 → 真滚动），底栏 shrink-0 恒贴底。
// DEV 模式（真 import /src 造节点 + 注入长 prompt）。用法: node tests/ux/composer-long-prompt.walk.mjs
import { _electron as electron } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/composer-long-prompt')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-composer-long')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-composer-long-projects')
for (const d of [userData, projectsDir]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const results = []
function check(name, ok, detail) { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.destroy(); resolve(true) })
      req.on('error', () => { if (Date.now() > deadline) reject(new Error('vite 未就绪')); else setTimeout(tick, 400) })
      req.setTimeout(1500, () => { req.destroy() })
    }
    tick()
  })
}

// 用户截图里那条角色身份板长 prompt，并显著加长（~1800 字），保证在任意卡宽（含 880px 上限）都溢出，
// 从而真正复现「文字太长」条件 → 能验证滚动是否生效、底栏是否被盖。
const LONG_PROMPT = '你是顶尖游戏/动漫概念美术大师，擅长详尽的角色身份板（character identity board）。【主体】严格基于参考图 image-1784087382625 进行 1:1 身份锁定。【任务】制作一张超高清 16:9 电影感艺术书式角色身份板。柔和米白色纹理纸质背景，带细微纤维与轻微阴影层次，整体呈现高端画册印刷质感。【构图】电影感艺术书式极度不对称布局，绝不用任何网格、表格或对称排列——英雄全身立绘作为视觉锚点略偏画面中心偏左，占据约 35% 空间，周围以干净宽敞的呼吸间距环绕排列各独立区块，区块之间用极细浅灰引导线轻柔连接，每块清晰分离、绝不堆叠、绝不裁切、绝不合并，整体留白充足、节奏优雅。【强制中文标注——缺任一项即失败】每个分组必须写清晰中文章节大标题（无衬线黑体，层级分明）；每个子图正下方写精确中文小标签，逐字如下：·「三视图」：正面 / 侧面 / 背面（三视图等比例排列于右上，全身、统一比例、统一姿态朝向）；·「表情研究」：平静 / 微笑 / 愤怒 / 惊讶（四个面部特写横排或弧形环绕，表情精准、面部结构完全一致）；·「服装细节」：材质 / 配饰 / 纹样特写排布，标注主料次料与金属件的质感差异。·「配色板」：主色 / 辅色 / 点缀色 三档色卡横排，每格下写十六进制色值与情绪关键词。·「道具组」：随身武器 / 载具 / 徽记，各带三视小图与尺寸比例尺。·「动态姿势」：待机 / 奔跑 / 战斗起手 / 胜利，四个火柴人剪影加简短动势说明。·「材质微距」：布料织纹、皮革磨损、金属反光三张放大特写，标注 PBR 粗糙度与金属度取值区间。·「光影设定」：主光方向、补光比例、轮廓光色温，附一张球形测光示意。·「比例尺」：与普通成年人并排的身高对照，标注头身比。整体版式必须保持电影书籍跨页的呼吸感，字体层级清晰、留白克制而奢侈，杜绝任何廉价拥挤感。'

// 跑「构建产物」（非 dev server）：避开 vite 按需编译 lazy chunk 的偶发失败（节点生成面板加载失败），
// 且更贴近用户实际运行的打包渲染层。需先 pnpm run build（dist 反映最新 src 改动）。
// NOMI_E2E=1：关 COOP/COEP 跨源隔离，否则卡死 Playwright CDP 握手 → launch timeout。
console.log('  … 启动构建产物（Electron）…')
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${userData}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_PROJECTS_DIR: projectsDir, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1', NOMI_ELECTRON_USER_DATA_DIR: userData, NOMI_SETTINGS_DIR: userData },
})
let win = await app.firstWindow()
const consoleErrors = []
win.on('console', (m) => { try { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)) } catch {} })
win.on('pageerror', (e) => { try { consoleErrors.push('PAGEERR: ' + String(e?.message || e).slice(0, 240)) } catch {} })
const getWin = () => {
  const live = app.windows().filter((w) => { try { return !w.isClosed() && !w.url().startsWith('devtools://') } catch { return false } })
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
async function dismiss() {
  await getWin().keyboard.press('Escape').catch(() => {})
  await getWin().waitForTimeout(150)
}

// 测量 composer：卡高、prompt 滚动区（overflow 模式 + scroll/client + 真能滚吗）、生成钮是否在卡内。
async function measure() {
  return getWin().locator('.generation-canvas-v2-node__composer-card').last().evaluate((card) => {
    const cardRect = card.getBoundingClientRect()
    const pm = card.querySelector('.ProseMirror')
    const scroller = pm ? pm.closest('.overflow-auto') : null
    const btn = card.querySelector('button[aria-label="生成素材"], button[aria-label="重新生成"]')
    const bRect = btn?.getBoundingClientRect()
    const cs = scroller ? getComputedStyle(scroller) : null
    let scrollableBy = null
    if (scroller) {
      const before = scroller.scrollTop
      scroller.scrollTop = 9999
      scrollableBy = scroller.scrollTop // 有界 overflow-auto → >0；无界/visible → 恒 0
      scroller.scrollTop = before
    }
    return {
      cardHeight: Math.round(cardRect.height),
      hasScroller: Boolean(scroller),
      overflowY: cs?.overflowY ?? null,
      scrollHeight: scroller?.scrollHeight ?? null,
      clientHeight: scroller?.clientHeight ?? null,
      scrolls: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null,
      scrollableBy,
      buttonInsideCard: bRect ? (bRect.bottom <= cardRect.bottom + 1 && bRect.right <= cardRect.right + 1) : null,
    }
  })
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().evaluate(() => localStorage.setItem('nomi-color-scheme', 'light')).catch(() => {})
  // 轮询等待应用真正 mount（dev 冷启动首次编译较慢；起始页出现按钮即就绪）。最多 60s。
  let ready = false
  for (let i = 0; i < 120; i++) {
    const n = await getWin().evaluate(() => document.querySelectorAll('button,[role="button"]').length).catch(() => 0)
    if (n > 0) { ready = true; break }
    if (i === 20 || i === 60) console.log(`  …等待应用 mount（已 ${i * 0.5}s，按钮数=${n}，错误 ${consoleErrors.length}）`)
    await getWin().waitForTimeout(500)
  }
  check('应用 mount（起始页就绪）', ready, `console错误 ${consoleErrors.length} 条`)
  if (consoleErrors.length) console.log('  控制台错误(前5):', JSON.stringify(consoleErrors.slice(0, 5), null, 2))
  await dismiss()

  // 诊断：起始页有哪些按钮（版本迭代文案会变）
  const startButtons = await getWin().evaluate(() => Array.from(document.querySelectorAll('button,[role="button"]')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40))
  console.log('  起始页按钮:', JSON.stringify(startButtons))
  await getWin().screenshot({ path: path.join(shotsDir, 'start.png') }).catch(() => {})
  // 多策略进项目：新建空白 → 新建项目 → 示例项目卡 → 任意项目卡
  const entryCandidates = ['新建空白项目', '新建项目', '新建', '示例', '空白项目']
  for (const label of entryCandidates) {
    if ((/projectId=([^&]+)/.exec(getWin().url()) || [])[1]) break
    await getWin().locator('button, [role="button"]', { hasText: label }).first().click({ timeout: 3000 }).catch(() => {})
    await dismiss(); await getWin().waitForTimeout(1000)
  }
  await getWin().waitForTimeout(600)
  check('新建并进入项目', Boolean((/projectId=([^&]+)/.exec(getWin().url()) || [])[1]), getWin().url())
  await getWin().locator('button, [role="button"], [role="tab"]', { hasText: /^生成$/ }).first().click({ timeout: 5000 }).catch(() => {})
  await getWin().waitForTimeout(900); await dismiss(); await getWin().waitForTimeout(400)

  // UI 驱动加图片节点（进真实渲染 store，避开 dev 动态 import 的双 store 实例问题；也更贴 R13）
  async function addNode(label) {
    await getWin().getByRole('button', { name: `添加${label}节点`, exact: false }).first().click({ timeout: 3000 }).catch(async () => {
      await getWin().getByRole('button', { name: '添加节点菜单', exact: false }).first().click({ timeout: 3000 }).catch(() => {})
      await getWin().waitForTimeout(300)
      await getWin().getByRole('button', { name: `添加${label}节点`, exact: false }).first().click({ timeout: 3000 }).catch(() => {})
    })
    await getWin().waitForTimeout(1400)
  }
  await addNode('图片')
  const nodeCount = await getWin().evaluate(() => document.querySelectorAll('.react-flow__node').length)
  console.log('  画布节点数:', nodeCount, 'url:', getWin().url())
  await getWin().screenshot({ path: path.join(shotsDir, 'after-add.png') }).catch(() => {})

  const composer = getWin().locator('.generation-canvas-v2-node__composer').last()
  // 若未自动选中→点节点卡选中，浮出 composer
  if (!(await composer.isVisible().catch(() => false))) {
    await getWin().locator('.react-flow__node').last().click({ timeout: 3000 }).catch(() => {})
    await getWin().waitForTimeout(600)
  }
  await composer.waitFor({ state: 'visible', timeout: 10000 })
  check('图片节点 composer 浮出', (await composer.count()) > 0)

  // 把超长 prompt 输入真实 PromptEditor（点进 → 一次性 insertText）
  const editor = composer.locator('.ProseMirror').first()
  await editor.click({ timeout: 4000 })
  await getWin().waitForTimeout(200)
  await getWin().keyboard.insertText(LONG_PROMPT)
  await getWin().waitForTimeout(700)
  check('长 prompt 已输入编辑器', ((await editor.textContent().catch(() => '')) || '').length > 200)

  // ── AFTER（已修）── 先确保滚到顶，截图展示 composer 自然态（prompt 从头、底栏干净）
  await getWin().locator('.generation-canvas-v2-node__composer-card').last().evaluate((card) => {
    const pm = card.querySelector('.ProseMirror'); const s = pm && pm.closest('.overflow-auto'); if (s) s.scrollTop = 0
  })
  const after = await measure()
  await composer.screenshot({ path: path.join(shotsDir, 'after-fixed.png') })
  await getWin().screenshot({ path: path.join(shotsDir, 'after-fixed-full.png') }).catch(() => {})
  check('卡高被 maxHeight 卡住(≤ 402)', after.cardHeight != null && after.cardHeight <= 402, `cardHeight=${after.cardHeight}`)
  check('prompt 内容确实超长(scrollHeight>clientHeight)', after.scrolls === true, `${after.scrollHeight}>${after.clientHeight}`)
  check('prompt 区 overflow-y=auto(滚动模式已启用)', after.overflowY === 'auto', String(after.overflowY))
  check('prompt 区真能滚动(scrollTop 可 >0 = 有界剪裁)', typeof after.scrollableBy === 'number' && after.scrollableBy > 0, `scrollableBy=${after.scrollableBy}`)
  check('生成钮在卡内(底栏未被顶出/裁掉)', after.buttonInsideCard === true)

  // ── BEFORE（A/B 定罪）── 把 overflow 改回 visible 复现「不剪裁 → 内容下溢盖底栏」
  await getWin().locator('.generation-canvas-v2-node__composer-card').last().evaluate((card) => {
    const pm = card.querySelector('.ProseMirror'); const scroller = pm && pm.closest('.overflow-auto')
    if (scroller) scroller.style.overflow = 'visible'
  })
  await getWin().waitForTimeout(400)
  await composer.screenshot({ path: path.join(shotsDir, 'before-broken.png') })
  await getWin().screenshot({ path: path.join(shotsDir, 'before-broken-full.png') }).catch(() => {})
  const brokenScrollable = await getWin().locator('.generation-canvas-v2-node__composer-card').last().evaluate((card) => {
    const pm = card.querySelector('.ProseMirror'); const scroller = pm && pm.closest('.overflow-auto')
    if (!scroller) return null
    const before = scroller.scrollTop; scroller.scrollTop = 9999; const v = scroller.scrollTop; scroller.scrollTop = before
    return v
  })
  check('A/B 定罪：overflow:visible 时不可滚动(scrollTop 恒 0 → 内容只能下溢盖底栏)', brokenScrollable === 0, `scrollableBy=${brokenScrollable}`)

  console.log('\n' + JSON.stringify({ after, brokenScrollable }, null, 2))
} catch (error) {
  console.error(`VERIFY ERROR: ${error?.stack || error?.message || error}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}

const failed = results.filter((r) => !r.ok)
if (failed.length) { console.error(`\n✗ ${failed.length}/${results.length} 项未过`); process.exitCode = 1 }
else console.log(`\n✓ 全部 ${results.length} 项通过`)
