/**
 * 窗口化列表里，每一项这一帧挂「完整行」还是「轻量占位」。
 *
 * 为什么要分：完整的镜头行带 TipTap 编辑器、画布同款参数区、参考条，挂一行要几十毫秒。快速滚动时
 * 每一帧都有行进出视口，全挂完整行 = 滚动中不停建 / 拆编辑器，一串长任务（V-1210 首轮实测：100 次滚轮 96 个长任务）。
 * 规则（都只看这一帧的输入，纯函数）：
 *   - 已经是完整行的项，只要还挂着就一直是完整行（不降级：编辑器不会在用户眼前被拆掉）；
 *   - 钉住的项（焦点所在、正在拖）、组头：完整；
 *   - 滚动中新进来的镜头行：轻量占位；
 *   - 不在滚动时第一次进来的（打开方案、窗口变化、增删镜头）：直接完整；
 *   - 停下以后，占位按「视口里的先、缓冲区的后」每次升级 `budget` 个，调用方每帧再算一次，直到没有占位。
 */
export type MountPlanInput = {
  /** 这一帧挂着的项（虚拟列表给的顺序），带是否在视口内（不含缓冲）。 */
  items: readonly { key: string; kind: 'head' | 'shot'; inViewport: boolean }[]
  isScrolling: boolean
  /** 上一帧已是完整行 / 占位的项。 */
  previousFull: ReadonlySet<string>
  previousLight: ReadonlySet<string>
  pinned: ReadonlySet<string>
  /** 停下后每帧最多升级几个占位。 */
  budget?: number
}

type MountPlan = { full: Set<string>; light: Set<string> }

export function planItemMounts({ items, isScrolling, previousFull, previousLight, pinned, budget = 1 }: MountPlanInput): MountPlan {
  const full = new Set<string>()
  const light = new Set<string>()
  const waiting: { key: string; inViewport: boolean }[] = []
  for (const item of items) {
    if (item.kind === 'head' || previousFull.has(item.key) || pinned.has(item.key)) full.add(item.key)
    else if (!isScrolling && !previousLight.has(item.key)) full.add(item.key)
    else waiting.push(item)
  }
  let remaining = isScrolling ? 0 : budget
  const ordered = [...waiting.filter((item) => item.inViewport), ...waiting.filter((item) => !item.inViewport)]
  for (const item of ordered) {
    if (remaining > 0) { full.add(item.key); remaining -= 1 }
    else light.add(item.key)
  }
  return { full, light }
}
