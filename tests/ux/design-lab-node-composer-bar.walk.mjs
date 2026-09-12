// 设计实验室 · 画布「节点生成浮框底栏」走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另几屏共用一份）；这里只声明这一屏的取景参数
// 和**这一屏独有的那几条承诺**——底栏改造的全部主张都是「有没有 / 在不在 / 换没换行 / 谁在谁前面」，
// 光截图看不出「它是不是真的没换行」，所以逐条写成断言（assertState 里点不到/数不对就红）。
//
// 2026-09-11 起前五格都是**现役 composer 本体**（v1.1 已接线，参数区是摘要 pill），
// 所以这些断言同时是生产回归：
// 底栏被后来的改动挤成两行、段序漂了、锁又跑回浮框里，这里当场红。
//
// 第六格 `composer-bar-chips-mode` 不是画布节点：它是同一个 `InlineParameterBar` 多传一个
// `parameterLayout="chips"` 的陈列（付费确认卡用的那种摆法）。用户 2026-09-11 04:30 拍板
// **画布节点保持摘要 pill**，所以「每颗参数是可点的下拉」这条断言只能钉在那一格上——
// 钉在画布五格上就是在守一个用户明确收回的形态。
//
// 产出：`tests/ux/shots/design-lab-node-composer-bar/<state>.png` + `_contact-sheet.png`（拍板用）。
// 用法：node tests/ux/design-lab-node-composer-bar.walk.mjs
//      （ONLY=composer-bar-v1-video 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'

/**
 * v1.1 底栏必须是**一行三段**：
 *   ① 所有分段的中心 y 落在同一行内（换行 = 立刻拉开一整行高度）；
 *   ② 段序就是拍板那句话——模型/参数 → B 簇 → ×N/生成。
 * 顺序按 `data-bar-segment` 读，不按下标猜：中间夹着两根分隔线，下标会跟着分隔线一起飘。
 */
const BAR_SEGMENT_ORDER = ['model-params', 'prompt-tools', 'variants', 'generate']

async function assertSingleRow(page, record, stateId) {
  const rows = await page.evaluate(() => {
    const bar = document.querySelector('.generation-canvas-v2-node__composer-card [data-node-composer-footer]')
    if (!bar) return null
    const segments = [...bar.querySelectorAll('[data-bar-segment]')]
    const centers = segments.map((element) => {
      const rect = element.getBoundingClientRect()
      return rect.height > 0 ? rect.top + rect.height / 2 : null
    }).filter((value) => value !== null)
    return {
      count: centers.length,
      spread: centers.length ? Math.max(...centers) - Math.min(...centers) : 0,
      segments: segments.map((element) => element.getAttribute('data-bar-segment')),
    }
  })
  if (!rows) { record(`${stateId} 找不到现役底栏 [data-node-composer-footer]`); return }
  if (rows.count !== 4) record(`${stateId} 底栏应有 4 段（模型/参数 · B 簇 · ×N · 生成），实际量到 ${rows.count} 段`)
  if (rows.spread > 8) record(`${stateId} 底栏换行了：分段中心 y 相差 ${Math.round(rows.spread)}px（单行不换行是这条改造的硬承诺）`)
  const order = rows.segments.join(' → ')
  if (order !== BAR_SEGMENT_ORDER.join(' → ')) {
    record(`${stateId} 底栏顺序应是「${BAR_SEGMENT_ORDER.join(' → ')}」，实际「${order}」`)
  }
}

/**
 * 「缩小一号」不能靠眼睛认：B 簇每颗 icon 的实际盒子必须**小于底栏里最高的那颗控件**，
 * 且不超过设计系统小号档（`WorkbenchIconButton` size="sm" = 28px）。
 * 量的是 getBoundingClientRect，不是 class 名——写着 sm 却被外层拉高，这条才拦得住。
 */
async function assertClusterIsSmaller(page, record, stateId) {
  const sizes = await page.evaluate(() => {
    const bar = document.querySelector('.generation-canvas-v2-node__composer-card [data-node-composer-footer]')
    if (!bar) return null
    const icons = [...bar.querySelectorAll('[data-prompt-tool]')].map((el) => el.getBoundingClientRect().height)
    const others = [...bar.querySelectorAll('button, [role="combobox"]')]
      .filter((el) => !el.closest('[data-prompt-tool-cluster="true"]'))
      .map((el) => el.getBoundingClientRect().height)
      .filter((height) => height > 0)
    return { icons, tallest: others.length ? Math.max(...others) : 0 }
  })
  if (!sizes || !sizes.icons.length) { record(`${stateId} 底栏里找不到 B 簇 icon，量不了尺寸`); return }
  const biggest = Math.max(...sizes.icons)
  if (biggest > 28) record(`${stateId} B 簇 icon 高 ${Math.round(biggest)}px，超过设计系统小号档 28px（不许造新尺寸）`)
  if (!sizes.tallest) { record(`${stateId} 底栏里没量到其它控件，「缩小一号」没有对照物`); return }
  if (biggest >= sizes.tallest) {
    record(`${stateId} B 簇 icon 高 ${Math.round(biggest)}px，没有比底栏其它控件（${Math.round(sizes.tallest)}px）小一号`)
  }
}

await walkDesignLabScreen({
  screen: 'node-composer-bar',
  title: '画布 · 节点生成浮框底栏',
  role: 'walk-node-composer-bar',
  cellWidth: 900,
  columns: 2,
  async assertState(page, state, record) {
    // ── chips 陈列格：没有节点卡、没有 B 簇、没有锁，下面那一整套画布断言对它一条都不成立。
    // 它只需回答一句话：`parameterLayout="chips"` 真的把参数摆成了**可点的下拉**（一步到位）。
    if (state.id === 'composer-bar-chips-mode') {
      const chips = await page.evaluate(() => [...document.querySelectorAll('[data-parameter-chip]')].map((element) => ({
        key: element.getAttribute('data-parameter-chip'),
        value: element.getAttribute('data-parameter-chip-value'),
        trigger: Boolean(element.querySelector('button')),
      })))
      if (!chips.length) record(`${state.id} chips 模式一颗主参数 chip 都没有（档案 derive 断了？）`)
      const brokenChip = chips.find((chip) => !chip.trigger || !chip.value)
      if (brokenChip) record(`${state.id} chip「${brokenChip.key}」不是可点的下拉或没有当前值（${JSON.stringify(brokenChip)}）`)
      // 换了摆法，摘要 pill 就不该同时在（同一处不许两个家）。基线 = 上面那句「chip 确实在」。
      if (chips.length) {
        const pill = await page.locator('[data-parameter-summary]').count()
        if (pill) record(`${state.id} chips 模式不该同时渲染摘要 pill（数到 ${pill} 颗）`)
      }
      return
    }
    // 画布五格都是真身：现役 composer 卡必须真的挂出来了，否则下面每一条「没看到 X」都是废话。
    const card = await page.locator('.generation-canvas-v2-node__composer-card').count()
    if (card !== 1) { record(`${state.id} 现役 composer 卡应有 1 张，实际 ${card} —— 这一格没渲染出真身`); return }
    await assertSingleRow(page, record, state.id)
    await assertClusterIsSmaller(page, record, state.id)
    // 锁：先证「浮条上确实有一把锁」，再断言「浮框里一把都没有」。
    // 没有前一句，后一句在锁根本没渲染时也照样绿——那正是 expectAbsent 在签名上逼你补的基线。
    const lockOnToolbar = await page.locator('[data-node-floating-toolbar="true"] [data-node-lock]').count()
    if (lockOnToolbar !== 1) record(`${state.id} 锁应回到节点浮条，实际在浮条上找到 ${lockOnToolbar} 个`)
    const lockProof = await proveProbe(
      page.locator('[data-node-floating-toolbar="true"] [data-node-lock]'),
      `${state.id} 的锁已经在节点浮条上`,
    )
    await expectAbsent(
      page.locator('.generation-canvas-v2-node__composer-card [data-node-lock]'),
      { provenBy: lockProof, message: `${state.id} 浮框里不该再有锁（它已归位到浮条）` },
    )
    // B 簇在**底栏里**，提示词区右端一件控件都没有。
    // 先证「底栏里确实有簇」，再断言「提示词区一颗都没有」——没有前一句，簇整个没渲染时后一句照样绿。
    const clusterInBar = await page.locator('[data-node-composer-footer] [data-prompt-tool-cluster="true"]').count()
    if (clusterInBar !== 1) record(`${state.id} B 簇应在底栏里，实际在底栏找到 ${clusterInBar} 个`)
    const clusterInBarProof = await proveProbe(
      page.locator('[data-node-composer-footer] [data-prompt-tool]'),
      `${state.id} 的 B 簇已经在底栏里渲染出来了`,
    )
    await expectAbsent(
      page.locator('[data-node-composer-prompt] [data-prompt-tool], [data-node-composer-prompt] button'),
      { provenBy: clusterInBarProof, message: `${state.id} 提示词区右端不该有任何控件` },
    )
    const clusterButtons = await page.locator('[data-prompt-tool-cluster="true"] [data-prompt-tool]').count()
    const expected = 2
    if (clusterButtons !== expected) record(`${state.id} B 簇应有 ${expected} 颗 icon（视频含运镜、图片没有），实际 ${clusterButtons}`)
    // 簇内顺序也是拍板那句话的一部分：运镜 → 效果 → 优化。图片节点没有运镜，只掉头一颗。
    const clusterOrder = await page.locator('[data-prompt-tool-cluster="true"] [data-prompt-tool]').evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute('data-prompt-tool')).join(' → '),
    )
    const wantedOrder = (['effects', 'optimize']).join(' → ')
    if (clusterOrder !== wantedOrder) record(`${state.id} B 簇顺序应是「${wantedOrder}」，实际「${clusterOrder}」`)
    const clusterText = (await page.locator('[data-prompt-tool-cluster="true"]').innerText().catch(() => '')).trim()
    if (clusterText) record(`${state.id} B 簇必须是纯 icon，却渲出了文字「${clusterText}」`)
    // 「哪几格该有激活点」按 id 白名单判，别用 includes 猜——`image-dark` 里也有 dark，
    // 猜一次就把一格图片态误判成「运镜没生效」（第一版就这么假红过）。
    const CAMERA_PICKED = new Set()
    const dots = page.locator('[data-prompt-tool-active="true"]')
    if (CAMERA_PICKED.has(state.id)) {
      const dot = await dots.count()
      if (dot !== 1) record(`${state.id} 运镜已选应带 1 个激活点，实际 ${dot}`)
    } else {
      // 「没有激活点」的基线 = **B 簇本身在**。簇没渲染出来时「没看到点」是句废话，
      // 和「点没生效」在观测上完全一样，所以这里先证簇里有按钮再断言点不在。
      const clusterProof = await proveProbe(
        page.locator('[data-prompt-tool-cluster="true"] [data-prompt-tool]'),
        `${state.id} 的 B 簇已经渲染出来了`,
      )
      await expectAbsent(dots, { provenBy: clusterProof, message: `${state.id} 运镜未选不该有激活点` })
    }
    // 参数区是**摘要 pill**（v1.1，用户 2026-09-11 04:30 确认节点保持原样）：
    // 摘要由档案 derive（比例 + 时长 / 比例 + 清晰度），形状必须是 `A · B`。
    const headline = await page.getAttribute(
      '.generation-canvas-v2-node__composer-card [data-parameter-summary]',
      'data-parameter-summary',
    ).catch(() => null)
    if (!headline || headline.split(' · ').filter(Boolean).length !== 2) {
      record(`${state.id} 参数摘要 pill 应恰好两个值，实际「${headline}」`)
    }
    // 画布节点**不该**长出逐参数 chip：那是付费确认卡的摆法（用户 04:30 明确收回）。
    // 基线 = 上面那句「摘要 pill 读到了」，所以这里不是一句在真身没渲染时也照样绿的废话。
    if (headline) {
      const strayChips = await page.locator('.generation-canvas-v2-node__composer-card [data-parameter-chip]').count()
      if (strayChips) record(`${state.id} 画布节点不该有逐参数 chip（数到 ${strayChips} 颗），那是付费卡的摆法`)
    }
  },
})
