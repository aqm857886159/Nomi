// 反问卡「通用性」补验（2026-09-21 用户原话：「这个是通用的吧，只有那一种反问就离谱了」）。
//
// 设计实验室里那六格换的是**题目**，不是皮肤：无选项纯自由作答 / 2 个 / 4 个长短不一 /
// 只有标签 / 熔断来源 / 缺参数来源。这条走查把它们在 **zh 和 en 两轨**各拍一张，
// 并对每一格做同一套机器判据——**截断、溢出、错位**这三样，眼睛看得出、断言也必须数得出。
//
// 为什么非要两轨：英文串长 1.5–2 倍，而这六格里有一条是刻意写长的说明。
// 只拍中文那一轨，等于把最容易出事的那一种情况排除在证据之外。
//
// 用法: node tests/ux/design-lab-question-card-generality.walk.mjs
import { stationTimeout } from './_station-budget.mjs'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './design-lab/labServer.mjs'

// 自己的角色 = 自己的端口（原来借的是 `walk-agent-panel-v4`：三份入口并行跑会抢同一口）。
const LAB = { role: 'walk-question-card' }
const ROLE = LAB.role
const PORT = labPortFor(ROLE)
const BASE = `http://127.0.0.1:${PORT}`
const outDir = process.env.QUESTION_CARD_WALK_OUT || path.join(REPO_ROOT, 'tests/ux/shots/design-lab-question-card')
fs.mkdirSync(outDir, { recursive: true })

/** 六种问法 = 用户点名要补齐的那六格（⑤熔断此前已有，一并再拍一次）。 */
const STATES = [
  'v4-intervention-question',
  'v4-intervention-question-free',
  'v4-intervention-question-two-options',
  'v4-intervention-question-four-mixed',
  'v4-intervention-question-labels-only',
  'v4-intervention-question-retry',
  'v4-intervention-question-missing-param',
  // 整件还原之后多出来的两格（Approval Card 本来就有、我们此前砍掉了的两样）。
  'v4-intervention-question-three',
  'v4-intervention-question-multi',
]

/** 只有这一格该出页码——其余全是一题，出了就是「1/1」那句废话回来了。 */
const PAGER_STATE = 'v4-intervention-question-three'
/** 只有这一格该是方标记（多选）。 */
const MULTI_STATES = new Set(['v4-intervention-question-multi'])

const failures = []
const measured = []

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url)
        if (response.ok || response.status === 404) return resolve()
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('vite dev server 启动超时'))
      setTimeout(tick, 400)
    }
    tick()
  })
}

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32',
})
vite.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))
await waitForServer(`${BASE}/design-lab.html`)
// 应答了不等于是我起的那一个（这台机器常年 20+ worktree）——不证明就可能截回别人分支的 UI。
assertLabPortOwnership(ROLE)

const browser = await chromium.launch({ headless: true })
try {
  for (const locale of ['zh-CN', 'en']) {
    const context = await browser.newContext({ viewport: { width: 520, height: 720 }, deviceScaleFactor: 2 })
    await context.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) }, ['nomi:locale:v1', locale])
    const page = await context.newPage()
    const tag = locale === 'zh-CN' ? 'zh' : 'en'
    for (const state of STATES) {
      await page.goto(`${BASE}/design-lab.html?screen=agent-panel-v4&frame=1&state=${state}`, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout() })
      const shot = page.locator(`[data-design-lab-shot="${state}"]`)
      await shot.waitFor({ state: 'visible', timeout: stationTimeout() })
      await page.waitForTimeout(250)
      await shot.screenshot({ path: path.join(outDir, `${tag}-${state}.png`) })

      /**
       * 三样机器判据，都在**卡自己的盒子**里量：
       *   ① 溢出：任何叶子越出卡片左右缘；
       *   ② 截断：任何元素的内容比它的盒子宽（`scrollWidth > clientWidth`）——
       *      这一条专抓「一行字被切掉后半句」，它不会产生越界矩形，光量 ① 抓不到；
       *   ③ 错位：选项 chip 的行没有挂在卡里（出现在卡的上方或下方之外）。
       * 另外记一条正向基线：这一格到底渲出了几个选项、有没有那一行自由输入——
       * 没有基线的「没发现问题」和「根本没渲染」长得一模一样。
       */
      const shape = await shot.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        /**
         * 多题卡上其余几题**留在 DOM 里**（题轨靠 translate 滑动，那是它动起来的方式），
         * 只是被 `overflow-hidden` 裁在视口外。所以「这张卡上有几个选项 / 几行输入 /
         * 什么形状的标记」一律只量**用户此刻看得见的那一题**——量整张卡等于把看不见的
         * 那两题也算进来，断言就变成了在数 DOM，不是在数用户看到的东西。
         */
        const visible = element.querySelector('[data-ask-question][data-active="true"]') ?? element
        const overflowing = []
        const clipped = []
        for (const node of element.querySelectorAll('*')) {
          const nodeRect = node.getBoundingClientRect()
          if (nodeRect.width < 1 && nodeRect.height < 1) continue
          if (!node.childElementCount && (nodeRect.right > rect.right + 1 || nodeRect.left < rect.left - 1)) {
            overflowing.push(`${node.tagName.toLowerCase()}:${(node.textContent || '').trim().slice(0, 28)}`)
          }
          if (node.scrollWidth - node.clientWidth > 1 && getComputedStyle(node).overflowX !== 'visible') {
            clipped.push(`${node.tagName.toLowerCase()}:${(node.textContent || '').trim().slice(0, 28)}`)
          }
        }
        const chips = visible.querySelectorAll('[data-v4-control="question-option"]')
        const answerRow = visible.querySelectorAll('[data-v4-control="question-answer"]').length
        // ── 整件还原的四条结构判据（用户 2026-09-21 点名的那四样，逐条机器化）──
        const boxed = [...chips].filter((chip) => {
          const style = getComputedStyle(chip)
          return style.borderTopWidth !== '0px' || style.borderLeftWidth !== '0px'
        }).length
        // 选项行**整行可点**：每一行的宽度都该贴着内容区，而不是按字数各长各的。
        const widths = new Set([...chips].map((chip) => Math.round(chip.getBoundingClientRect().width)))
        const answerInput = visible.querySelector('[data-v4-control="question-answer"]')
        const answerStyle = answerInput ? getComputedStyle(answerInput) : null
        const answerBordered = answerStyle
          ? answerStyle.borderTopWidth !== '0px' || answerStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
          : false
        const heading = visible.querySelector('[data-v4-block="ask-question"]')
        const pager = element.querySelectorAll('[data-v4-block="pager"]').length
        // 圆点 / 方框是**原生控件**（与同槽计划卡的勾选行同一写法），形状由 `type` 决定，
        // 所以这里数的是 type，不再量自画标记的圆角。
        const radios = visible.querySelectorAll('[data-v4-control="question-option"] input[type="radio"]').length
        const checks = visible.querySelectorAll('[data-v4-control="question-option"] input[type="checkbox"]').length
        const markers = radios + checks
        const squareMarkers = checks
        const roundMarkers = radios
        const markerRadii = []
        const text = (element.textContent || '')
        const misplaced = [...chips].filter((chip) => {
          const chipRect = chip.getBoundingClientRect()
          return chipRect.top < rect.top - 1 || chipRect.bottom > rect.bottom + 1
        }).length
        return {
          width: Math.round(rect.width), height: Math.round(rect.height), options: chips.length,
          answerRow, overflowing, clipped, misplaced,
          boxed, distinctWidths: widths.size, answerBordered, pager, markers, squareMarkers, roundMarkers, markerRadii,
          heading: heading ? (heading.textContent || '').trim().slice(0, 40) : '',
          saysDontAskAgain: /不再问|Don.t ask again/.test(text),
          skipButtons: element.querySelectorAll('[data-v4-control="ask-skip"]').length,
          dismissButtons: element.querySelectorAll('[data-v4-control="slot-dismiss"]').length,
          // 滑走的那几题必须**真的够不到**：aria-hidden 给读屏，tabIndex=-1 给键盘。
          // 少任何一条，用户按 Tab 就会掉进一张他看不见的卡里。
          reachableHidden: [...element.querySelectorAll('[data-ask-question][data-active="false"]')]
            .flatMap((item) => [...item.querySelectorAll('button, input')])
            .filter((node) => node.tabIndex !== -1).length,
          hiddenNotMarked: [...element.querySelectorAll('[data-ask-question][data-active="false"]')]
            .filter((item) => item.getAttribute('aria-hidden') !== 'true').length,
        }
      })
      measured.push({ locale: tag, state, ...shape })
      if (state === PAGER_STATE) {
        const pagerText = async () => (await shot.locator('[data-v4-block="pager"]').innerText()).replace(/\s+/g, '')
        const beforeSkip = await pagerText()
        await shot.locator('[data-v4-control="ask-skip"]').click()
        await page.waitForTimeout(500)
        const afterSkip = await pagerText()
        measured.push({ locale: tag, state, step: 'skip', beforeSkip, afterSkip })
        if (!beforeSkip.includes('1/3') || !afterSkip.includes('2/3')) {
          failures.push(`${tag}/${state}：点「跳过」应从 1/3 走到 2/3（跳过当前这一题），实际 ${beforeSkip} → ${afterSkip}`)
        }
        if (await shot.locator('[data-ask-card="true"]').count() !== 1) failures.push(`${tag}/${state}：点「跳过」把整张卡关了——那是 × 的事`)
      }
      if (shape.height < 40) failures.push(`${tag}/${state}：卡几乎没有高度（${shape.height}px），这一格什么都没证`)
      if (shape.overflowing.length) failures.push(`${tag}/${state}：${shape.overflowing.length} 处越出卡外 → ${shape.overflowing.join(' / ')}`)
      if (shape.clipped.length) failures.push(`${tag}/${state}：${shape.clipped.length} 处被自己的盒子切掉 → ${shape.clipped.join(' / ')}`)
      if (shape.misplaced) failures.push(`${tag}/${state}：${shape.misplaced} 个选项跑到卡外面去了`)
      // 每一张反问卡都必须带卡内那一行自由输入（2026-09-21 拍板，不分有没有选项）。
      if (shape.answerRow !== 1) failures.push(`${tag}/${state}：卡内自由作答那一行有 ${shape.answerRow} 个，说好永远恰好一行`)
      // ── 用户点名的四样，逐条钉死；任何一条改回去当场红 ──
      // ① 选项不许自带方框（chip 版的病灶）。
      if (shape.boxed) failures.push(`${tag}/${state}：${shape.boxed} 个选项自己长了边框——整件还原后选项是整行，不是方框 chip`)
      // ② 选项行宽度必须一致（chip 版是按内容定宽，三个选项三个宽度，用户原话「宽度参差」）。
      if (shape.options > 1 && shape.distinctWidths > 1) {
        failures.push(`${tag}/${state}：${shape.options} 个选项量到 ${shape.distinctWidths} 种宽度——整行可点的行必须等宽`)
      }
      // ③ 自由输入不许有边框或底色（用户原话「蓝色粗框输入」）。
      if (shape.answerBordered) failures.push(`${tag}/${state}：末行自由输入又长出边框/底色了——它是无边框内联的一行`)
      // ④ 反问卡上不许出现「不再问」（它根本没有那颗钮，那行字在解释一个不存在的按钮）。
      if (shape.saysDontAskAgain) failures.push(`${tag}/${state}：卡上出现了「不再问」——那是确认卡的东西漏过来了`)
      // ⑤ 问题**就是**标题：卡头那句套话删掉后，标题不能为空。
      if (!shape.heading) failures.push(`${tag}/${state}：没有标题——问题本身就该是那行标题`)
      // ⑥ 页码只在多题时出现。
      const wantPager = state === PAGER_STATE ? 1 : 0
      if (shape.pager !== wantPager) failures.push(`${tag}/${state}：页码出现了 ${shape.pager} 次，期望 ${wantPager}（只有一题时「1/1」是废话）`)
      // 「跳过」与 × 是两个动作：× 每张卡恰好一颗（整张卡不答）；「跳过」只在多题卡上出现
      //（跳过当前这一题）。只有一题时两者是同一件事，放两个就是一功能两个家。
      if (shape.dismissButtons !== 1) failures.push(`${tag}/${state}：右上 × 有 ${shape.dismissButtons} 颗，期望恰好 1 颗`)
      const wantSkip = state === PAGER_STATE ? 1 : 0
      if (shape.skipButtons !== wantSkip) failures.push(`${tag}/${state}：「跳过」有 ${shape.skipButtons} 颗，期望 ${wantSkip}（只有多题卡才有）`)
      // ⑦ 滑走的那几题够不到（读屏与键盘各一条）。
      if (shape.reachableHidden) failures.push(`${tag}/${state}：滑走的题里还有 ${shape.reachableHidden} 个控件在 Tab 序里——按 Tab 会掉进看不见的一题`)
      if (shape.hiddenNotMarked) failures.push(`${tag}/${state}：${shape.hiddenNotMarked} 道滑走的题没标 aria-hidden，读屏会把它念出来`)
      // ⑧ 多选那一格的标记必须是方的、单选那几格必须是圆的。
      if (shape.markers) {
        const wantSquare = MULTI_STATES.has(state) ? shape.markers : 0
        const wantRound = MULTI_STATES.has(state) ? 0 : shape.markers
        if (shape.squareMarkers !== wantSquare || shape.roundMarkers !== wantRound) {
          failures.push(`${tag}/${state}：radio ${shape.roundMarkers} 个 / checkbox ${shape.squareMarkers} 个——单选题该全是 radio、多选题该全是 checkbox`)
        }
      }
    }
    await context.close()
  }

  // 正向基线：这六格确实覆盖了「没有选项 / 2 个 / 4 个」三种数量，不是六张一模一样的卡。
  const zh = measured.filter((row) => row.locale === 'zh')
  const counts = new Set(zh.map((row) => row.options))
  for (const expected of [0, 2, 4]) {
    if (!counts.has(expected)) failures.push(`六格里没有一格是 ${expected} 个选项——通用性没被覆盖到，只是换了文案`)
  }
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
} finally {
  await browser.close().catch(() => undefined)
  vite.kill('SIGTERM')
}

const report = [
  '# design lab · question card generality walk',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `shots: ${outDir} (${STATES.length} states × zh/en)`,
  `measured: ${JSON.stringify(measured, null, 2)}`,
  'covers: nine different questions (none/2/3/4 options, labels-only, retry-exhausted producer, missing-param producer, three-question stack, multi-select) render on one Approval Card in zh and en with nothing overflowing, nothing clipped by its own box, options inside the card, exactly one in-card free answer row each, no per-option boxes, equal option row widths, a borderless free-answer row, no leaked "don\'t ask again" line, a non-empty question heading, a pager only on the multi-question cell, and square markers only on the multi-select cell.',
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
