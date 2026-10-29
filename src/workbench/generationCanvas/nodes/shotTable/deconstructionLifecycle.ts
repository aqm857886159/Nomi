// 拆解任务终态判定的**唯一 owner**（T-ED-06）。
//
// 「这次拆解还有没有可能完成」这个判断只有一层配拥有：**谁手里攥着那个 promise**。
// 视频拆解不是任务表里的一行——它是一次 `nomi:video:deconstruct` 的 invoke，编排全程活在
// 主进程的那次调用里，没有 taskId、没有可轮询的上游、重启后也没有任何东西能替它续跑。
// 所以在飞与否这件事，只有发起它的**这个渲染进程**知道；磁盘上那个 `status: 'running'`
// 只是它的一张影子照片，跨进程读回来时已经没有任何东西为它作保。
//
// 2026-09-17 付费走查 §6.5 撞到的就是这张影子照片：拆到一半关 app 再打开，
// 节点永久停在「本地找切点 / 0 镜」。快照归一化里其实有一句 `running → idle` 的收敛
// （2026-09-10 加的），但它**收敛完就被事件尾巴重放原样盖了回去**——
// `writeTable` 的每一下进度写都走 `canvas.node.updated` 进了事件日志，
// 重放把 `status: 'running'` 又写了回去。收敛发生在重放之前，于是等于没发生。
//
// 这里把判据收成一份：**节点不自己算终态，它投影这份在飞登记**。
// 读到 `running` 而登记里没有这个节点 → 这次拆解不可能再完成了 → `interrupted`。
// 快照归一化、事件尾巴重放、外部图应用三条读路径共用这同一个函数，不各写一遍。
import type { DeconstructionShotTableDocument } from '../../../../../electron/shared/canvas/shotTable'
import { readShotTable } from '../../../../../electron/shared/canvas/shotTable'

type DeconstructionStatus = DeconstructionShotTableDocument['source']['status']

/** 终态 = 用户在这一格上有明确的下一步动作（看结果 / 看原因重试 / 重新拆解）。只有 `running` 不是。 */
const TERMINAL_STATUSES: readonly DeconstructionStatus[] = ['idle', 'ready', 'failed', 'interrupted', 'cancelled']

export function isDeconstructionTerminal(status: DeconstructionStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * 从这一格能不能再起一次拆解。从终态集派生，**不另列一份状态清单**——
 * 原来那颗找回钮正是因为手列了 `failed || idle` 才把 interrupted 漏在外面。
 * `running` 不行（会起第二条）；`ready` 不行（已有结果，重拆走显式重试）。
 */
export function canRestartDeconstruction(status: DeconstructionStatus): boolean {
  return isDeconstructionTerminal(status) && status !== 'ready'
}

/**
 * 在飞登记：key = 分镜表节点 id，value = 这次调用的 requestId。
 *
 * 模块级单例是故意的——它要和「这个渲染进程还活着」同寿命：进程没了，登记自然全空，
 * 下次读回来的每一张 `running` 表都会被判为中断。这正是我们要的语义。
 */
const liveRuns = new Map<string, { requestId: string; cancelled: boolean }>()

export function registerDeconstructionRun(tableNodeId: string, requestId: string): void {
  liveRuns.set(tableNodeId, { requestId, cancelled: false })
}

/** 只有当前这次调用能注销自己——迟到的那次不许把后来者的在飞登记抹掉。 */
export function releaseDeconstructionRun(tableNodeId: string, requestId: string): void {
  if (liveRuns.get(tableNodeId)?.requestId === requestId) liveRuns.delete(tableNodeId)
}

export function isDeconstructionRunLive(tableNodeId: string): boolean {
  return liveRuns.has(tableNodeId)
}

/**
 * 标记「用户取消了这一次」：它回来时不许再写进表（迟到结果作废）。
 * 返回这次调用的 requestId——调用方拿它去撤主进程那次拆解（`video.cancelDeconstruct`，2026-10-27）：
 * 停不停由主进程那份请求登记说了算，这里只管表的终态。
 * 返回 undefined = 这个节点上根本没有在飞的调用，没什么可取消。
 */
export function markDeconstructionCancelled(tableNodeId: string): string | undefined {
  const run = liveRuns.get(tableNodeId)
  if (!run) return undefined
  run.cancelled = true
  return run.requestId
}

export function isDeconstructionRunCancelled(tableNodeId: string, requestId: string): boolean {
  const run = liveRuns.get(tableNodeId)
  return run?.requestId === requestId && run.cancelled
}

/**
 * 中断 / 取消要对用户说的那句话的**i18n key**，不是那句话本身。
 *
 * 为什么不把译好的句子写进 `errorMessage`：`errorMessage` 是**落盘**字段，它存的是
 * 供应商或 ffmpeg 的原话——那种东西没有译文、也不该有。而「这次拆解被中断了」是界面文案：
 * 把它冻进项目数据，等于用户在中文界面下中断一次、之后切到 English，这句话永远留在中文
 * （真机走查第一轮就这么红的）。状态本身已经是机器可读的，句子在渲染时按当前语言现取。
 */
export function deconstructionNoticeKey(status: DeconstructionStatus): string | undefined {
  if (status === 'interrupted') return 'shotTable.interrupted'
  if (status === 'cancelled') return 'shotTable.cancelled'
  return undefined
}

/**
 * **测试隔离专用**的清零口（生产没有调用方，也不该有）。
 *
 * 在飞登记是模块级单例，寿命就是这个渲染进程——这正是它的语义，所以生产代码里
 * 没有任何地方「该」清空它：项目切换不清（切走的那张画布上的节点 id 随画布一起消失，
 * 而真在飞的那次调用仍然归它自己的 finally 注销），进程结束自然就空了。
 * 单测需要每个 case 从空登记起跑，只为这一件事开这个口。
 */
export function resetDeconstructionRuns(): void {
  liveRuns.clear()
}

/**
 * 把一张表收敛到终态。纯函数：在飞与否由 `isLive` 注入，便于单测钉死而不碰模块单例。
 * 返回 undefined = 这张表不用动（已是终态，或确实还在飞）。
 */
export function convergeDeconstructionTable(
  tableNodeId: string,
  table: DeconstructionShotTableDocument,
  isLive: (nodeId: string) => boolean = isDeconstructionRunLive,
): DeconstructionShotTableDocument | undefined {
  if (table.source.status !== 'running' || isLive(tableNodeId)) return undefined
  return {
    ...table,
    source: {
      ...table.source,
      status: 'interrupted',
      phase: undefined,
      progressDetail: undefined,
      // 中断没有供应商原话可抄，所以这里**不留**上一次的 errorMessage（那是别的事的原因）。
      // 要对用户说的那句话由 deconstructionNoticeKey 在渲染时按当前语言取，不冻进项目数据。
      errorMessage: undefined,
    },
  }
}

/**
 * 扫一张画布，列出**需要被收敛**的那几张表。扫描与判据都只有这一份——
 * 读路径要的是「一张新的 nodes 数组」，引擎的 finally 要的是「逐个 updateNode 落盘」，
 * 两种落笔方式共用它，不各写一遍循环。
 */
export function convergedDeconstructionEntries<T extends { id: string; kind: string; meta?: Record<string, unknown> }>(
  nodes: readonly T[],
  isLive: (nodeId: string) => boolean = isDeconstructionRunLive,
): { node: T; table: DeconstructionShotTableDocument }[] {
  const entries: { node: T; table: DeconstructionShotTableDocument }[] = []
  for (const node of nodes) {
    if (node.kind !== 'shot_table') continue
    const table = readShotTable(node.meta)
    if (table?.source.kind !== 'deconstruction' || !('columns' in table)) continue
    const converged = convergeDeconstructionTable(node.id, table, isLive)
    if (converged) entries.push({ node, table: converged })
  }
  return entries
}

/**
 * 整张画布收敛一遍（读路径用）。快照恢复 / 事件尾巴重放 / 外部图应用末尾各调一次，
 * 幂等：没有要动的表时**原样返回同一份 nodes 引用**，不白白触发重渲染。
 */
export function convergeDeconstructionNodes<T extends { id: string; kind: string; meta?: Record<string, unknown> }>(
  nodes: readonly T[],
  isLive: (nodeId: string) => boolean = isDeconstructionRunLive,
): T[] {
  const entries = convergedDeconstructionEntries(nodes, isLive)
  if (!entries.length) return nodes as T[]
  const byId = new Map(entries.map((entry) => [entry.node.id, entry.table]))
  return nodes.map((node) => {
    const table = byId.get(node.id)
    return table ? { ...node, meta: { ...node.meta, shotTable: table } } : node
  })
}
