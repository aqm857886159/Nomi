// R13 走查：节点生成浮框「钉在节点正下方、定宽、被挡就挡、不漂移」+ 底栏不被裁 + ×N 通用化。
//
// 2026-09-25 用户拍板改了放置规则：浮框不再 clamp 进视口、不再翻到上方、不再给左栏/底部停靠区让位，
// 宽度恒 560（屏幕像素）。原话：「有时候位置不在下面而是在节点中间」「遮挡就遮挡了，保持位置」。
// 所以这里的判据从「在视口内」换成「顶边 = 节点底边 + 14 × 缩放、中线 = 节点中线、宽 = 560」，
// 并在窄画布下反过来断：浮框**不**被收窄、**不**被推回视口。
//
// 症状（2026-09-10 用户真机反馈 #10 / #11）：
//   · 点击节点后浮出的 composer 来回漂移、不在节点正下方、有时被截断；
//   · 「一次生成几个」只有图片/视频节点有，声音节点没有。
// 根因：placement 之前把全场元素当障碍物做空矩形搜索，任何布局变化都重定位（漂移）。
// 修：`nodes/anchoredPlacement.ts` —— 位置只是 (stage, anchor, 自然尺寸) 的函数。
//
// 底栏形态是 v1.1（见 docs/design/2026-09-10-node-composer-bar-v1.md）：一行三段
// `[模型 ▾][变体 ▾][16:9 · 5s ▾] │ [🎥][✦][✨] │ [×N ▾] ……… [↑]`，
// 参数区是**摘要 pill**（读得出当前配置、点开是统一参数面板）、锁回节点浮条、提示词区右端不留控件。
// 同日 02:10 拍板的「逐参数下拉 chip」于 04:30 被用户收回——**只给付费确认卡**，画布节点保持原样；
// 那个摆法的回归钉在设计实验室 `composer-bar-chips-mode` 那一格上，不在这里。
// 这里把那几条承诺连同原有的「单行」一起当**真机回归**守着：设计实验室那一屏证的是同一份代码
// 在受控夹具下的样子，这一条证的是它在打包 Electron 里被真实鼠标点出来之后还是那个样子。
//
// 全程 UI 驱动（建节点、选节点、拖画布都是真实鼠标动作），不灌 store、不注入夹具。
// 用法: node tests/ux/node-composer-placement.walk.mjs（需先 pnpm run build）
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { expect, screenshotSettled } from './_assert.mjs'

const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/node-composer-placement')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-composer-placement')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-composer-placement-projects')
for (const dir of [userData, projectsDir]) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }) }

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const { app, win: initialWin } = await launchNomiApp({
  name: 'node-composer-placement',
  userDataDir: userData,
  settingsDir: userData,
  projectsDir,
  settleMs: 0,
})
let win = initialWin
const consoleErrors = []
win.on('console', (message) => { try { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) } catch { /* 窗口已关 */ } })
const getWin = () => {
  const live = app.windows().filter((candidate) => { try { return !candidate.isClosed() && !candidate.url().startsWith('devtools://') } catch { return false } })
  win = live.find((candidate) => { try { return /projectId=/.test(candidate.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
const dismiss = async () => { await getWin().keyboard.press('Escape').catch(() => {}); await getWin().waitForTimeout(150) }

/**
 * 一次量清「舞台 / 节点 / 浮框卡 / 底栏每个控件 / 摘要 pill」的真实几何。
 * evaluate 只读不写；所有状态改变都由上面的真实鼠标键盘动作造成。
 */
async function measure() {
  return getWin().evaluate(() => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    // 取**最后挂上**的那个浮框，和上面几处 locator 的 `.last()` 同一个口径。
    // 用 querySelector 取第一个曾经是对的（同时只有一个浮框），但一旦某一刻同时挂着两个
    // （刚建的新节点 + 上一个还没退场的），量到的就是上一个节点的底栏——2026-09-11 实测：
    // 声音节点那一段量出了视频节点的三颗 chip，看起来像「声音节点也长了比例/时长」。
    const anchor = [...document.querySelectorAll('.generation-canvas-v2-node__composer')].pop()
    // card 从 anchor 里找，不再全局找：全局那句会把两个浮框混着取。
    const card = anchor?.querySelector('.generation-canvas-v2-node__composer-card')
    const nodeEl = anchor?.parentElement
    const viewportEl = document.querySelector('.react-flow__viewport')
    if (!stage || !anchor || !card || !nodeEl) return null
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    const hits = (element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(target && (element.contains(target) || target.contains(element)))
    }
    const footer = card.querySelector('[data-node-composer-footer]')
    const cardRect = card.getBoundingClientRect()
    // v1.1 底栏：段序、B 簇尺寸、提示词区有没有控件、锁在哪，全部量真实盒子，不看 class 名。
    const barSegments = footer ? [...footer.querySelectorAll('[data-bar-segment]')] : []
    const clusterIcons = footer ? [...footer.querySelectorAll('[data-prompt-tool]')] : []
    const nonClusterHeights = footer
      ? [...footer.querySelectorAll('button, [role="combobox"]')]
        .filter((element) => !element.closest('[data-prompt-tool-cluster="true"]'))
        .map((element) => element.getBoundingClientRect().height)
        .filter((height) => height > 0)
      : []
    const controls = footer
      ? [...footer.querySelectorAll('button, [role="button"], select')].filter((element) => {
        const style = getComputedStyle(element)
        return style.visibility !== 'hidden' && style.display !== 'none'
      })
      : []
    return {
      // 拖动期间浮框刻意不重排（也刻意 invisible），所以量之前必须等这面旗降下来，
      // 否则量到的是「拖到一半」的中间态，看起来和真 bug 一模一样。
      dragging: stage.getAttribute('data-dragging') === 'true',
      stage: box(stage),
      node: box(nodeEl),
      card: box(card),
      // 画布缩放：读 React Flow 视口自己的 transform（DOMMatrix.a），不读 store——量的是用户眼前那一帧。
      zoom: viewportEl ? new DOMMatrixReadOnly(getComputedStyle(viewportEl).transform).a : 1,
      // 「几行」按**竖直中心**聚类算，不能按 top：`items-center` 的同一行里控件高矮不同，
      // top 天生各不相同，按 top 数会把一条正常单行数成 4 行（第一版就是这么假红的）。
      footerRows: footer ? controls.reduce((rows, element) => {
        const rect = element.getBoundingClientRect()
        const centre = rect.top + rect.height / 2
        if (!rows.some((existing) => Math.abs(existing - centre) <= 4)) rows.push(centre)
        return rows
      }, []).length : 0,
      controlCount: controls.length,
      controlsInsideCard: controls.every((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1
          && rect.top >= cardRect.top - 1 && rect.bottom <= cardRect.bottom + 1
      }),
      controlsHittable: controls.every(hits),
      variantControl: Boolean(card.querySelector('[aria-label="每次生成几个"]')),
      barSegments: barSegments.map((element) => element.getAttribute('data-bar-segment')),
      clusterTools: clusterIcons.map((element) => element.getAttribute('data-prompt-tool')),
      clusterTallest: clusterIcons.length ? Math.max(...clusterIcons.map((element) => element.getBoundingClientRect().height)) : 0,
      barTallestOutsideCluster: nonClusterHeights.length ? Math.max(...nonClusterHeights) : 0,
      // B 簇必须是纯 icon：渲出任何文字就是「缩小一号」只做了一半。
      clusterText: (footer?.querySelector('[data-prompt-tool-cluster="true"]')?.textContent || '').trim(),
      // 提示词区右端一件控件都不留（v1.1 的第一条主张）。
      promptControlCount: card.querySelectorAll('[data-node-composer-prompt] button, [data-node-composer-prompt] [data-prompt-tool]').length,
      // 锁：浮框里一把都不该有，节点浮条上必须有且只有一把。
      lockInComposer: card.querySelectorAll('[data-node-lock]').length,
      lockOnToolbar: document.querySelectorAll('[data-node-floating-toolbar="true"] [data-node-lock]').length,
      // 参数区是摘要 pill：那串摘要本身挂在 pill 上，读它比读截图可靠，
      // 也不依赖中文 aria-label（换个语言就断了）。pill 不在时是 null（区别于「在但是空串」）。
      parameterSummary: card.querySelector('[data-parameter-summary]')?.getAttribute('data-parameter-summary') ?? null,
      summaryHittable: (() => {
        const pill = card.querySelector('[data-parameter-summary]')
        return pill ? hits(pill) : false
      })(),
      // 画布节点**不该**长出逐参数 chip（那是付费确认卡的摆法，用户 2026-09-11 04:30 收回）。
      // 数出来才断言得了「一颗都没有」。
      parameterChipCount: card.querySelectorAll('[data-parameter-chip]').length,
      // 参数面板里的参数组（面板 portal 到 body，所以从 document 找，不从卡里找）。
      panelControlKeys: [...document.querySelectorAll('[data-agent-parameter-panel="true"] [data-agent-parameter-control]')]
        .map((element) => element.getAttribute('data-agent-parameter-control')),
      // 面板里**一个下拉都不许有**（2026-09-11 13:00 用户拍板：选项全摊开）。
      // `aria-haspopup="listbox"` 是 Mantine Combobox 给触发器加的属性，所有 NomiSelect 都带它——
      // 按属性数，不按组件名数：换个下拉实现照样拦得住。
      panelSelects: document.querySelectorAll('[data-agent-parameter-panel="true"] [aria-haspopup="listbox"]').length,
      // 摊开的可点项数（分段 chip 与列表项都是 role=radio）。它是上面那句「没有下拉」的基线：
      // 面板整个空着时「没有下拉」也成立，而那种绿和真绿在观测上一模一样。
      panelOptionCount: document.querySelectorAll('[data-agent-parameter-panel="true"] [role="radio"]').length,
      // 单参数直出：点 pill 出来的就是那一个参数的选项列表，没有面板壳。null = 走的是面板。
      panelSolo: document.querySelector('[data-agent-parameter-panel="true"] [data-parameter-solo]')
        ?.getAttribute('data-parameter-solo') ?? null,
      panelOpen: document.querySelectorAll('[data-agent-parameter-panel="true"]').length,
    }
  })
}

/**
 * 浮框刚挂上的那几帧里，底栏还可能没渲染完（浮框按节点懒加载，见 LazyNodeGenerationComposer；
 * 画布拖动期间整块 `invisible`）。此时锚点的 getBoundingClientRect 照样有值、Playwright 也认它
 * 「visible」，但量到的是「0 个控件 / 0 行」，和「底栏整个没渲染」在观测上一模一样。
 * （2026-09-25 前这里等的是旧视口放置层算出可用区前的 `visibility: hidden`；
 * 那层已删，位置改由 composerCanvasPlacement 同步算出，不再有「未定位」这一态。）
 * 所以量之前先等它真的挂好：条件是「底栏里有可见控件」，不是等一个墙钟（R18）。
 */
async function settleComposer(label) {
  await expect.poll(async () => (await measure())?.controlCount ?? 0, {
    message: `${label}浮框底栏必须完成定位（底栏里量得到可见控件）`,
  }).toBeGreaterThan(0)
}

/**
 * v1.1 底栏那几条承诺，逐条量。**每条都先证基线再断言不在**——「提示词区没有控件」
 * 在整个提示词区没渲染时也照样绿，那种绿和真绿在观测上一模一样。
 */
function checkComposerBarV1(label, m) {
  const wantedSegments = ['model-params', 'prompt-tools', 'variants', 'generate']
  check(
    `${label} 底栏段序 = 模型/参数 → B 簇 → ×N → 生成`,
    m.barSegments.join(' → ') === wantedSegments.join(' → '),
    `实际「${m.barSegments.join(' → ')}」`,
  )
  check(
    `${label} B 簇是缩小一号的纯 icon（≤28px 且严格小于底栏最高控件）`,
    m.clusterTools.length > 0 && m.clusterTallest > 0 && m.clusterTallest <= 28
      && m.barTallestOutsideCluster > 0 && m.clusterTallest < m.barTallestOutsideCluster,
    `簇 ${m.clusterTools.join('/')} 高 ${Math.round(m.clusterTallest)}px，底栏其它控件最高 ${Math.round(m.barTallestOutsideCluster)}px`,
  )
  check(`${label} B 簇不渲染任何文字`, m.clusterText === '', `实际「${m.clusterText}」`)
  // 基线：簇真的渲染出来了（下面那条「提示词区没有控件」才不是句废话）。
  check(
    `${label} 提示词区右端一件控件都没有（基线：B 簇确实在底栏里）`,
    m.clusterTools.length > 0 && m.promptControlCount === 0,
    `簇 ${m.clusterTools.length} 颗 / 提示词区 ${m.promptControlCount} 个控件`,
  )
  check(
    `${label} 锁在节点浮条上、浮框里一把都没有（基线：浮条上确实有一把）`,
    m.lockOnToolbar === 1 && m.lockInComposer === 0,
    `浮条 ${m.lockOnToolbar} 把 / 浮框 ${m.lockInComposer} 把`,
  )
  // 参数区是**一颗读得出当前配置、点得到的摘要 pill**（v1.1；「点开真能改」由 ⑤.6 在视频节点上
  // 真点一次，不在这里靠肉眼）。
  check(
    `${label} 底栏参数区是一颗读得出当前配置的摘要 pill，且点得到`,
    Boolean(m.parameterSummary && m.parameterSummary.trim()) && m.summaryHittable,
    `pill「${m.parameterSummary}」hittable=${m.summaryHittable}`,
  )
  // 画布节点**不该**长出逐参数 chip。这条不是废话：基线就是上面那句「pill 读到了」——
  // 参数区整个没渲染时上一条会先红，所以「一颗 chip 都没有」在这里是有观测基线的。
  check(
    `${label} 画布节点不摆逐参数 chip（那是付费确认卡的摆法，用户 09-11 04:30 收回）`,
    m.parameterChipCount === 0,
    `数到 ${m.parameterChipCount} 颗`,
  )
}

// 「点开面板真能改一个值」这条路整场必须真的走到过：模型碰巧一个分段组都没有（全是搜索下拉 /
// 输入框）时，上面那段会**静静跳过**，那种绿和真绿在观测上一模一样（走查里最贵的一类假绿）。
let sawPanelPick = false

// 浮框钉在节点正下方的唯一判据（与 composerCanvasPlacement 同一个不变量，这里在真机屏幕坐标里验）：
// 顶边 = 节点底边 + 14 × 缩放；中线 = 节点中线；屏幕宽 = 560。不看视口、不看停靠区——那些不再是输入。
const COMPOSER_WIDTH = 560
const COMPOSER_GAP = 14
function assertPinned(label, m) {
  const expectedTop = m.node.bottom + COMPOSER_GAP * m.zoom
  const centreDelta = (m.card.left + m.card.right) / 2 - (m.node.left + m.node.right) / 2
  check(`${label}：浮框顶边 = 节点底边 + 14×缩放（在节点下面，不压在节点身上）`, Math.abs(m.card.top - expectedTop) <= 2,
    `card.top=${Math.round(m.card.top)} 期望 ${Math.round(expectedTop)}（node.bottom=${Math.round(m.node.bottom)} zoom=${m.zoom.toFixed(2)}）`)
  check(`${label}：浮框中线 = 节点中线`, Math.abs(centreDelta) <= 2, `偏 ${centreDelta.toFixed(1)}px`)
  check(`${label}：浮框宽恒 560`, Math.abs(m.card.width - COMPOSER_WIDTH) <= 1, `实测 ${m.card.width.toFixed(1)}`)
}

/**
 * 首启引导/弹层清场。锚点抄自已跑通的 tests/ux/canvas-control-clarity.walk.mjs：
 * 起始页停在 #/studio 而不进项目，就是引导层还压着没被点掉。
 */
// 等待一律不写死 ≥5s 的超时：那是私有墙钟，`check:test-waits`（R18）会拦，
// 单跑绿、并行翻红也正是它拦的那一族。用 Playwright 自己的默认超时。
async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().evaluate(() => localStorage.setItem('nomi-color-scheme', 'light')).catch(() => {})
  let mounted = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const buttons = await getWin().evaluate(() => document.querySelectorAll('button,[role="button"]').length).catch(() => 0)
    if (buttons > 0) { mounted = true; break }
    await getWin().waitForTimeout(500)
  }
  check('应用 mount（起始页就绪）', mounted, `console 错误 ${consoleErrors.length} 条`)
  await dismissFirstRun()

  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor()
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  check('新建并进入项目', /projectId=/.test(getWin().url()), getWin().url())

  // 进「生成」工作区并等真实 React Flow 画布挂载（不是等超时）。
  const generationTab = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generationTab.waitFor()
  await generationTab.click()
  const toolbar = getWin().locator('.generation-canvas-v2-toolbar').first()
  await toolbar.waitFor()
  await getWin().locator('.react-flow').first().waitFor()
  check('生成画布就绪（React Flow 已挂载）', true)

  /** 用左侧栏真按钮建节点——常驻的直接点，收进「更多」的先展开。 */
  async function addNode(kind, label) {
    const before = await getWin().locator('[data-node-id]').count()
    const resident = toolbar.locator(`[data-node-kind="${kind}"]`).first()
    if (await resident.isVisible().catch(() => false)) {
      await resident.click({ timeout: 4000 })
    } else {
      await toolbar.locator('[data-canvas-add-more="true"]').first().click({ timeout: 4000 })
      await getWin().locator(`.generation-canvas-v2-toolbar__more-menu [data-node-kind="${kind}"]`).first().click({ timeout: 4000 })
    }
    await expect.poll(() => getWin().locator('[data-node-id]').count(), { message: `添加${label}节点后画布节点数必须增加` }).toBeGreaterThan(before)
  }

  await addNode('video', '视频')
  const composer = getWin().locator('.generation-canvas-v2-node__composer').last()
  if (!(await composer.isVisible().catch(() => false))) {
    await getWin().locator('[data-node-id]').last().click({ timeout: 3000 }).catch(() => {})
  }
  await composer.waitFor({ state: 'visible' })
  check('视频节点选中后浮框出现', true)

  await screenshotSettled(getWin(), { path: path.join(shotsDir, '01-video-node-composer.png') })
  const first = await measure()
  if (!first) throw new Error('量不到浮框几何：舞台 / 节点 / 卡片有一个没找到')
  console.log('  几何:', JSON.stringify(first, null, 2))

  // ① 钉在节点正下方：顶边 = 节点底边 + 14×缩放，中线 = 节点中线，宽 = 560。三条同一个判据函数。
  assertPinned('视频节点', first)
  // ③ 底栏所有控件都在卡内并且真的点得到（不是被 overflow-hidden 裁在外面）。
  check('底栏控件全部在卡内', first.controlsInsideCard, `控件 ${first.controlCount} 个，${first.footerRows} 行`)
  check('底栏控件全部可命中（没有被别的东西盖住）', first.controlsHittable)
  // ④ 底栏仍是单行：用户拍板「单行没有问题」，这条守住它不被后续改动挤成两行。
  check('底栏仍是单行（控件竖直中心只有一条）', first.footerRows === 1, `${first.footerRows} 行 / ${first.controlCount} 个控件`)
  // ⑤ 「一次生成几个」在视频节点上可见。
  check('视频节点有「每次生成几个」控件', first.variantControl)
  // ⑤.5 v1.1 底栏形态（段序 / B 簇缩小一号 / 提示词区清空 / 锁归位）。
  checkComposerBarV1('视频节点', first)
  check('视频节点 B 簇两颗：效果 → 优化', first.clusterTools.join(' → ') === 'effects → optimize',
    `实际「${first.clusterTools.join(' → ')}」`)

  // ⑤.6 摘要 pill 的那两句主张：**读得出** + **点得开真能改**（v1.1 形态；同日 02:10 的逐参数
  // chip 已于 04:30 被用户收回，只给付费确认卡）。像真人一样点 pill → 面板打开 →
  // 在面板里挑一个别的档 → 那一组的选中态真的挪过去了（面板是受控的，读的就是节点 meta，
  // 所以选中态挪过去 = 值写进了 store）。不灌 store、不注入夹具，全程鼠标。
  const pill = getWin().locator('[data-parameter-summary]').last()
  const summaryBefore = await pill.getAttribute('data-parameter-summary')
  check('视频节点底栏是一颗读得出当前配置的摘要 pill', Boolean(summaryBefore && summaryBefore.trim()),
    `pill「${summaryBefore}」`)
  await pill.click()
  const paramPanel = getWin().locator('[data-agent-parameter-panel="true"]').last()
  await paramPanel.waitFor({ state: 'visible' })
  const withPanel = await measure()
  if (!withPanel) throw new Error('打开参数面板后量不到浮框几何')
  check('点开 pill 弹的是统一参数面板，里面确实有参数组（基线：不是一块点开空白的面板）',
    withPanel.panelControlKeys.length > 0, `面板里 ${withPanel.panelControlKeys.join(' / ') || '空'}`)
  // v1.2（2026-09-11 13:00 用户真机拍板）：**面板里一个下拉都没有**——枚举参数的选项直接摊成
  // 可点项（一排/一列 chip，>8 项才是默认就展开的搜索列表）。改一个值因此是「pill → 点那一项」两步，
  // 不再是「pill → 面板 → 下拉 → 列表 → 选」四步。
  // 基线是同一句里的 `panelOptionCount > 0`：面板空着时「没有下拉」照样成立，那种绿骗不过这条。
  check(
    '视频节点：面板里一个下拉都没有，选项全摊开（基线：面板里数得到可点选项）',
    withPanel.panelSelects === 0 && withPanel.panelOptionCount > 0,
    `下拉 ${withPanel.panelSelects} 个 / 摊开的可点项 ${withPanel.panelOptionCount} 个`,
  )
  check('视频节点是多参数，走的是面板不是单参数直出（两条路各守各的）',
    withPanel.panelControlKeys.length > 1 && withPanel.panelSolo === null,
    `参数 ${withPanel.panelControlKeys.length} 组 / solo=${withPanel.panelSolo}`)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '06-video-param-panel.png') })
  // 挑一个**没被选中**的分段档。定位先在页面里算好「哪一组的第几项」再用稳定选择器点：
  // 直接写 `[aria-checked="false"]` 会在点完之后指向另一项（选择器自己失效了），
  // 那种「永远为真」的轮询和真绿长得一样。
  const pickTarget = await getWin().evaluate(() => {
    const groups = [...document.querySelectorAll('[data-agent-parameter-panel="true"] [data-agent-parameter-control]')]
    for (const group of groups) {
      const radios = [...group.querySelectorAll('[role="radio"]')]
      if (radios.length < 2) continue
      const index = radios.findIndex((radio) => radio.getAttribute('aria-checked') !== 'true' && !radio.hasAttribute('disabled'))
      if (index >= 0) return { key: group.getAttribute('data-agent-parameter-control'), index }
    }
    return null
  })
  if (pickTarget) {
    const radio = paramPanel.locator(`[data-agent-parameter-control="${pickTarget.key}"] [role="radio"]`).nth(pickTarget.index)
    await radio.click()
    await expect.poll(() => radio.getAttribute('aria-checked'),
      { message: '面板里选完必须把新值写进节点（store）——面板是受控的，选中态没挪过去就是没写进去' }).toBe('true')
    check(`面板里改「${pickTarget.key}」一次点击即生效，且面板不关（可连改多项）`, await paramPanel.isVisible())
    sawPanelPick = true
  }
  await dismiss()
  const afterPick = await measure()
  if (!afterPick) throw new Error('改完参数后量不到浮框几何')
  check('改完参数摘要 pill 仍读得出当前配置（打开期间冻结、关掉回到实时值）',
    Boolean(afterPick.parameterSummary && afterPick.parameterSummary.trim()), `pill「${afterPick.parameterSummary}」`)
  check('改完参数底栏仍是单行', afterPick.footerRows === 1, `${afterPick.footerRows} 行`)

  // ⑥ 拖动画布后浮框仍贴着节点：节点动了多少，浮框就动多少（相对偏移逐像素不变 = 不漂移）。
  // 基线要**现量**，不能拿最上面那次 `first`：上一步刚在面板里改过一个参数，改的若是比例，
  // 节点会因此变高、浮框相对节点顶边的偏移本来就该跟着变——拿改参数之前的偏移来比，
  // 量到的是「参数改了」不是「漂移了」。
  const beforeDrag = await measure()
  if (!beforeDrag) throw new Error('拖动前量不到浮框几何')
  const stageBox = await getWin().locator('.generation-canvas-v2__stage').first().boundingBox()
  if (!stageBox) throw new Error('舞台不可见，无法拖动画布')
  const emptyPoint = { x: stageBox.x + stageBox.width - 80, y: stageBox.y + stageBox.height - 80 }
  await getWin().mouse.move(emptyPoint.x, emptyPoint.y)
  await getWin().mouse.down()
  await getWin().mouse.move(emptyPoint.x - 160, emptyPoint.y - 90, { steps: 14 })
  await getWin().mouse.up()
  await expect.poll(async () => Math.round((await measure())?.node.left ?? beforeDrag.node.left), { message: '拖画布后节点必须真的移动了（否则这条断言什么都没验）' })
    .not.toBe(Math.round(beforeDrag.node.left))

  // 等拖动旗降下来 + 位置落定，再量。
  await expect.poll(async () => (await measure())?.dragging, { message: '松手后画布必须退出拖动态' }).toBe(false)
  // 再等它连着两帧不动，避免量到重排的中间帧。
  let settled = null
  await expect.poll(async () => {
    const sample = Math.round((await measure())?.card.left ?? Number.NaN)
    const stable = settled !== null && settled === sample
    settled = sample
    return stable
  }, { message: '浮框横向位置必须落定（连续两次采样相同）' }).toBe(true)
  const dragged = await measure()
  if (!dragged) throw new Error('拖动后量不到浮框几何')
  const offsetBefore = { x: beforeDrag.card.left - beforeDrag.node.left, y: beforeDrag.card.top - beforeDrag.node.top }
  const offsetAfter = { x: dragged.card.left - dragged.node.left, y: dragged.card.top - dragged.node.top }
  // 竖直方向必须逐像素贴着节点底边——这是「跟着这个节点走」的判据。
  check(
    '拖动画布后浮框仍贴在节点底边下方（竖直偏移逐像素不变）',
    Math.abs(offsetAfter.y - offsetBefore.y) <= 2,
    `before=${JSON.stringify(offsetBefore)} after=${JSON.stringify(offsetAfter)}`,
  )
  // 横向也必须逐像素不变：浮框不再被视口 clamp，横向偏移只由节点决定。
  check(
    '拖动画布后浮框横向偏移逐像素不变（不 clamp、不躲边）',
    Math.abs(offsetAfter.x - offsetBefore.x) <= 2,
    `before=${JSON.stringify(offsetBefore)} after=${JSON.stringify(offsetAfter)}`,
  )
  assertPinned('拖动后', dragged)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '02-after-canvas-drag.png') })

  // ⑦ ×N 通用化：声音节点以前没有这个控件，现在按执行类派生 → 也有。
  await getWin().keyboard.press('Escape').catch(() => {})
  await addNode('audio', '声音')
  const audioComposer = getWin().locator('.generation-canvas-v2-node__composer').last()
  if (!(await audioComposer.isVisible().catch(() => false))) {
    await getWin().locator('[data-node-id]').last().click({ timeout: 3000 }).catch(() => {})
  }
  await audioComposer.waitFor({ state: 'visible' })
  await settleComposer('声音节点')
  const audio = await measure()
  if (!audio) throw new Error('量不到声音节点浮框几何')
  check('声音节点也有「每次生成几个」（×N 已按执行类派生，不再只给图片/视频）', audio.variantControl)
  assertPinned('声音节点', audio)
  check('声音节点底栏控件全部在卡内且可命中', audio.controlsInsideCard && audio.controlsHittable, `控件 ${audio.controlCount} 个，${audio.footerRows} 行`)
  check('声音节点底栏同样是单行', audio.footerRows === 1, `${audio.footerRows} 行`)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '03-audio-node-composer.png') })

  // ⑦.5 图片节点：B 簇没有运镜，只剩两颗（效果 / 优化）——「图片节点只两颗」是 v1.1 拍板的一条，
  // 光看视频那格看不出来它是**按节点类型派生**的，还是碰巧渲了三颗。
  await getWin().keyboard.press('Escape').catch(() => {})
  await addNode('image', '图片')
  const imageComposer = getWin().locator('.generation-canvas-v2-node__composer').last()
  if (!(await imageComposer.isVisible().catch(() => false))) {
    await getWin().locator('[data-node-id]').last().click({ timeout: 3000 }).catch(() => {})
  }
  await imageComposer.waitFor({ state: 'visible' })
  await settleComposer('图片节点')
  const image = await measure()
  if (!image) throw new Error('量不到图片节点浮框几何')
  check('图片节点底栏同样是单行', image.footerRows === 1, `${image.footerRows} 行 / ${image.controlCount} 个控件`)
  checkComposerBarV1('图片节点', image)
  check('图片节点 B 簇只剩两颗：效果 → 优化（没有运镜）', image.clusterTools.join(' → ') === 'effects → optimize',
    `实际「${image.clusterTools.join(' → ')}」`)
  // 图与视频的摘要**不是同一句**（图没有时长，报的是比例 + 清晰度）——证明这两个值是按各自档案
  // derive 的，不是一张写死的清单在到处渲染。
  check('图片与视频的参数摘要各按各的档案来（两边不是同一句）', image.parameterSummary !== first.parameterSummary,
    `视频「${first.parameterSummary}」/ 图片「${image.parameterSummary}」`)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '05-image-node-composer.png') })

  // ⑦.6 图片节点点开之后那一层，也必须是摊开的（v1.2 同一条规则，两种节点各量一次：
  // 「面板里没有下拉」若只在视频节点上验，换个档案就可能悄悄退回下拉）。
  const imagePill = getWin().locator('[data-parameter-summary]').last()
  await imagePill.click()
  const imagePanel = getWin().locator('[data-agent-parameter-panel="true"]').last()
  await imagePanel.waitFor({ state: 'visible' })
  const imageOpen = await measure()
  if (!imageOpen) throw new Error('点开图片节点的参数后量不到浮框几何')
  check(
    '图片节点：点开的参数里一个下拉都没有，选项全摊开（基线：数得到可点选项）',
    imageOpen.panelSelects === 0 && imageOpen.panelOptionCount > 0,
    `下拉 ${imageOpen.panelSelects} 个 / 摊开的可点项 ${imageOpen.panelOptionCount} 个`,
  )
  // 「单参数直出 / 多参数走面板」是同一条规则的两面。这台机器上**没有**单参数的图片模型
  // （内置可用的那个档案声明了比例 + 清晰度，pill 只是按 v1.1 的口径挑两个值报），
  // 所以真机这一侧只量得到「多参数 → 面板、不走直出」这半边；
  // 直出那半边由设计实验室 `composer-bar-panel-solo-direct` 那一格守（Agnes Image 是**真实档案**，
  // 只声明一个「尺寸」参数，正是用户 09-11 13:00 截图里那种模型），那一格会真的点一项、
  // 断言列表随即关闭。两边合起来才覆盖整条规则——这里不假装真机上走到了一个不存在的模型。
  check(
    `图片节点是多参数（${imageOpen.panelControlKeys.join(' / ')}），走的是面板不是单参数直出`,
    imageOpen.panelControlKeys.length > 1 && imageOpen.panelSolo === null,
    `参数 ${imageOpen.panelControlKeys.length} 组 / solo=${imageOpen.panelSolo}`,
  )
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '07-image-param-panel.png') })
  await dismiss()

  // ⑧ 窄视口：真实场景不是缩小 OS 窗口（主窗口 minWidth=1100，缩不下去，而且 Electron
  // 真实窗口下 `page.setViewportSize` 只改 CDP 上报的量值、不动原生边界，会撞出「布局和
  // React Flow 各读各的尺寸」——实测就是这条路先炸了：composer 整个从 DOM 消失，量了 8 次全
  // null）。真实会让画布变窄的是**拉宽常驻 Agent 面板**这个既有 UI（`AssistantPane` 的
  // 分隔条，键盘 End 直接跳到当前视口下的最大宽度），画布宽度因此被真实地挤掉一块，
  // 不用碰原生窗口。2026-09-25 起这里断的是反面：画布变窄了，浮框**照旧** 560 宽、照旧钉在节点下，
  // 伸出画布的那截就被挡住（用户拍板「遮挡就遮挡了」）——不收窄、不推回视口。
  const assistantResizer = getWin().getByRole('separator', { name: '拖动调整助手宽度' }).first()
  await assistantResizer.waitFor({ state: 'visible' })
  await assistantResizer.focus()
  await getWin().keyboard.press('End')
  let narrowSettled = null
  await expect.poll(async () => {
    const sample = await measure()
    const signature = sample ? `${Math.round(sample.card.left)},${Math.round(sample.card.width)},${Math.round(sample.stage.width)}` : null
    const stable = narrowSettled !== null && narrowSettled === signature
    narrowSettled = signature
    return stable
  }, { message: '拉宽 Agent 面板后浮框位置必须落定（连续两次采样相同）' }).toBe(true)
  const narrow = await measure()
  if (!narrow) throw new Error('拉宽 Agent 面板后量不到浮框几何')
  check('拉宽 Agent 面板确实挤窄了画布（这条断言不是摆设）', narrow.stage.width < first.stage.width - 40,
    `narrow.stage.width=${Math.round(narrow.stage.width)} first.stage.width=${Math.round(first.stage.width)}`)
  assertPinned('窄画布下', narrow)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '04-narrow-canvas.png') })

  check('「点开面板改一个值」这条路整场至少走到一次（否则那几条断言等于没跑）', sawPanelPick)

  fs.writeFileSync(path.join(shotsDir, 'geometry.json'), JSON.stringify({ first, dragged, audio, image, narrow }, null, 2))
} catch (error) {
  console.error(`VERIFY ERROR: ${error?.stack || error?.message || error}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}

const failed = results.filter((entry) => !entry.ok)
if (failed.length) { console.error(`\n✗ ${failed.length}/${results.length} 项未过`); process.exitCode = 1 }
else console.log(`\n✓ 全部 ${results.length} 项通过`)
