// Agent lane · 中立快照与条目契约（纯类型，零运行时依赖，主进程与渲染层共用）
//
// `pi-coding-agent@1.7.0` 的 `SessionManager` v3 持有落盘条目树，`pi-agent-core@1.7.0` 的 `Agent`
// 持有流式与运行态；主进程 `laneSession` / `laneHost` / `laneHistory` 将两者拼成这份中立快照，
// 交给纯函数 `projectLaneSnapshot` 摊平成界面段。渲染层与设计实验室只 `import type` 本文件，
// 不把任何 Node / CLI 运行时拖进浏览器 bundle。
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, JsonValue, Usage } from '@earendil-works/pi-ai';

export interface LaneEntryBase {
  readonly id: string;
  readonly parentId: string | null;
  readonly seq: number;
  readonly timestamp: number;
}

export interface LaneMessageEntry extends LaneEntryBase {
  readonly type: 'message';
  readonly message: AgentMessage;
}

export interface LaneCustomEntry extends LaneEntryBase {
  readonly type: 'custom';
  readonly customType: string;
  readonly data?: JsonValue;
}

export interface LaneCompactionEntry extends LaneEntryBase {
  readonly type: 'compaction';
  readonly summary: string;
  readonly firstKeptEntryId: string | null;
  readonly tokensBefore: number;
  readonly details?: JsonValue;
  readonly usage?: Usage;
  readonly fromHook?: boolean;
}

export interface LaneBranchSummaryEntry extends LaneEntryBase {
  readonly type: 'branch_summary';
  readonly fromId: string;
  readonly summary: string;
  readonly details?: JsonValue;
  readonly usage?: Usage;
  readonly fromHook?: boolean;
}

export interface LaneContextEditEntry extends LaneEntryBase {
  readonly type: 'context_edit';
  readonly targetId: string;
  readonly replacement: { readonly content: unknown } | null;
}

export interface LaneModelChangeEntry extends LaneEntryBase {
  readonly type: 'model_change';
  readonly provider: string;
  readonly modelId: string;
}

export interface LaneThinkingLevelChangeEntry extends LaneEntryBase {
  readonly type: 'thinking_level_change';
  readonly thinkingLevel: string;
}

export interface LaneUsageEntry extends LaneEntryBase {
  readonly type: 'usage';
  readonly kind: string;
  readonly provider: string;
  readonly model: string;
  readonly usage: Usage;
  readonly note?: string;
}

export interface LaneLabelEntry extends LaneEntryBase {
  readonly type: 'label';
  readonly targetId: string;
  readonly label: string | undefined;
}

export interface LaneSessionInfoEntry extends LaneEntryBase {
  readonly type: 'session_info';
  readonly name?: string;
}

export type LaneEntry =
  | LaneMessageEntry
  | LaneCustomEntry
  | LaneCompactionEntry
  | LaneBranchSummaryEntry
  | LaneContextEditEntry
  | LaneModelChangeEntry
  | LaneThinkingLevelChangeEntry
  | LaneUsageEntry
  | LaneLabelEntry
  | LaneSessionInfoEntry;

export type LaneQueueItem =
  | {
      readonly entryId: string;
      readonly kind: 'steer' | 'followUp' | 'nextRun';
      readonly type?: 'message';
      readonly message: AgentMessage;
    }
  | {
      readonly entryId: string;
      readonly kind: 'write';
      readonly type: 'custom';
      readonly customType: string;
      readonly data?: JsonValue;
    }
  | {
      readonly entryId: string;
      readonly kind: 'write';
      readonly type: 'message';
      readonly message: AgentMessage;
    };

export interface LaneRunningToolSnapshot {
  readonly status: 'running' | 'completed';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
}

export interface LaneOperationSnapshot {
  readonly id?: string;
  readonly kind?: string;
  readonly startedAt?: number;
  readonly fromTipId?: string | null;
  readonly status?: string;
  readonly streamingMessage?: AssistantMessage;
  readonly runningTools?: readonly LaneRunningToolSnapshot[];
  readonly retry?: {
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly nextAttemptAt: number;
  };
}

export interface LaneSnapshot {
  readonly lane: string;
  readonly transcript: readonly LaneEntry[];
  readonly tipId: string | null;
  readonly configuration: {
    readonly model: { readonly provider: string; readonly modelId: string };
    readonly thinkingLevel: string;
    readonly activeToolNames: readonly string[];
  };
  readonly stats: {
    readonly messageCount: number;
    readonly usage: Usage;
  };
  readonly operation: LaneOperationSnapshot | null;
  readonly queues: readonly LaneQueueItem[];
  readonly faulted: boolean;
}

export interface LaneBranchQuery {
  readonly start?: string;
  readonly order?: 'newestFirst' | 'oldestFirst';
  readonly limit?: number;
  readonly cursor?: { readonly seq: number };
  readonly stopAtId?: string;
  readonly stopAtType?: LaneEntry['type'];
  readonly type?: LaneEntry['type'];
  readonly customType?: string;
}
