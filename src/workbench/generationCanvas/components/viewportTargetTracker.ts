type Offset = { x: number; y: number }
export type ViewportTarget = { zoom: number; offset: Offset }

/**
 * 「视口正要去哪」的单一登记处。
 *
 * 为什么需要它：画布上有多个「自动让位」来源——新建节点要露出自己（useCreatedNodeVisibilityPan）、
 * composer 装不下要把画布推开（useComposerVisibilityPan）——它们都走同一个 `animateViewportTo`，
 * 而底层（React Flow `setViewport({ duration })`）是**后来者打断先来者**。两个请求几乎同时到
 * （建卡后 60ms 内 composer 就量完了），谁后到谁赢，先到的那段位移直接丢掉：
 * 2026-09-05 真机探针里 video 卡右边 200+px 压在常驻 Agent 面板底下、视口 x 恒 0，就是这么来的。
 *
 * 规则：每个自动让位都**从「正在去的目标」出发算自己的增量**，而不是从当前位置。
 * 这样后到的请求把先到的目标带着一起走，而不是覆盖它。
 */
/** 登记在动画时长之外还保留多久：给最后一帧的结算回调留余量。 */
export const PENDING_TARGET_GRACE_MS = 250

export function createViewportTargetTracker(readLive: () => ViewportTarget, now: () => number = () => Date.now()) {
  let pending: ViewportTarget | null = null
  let last: ViewportTarget | null = null
  let expiresAt = 0
  return {
    /**
     * 登记一个新目标；返回的 token 用于结算时判断「清掉的是不是自己」。
     * `durationMs` 决定登记的有效期：React Flow 的 setViewport 被别的直接写入（切分类、聚焦还原、
     * 用户开始拖）打断时 **promise 永远不结算**，登记若只靠结算清除就会永久卡住，之后每个自动让位
     * 都从一个早已作废的目标出发。过期即视为「没有在飞的目标」。
     */
    begin(target: ViewportTarget, durationMs = 0): ViewportTarget {
      const token = { zoom: target.zoom, offset: { x: target.offset.x, y: target.offset.y } }
      pending = token
      last = token
      expiresAt = now() + Math.max(0, durationMs) + PENDING_TARGET_GRACE_MS
      return token
    },
    /** 动画结算（完成或被打断）：只有当前登记的仍是自己时才清掉，别把后来者的目标抹了。 */
    settle(token: ViewportTarget): void {
      if (pending === token) pending = null
    },
    /** 最近一次登记过的自动让位目标（不管结算没结算）；用户手动平移不经过这里，所以「视口还停在它上面」= 用户此后没动过。 */
    readLastAutoTarget(): ViewportTarget | null {
      return last ? { zoom: last.zoom, offset: { x: last.offset.x, y: last.offset.y } } : null
    },
    /** 正在去的目标；没有动画在跑（或登记已过期）就是当前实际视口。 */
    read(): ViewportTarget {
      if (pending && now() <= expiresAt) return { zoom: pending.zoom, offset: { x: pending.offset.x, y: pending.offset.y } }
      const live = readLive()
      return { zoom: live.zoom, offset: { x: live.offset.x, y: live.offset.y } }
    },
  }
}

export type ViewportTargetTracker = ReturnType<typeof createViewportTargetTracker>
