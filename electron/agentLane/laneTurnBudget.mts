import type { AgentHarness, AgentLane, AgentMessage } from '@earendil-works/pi-agent-core';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import { logWarn } from '../logging/logger.js';
import { isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import type { LaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';

/** 未知工具名在连败计数器里共用的那一个名字（不是任何真实工具名：真实工具名不含括号）。 */
const LANE_UNKNOWN_TOOL = '(unknown tool)';

/** 回合停止权、请求预算与取消后交回的输入；宿主只负责装配和驱动。 */
export function createLaneTurnBudget(failures: LaneRepeatedFailureTracker, maxModelRequests: number | undefined) {
  // 这一轮的预算只有一份，按 run 计；over 表示模型无视了「这一轮别再发」。
  const turn = { runId: '', requests: 0, over: false };
  // 这一轮被宿主收掉时，pi 从队列里拿走、还没送进模型的那几句用户话（插话 / 排队话）。
  // 「停止」那条路把它们还给输入框（`restoredInput`）；这里没有一次命令可以回话，所以在这一轮跑完后
  // 原样排回 lane 的队列：面板照旧显示它们（能撤回到输入框），用户下一句话时随新的一轮一起送进去。
  const unconsumed: Array<{ kind: 'steer' | 'followUp'; message: AgentMessage }> = [];
  const requeueUnconsumed = async (lane: AgentLane, context: Context): Promise<void> => {
    for (const item of unconsumed.splice(0)) {
      const queued = item.kind === 'steer'
        ? await lane.steer(item.message, undefined, context) : await lane.followUp(item.message, undefined, context);
      if (!queued.ok) logWarn('agent', 'lane-turn-requeue-failed', { kind: item.kind, error: queued.error._tag });
    }
  };

  return {
    isOver: (runId?: string) => (runId !== undefined && turn.runId !== runId ? false : turn.over),
    end: () => { turn.over = true; },
    requeueUnconsumed,
    attach(harness: AgentHarness<undefined>, lane: AgentLane, registeredToolNames: ReadonlySet<string>) {
      harness.events.on('run_start', (event) => {
        if (turn.runId !== event.runId) { turn.runId = event.runId; turn.requests = 0; turn.over = false; }
      });
      // ── 回合预算：唯一的判定点是「下一次模型请求」──
      // 每一次模型请求都过这里（立即结果、执行过的工具、未知工具名之后都一样），所以拒发只在这一处：
      // 这一轮已经结束（`turn.over`，模型无视了「别再发」）或宿主显式上限（`limits.maxModelRequests`，缺省不设）
      // 用完了，就用 pi 公开的取消原语 `requestAbort` 把这一轮收掉——请求不发出去，pi 自己把运行收尾成「已取消」。
      // `before_request` 本身不能拒（只能改 streamOptions，抛错会被吞掉）；`lane.abort()` 会等这一轮跑完，
      // 在钩子里 await 它等于等自己，所以只用不驱动的 `requestAbort`。
      // 2026-11-09 之前上限只判在 `before_tool`：pi 的立即结果（形状错、准备拒收、墙）根本不经过那里，
      // 设了 5 也照样发到 11 次。
      harness.hooks.on('before_request', async (event, hookContext) => {
        if (event.step !== 'assistant') return undefined;
        // 重试不消耗预算：`attempt` 在重试时递增，同一步会带着 2、3、4 再来一次。
        // 把重试算进步数，等于让一次网络抖动吃掉用户的回合。
        if (event.attempt !== 1) return undefined;
        if (turn.runId !== event.runId) { turn.runId = event.runId; turn.requests = 0; turn.over = false; }
        if (turn.over || (maxModelRequests !== undefined && turn.requests >= maxModelRequests)) {
          const aborted = await lane.requestAbort(event.runId, hookContext);
          if (aborted.ok) {
            unconsumed.push(...aborted.value.steer.map((message) => ({ kind: 'steer' as const, message })),
              ...aborted.value.followUp.map((message) => ({ kind: 'followUp' as const, message })));
          }
          return undefined;
        }
        turn.requests += 1;
        return undefined;
      });

      // 用户的话**真的进了模型的上下文**（新一轮的输入、或插话 / 排队话被这一轮吃进去）才算回合边界：
      // 连败清零、这一轮重新开放。排队那一刻不算——模型还没读到，墙先倒了它就又能空转三次。
      // 答卡（提问 / 报价）不是一条用户消息，它是那次工具调用的结果，在答的那一刻就清零（见 `execute`）。
      // 桌面端用户的话是 `nomi.input`（只在发给模型时才转成 user）；只认 `user` 时真 App 里永远不清零，
      // 连败跨回合累加，用户回一句话后第一次调用就被收掉（2026-11-15 并主线后起草拒收走查第 4 回合卡住）。
      harness.events.on('message_end', (event) => {
        if (event.message.role !== 'user' && !isLaneInputMessage(event.message)) return;
        failures.reset();
        if (event.runId === turn.runId) turn.over = false;
      });

      // 未知工具名是 pi 的立即结果，连入参边界都到不了（`prepareToolCall` 找不到工具）。它们记在同一个计数器的
      // 同一个名下（换一个瞎编的名字不算新的一条），连着 3 次之后再来一次，这一轮同样到此为止。
      harness.events.on('tool_end', (event) => {
        if (registeredToolNames.has(event.toolName) || !event.isError) return;
        if (failures.block(LANE_UNKNOWN_TOOL)) turn.over = true;
        else failures.note(LANE_UNKNOWN_TOOL, true);
      });

    },
  };
}
