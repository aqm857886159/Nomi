import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import type { LaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';

/** 未知工具名在连败计数器里共用的那一个名字（不是任何真实工具名：真实工具名不含括号）。 */
const LANE_UNKNOWN_TOOL = '(unknown tool)';

export interface LaneQueuedTurnItem {
  readonly kind: 'steer' | 'followUp';
  readonly message: AgentMessage;
}

/** 回合停止权、请求预算与取消后交回的输入；宿主只负责装配和驱动。 */
export function createLaneTurnBudget(failures: LaneRepeatedFailureTracker, maxModelRequests: number | undefined) {
  const turn = { runId: '', requests: 0, over: false };
  const unconsumed: LaneQueuedTurnItem[] = [];

  return {
    isOver: () => turn.over,
    end: () => { turn.over = true; },
    onBeforeRequest: (input: {
      runId: string;
      isRetry: boolean;
      abortWithQueued: () => readonly LaneQueuedTurnItem[];
    }): boolean => {
      if (input.isRetry) return true;
      if (turn.runId !== input.runId) {
        turn.runId = input.runId;
        turn.requests = 0;
        turn.over = false;
      }
      if (turn.over || (maxModelRequests !== undefined && turn.requests >= maxModelRequests)) {
        unconsumed.push(...input.abortWithQueued());
        return false;
      }
      turn.requests += 1;
      return true;
    },
    onMessageEnd: (runId: string, message: AgentMessage): void => {
      if (message.role !== 'user' && !isLaneInputMessage(message)) return;
      failures.reset();
      if (runId === turn.runId) turn.over = false;
    },
    onToolEnd: (toolName: string, isError: boolean, registeredToolNames: ReadonlySet<string>): void => {
      if (registeredToolNames.has(toolName) || !isError) return;
      if (failures.block(LANE_UNKNOWN_TOOL)) turn.over = true;
      else failures.note(LANE_UNKNOWN_TOOL, true);
    },
    drainUnconsumed: (): LaneQueuedTurnItem[] => unconsumed.splice(0),
  };
}
