// NomiEvent schema v1 —— harness 总方案 §1.1 的代码定稿(同时是评测体系的轨迹格式)。
// 纪律:任何事件类型必须有产品投影(进度/错误/成本/配方/步骤/记忆之一)才允许进 schema;
// 触发器观测事件(context.capped)的投影是对话内"AI 已不再记得最早 N 轮"提示。
// 演进:v 字段 + 载入 upcast 链(仿 projectRecordSchema 先例);历史永不回写。

/** 链路键三层:causeId=事件级因果;txnId/proposalId=事务分组;runId 是 vendor 域 payload 内的配对键。 */
export type NomiEventSource = "user" | "agent" | "runtime" | "system";

export type NomiEvent = {
  v: 1;
  /** evt_<随机> —— 产生端铸;全局顺序以 seq 为唯一权威(跨进程 id 不保序)。 */
  id: string;
  /** 单写者(eventLogRepository)append 时统一编号,严格递增。 */
  seq: number;
  ts: string;
  source: NomiEventSource;
  causeId?: string;
  txnId?: string;
  proposalId?: string;
  type: string;
  /** 单事件序列化 ≤4KB(写入端断言);超限字段截断,全文落 sidecar 存引用。 */
  payload: Record<string, unknown>;
};

/** append 入参:seq/ts 由仓库统一补,其余调用方给。 */
export type NewNomiEvent = Omit<NomiEvent, "v" | "seq" | "ts">;

// ---------------------------------------------------------------------------
// 事件域(v1 首批)。字符串联合而非 enum:载入老日志时未知 type 原样保留不丢。
// ---------------------------------------------------------------------------

/** agent 域 —— 投影:计划卡 / 查看步骤 / 轮次 footer / 对账。 */
export type AgentEventType =
  | "agent.turn.started" //   { sessionId, skillKey, promptHead }
  | "agent.turn.finished" //  { sessionId, status: "ok"|"error"|"aborted", finalTextHead, finalTextSha256?, stepCount?, usage? }
  | "agent.tool.proposed" //  { toolCallId, toolName, args }
  | "agent.tool.completed" // { toolCallId, toolName, ok, resultHead }
  | "agent.proposal.approved" // { toolCallId } (S6 起补 effectiveArgs/overridesDelta)
  | "agent.proposal.rejected" // { toolCallId, message }
  | "agent.turn.error" //     { sessionId, message } —— 投影:人话错误卡
  | "agent.gate.denied"; //   { intent, reason(人话) }

/** context 域 —— 投影:对话内"已不再记得最早 N 轮"提示 + C1 触发器观测。 */
export type ContextEventType = "context.capped"; // { sessionKey, droppedCount, keptCount }

/** canvas / vendor / review / memory / undo 域在 S4/S5/S6/S9 落地;类型占位见总方案 §1.1。 */

/** 截断信息:被截断字段统一替换为该形状,sidecarRef 指向全文文件(events/sidecar/<seq>-<field>.json)。 */
export type TruncatedPayloadField = {
  truncated: true;
  head: string;
  byteSize: number;
  sha256: string;
  sidecarRef?: string;
};
