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
// 原来的第六格 `composer-bar-chips-mode`（逐参数 chip，付费确认卡用的那种摆法）随 D2 旧卡一起删了：
// 付费卡上不再挂参数控件（用户 2026-10-23 拍板），那种摆法没有宿主了。
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
// 数量（quantity）只在模型声明了数量参数时才有：段序是这四个的子序列，必有第一段与最后一段。
const BAR_SEGMENT_ORDER = ['model-params', 'prompt-tools', 'quantity', 'generate']

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
  if (rows.count < 3 || rows.count > 4) record(`${stateId} 底栏应有 3–4 段（模型/参数 · B 簇 · [数量] · 生成），实际量到 ${rows.count} 段`)
  if (rows.spread > 8) record(`${stateId} 底栏换行了：分段中心 y 相差 ${Math.round(rows.spread)}px（单行不换行是这条改造的硬承诺）`)
  const order = rows.segments.join(' → ')
  const expected = BAR_SEGMENT_ORDER.filter((name) => rows.segments.includes(name)).join(' → ')
  if (order !== expected) {
    record(`${stateId} 底栏顺序应是「${BAR_SEGMENT_ORDER.join(' → ')}」（缺的段跳过），实际「${order}」`)
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
    // ── v1.2 两格：点开之后那一层（用户 2026-09-11 13:00 真机拍板「点好几次」）。
    // 它们证的是两句话，而这两句都不是截图看得出来的：
    //   ① 面板里**一个下拉都没有**——选项本身就是可点的项；
    //   ② 只有一个参数时也是**同一只 320 面板**（2026-11-14 用户定稿「面板和 LibTV 保持一致」：
    //      旧「单参数直出」那条 68 宽竖条整段删了），点一项写入、面板不关。
    if (state.id.startsWith('composer-bar-panel-')) {
      const solo = state.id.endsWith('-solo-direct')
      const shape = await page.evaluate(() => {
        const panel = document.querySelector('[data-agent-parameter-panel="true"]')
        if (!panel) return null
        return {
          // Mantine Combobox 给每个下拉触发器加 aria-haspopup="listbox"：按属性数，换实现照样拦得住。
          selects: panel.querySelectorAll('[aria-haspopup="listbox"]').length,
          options: panel.querySelectorAll('[role="radio"]').length,
          groups: panel.querySelectorAll('[data-agent-parameter-control]').length,
          checked: [...panel.querySelectorAll('[role="radio"]')].findIndex((radio) => radio.getAttribute('aria-checked') === 'true'),
        }
      })
      if (!shape) { record(`${state.id} 参数浮层没打开（取景台那一下点空了），这一格什么都没证`); return }
      // ── 尺寸由内容派生（设计系统 §1.5.2 第 4 条）。2026-09-14 用户两次拍板之后只剩两条：
      //   ① 浮层宽不得明显宽于最宽那一项的文字——右边那截空白就是这么露馅的；
      //   ② 下一行才换行：一项只有在本行确实放不下时才落到下一行。
      // **「不许每项独占一行」那条已删**：用户明确要一列、每项一行（横排换行「两个一行、三个一行
      // 反而更难受」）。一列摆法下 ② 自动成立（每项就是一整行），它守的是别退回
      // 「浮层很宽、项很窄、还竖着排」那种样子。
      const fit = await page.evaluate(() => {
        const panel = document.querySelector('[data-agent-parameter-panel="true"]')
        const group = panel?.querySelector('[role="radiogroup"]')
        if (!panel || !group) return null
        const box = group.getBoundingClientRect()
        const style = getComputedStyle(group)
        const padX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0')
        const gap = parseFloat(style.columnGap || style.gap || '0') || 0
        const range = document.createRange()
        const items = [...group.querySelectorAll('[role="radio"]')].map((el) => {
          const r = el.getBoundingClientRect()
          range.selectNodeContents(el)
          const itemStyle = getComputedStyle(el)
          return {
            top: Math.round(r.top),
            width: r.width,
            // 量文字而不是被 1fr 拉伸的按钮框：一列摆法下每项都被拉到容器宽，量框等于量容器。
            text: range.getBoundingClientRect().width
              + parseFloat(itemStyle.paddingLeft || '0') + parseFloat(itemStyle.paddingRight || '0'),
          }
        })
        range.detach()
        const rows = []
        for (const item of items) {
          const row = rows.find((candidate) => Math.abs(candidate.top - item.top) <= 2)
          if (row) { row.widths.push(item.width) } else { rows.push({ top: item.top, widths: [item.width] }) }
        }
        const used = rows.map((row) => row.widths.reduce((a, b) => a + b, 0) + gap * (row.widths.length - 1))
        return {
          inner: box.width - padX,
          gap,
          rows: rows.map((r) => r.widths.length),
          used,
          widestText: Math.max(0, ...items.map((i) => i.text)),
          panelWidth: panel.getBoundingClientRect().width,
          groupWidth: box.width,
          count: items.length,
        }
      })
      if (!fit) { record(`${state.id} 量不到选项组几何（没有 role=radiogroup），尺寸断言等于没跑`); return }
      if (fit.count < 2) { record(`${state.id} 这一格应至少两项可点，实际 ${fit.count} 项——尺寸断言在一项上没有判别力`); return }
      // ② 下一行才换行：除最后一行外，下一行的第一项必须**确实塞不进**本行。
      for (let i = 0; i < fit.rows.length - 1; i += 1) {
        const nextFirst = fit.used[i + 1] / fit.rows[i + 1]
        if (fit.used[i] + fit.gap + nextFirst <= fit.inner + 1) {
          record(`${state.id} 第 ${i + 1} 行只用了 ${Math.round(fit.used[i])}/${Math.round(fit.inner)}px，下一行的第一项（约 ${Math.round(nextFirst)}px）本来放得下——下一行才换行（§1.5.2.4）`)
        }
      }
      if (solo) {
        // 只有一项的面板：和多项面板同一只（宽 320），不是贴着文字收窄的细条。
        if (Math.round(fit.panelWidth) !== 320) record(`${state.id} 只有一项的面板宽 ${Math.round(fit.panelWidth)}px，应和别的面板一样 320（不再是细竖条）`)
        if (shape.groups !== 1) record(`${state.id} 只有一项的面板应恰好 1 组参数，实际 ${shape.groups} 组`)
        // 点一项写入、面板不关（同一只面板，一种行为）。截图已在这之前拍完，这里点不会影响基线。
        const target = page.locator('[data-agent-parameter-panel="true"] [role="radio"]').nth(shape.checked === 0 ? 1 : 0)
        await target.click()
        const stillOpen = await page.locator('[data-agent-parameter-panel="true"]').count()
        if (!stillOpen) record(`${state.id} 只有一项的面板选完不该自己关（它和多项面板是同一只）`)
      } else if (shape.groups < 2) {
        record(`${state.id} 多参数那一格应有多组参数，实际 ${shape.groups} 组`)
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
    // 画布节点**不该**长出逐参数 chip：用户 2026-09-11 04:30 明确收回的摆法。
    // 基线 = 上面那句「摘要 pill 读到了」，所以这里不是一句在真身没渲染时也照样绿的废话。
    if (headline) {
      const strayChips = await page.locator('.generation-canvas-v2-node__composer-card [data-parameter-chip]').count()
      if (strayChips) record(`${state.id} 画布节点不该有逐参数 chip（数到 ${strayChips} 颗）`)
    }
  },
})
