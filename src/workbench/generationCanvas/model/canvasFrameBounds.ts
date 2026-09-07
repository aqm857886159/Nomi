/**
 * 框（Frame）几何的**唯一 owner**——纯函数，不碰 React / store / DOM。
 *
 * 2026-09-06 用户拍板的第一档把 `NodeGroup.frameBounds` 从「有字段没人读」翻成**真相之一**：
 * 框的边界是**用户画的那个矩形**，不再是成员包围盒算出来的一层皮。
 *
 * 一句话的语义：**只长不缩**。渲染出来的框 = `画的矩形 ∪ 成员矩形`——
 *  · 成员都在框内 → 框就是用户画的那个大小（不会缩到刚好贴住内容）；
 *  · 某个成员长高了、探出框外 → 框跟着长，保证内容不被截在外面；
 *  · 成员被拖到框外 → 那是**退组**（见 canvasPointerGestureModel.resolveCanvasFrameMembership），
 *    它已经不是成员，所以框不会追着它长——这正是实拍里那条 bug（框追着跑掉的节点长大把它重新包住）的修法。
 *
 * 为什么几何住 model/ 而判定住 canvasPointerGestureModel：这里回答「框有多大」，
 * 那里回答「这次手势打在什么上、会发生什么」。两个问题各有一个 owner，谁都别抄谁。
 */

/** 框矩形的持久化形状（与 `NodeGroup.frameBounds` 逐字一致）。 */
export type CanvasFrameRect = { x: number; y: number; w: number; h: number }

/** 一个成员在画布坐标系里占的地方。 */
export type CanvasMemberRect = { x: number; y: number; width: number; height: number }

/** 成员与框边之间的留白。 */
export const FRAME_CONTENT_PADDING = 24
/** 框顶部留给标题胶囊的那一条。 */
export const FRAME_LABEL_HEIGHT = 28

/** 画得太小 = 手抖，不建框（画布坐标系）。 */
export const FRAME_DRAW_NOISE_THRESHOLD = 24

function isFiniteRect(rect: CanvasFrameRect | null | undefined): rect is CanvasFrameRect {
  return Boolean(
    rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.w) &&
      Number.isFinite(rect.h),
  )
}

/**
 * 成员外接矩形 → 框矩形（含留白与顶部标签带）。
 *
 * 这就是 2026-09-06 之前 `getCanvasGroupBoxes` 内联算的那一份，逐字搬过来：
 * 旧组回填与新框渲染必须用**同一个**算式，否则升级当天所有旧组会集体跳一下。
 */
export function frameBoundsFromMembers(members: readonly CanvasMemberRect[]): CanvasFrameRect | null {
  if (!members.length) return null
  const minX = Math.min(...members.map((member) => member.x))
  const minY = Math.min(...members.map((member) => member.y))
  const maxX = Math.max(...members.map((member) => member.x + member.width))
  const maxY = Math.max(...members.map((member) => member.y + member.height))
  if (![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) return null
  return {
    x: minX - FRAME_CONTENT_PADDING,
    y: minY - FRAME_CONTENT_PADDING - FRAME_LABEL_HEIGHT,
    w: maxX - minX + FRAME_CONTENT_PADDING * 2,
    h: maxY - minY + FRAME_CONTENT_PADDING * 2 + FRAME_LABEL_HEIGHT,
  }
}

/**
 * 画的矩形 ∪ 成员矩形 = 真正渲染出来的框。**只长不缩**：结果永远完整包含 `drawn`。
 *
 * 两边都没有（空组、且旧快照没回填上）→ null，调用方据此不渲染——
 * 与 2026-09-06 之前「空组不出框」的行为一致，不会凭空冒出幽灵框。
 */
export function unionFrameBounds(
  drawn: CanvasFrameRect | null | undefined,
  content: CanvasFrameRect | null | undefined,
): CanvasFrameRect | null {
  const a = isFiniteRect(drawn) ? drawn : null
  const b = isFiniteRect(content) ? content : null
  if (!a) return b
  if (!b) return a
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * 用户拖出来的两点 → 一个可用的框矩形。
 *
 * 下限**从调用方给的节点最小尺寸派生**（`nodeSizing.MIN_NODE_WIDTH/HEIGHT`），不在这里写死数字：
 * 「一个框至少装得下一个最小的节点」是个有意义的判据，「至少 160px」不是。
 * 短边小于 `FRAME_DRAW_NOISE_THRESHOLD` 直接判成误点（返回 null）——
 * 手抖不该在画布上留下一个针尖大、又难选中删掉的框。
 */
export function normalizeDrawnFrameBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minContent: { width: number; height: number },
): CanvasFrameRect | null {
  const rawWidth = Math.abs(end.x - start.x)
  const rawHeight = Math.abs(end.y - start.y)
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) return null
  if (Math.min(rawWidth, rawHeight) < FRAME_DRAW_NOISE_THRESHOLD) return null
  const minWidth = minContent.width + FRAME_CONTENT_PADDING * 2
  const minHeight = minContent.height + FRAME_CONTENT_PADDING * 2 + FRAME_LABEL_HEIGHT
  const width = Math.max(rawWidth, minWidth)
  const height = Math.max(rawHeight, minHeight)
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: width,
    h: height,
  }
}

/** 画框过程中给用户看的那个预览矩形——不判误点、不补下限，所见即手上的动作。 */
export function drawPreviewRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): CanvasFrameRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  }
}

/** 两个框矩形有没有交叠——「框里不能再画框」那条提示的判据。 */
export function frameRectsOverlap(a: CanvasFrameRect, b: CanvasFrameRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * 旧组**原地升级**：没有 `frameBounds` 的按当前成员包围盒补一次。
 *
 * 幂等是硬要求——它每次载入快照都会跑：已经有 bounds 的组原样返回（连对象引用都不换），
 * 成员一个都取不到的空组**不硬造** bounds（凭空造一个 0×0 的框比没有更糟）。
 * 补出来的值随下一次持久化落盘；回滚代码后这个字段仍在盘上，但旧代码不读它，行为零变化。
 */
export function backfillGroupFrameBounds<
  G extends { nodeIds: readonly string[]; frameBounds?: CanvasFrameRect },
>(groups: readonly G[], rectOf: (nodeId: string) => CanvasMemberRect | null): G[] {
  return groups.map((group) => {
    if (isFiniteRect(group.frameBounds)) return group
    const members = group.nodeIds.flatMap((nodeId) => {
      const rect = rectOf(nodeId)
      return rect ? [rect] : []
    })
    const bounds = frameBoundsFromMembers(members)
    return bounds ? { ...group, frameBounds: bounds } : group
  })
}
