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
// 唯一带判断的方法是 `say()`：用户在输入框里打的那句话，在「有卡在等 / 在跑 / 空闲」三种
// 状态下是三件不同的事（方案 §1.3）。判据本身仍不在这里——它在中立契约层的
// `laneComposerIntent`，与主进程侧的验收门共用同一份。这一层只是照着它发命令。
//
import type {
  LaneApprovalAction, LaneProjection, LaneSummary,
  LaneWorkspaceProjection,
} from '../../../../electron/shared/agentLane/laneContracts'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'
import type { LaneComposerContext, LaneConversationAddress, LaneDesktopCommand, LaneDesktopResult, LaneReceiptCommand, LaneSingleShotRequest } from '../../../../electron/shared/agentLane/laneDesktopContracts'
import { laneConversationOf } from '../../../../electron/shared/agentLane/laneConversation'
import { LANE_IPC_CHANNELS } from '../../../../electron/shared/agentLane/laneContracts'
import { laneComposerIntent, type LaneComposerIntent } from '../../../../electron/shared/agentLane/laneComposerIntent'
import { LaneCommandFailure } from './laneCommandFailure'

export type LaneCommandResult = LaneDesktopResult

/** 桥的形状。渲染层只发得出**意图**——它发不出宿主记录，因为它造不出宿主记录。 */
export interface LaneBridge {
  onProjection(listener: (projection: LaneWorkspaceProjection) => void): () => void
  send(command: LaneDesktopCommand): Promise<LaneCommandResult>
}

interface LaneBridgeHost {
  nomiDesktop?: { agentLane?: LaneBridge }
}

/** Resolve the preload surface. Browser-only labs inject their own bridge. */
export function resolveLaneBridge(host: LaneBridgeHost | undefined = globalThis as LaneBridgeHost): LaneBridge | undefined {
  return host?.nomiDesktop?.agentLane
}

/**
 * 桥没接上时订阅者看到的东西。空投影不是「出错了」，是「这条 lane 还没有内容」。
 *
 * 三行**全部是「不可知」**，不是 0：桥没接上时我们连模型是谁都不知道，更不知道花了多少钱。
 * token 那四列留 0 是因为它们说的是「这条 lane 到此为止累计用了多少」，而答案确实是零——
 * 一件事都还没发生过。两者的区别就是「量到的 0」和「没量」，这一层不许把后者写成前者。
 */
export const EMPTY_LANE_PROJECTION: LaneProjection = Object.freeze({
  lane: 'main',
  parts: Object.freeze([]),
  running: false,
  usage: Object.freeze({
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
    cost: Object.freeze({ state: 'unknown', reason: 'no-settled-turn' }),
    contextTokens: Object.freeze({ state: 'unknown', reason: 'no-settled-turn' }),
    reasoningTokens: Object.freeze({ state: 'unknown', reason: 'no-settled-turn' }),
  }),
  thinking: Object.freeze({ supportedLevels: Object.freeze(['off' as const]), level: 'off', canTurnOff: true }),
  // 桥没接上时队列**是空的**，这是量到的：没有桥就没有地方排队。
  queues: Object.freeze([]),
})

/** 桥没接上时的工作区：一条对话都列不出来（不是「这个项目没有对话」，是「还没问到」）。 */
export const EMPTY_LANE_WORKSPACE: LaneWorkspaceProjection = Object.freeze({
  lanes: Object.freeze([]),
  active: EMPTY_LANE_PROJECTION,
})

export interface LaneClient {
  connect(bridge: LaneBridge | undefined): void
  open(binding: ProjectBinding, model?: LaneComposerContext['model']): Promise<LaneCommandResult>
  close(): Promise<void>
  setPolicy(policy: LaneComposerContext['approvalPolicy']): Promise<LaneCommandResult>
  context(): Readonly<{ subscriptionId: string; binding: ProjectBinding }> | null
  conversation(): LaneConversationAddress | null
  /** Capture this opening/reopening before any caller waits for catalogs or files. No conversation → throws `agent_lane_closed`, never a silent null. */
  prepareInput(): Promise<LaneConversationAddress>
  receipt(subscriptionId: string, command: LaneReceiptCommand): Promise<LaneCommandResult>
  singleShot(request: LaneSingleShotRequest): Promise<LaneCommandResult>
  abortSingleShot(requestId: string): Promise<LaneCommandResult>
  /** 当前打开的那条对话。等价于 `workspace().active`，留着是因为绝大多数消费者只要这一份。 */
  projection(): LaneProjection
  /** 这个项目的对话列表 + 当前那条。 */
  workspace(): LaneWorkspaceProjection
  lanes(): readonly LaneSummary[]
  subscribe(listener: (projection: LaneWorkspaceProjection) => void): () => void
  prompt(text: string): Promise<LaneCommandResult>
  /**
   * 「用户在输入框里打了这句话」——**唯一**该被 composer 调用的那个方法。
   *
   * 它不自己决定这句话是什么意思：判据在 `laneComposerIntent`（中立契约层，主进程侧的
   * 验收门用的是同一份）。composer 只负责把用户按的是回车还是那个明确的按钮告诉它。
   */
  say(text: string, choice?: 'primary' | 'secondary', context?: LaneComposerContext, expected?: LaneConversationAddress): Promise<LaneCommandResult>
  /** 这句话现在会走哪条路。面板用它渲染次选按钮，不用它做决定。 */
  intent(text: string): LaneComposerIntent
  /** 「等这一步做完就听我的」。 */
  steer(text: string): Promise<LaneCommandResult>
  /** 「等它整个做完再说」。 */
  followUp(text: string): Promise<LaneCommandResult>
  /** 撤回一条排队的插话。结果三态，见 `LaneCancelQueuedResult`。 */
  cancelQueued(entryId: string, expected?: LaneConversationAddress): Promise<LaneCommandResult>
  /** 对话列表的三件事。切换/新建会把当前那条关掉——等待中的卡随之以「关窗」收尾。 */
  selectLane(laneName: string): Promise<LaneCommandResult>
  createLane(laneName: string): Promise<LaneCommandResult>
  deleteLane(laneName: string): Promise<LaneCommandResult>
  /**
   * 审批卡上的三个动作。第四个是 `abort()`——「停」停的是整轮，不是这一次，
   * 所以它不该长成第四个 action（那会让它看起来像「拒绝得更用力一点」）。
   *
   * `toolCallId` 必须由调用方从 `projection().pending` 取：它证明用户答的是**那一张卡**。
   * 「答当前那张」这种写法在用户点得慢、卡已经翻篇时会把答案落到下一张上。
   */
  approve(toolCallId: string, expected?: LaneConversationAddress): Promise<LaneCommandResult>
  approveForSession(toolCallId: string, expected?: LaneConversationAddress): Promise<LaneCommandResult>
  /** 「不要」+ 可选的一句话。那句话会一字不改成为模型看到的 tool result。 */
  deny(toolCallId: string, reason?: string, expected?: LaneConversationAddress): Promise<LaneCommandResult>
  /**
   * **回答**一张提问卡。`text` 一字不改成为模型看到的 tool result，同一个回合继续。
   *
   * 它和 `deny` 分开是因为用户做的不是同一件事：拒绝是「别做这个」，回答是「我告诉你」。
   * 走同一个 action 的那一版里，转录留下的是一条「用户拒绝了」，面板那一行只能靠嗅 args
   * 把它读回成「已回答」——两个说法，第二个还得靠猜。空串会被主进程拒收。
   */
  answer(toolCallId: string, text: string, expected?: LaneConversationAddress): Promise<LaneCommandResult>
  /** 停。回值里可能带着用户没送出去的话——调用方**必须**把它放回输入框。 */
  abort(expected?: LaneConversationAddress): Promise<LaneCommandResult>
  loadOlder(): Promise<LaneCommandResult>
  dispose(): void
}

const NO_BRIDGE: LaneCommandResult = {
  ok: false,
  code: 'agent_lane_bridge_absent',
  diagnostic: 'nomiDesktop.agentLane is not exposed on this build',
}

export function createLaneClient(bridge: LaneBridge | undefined = resolveLaneBridge()): LaneClient {
  let latest: LaneWorkspaceProjection = EMPTY_LANE_WORKSPACE
  let current: Readonly<{ subscriptionId: string; binding: ProjectBinding }> | null = null
  let reopen: { binding: ProjectBinding; model?: LaneComposerContext['model'] } | null = null
  let openedModel: LaneComposerContext['model']
  const openingProjections = new Map<string, LaneWorkspaceProjection>()
  let openingEpoch: number | null = null
  let epoch = 0
  let connectionEpoch = 0
  const listeners = new Set<(projection: LaneWorkspaceProjection) => void>()
  // `useSyncExternalStore` 的 getter 必须**引用稳定**：只在真收到新投影时换对象。
  // 这条不是风格问题——仓库里 6 个手写 store 之一因为每次 getter 新建对象，
  // 在「有待决工具」时把整页打成「工作台加载失败」（G6 判据②）。
  const publish = (projection: LaneWorkspaceProjection) => {
    if (projection.workspaceId && !current) {
      if (openingEpoch === epoch) openingProjections.set(projection.workspaceId, projection)
      return
    }
    if (projection.workspaceId && current && projection.workspaceId !== current.subscriptionId) return
    if (projection.closed) {
      // Closing an older workspace during open/close cannot seed reauthorization.
      if (!current) return
      reopen = { binding: current.binding, model: openedModel }
      current = null
    }
    latest = projection
    for (const listener of listeners) listener(projection)
  }
  let unsubscribe: (() => void) | undefined
  const connect = (next: LaneBridge | undefined) => {
    unsubscribe?.()
    bridge = next
    current = null
    reopen = null
    openingProjections.clear()
    openingEpoch = null
    epoch += 1
    publish(EMPTY_LANE_WORKSPACE)
    const connectedEpoch = ++connectionEpoch
    const connectedBridge = bridge
    unsubscribe = bridge?.onProjection((projection) => {
      if (connectedBridge !== bridge || connectedEpoch !== connectionEpoch) return
      publish(projection)
    })
  }
  connect(bridge)
  // 「这次 open 还没落定」。面板刚打开的那一两秒里用户就打字/点按钮是常态：以前这些命令
  // 带着一个**空身份**发出去（`current` 还是 null），主进程那边当然找不到归属，于是回一条
  // 失败、那句话还得他自己重打。现在它们等自己这次 open 落定，再带着真身份发。
  let opening: Promise<unknown> | undefined
  const conversation = (): LaneConversationAddress | null => {
    const ref = laneConversationOf(latest)
    return current && ref ? { ...ref, workspaceId: current.subscriptionId } : null
  }
  const stale = (): LaneCommandResult => ({ ok: false, code: 'agent_lane_workspace_stale', diagnostic: 'conversation changed before command admission' })
  const prepareInput = async (): Promise<LaneConversationAddress> => {
    const startedBridge = bridge
    const startedEpoch = epoch
    if (opening) await opening.catch(() => undefined)
    if (startedBridge !== bridge || startedEpoch !== epoch) throw new LaneCommandFailure('agent_lane_workspace_stale', 'input opening was replaced')
    if (reopen) {
      const previous = reopen
      const pending = open(previous.binding, previous.model)
      const generation = epoch
      const result = await pending
      if (!result.ok) {
        if (generation === epoch) reopen = previous
        throw new LaneCommandFailure(result.code, result.diagnostic)
      }
      if (generation !== epoch || !current || current.subscriptionId !== result.workspaceId) {
        throw new LaneCommandFailure('agent_lane_workspace_stale', 'input reauthorization was replaced')
      }
    }
    // 没有可装进去的对话 = 这句话发不出去。以前这里回 null，发送钮据此**静默**返回：
    // 用户点了没反应、字留在框里、哪儿都没有一句话（2026-09-24 Windows 真机，列表认不出对话）。
    const address = conversation()
    if (!address) throw new LaneCommandFailure('agent_lane_closed', 'no conversation to admit input into')
    return address
  }
  const send = async (command: LaneDesktopCommand, expected?: LaneConversationAddress): Promise<LaneCommandResult> => {
    if (!bridge) return NO_BRIDGE
    const startedBridge = bridge
    const startedEpoch = epoch
    const scoped = command.kind === 'prompt' || command.kind === 'steer' || command.kind === 'follow-up'
      || command.kind === 'abort' || command.kind === 'approval' || command.kind === 'cancel-queued' || command.kind === 'history-older'
    let address = scoped ? expected ?? conversation() : null
    // open / close 本身不能等自己（那是死锁），只有「装进这条对话」的命令要等。
    if (opening && command.kind !== 'workspace-open' && command.kind !== 'workspace-close') {
      await opening.catch(() => undefined)
      if (startedEpoch !== epoch || startedBridge !== bridge) return stale()
      if (scoped && !address) address = conversation()
    }
    if (command.kind === 'prompt' && reopen) {
      try {
        const opened = await prepareInput()
        if (scoped && !address) address = opened
      } catch (error) {
        if (error instanceof LaneCommandFailure) return { ok: false, code: error.laneCode, diagnostic: '' }
        throw error
      }
    }
    if (address) {
      const now = conversation()
      if (!now || address.workspaceId !== now.workspaceId || address.laneName !== now.laneName || address.sessionId !== now.sessionId) return stale()
    }
    return bridge.send({ ...command, ...(current ? { workspaceId: current.subscriptionId } : {}),
      ...(address ? { expectedLane: address.laneName, expectedSessionId: address.sessionId } : {}) })
  }

  const approval = (toolCallId: string, action: LaneApprovalAction, reason?: string, expected?: LaneConversationAddress) =>
    send({ kind: 'approval', toolCallId, action, ...(reason?.trim() ? { reason } : {}) }, expected)

  const open: LaneClient['open'] = async (binding, model) => {
    const generation = ++epoch
    current = null
    reopen = null
    openingProjections.clear()
    openingEpoch = generation
    openedModel = model
    publish(EMPTY_LANE_WORKSPACE)
    const inFlight = send({ kind: 'workspace-open', binding, ...(model ? { model } : {}) })
    opening = inFlight
    try {
      const result = await inFlight
      if (generation === epoch && result.ok && result.workspaceId) {
        current = Object.freeze({ subscriptionId: result.workspaceId, binding: Object.freeze({ ...binding }) })
        const buffered = openingProjections.get(result.workspaceId)
        if (buffered) publish(buffered)
      }
      return result
    } finally {
      if (opening === inFlight) opening = undefined
      if (openingEpoch === generation) { openingEpoch = null; openingProjections.clear() }
    }
  }

  return {
    connect,
    open,
    close: async () => {
      const closing = ++epoch
      reopen = null
      const result = await send({ kind: 'workspace-close' })
      if (!result.ok) throw new LaneCommandFailure(result.code, result.diagnostic)
      if (closing === epoch) {
        current = null
        publish(EMPTY_LANE_WORKSPACE)
      }
    },
    setPolicy: (policy) => send({ kind: 'workspace-policy', policy }),
    context: () => current,
    conversation,
    prepareInput,
    singleShot: (request) => send({ kind: 'single-shot', ...request }),
    abortSingleShot: (requestId) => send({ kind: 'single-shot-abort', requestId }),
    receipt: (subscriptionId, command) => {
      if (current?.subscriptionId !== subscriptionId) return Promise.resolve({ ok: false, code: 'agent_lane_workspace_stale', diagnostic: 'receipt addressed a workspace this window no longer owns' })
      return send(command)
    },
    projection: () => latest.active,
    workspace: () => latest,
    lanes: () => latest.lanes,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    prompt: (text: string) => send({ kind: 'prompt', text }),
    intent: (text: string) => laneComposerIntent(latest.active, text),
    say: (text: string, choice: 'primary' | 'secondary' = 'primary', context?: LaneComposerContext, expected?: LaneConversationAddress) => {
      const intent = laneComposerIntent(latest.active, text)
      // 空闲态没有次选。用户在「新一轮」上按不到第二个按钮，所以这里回落到主动作而不是抛：
      // 抛会让一次正常的回车在极短的状态竞态里（刚跑完那一瞬）变成一个错误弹窗。
      const chosen = choice === 'secondary' ? intent.secondary ?? intent.primary : intent.primary
      return send({ ...chosen.command, ...(context ? { context } : {}) }, expected)
    },
    steer: (text: string) => send({ kind: 'steer', text }),
    followUp: (text: string) => send({ kind: 'follow-up', text }),
    cancelQueued: (entryId: string, expected) => send({ kind: 'cancel-queued', entryId }, expected),
    selectLane: (laneName: string) => send({ kind: 'lane-select', laneName }),
    createLane: (laneName: string) => send({ kind: 'lane-create', laneName }),
    deleteLane: (laneName: string) => send({ kind: 'lane-delete', laneName }),
    approve: (toolCallId: string, expected) => approval(toolCallId, 'allow-once', undefined, expected),
    approveForSession: (toolCallId: string, expected) => approval(toolCallId, 'allow-session', undefined, expected),
    deny: (toolCallId: string, reason?: string, expected?: LaneConversationAddress) => approval(toolCallId, 'deny', reason, expected),
    answer: (toolCallId: string, text: string, expected?: LaneConversationAddress) => approval(toolCallId, 'answer', text, expected),
    abort: (expected) => send({ kind: 'abort' }, expected),
    loadOlder: () => {
      const before = latest.active.history?.before
      return before && latest.active.history?.hasMore
        ? send({ kind: 'history-older', before, expectedLane: latest.active.lane })
        : Promise.resolve({ ok: true })
    },
    dispose: () => {
      unsubscribe?.()
      listeners.clear()
    },
  }
}

/** 通道名从中立契约层来，两侧永远同一个字面量。 */
export const LANE_CHANNELS = LANE_IPC_CHANNELS

/** One subscription owner for the persistent panel and collapsed dock. */
export const laneClient = createLaneClient()
