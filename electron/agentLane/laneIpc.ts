// Agent lane · IPC（重建 B6 · 影子期不注册）
//
// **这道桥和今天那道最大的区别不是通道数，是谁铸造身份。**
// 今天渲染层在 `projectAgentTurnCommands.ts:88-167` 里造出 thread / turn / item /
// executionToken / contextRef 再送过桥——宿主自有记录的身份生成在桥的**不可信一侧**
// （#546 V10）。这里渲染层只能说两句话：「跑这段提示词」和「停」（`LaneCommand`），
// 身份（sessionId / entryId / sequence）全部由主进程与 pi 铸造。
//
// ⚠️ **`registerAgentLaneIpc` 此刻不出现在 `main.ts` 里，这是刻意的。**
// 影子期用户走不到新通路，回滚面积因此为零（方案 §4.1 / §8.1 规则 O6）。
// `tests/agent-runtime/lane-unreachable.test.mts` 把这条钉成断言——手法与既有的
// `projectAgentCutoverStructure.test.ts`（断言 main.ts 不含 `registerAgentChatV2Ipc`）
// 同源，那条断言证明了这个手法在本仓行得通。
import { ipcMain, type WebContents } from 'electron'

import { assertTrustedSender } from '../ipcSenderGuard'
import { LANE_IPC_CHANNELS, type LaneHandle, type LaneProjection } from '../shared/agentLane/laneContracts'
import { LaneCommandError, parseLaneCommand } from './laneCommandCodec'

export interface LaneIpcDependencies {
  /** 当前这条 lane。阶段 1 一个窗口一条；多 lane 是阶段 3 的事，别提前把它设计进通道名。 */
  lane(): LaneHandle | undefined
  /** 推送目标。给函数而不是给对象，是因为窗口会被关掉重开，而订阅活得比窗口长。 */
  target(): WebContents | undefined
}

export interface LaneIpcRegistration {
  dispose(): void
}

/**
 * 注册两条通道，并把 lane 的投影推给渲染层。
 *
 * 推的是**全量有序段**，不是增量：阶段 1 要证的是「顺序对不对」，而增量推送会在这条
 * 结论上加一层「合并对不对」——两个问题混在一起，红了分不清是谁的错。增量是阶段 3 的事。
 */
export function registerAgentLaneIpc(dependencies: LaneIpcDependencies): LaneIpcRegistration {
  const push = (projection: LaneProjection) => {
    const target = dependencies.target()
    if (!target || target.isDestroyed()) return
    target.send(LANE_IPC_CHANNELS.projection, projection)
  }

  ipcMain.handle(LANE_IPC_CHANNELS.command, async (event, wire: unknown) => {
    assertTrustedSender(event)
    const lane = dependencies.lane()
    if (!lane) return { ok: false as const, code: 'agent_lane_closed', message: 'No agent lane is open for this project.' }
    try {
      await lane.execute(parseLaneCommand(wire))
    } catch (error) {
      // 解不出来的命令是**渲染层的**错，跑不动的命令是**运行时的**错。两者都回一句人话，
      // 不回错误码字符串——「回给调用方一个 code 就算交代了」正是 #547 §2.2⑤ 记的那条
      // 内外不对等（外部 MCP 客户端拿到可行动错误，我们自己的通道拿到一个码）。
      const code = error instanceof LaneCommandError ? error.code : 'agent_lane_execute_failed'
      return { ok: false as const, code, message: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true as const }
  })

  const lane = dependencies.lane()
  const unsubscribe = lane?.subscribe(push)
  // 通道刚接上时先推一份当前状态，否则渲染层要等到下一次变化才知道自己在看什么——
  // 冷重启后打开一条已经跑完的历史对话，那个「下一次变化」永远不会来。
  if (lane) push(lane.projection())

  return {
    dispose: () => {
      unsubscribe?.()
      ipcMain.removeHandler(LANE_IPC_CHANNELS.command)
    },
  }
}
