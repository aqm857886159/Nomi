/**
 * 「工作区底部停靠区」的唯一 owner —— 谁常驻在生成面的下沿、别把浮的东西排到它身上。
 *
 * ## 为什么归到外壳层
 *
 * 这个概念原来住在画布里（`useCanvasBottomDockRects.ts` 的 `DOCK_SCOPE_SELECTOR =
 * '.workbench-generation__canvas'`），而且有**两份**实现：选择浮条那一份走那个 hook，
 * 时间轴胶囊那一份在 `GenerationWorkspace` 里就地又写了一遍 `canvas.querySelectorAll(...)`。
 * 两份都把范围钉在画布这棵子树上。
 *
 * 2026-09-13 真机反馈暴露的正是这个范围画小了：Nomi 面板收起后那条浮起的输入条
 * （`AgentPanelV4Dock` 的收起坞）是**工作区的孩子、不是画布的孩子**，于是它在避让名单里
 * 根本不存在——时间轴收起后胶囊按「底部居中」落位，正好落在它下面，用户点不到，
 * 也就叫不回时间轴。这和「输入条压住底部带」是同一件事的两半：
 * 底部这一排东西属于**外壳**，画布只是其中一块。
 *
 * 所以范围上移一层到工作区（`.workbench-generation`），两个消费者共用这一份查询。
 * 标记本身不动（`data-canvas-bottom-dock`，5 处现役标记 + 走查锚点都认它）：
 * 要改的是「在哪一层找」，不是「叫什么名字」。
 *
 * ## 标记纪律（沿用）
 *
 * 停靠区自己在 DOM 上声明这个标记，而不是在这里抄一份 class 名单——名单少写一条不会报错，
 * 只会在某个窗口尺寸下静默地让浮的东西压上去。新加一块停靠区时标记就在你手边。
 */

export const BOTTOM_DOCK_ATTR = 'data-canvas-bottom-dock'
export const BOTTOM_DOCK_SELECTOR = `[${BOTTOM_DOCK_ATTR}]`
/**
 * 「我自己的位置就是从这份名单算出来的」——让位者的声明。
 *
 * 只有一个用处，但它是条正确性约束而不是优化：**让位关系必须单向**。
 * 时间轴胶囊要避开 Nomi 收起坞；如果坞反过来也把胶囊当障碍去抬高自己，两边就互相依赖，
 * 位置不收敛（先各自居中 → 互相看见 → 各挪一次 → 再互相看见）。
 * 所以坞算空当时跳过让位者，只让开**位置由自己定**的那几块（画布工具簇、迷你画面窗）。
 * 反方向不跳：胶囊与画布选择浮条必须照旧把坞和彼此都算进障碍。
 */
export const BOTTOM_DOCK_AVOIDER_ATTR = 'data-bottom-dock-avoids'
/** 外壳层：整个生成面工作区。收起态的 Nomi 坞、时间轴胶囊、迷你画面窗都在这一层之内。 */
export const BOTTOM_DOCK_SCOPE_SELECTOR = '.workbench-generation'

export type BottomDockRect = { left: number; top: number; right: number; bottom: number }

/** 往上找到外壳；找不到就退回宿主自己（测试里的裸节点、或外壳换名字时不至于抛）。 */
export function resolveBottomDockScope(host: Element): Element {
  return host.closest(BOTTOM_DOCK_SCOPE_SELECTOR) ?? host
}

/**
 * 量出此刻的底部停靠区，坐标换算到 `origin` 的坐标系（传谁的 rect 就是谁的坐标系）。
 *
 * **现量、不写常数**：这排东西的高度由 CSS 决定（胶囊的字号、缩略图开没开、批量条有没有出现、
 * 收起坞里有没有介入卡），抄一份数字进 TS 就是「尺寸双真相源」（`check:heavy-path` 有门岗拦）。
 *
 * `exclude` 用来把「正在被摆放的那个东西自己」排掉——胶囊自己也带标记（它对别人也是停靠区），
 * 不排掉就会自己躲自己。祖先/后代关系一并排除：坞的外框与内框都可能带标记。
 */
export function collectBottomDockElements(
  host: Element,
  exclude?: Element | null,
  options?: Readonly<{ skipAvoiders?: boolean }>,
): Element[] {
  const found: Element[] = []
  for (const element of Array.from(resolveBottomDockScope(host).querySelectorAll(BOTTOM_DOCK_SELECTOR))) {
    if (exclude && (element === exclude || element.contains(exclude) || exclude.contains(element))) continue
    if (options?.skipAvoiders && element.hasAttribute(BOTTOM_DOCK_AVOIDER_ATTR)) continue
    const rect = element.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) continue
    found.push(element)
  }
  return found
}

export function collectBottomDockRects(
  host: Element,
  origin: Readonly<{ left: number; top: number }>,
  exclude?: Element | null,
  options?: Readonly<{ skipAvoiders?: boolean }>,
): BottomDockRect[] {
  return collectBottomDockElements(host, exclude, options).map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top,
    }
  })
}

/**
 * 「这一条横向跨度往下最多能用到哪儿」——底部停靠区对浮在画布上的东西的**唯一**让位判据。
 *
 * 判据就是矩形不相交：只有横向真的压得上 `[span.left, span.right)` 的停靠区才算
 * （左下的工具簇不该逼一个靠右的浮层往上跑），取它们最高的上沿再让出 `clearance`。
 * 完全在视口之外的停靠区（例如时间轴展开后被顶出去的胶囊）挡不住任何人，不参与。
 *
 * 消费者：画布多选浮条（`selectionToolbarPlacement.ts`）。节点生成浮框 2026-09-21 曾经也读它，
 * 2026-09-25 用户拍板浮框「钉在节点正下方、被挡就挡」后不再让位任何停靠区，那一处读法已删。
 * 坐标系由调用方决定：矩形与 viewport 在同一坐标系里即可。
 */
export function resolveUsableBottomAboveDocks(input: Readonly<{
  viewport: Readonly<{ top: number; bottom: number }>
  span: Readonly<{ left: number; right: number }>
  docks: readonly BottomDockRect[]
  clearance?: number
}>): number {
  const { viewport, span, docks, clearance = 0 } = input
  let bottom = viewport.bottom
  for (const dock of docks) {
    if (![dock.left, dock.top, dock.right, dock.bottom].every((value) => Number.isFinite(value))) continue
    if (dock.bottom <= viewport.top || dock.top >= viewport.bottom) continue
    if (dock.right <= span.left || dock.left >= span.right) continue
    bottom = Math.min(bottom, dock.top - clearance)
  }
  return Math.max(viewport.top, bottom)
}
