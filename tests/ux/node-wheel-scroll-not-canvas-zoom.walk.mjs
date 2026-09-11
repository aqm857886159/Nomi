// R13 走查：节点内可滚动区域不再把滚轮交给画布（整类修复的真机验证）。
//
// 症状（用户原话）：「鼠标在画布上滑动…提示词框…画布会跑」——在节点的提示词框里滚轮，
// 画布跟着缩放/平移，而不是提示词框自己滚动。
//
// 根因（见 src/workbench/generationCanvas/nodes/nodeScrollRegionClassName.ts 头注释）：
// d3-zoom 的 wheel 监听器原生挂在 `.react-flow__pane`（真实 DOM 祖先），比 React 合成事件
// 分发更早处理；节点内 onWheel 里 `event.stopPropagation()` 拦不住它——生产代码里确实有过
// 这种不生效的手法（ProductionShotPlaceholder.tsx / NodeErrorReport.tsx / ClipNodeTimeline.tsx
// 修复前都是这样写的）。真正管用的是 React Flow 自己认的 `nowheel`（默认 noWheelClassName）：
// 它在事件源头 `closest('.nowheel')` 短路，不依赖冒泡顺序。
//
// 这条走查验两件事：① 提示词框里滚轮，画布 viewport 变换（transform matrix）严格不变；
// ② 同一次滚轮手势，提示词框自己的 scrollTop 真的变了（不是「什么都没发生」的假阴性）。
// 用真实 Electron 构建产物 + 真实鼠标滚轮，不灌 store、不改夹具。
//
// 用法: pnpm run build && node tests/ux/node-wheel-scroll-not-canvas-zoom.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'

const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'docs/plan/2026-09-11-triage-board-evidence')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-node-wheel-walk')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-node-wheel-walk-projects')
for (const dir of [userData, projectsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 用户截图里那条超长 prompt 的同款手法（tests/ux/composer-long-prompt.walk.mjs 已验证过这个
// 长度在任意卡宽下都会溢出、触发内部滚动），这里复用同一段文案，不重造一份。
const LONG_PROMPT = '你是顶尖游戏/动漫概念美术大师，擅长详尽的角色身份板（character identity board）。【主体】严格基于参考图 image-1784087382625 进行 1:1 身份锁定。【任务】制作一张超高清 16:9 电影感艺术书式角色身份板。柔和米白色纹理纸质背景，带细微纤维与轻微阴影层次，整体呈现高端画册印刷质感。【构图】电影感艺术书式极度不对称布局，绝不用任何网格、表格或对称排列——英雄全身立绘作为视觉锚点略偏画面中心偏左，占据约 35% 空间，周围以干净宽敞的呼吸间距环绕排列各独立区块，区块之间用极细浅灰引导线轻柔连接，每块清晰分离、绝不堆叠、绝不裁切、绝不合并，整体留白充足、节奏优雅。【强制中文标注——缺任一项即失败】每个分组必须写清晰中文章节大标题（无衬线黑体，层级分明）；每个子图正下方写精确中文小标签，逐字如下：·「三视图」：正面 / 侧面 / 背面（三视图等比例排列于右上，全身、统一比例、统一姿态朝向）；·「表情研究」：平静 / 微笑 / 愤怒 / 惊讶（四个面部特写横排或弧形环绕，表情精准、面部结构完全一致）；·「服装细节」：材质 / 配饰 / 纹样特写排布，标注主料次料与金属件的质感差异。·「配色板」：主色 / 辅色 / 点缀色 三档色卡横排，每格下写十六进制色值与情绪关键词。·「道具组」：随身武器 / 载具 / 徽记，各带三视小图与尺寸比例尺。·「动态姿势」：待机 / 奔跑 / 战斗起手 / 胜利，四个火柴人剪影加简短动势说明。·「材质微距」：布料织纹、皮革磨损、金属反光三张放大特写，标注 PBR 粗糙度与金属度取值区间。·「光影设定」：主光方向、补光比例、轮廓光色温，附一张球形测光示意。·「比例尺」：与普通成年人并排的身高对照，标注头身比。整体版式必须保持电影书籍跨页的呼吸感，字体层级清晰、留白克制而奢侈，杜绝任何廉价拥挤感。'

console.log('  … 启动构建产物（Electron）…')
const { app, win: _initialWin } = await launchNomiApp({
  name: 'node-wheel-scroll-not-canvas-zoom',
  userDataDir: userData,
  settingsDir: userData,
  projectsDir,
  settleMs: 0,
})
let win = _initialWin
const consoleErrors = []
win.on('console', (m) => { try { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)) } catch { /* noop */ } })
const getWin = () => {
  const live = app.windows().filter((w) => { try { return !w.isClosed() && !w.url().startsWith('devtools://') } catch { return false } })
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
async function dismiss() {
  await getWin().keyboard.press('Escape').catch(() => {})
  await getWin().waitForTimeout(150)
}

// 画布变换真相：直接读变换层的 transform（同 tests/ux/canvas-drag-pan-gestures.walk.mjs 的
// readTransform 手法）。`.generation-canvas-v2__canvas` 是运行时贴在真实
// `.react-flow__viewport` 上的别名 class（见 useGenerationCanvasReactFlowEffects.ts），
// 不是另一层——读它就是读 React Flow 自己的变换矩阵，唯一真相源。
async function readTransform() {
  return getWin().evaluate(() => {
    const layer = document.querySelector('.generation-canvas-v2__canvas')
    if (!layer) return null
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
  })
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().evaluate(() => localStorage.setItem('nomi-color-scheme', 'light')).catch(() => {})

  let ready = false
  for (let i = 0; i < 120; i++) {
    const n = await getWin().evaluate(() => document.querySelectorAll('button,[role="button"]').length).catch(() => 0)
    if (n > 0) { ready = true; break }
    await getWin().waitForTimeout(500)
  }
  check('应用 mount（起始页就绪）', ready, `console 错误 ${consoleErrors.length} 条`)
  await dismiss()

  const entryCandidates = ['新建空白项目', '新建项目', '新建', '示例', '空白项目']
  for (const label of entryCandidates) {
    if ((/projectId=([^&]+)/.exec(getWin().url()) || [])[1]) break
    await getWin().locator('button, [role="button"]', { hasText: label }).first().click({ timeout: 3000 }).catch(() => {})
    await dismiss()
    await getWin().waitForTimeout(1000)
  }
  await getWin().waitForTimeout(600)
  check('新建并进入项目', Boolean((/projectId=([^&]+)/.exec(getWin().url()) || [])[1]), getWin().url())

  await getWin().locator('button, [role="button"], [role="tab"]', { hasText: /^生成$/ }).first().click({ timeout: DEFAULT_TIMEOUT_MS }).catch(() => {})
  await getWin().waitForTimeout(900)
  await dismiss()
  await getWin().locator('.react-flow').first().waitFor()
  check('生成画布就绪（React Flow 已挂载）', true)

  async function addNode(label) {
    await getWin().getByRole('button', { name: `添加${label}节点`, exact: false }).first().click({ timeout: 3000 }).catch(async () => {
      await getWin().getByRole('button', { name: '添加节点菜单', exact: false }).first().click({ timeout: 3000 }).catch(() => {})
      await getWin().waitForTimeout(300)
      await getWin().getByRole('button', { name: `添加${label}节点`, exact: false }).first().click({ timeout: 3000 }).catch(() => {})
    })
    await getWin().waitForTimeout(1400)
  }
  await addNode('图片')
  const nodeCount = await getWin().locator('[data-node-id]').count()
  check('画布上真的加出了节点', nodeCount > 0, `[data-node-id] 命中 ${nodeCount} 个`)

  const composer = getWin().locator('.generation-canvas-v2-node__composer').last()
  if (!(await composer.isVisible().catch(() => false))) {
    await getWin().locator('[data-node-id]').last().click({ timeout: 3000 }).catch(() => {})
    await getWin().waitForTimeout(600)
  }
  await composer.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS })
  check('节点选中后提示词浮框出现', true)

  // 用真实鼠标点进真实 PromptEditor，一次性插入超长 prompt（撑出内部滚动条件）。
  const editor = composer.locator('.ProseMirror').first()
  await editor.click({ timeout: 4000 })
  await getWin().waitForTimeout(200)
  await getWin().keyboard.insertText(LONG_PROMPT)
  await getWin().waitForTimeout(700)
  check('长 prompt 已输入编辑器', ((await editor.textContent().catch(() => '')) || '').length > 200)

  // 落地锚点就是本次修复的目标元素：NodeGenerationComposer.tsx 里带 data-node-composer-prompt
  // 的滚动容器（用户报的「提示词框」）。
  const promptScroller = getWin().locator('[data-node-composer-prompt]').first()
  await promptScroller.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS })
  await promptScroller.evaluate((element) => { element.scrollTop = 0 })

  const scrollableBy = await promptScroller.evaluate((element) => {
    const before = element.scrollTop
    element.scrollTop = 9999
    const after = element.scrollTop
    element.scrollTop = before
    return after
  })
  check('提示词框内容确实超出可视高度（有滚动空间）', scrollableBy > 0, `scrollableBy=${scrollableBy}`)

  await screenshotSettled(composer, { path: path.join(shotsDir, 'node-wheel-before-scroll.png') })

  const beforeTransform = await readTransform()
  const beforeScrollTop = await promptScroller.evaluate((element) => element.scrollTop)

  // 真实鼠标滚轮：先把光标悬停在提示词框内部，再原生 wheel（不是 dispatchEvent 模拟）。
  const scrollerBox = await promptScroller.boundingBox()
  if (!scrollerBox) throw new Error('提示词框不可见，测不出滚轮落在哪')
  await getWin().mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2)
  await getWin().mouse.wheel(0, 240)
  await getWin().waitForTimeout(250)

  const afterTransform = await readTransform()
  const afterScrollTop = await promptScroller.evaluate((element) => element.scrollTop)

  await screenshotSettled(composer, { path: path.join(shotsDir, 'node-wheel-after-scroll.png') })
  await getWin().screenshot({ path: path.join(shotsDir, 'node-wheel-after-scroll-full.png') }).catch(() => {})

  console.log('  变换前:', JSON.stringify(beforeTransform), ' 变换后:', JSON.stringify(afterTransform))
  console.log('  scrollTop 前:', beforeScrollTop, ' scrollTop 后:', afterScrollTop)

  check(
    '在提示词框里滚轮，画布 viewport 变换严格不变（没被当成缩放/平移吃掉）',
    Boolean(beforeTransform && afterTransform)
      && beforeTransform.x === afterTransform.x
      && beforeTransform.y === afterTransform.y
      && beforeTransform.zoom === afterTransform.zoom,
    `前 ${JSON.stringify(beforeTransform)} → 后 ${JSON.stringify(afterTransform)}`,
  )
  check(
    '同一次滚轮手势，提示词框自己真的滚动了（不是什么都没发生的假阴性）',
    afterScrollTop > beforeScrollTop,
    `${beforeScrollTop} → ${afterScrollTop}`,
  )

  // 对照组：画布空白区滚轮必须仍能缩放——证明修复没有连坐到「整个画布都不响应滚轮」。
  const stage = getWin().locator('.generation-canvas-v2__stage').first()
  const stageBox = await stage.boundingBox()
  if (stageBox) {
    await getWin().mouse.move(stageBox.x + stageBox.width - 48, stageBox.y + 48)
    const blankBefore = await readTransform()
    await getWin().mouse.wheel(0, 120)
    await getWin().waitForTimeout(250)
    const blankAfter = await readTransform()
    check(
      '对照组：画布空白区滚轮仍能正常缩放（修复没有连坐关掉整块画布的滚轮）',
      Boolean(blankBefore && blankAfter) && blankBefore.zoom !== blankAfter.zoom,
      `前 zoom=${blankBefore?.zoom} → 后 zoom=${blankAfter?.zoom}`,
    )
  }
} catch (error) {
  console.error(`WALK ERROR: ${error?.stack || error?.message || error}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}

const failed = results.filter((r) => !r.ok)
if (failed.length) {
  console.error(`\n✗ ${failed.length}/${results.length} 项未过`)
  process.exitCode = 1
} else {
  console.log(`\n✓ 全部 ${results.length} 项通过`)
}
