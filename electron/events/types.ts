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
  | "agent.proposal.approved" // { toolCallId, effectiveArgs?, overridesDelta? } —— S6-0 起携对账快照+偏好增量
  | "agent.proposal.rejected" // { toolCallId, message }
  | "agent.turn.error" //     { sessionId, message } —— 投影:人话错误卡
  | "agent.gate.denied" //    { toolCallId, reason(人话) } —— intent 经 causeId→tool.proposed 还原
  // S6-2 提议事务回执(渲染层经 events bridge 入账,事件级 proposalId/txnId 同批画布事件)。
  | "agent.txn.committed" //  { proposalId, steps[{toolCallId,toolName}], clientIdToNodeId? } —— S6-3 加 reconciliation
  | "agent.txn.aborted" //    { proposalId, reason, failedToolCallId, failedIndex, stepCount, compensatedNodeIds } —— 中途失败补偿回滚,零半截(I3)
  | "agent.txn.reverted"; //  { proposalId, ops } —— S6-5 整笔撤销(用户发起的补偿事务,source:user,期间用户工作保留)

/** context 域 —— 投影:对话内"已不再记得最早 N 轮"提示 + C1 触发器观测。 */
export type ContextEventType = "context.capped"; // { sessionKey, droppedCount, keptCount }

/** memory 域(S9) —— 投影:记忆卡「AI 记得 N 条」+ 纠正审计。 */
export type MemoryEventType =
  | "memory.fact.added" //     { fact: MemoryFact } —— 提炼器规则命中(source:system)或用户手动(source:user)
  | "memory.fact.corrected" // { factId, text, origin } —— 用户改文本=纠正(origin:user,自动提炼永不静默覆盖)
  | "memory.fact.removed"; //  { factId } —— 用户删除(墓碑:删除点之前的旧事件不再重提炼它)

/** experience 域 —— 对话闭环的候选/复用/状态投影；正文经过本地脱敏和长度限制。 */
export type ExperienceEventType =
  | "experience.candidate.created" // { candidate }
  | "experience.candidate.updated" // { candidate }
  | "experience.reuse.recorded"; // { candidate, reuse }

/** canvas / vendor / review / undo 域在 S4/S5/S6 落地;类型占位见总方案 §1.1。 */

/** 截断信息:被截断字段统一替换为该形状,sidecarRef 指向全文文件(events/sidecar/<seq>-<field>.json)。 */
export type TruncatedPayloadField = {
  truncated: true;
  head: string;
  byteSize: number;
  sha256: string;
  /** 原值类型:string 原样回读,json 经 JSON.parse 回读(sidecar 回读用,S5-a3)。 */
  valueKind: "string" | "json";
  sidecarRef?: string;
  /** 超硬上限被整段丢内容(不脱敏/不哈希/不落 sidecar):日志层不许因为一个大字段拖死主进程。 */
  oversize?: true;
};
