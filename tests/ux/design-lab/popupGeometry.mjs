// 弹层几何普查（2026-10-06 立，节点快捷动作第二轮）：**点开的浮层不许压住自己的触发钮、不许压住触发钮所在的那一排工具条、整块要在窗口里**。
//
// 为什么要一条普查而不是在某个组件的测试里断言：用户截图那次（节点靠画布上沿，「改图 ▾」的菜单翻下来盖住浮条和「宫格」），
// 组件测试、实验室截图、feel observer 全绿——实验室里节点永远摆在画面中间，头顶空间足够，菜单从来没翻过边；
// feel observer 量的是「字叠字」和「中心点被别的东西挡住」，菜单盖住的按钮恰好被盖住、它也只报一条 baseline 里认过的类。
// 这一类缺陷只在**边界摆位**才出现，所以判据必须对「所有打开的浮层 × 所有摆位」成立，而不是对一张主样张成立。
//
// 判据只认 DOM 几何与无障碍属性，不认组件名：
//   · 触发钮 = 可见、接指针、`aria-haspopup` 且 `aria-expanded="true"` 的元素（手风琴那类只有 aria-expanded 的不算——它没有弹层）；
//   · 浮层 = `body` 的直接孩子里 `position: fixed`、可见、接指针的那一层（Radix 的 popper 外壳、AnchoredPopover 的 Portal 根都是这个形状；
//     Radix 菜单的虚拟锚点不接指针，悬停预览 `passThrough` 也不接，都不算）；
//   · 工具条 = 触发钮最近的 `[role="toolbar"]`，只在它是横条（宽 > 高）时算「那一排」。
// 违例：浮层与触发钮相交 / 与那一排工具条相交 / 探出窗口（1px 容差）。
//
// 用在两处：设计实验室走查（`walkScreen.mjs`，每屏每格都量）与 CI 普查（`popupGeometry.census.mjs`，所有 capture: viewport 的格）。

/** 在页面里跑：返回违例列表（空 = 通过）。不依赖任何产品代码。 */
export function probePopupGeometry() {
  const EPS = 1
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0 && style.display !== 'none'
  }
  const takesPointer = (el) => getComputedStyle(el).pointerEvents !== 'none'
  const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EPS
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)
  const box = (r) => ({ left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) })

  const triggers = [...document.querySelectorAll('[aria-haspopup][aria-expanded="true"]')]
    .filter((el) => el.getAttribute('aria-haspopup') !== 'false' && visible(el) && takesPointer(el))
  const layers = [...document.body.children]
    .filter((el) => getComputedStyle(el).position === 'fixed' && visible(el) && takesPointer(el))
  const violations = []
  const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
  for (const layer of layers) {
    const r = layer.getBoundingClientRect()
    if (r.left < viewport.left - EPS || r.top < viewport.top - EPS || r.right > viewport.right + EPS || r.bottom > viewport.bottom + EPS) {
      violations.push({ rule: 'popup-out-of-viewport', layer: name(layer), layerBox: box(r), viewport: box(viewport) })
    }
  }
  for (const trigger of triggers) {
    if (layers.some((layer) => layer.contains(trigger))) continue // 浮层里的二级触发钮：它和自己的浮层另算
    const t = trigger.getBoundingClientRect()
    const toolbar = trigger.closest('[role="toolbar"]')
    const row = toolbar && toolbar.getBoundingClientRect().width > toolbar.getBoundingClientRect().height ? toolbar.getBoundingClientRect() : null
    for (const layer of layers) {
      const r = layer.getBoundingClientRect()
      if (overlap(r, t)) violations.push({ rule: 'popup-covers-trigger', trigger: name(trigger), layer: name(layer), triggerBox: box(t), layerBox: box(r) })
      else if (row && overlap(r, row)) violations.push({ rule: 'popup-covers-toolbar-row', trigger: name(trigger), layer: name(layer), rowBox: box(row), layerBox: box(r) })
    }
  }
  return { triggers: triggers.length, layers: layers.length, violations }
}
