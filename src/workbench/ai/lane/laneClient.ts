// Agent lane · 渲染层订阅（唯一 owner，**本层零状态机**）
//
// 今天渲染层有一整套自己的记账：手写 external store、待决工具登记表、工具正文写进
// localStorage。它们存在的理由都是同一个——宿主推来的东西不够用，所以渲染层自己补。
// 新通路里主进程推来的是一份**完整且有序**的投影，所以这一层退化成三件事：
// 存住最后一份、通知订阅者、把命令发过去。没有 reducer、没有合并、没有排序。
//
// 一条边界要写清楚：**草稿 / 附件 / 选中 chip 仍住 `workbenchStore`**。那是**用户输入**，
// 不是转录——用户打了一半的字不该因为一次快照推送就被覆盖掉。两者永不混。
//
// ⚠️ **影子期这条通路是接不上的，这是刻意的。** `resolveLaneBridge()` 在今天恒返回
// `undefined`：preload 没有暴露 `agentLane`，`main.ts` 也没注册那两条通道
// （方案 §8.1 规则 O6「开发期不可达」）。用户走不到 = 回滚面积为零。
// 桥以参数形式注入而不是在模块里直接摸 `window`，所以这一层今天就能被真正测到。
import type { LaneCommand, LaneProjection } from '../../../../electron/shared/agentLane/laneContracts'
import { LANE_IPC_CHANNELS } from '../../../../electron/shared/agentLane/laneContracts'

export type LaneCommandResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

/** 桥的形状。渲染层只认识这两个动作——它发不出宿主记录，因为它造不出宿主记录。 */
export interface LaneBridge {
  onProjection(listener: (projection: LaneProjection) => void): () => void
  send(command: LaneCommand): Promise<LaneCommandResult>
}

interface LaneBridgeHost {
  nomiDesktop?: { agentLane?: LaneBridge }
}

/**
 * 取桥。影子期恒 `undefined`——**这是状态，不是错误**，所以不抛。
 * 调用方据此渲染旧通路；切换 PR 里 preload 暴露 `agentLane` 之后它才开始返回东西。
 */
export function resolveLaneBridge(host: LaneBridgeHost | undefined = globalThis as LaneBridgeHost): LaneBridge | undefined {
  return host?.nomiDesktop?.agentLane
}

/** 桥没接上时订阅者看到的东西。空投影不是「出错了」，是「这条 lane 还没有内容」。 */
export const EMPTY_LANE_PROJECTION: LaneProjection = Object.freeze({
  lane: 'main',
  parts: Object.freeze([]),
  running: false,
  usage: Object.freeze({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
})

export interface LaneClient {
  projection(): LaneProjection
  subscribe(listener: (projection: LaneProjection) => void): () => void
  prompt(text: string): Promise<LaneCommandResult>
  abort(): Promise<LaneCommandResult>
  dispose(): void
}

const NO_BRIDGE: LaneCommandResult = {
  ok: false,
  code: 'agent_lane_bridge_absent',
  message: 'The agent lane bridge is not exposed in this build.',
}

export function createLaneClient(bridge: LaneBridge | undefined = resolveLaneBridge()): LaneClient {
  let latest: LaneProjection = EMPTY_LANE_PROJECTION
  const listeners = new Set<(projection: LaneProjection) => void>()
  // `useSyncExternalStore` 的 getter 必须**引用稳定**：只在真收到新投影时换对象。
  // 这条不是风格问题——仓库里 6 个手写 store 之一因为每次 getter 新建对象，
  // 在「有待决工具」时把整页打成「工作台加载失败」（G6 判据②）。
  const unsubscribe = bridge?.onProjection((projection) => {
    latest = projection
    for (const listener of listeners) listener(projection)
  })

  const send = async (command: LaneCommand): Promise<LaneCommandResult> =>
    bridge ? bridge.send(command) : NO_BRIDGE

  return {
    projection: () => latest,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    prompt: (text: string) => send({ kind: 'prompt', text }),
    abort: () => send({ kind: 'abort' }),
    dispose: () => {
      unsubscribe?.()
      listeners.clear()
    },
  }
}

/** 通道名从中立契约层来，两侧永远同一个字面量。 */
export const LANE_CHANNELS = LANE_IPC_CHANNELS
