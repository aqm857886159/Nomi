// 设计实验室 · 画布「节点生成浮框底栏」走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另几屏共用一份）；这里只声明这一屏的取景参数
// 和**这一屏独有的那几条承诺**——底栏改造的全部主张都是「有没有 / 在不在 / 换没换行」，
// 光截图看不出「它是不是真的没换行」，所以逐条写成断言（assertState 里点不到/数不对就红）。
//
// 产出：`tests/ux/shots/design-lab-node-composer-bar/<state>.png` + `_contact-sheet.png`（拍板用）。
// 用法：node tests/ux/design-lab-node-composer-bar.walk.mjs
//      （ONLY=composer-bar-v1-video 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'

/** v1 底栏必须是**一行**：所有直接子元素的中心 y 落在同一行内（换行 = 立刻拉开一整行高度）。 */
async function assertSingleRow(page, record, stateId) {
  const rows = await page.evaluate(() => {
    const bar = document.querySelector('[data-composer-bar-v1-actions]')
    if (!bar) return null
    const centers = [...bar.children].map((child) => {
      const rect = child.getBoundingClientRect()
      return rect.height > 0 ? rect.top + rect.height / 2 : null
    }).filter((value) => value !== null)
    return { count: centers.length, spread: centers.length ? Math.max(...centers) - Math.min(...centers) : 0 }
  })
  if (!rows) { record(`${stateId} 找不到 v1 底栏 [data-composer-bar-v1-actions]`); return }
  if (rows.count < 3) record(`${stateId} v1 底栏只有 ${rows.count} 件，A 类应为「参数组 + ×N + 生成」三件`)
  if (rows.spread > 8) record(`${stateId} v1 底栏换行了：子元素中心 y 相差 ${Math.round(rows.spread)}px（单行不换行是这条改造的硬承诺）`)
}

await walkDesignLabScreen({
  screen: 'node-composer-bar',
  title: '画布 · 节点生成浮框底栏',
  role: 'walk-node-composer-bar',
  cellWidth: 900,
  columns: 2,
  async assertState(page, state, record) {
    if (state.id.startsWith('composer-bar-before')) {
      // before 那两格的价值全在「它是真身」。真身的证据 = 现役 composer 的卡还在，
      // 且底栏里那颗锁还在底栏（这正是 v1 要搬走的东西）。
      const card = await page.locator('.generation-canvas-v2-node__composer-card').count()
      if (card !== 1) record(`${state.id} 现役 composer 卡应有 1 张，实际 ${card} —— 这一格已经不是真身了`)
      const lockInBar = await page.locator('.generation-canvas-v2-node__composer-card [data-node-lock]').count()
      if (lockInBar !== 1) record(`${state.id} 现状底栏里应能看到锁（[data-node-lock]），实际 ${lockInBar}`)
      return
    }
    // v1 三条承诺，逐条断言。
    await assertSingleRow(page, record, state.id)
    // 锁：先证「浮条上确实有一把锁」，再断言「浮框里一把都没有」。
    // 没有前一句，后一句在锁根本没渲染时也照样绿——那正是 expectAbsent 在签名上逼你补的基线。
    const lockOnToolbar = await page.locator('[data-node-floating-toolbar="true"] [data-node-lock]').count()
    if (lockOnToolbar !== 1) record(`${state.id} 锁应回到节点浮条，实际在浮条上找到 ${lockOnToolbar} 个`)
    const lockProof = await proveProbe(
      page.locator('[data-node-floating-toolbar="true"] [data-node-lock]'),
      `${state.id} 的锁已经在节点浮条上`,
    )
    await expectAbsent(
      page.locator('[data-composer-bar-v1-card] [data-node-lock]'),
      { provenBy: lockProof, message: `${state.id} v1 浮框里不该再有锁（它已归位到浮条）` },
    )
    const clusterButtons = await page.locator('[data-prompt-tool-cluster="true"] [data-prompt-tool]').count()
    const expected = state.id.includes('image') ? 2 : 3
    if (clusterButtons !== expected) record(`${state.id} B 簇应有 ${expected} 颗 icon（视频含运镜、图片没有），实际 ${clusterButtons}`)
    const clusterText = (await page.locator('[data-prompt-tool-cluster="true"]').innerText().catch(() => '')).trim()
    if (clusterText) record(`${state.id} B 簇必须是纯 icon，却渲出了文字「${clusterText}」`)
    // 「哪几格该有激活点」按 id 白名单判，别用 includes 猜——`image-dark` 里也有 dark，
    // 猜一次就把一格图片态误判成「运镜没生效」（第一版就这么假红过）。
    const CAMERA_PICKED = new Set(['composer-bar-v1-video-camera', 'composer-bar-v1-video-dark', 'composer-bar-v1-cluster-hover'])
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
    // 参数 chip 只报两个值：headline 由档案 derive，形状必须是 `A · B`。
    const headline = await page.getAttribute('[data-composer-bar-v1-card] [data-headline]', 'data-headline')
      .catch(() => null)
    if (!headline || headline.split(' · ').filter(Boolean).length !== 2) {
      record(`${state.id} 参数 chip 摘要应恰好两个值，实际「${headline}」`)
    }
  },
})
