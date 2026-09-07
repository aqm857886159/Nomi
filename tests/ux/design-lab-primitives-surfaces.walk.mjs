// 设计实验室 · primitive 陈列 · 表面族走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与其它屏共用一份）；这里声明这一屏的取景参数，
// 外加**一条只有这一屏才成立的断言**。
//
// 那条断言是这一屏的命门：浮层那五格（modal / drawer / anchored-popover / tooltip /
// confirm-dialog）全都 `capture: 'viewport'`——它们 Portal 到 body 并 fixed 定位，
// 根本不在舞台的 DOM 子树里，所以只能截整屏。代价是：浮层一旦没打开，截回来的是
// **一张空舞台**，而空舞台和「浮层渲染在别处了」「浮层被裁到视口外了」在图上完全一样，
// 三种都长得像一张正常的背景图。所以逐格验：那个浮层真的在 DOM 里、真的可见、
// 而且整个落在视口内（落在视口外 = 整屏截图里什么都看不到，同样是张废图）。
//
// 反过来的一半：不该有浮层的格子必须一个都没有。少了这一半，`ps-11` 的确认框
// 漏关一次就会盖在后面每一格上，而每一张看起来都「有东西」。
//
// 产出：`tests/ux/shots/design-lab-primitives-surfaces/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-primitives-surfaces.walk.mjs （ONLY=ps-07-modal 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

/**
 * 每一格许诺自己开着哪个浮层。`null` = 这一格不该有任何浮层。
 * `selector` 用各浮层**自己**的角色/标记（不是我们另贴的），`text` 是它内容里的一句原话——
 * 只验 role 的话，一个空壳 dialog 也能过，而空壳和真卡片在缩略图上分不出来。
 * `min` 是这个浮层该有的最小尺寸：气泡和对话框不是一个量级，用同一个数只会让其中一半失真。
 */
const EXPECTED = {
  'ps-01-status-badge-tones': null,
  'ps-02-design-badge': null,
  'ps-03-design-alert': null,
  'ps-04-progress-skeleton': null,
  'ps-05-empty-state-panel': null,
  'ps-06-empty-state-inline': null,
  'ps-07-modal': { selector: '[role="dialog"]', text: '重命名项目', min: { w: 300, h: 160 } },
  'ps-08-drawer': { selector: '[role="dialog"]', text: '镜头属性', min: { w: 300, h: 300 } },
  // AnchoredPopover 不贴任何 data 标记（src/design/AnchoredPopover.tsx），它的身份就是
  // 「body 下一个 position:fixed 的层」+ 里面那段文案。定位没算出来时它是 visibility:hidden
  // 且 top=-9999，Playwright 的可见性判定正好把这两种都算作不可见。
  'ps-09-anchored-popover': { selector: 'body > div:not(#design-lab-root)', text: '参考强度', min: { w: 240, h: 60 } },
  // Radix 的 `[role="tooltip"]` 是给读屏用的 1×1 隐藏 span，**不是**看得见的那颗气泡；
  // 拿它验会「找到了但塌成 1×1」。看得见的是 popper 的包装层，它本身不带 role。
    // 气泡本来就只有一行高（实测 198×22）——最小尺寸按它自己的量级定，别拿对话框那把尺子量。
  'ps-10-tooltip': { selector: '[data-radix-popper-content-wrapper]', text: '正在导出', min: { w: 120, h: 16 } },
  // 标题走的是 Mantine Modal 的 header（在 surface 之外），所以这里认的是正文那句话。
  'ps-11-confirm-dialog': { selector: '[data-confirm-dialog-surface]', text: '删除后画布上的连线', min: { w: 260, h: 40 } },
  'ps-12-table': null,
  'ps-13-pagination': null,
  'ps-14-identity': null,
  'ps-15-identity-icon': null,
  'ps-16-preview-host': null,
  'ps-17-page-shell': null,
}

/** 不该有浮层的格子拿这一族选择器反查：任意一个可见的就是漏关。 */
const ANY_OVERLAY = '[role="dialog"], [role="tooltip"], [data-radix-popper-content-wrapper], [data-confirm-dialog-surface]'

await walkDesignLabScreen({
  screen: 'primitives-surfaces',
  title: 'primitive 陈列 · 表面族',
  // 端口按 worktree + 角色派生（design-lab/labServer.mjs）：写死端口在这台常年 20+ worktree
  // 的机器上一定会撞，撞了截回来的是别人分支的 UI。
  role: 'walk-primitives-surfaces',
  // 五格浮层 + 整页外壳按整屏取景（1440 宽），所以格子按视口比例开列，两列一屏对照。
  cellWidth: 700,
  columns: 2,
  assertState: async (page, state, record) => {
    // 新加了一格却没在上面认领自己开不开浮层 → 当场说出来，别让这一格无人验证地混进接触表。
    if (!(state.id in EXPECTED)) {
      record(`${state.id} 没有在 EXPECTED 里认领自己开着哪个浮层（不开就写 null）——补上它，别让这一格无人验证`)
      return
    }
    const expected = EXPECTED[state.id]

    if (!expected) {
      const stray = await page.locator(`${ANY_OVERLAY}`).filter({ visible: true }).count()
      if (stray > 0) {
        record(`${state.id} 不该有浮层，却有 ${stray} 个开着——上一格的浮层漏关，这一格拍到的不是它自己`)
      }
      return
    }

    const layer = page.locator(expected.selector).filter({ hasText: expected.text, visible: true })
    const count = await layer.count()
    if (count !== 1) {
      record(`${state.id} 应当有 1 个可见的浮层（${expected.selector} 含「${expected.text}」），实际 ${count} 个`
        + '——浮层没打开的话，capture=viewport 截回来是一张空舞台，看起来和正常图一样')
      return
    }
    // 开着但落在视口外，整屏截图里照样什么都看不见——同一种废图的第二副面孔。
    const geometry = await layer.first().evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        outside: rect.bottom <= 0 || rect.right <= 0
          || rect.top >= window.innerHeight || rect.left >= window.innerWidth,
      }
    })
    if (geometry.w < expected.min.w || geometry.h < expected.min.h) {
      record(`${state.id} 的浮层只有 ${geometry.w}×${geometry.h}（许诺 ≥ ${expected.min.w}×${expected.min.h}）`
        + '——有壳没内容，拍板时看不出它长什么样')
    }
    if (geometry.outside) {
      record(`${state.id} 的浮层整个落在视口外——整屏截图里一片空白，和「没打开」在图上分不出来`)
    }
  },
})
