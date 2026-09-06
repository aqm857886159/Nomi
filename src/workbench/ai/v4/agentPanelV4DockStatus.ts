// Agent 面板 v4 · 收起坞的**状态词表**与它的派生（2026-09-06 用户改：收起态回到 Nomi logo）。
//
// 为什么单独一个文件：收起后 logo 上叠的那一格是一个**判断**（宿主真相 → 用户该不该看一眼），
// 不是一段长相。把它留在组件里，就只能靠截图证明；单独放这里，「有一条待确认时 logo 冒几号角标」
// 这件事有单测钉着，而组件只负责画。
//
// 词表只有一份 owner（R14.1）：`V4DockStatus`。`residentActivity` 那个 store 是**另一个**面
// （剪辑面板系统最右侧那条图标条）的投影口，存的是已经算好的 token 类名而不是状态词——
// 两边不是同义词表，别把这五个词再抄一份过去。
import React from 'react'

export type V4DockStatus =
  /** 没在跑、没在等、也没刚出事：logo 素着，不叠任何东西。 */
  | 'idle'
  /** 有回合活着：呼吸点。 */
  | 'running'
  /** 有介入槽在等用户裁决：数字角标（等着的条数）。 */
  | 'needs-confirm'
  /** 刚跑完：短暂一个勾，然后自己消失。 */
  | 'done'
  /** 最后一件事是失败：警示角标。 */
  | 'failed'

/** 勾号停留多久。够看见、不够变成一块常驻装饰。 */
export const V4_DOCK_DONE_HOLD_MS = 2400

export type V4DockFacts = Readonly<{
  /** 有回合活着（`useAgentPanelV4Data` 的 `running`）。 */
  running: boolean
  /** 还在等用户裁决的介入条数。 */
  pendingCount: number
  /** 最后一件事是失败（面板级错误带，或流末尾那条 error）。 */
  failed: boolean
  /** 刚从「在跑」落到「不跑了」的那几秒（由 `useV4DockStatus` 掐表）。 */
  justFinished: boolean
}>

/**
 * 优先级：**等你确认 > 失败 > 运行中 > 刚完成 > 空闲**。
 *
 * 为什么等待排在失败前面：待确认是一个**还没发生、正卡着**的提问——用户不点，事情就停在那儿；
 * 失败已经发生完了，晚看一眼不会更糟。收起态只有一格能说话，就把它给那件还能被改变的事。
 */
export function resolveDockStatus(facts: V4DockFacts): V4DockStatus {
  if (facts.pendingCount > 0) return 'needs-confirm'
  if (facts.failed) return 'failed'
  if (facts.running) return 'running'
  if (facts.justFinished) return 'done'
  return 'idle'
}

/** hover 那一行字 + 无障碍名共用同一句话（同一件事两个说法就是 R14.1 要横扫的东西）。 */
export type V4DockLabels = Readonly<{
  /** 动作名（「展开 Nomi」）——它是钮的无障碍名前半截。 */
  open: string
  idle: string
  running: string
  needsConfirm: (count: number) => string
  done: string
  failed: string
}>

export function dockStatusLabel(status: V4DockStatus, pendingCount: number, labels: V4DockLabels): string {
  if (status === 'needs-confirm') return labels.needsConfirm(pendingCount)
  if (status === 'failed') return labels.failed
  if (status === 'running') return labels.running
  if (status === 'done') return labels.done
  return labels.idle
}

/**
 * 「刚完成」是一段**时间**，宿主快照里没有这条记录——它只能由「在跑 → 不跑了」这次跳变掐表算出来。
 * 掐表在这个 hook 里、判断在 `resolveDockStatus` 里：前者只有真实运行时才有意义，后者是纯函数、有单测。
 */
export function useV4DockStatus({
  running,
  pendingCount,
  failed,
}: {
  running: boolean
  pendingCount: number
  failed: boolean
}): V4DockStatus {
  const [justFinished, setJustFinished] = React.useState(false)
  const wasRunning = React.useRef(running)
  React.useEffect(() => {
    const finished = wasRunning.current && !running
    wasRunning.current = running
    if (!finished) return undefined
    setJustFinished(true)
    const timer = setTimeout(() => setJustFinished(false), V4_DOCK_DONE_HOLD_MS)
    return () => clearTimeout(timer)
  }, [running])
  return resolveDockStatus({ running, pendingCount, failed, justFinished })
}
