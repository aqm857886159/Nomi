// 项目记忆卡(harness S9,总方案 §C 层2)——EventLog 的物化视图。
// 数据流:EventLog →(零 LLM 规则提炼器,增量 lastDistilledSeq 游标)→ memory.json(缓存)
// → 注入 system prompt(渲染层裁预算)。memory.json 可删:下次 get 从 seq 0 全量重建,结果等价。
// 不变量:用户纠正过的事实(origin:user)自动提炼永不静默覆盖;用户删除留墓碑
// (删除点之前的旧事件不再重提炼同一事实,之后的新事件可以——重新上锁理应重新记住)。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { appendEvents, readEvents } from "../events/eventLogRepository";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import type { NomiEvent } from "../events/types";

export type MemoryFactKind = "character" | "style" | "brand" | "preference" | "constraint";

export type MemoryFact = {
  /** 规则键(rule:target):同键再命中=corrected 而非重复 added。 */
  id: string;
  /** 一句人话(注入 prompt 与记忆卡直接显示)。 */
  text: string;
  kind: MemoryFactKind;
  origin: "auto" | "user";
  /** 下钻溯源:产生/更新它的事件 seq。 */
  sourceSeqs: number[];
  pinned: boolean;
  updatedAt: string;
};

export type ProjectMemory = {
  facts: MemoryFact[];
  lastDistilledSeq: number;
  /** factId → 删除时游标:seq ≤ 该值的事件不再重提炼此事实。 */
  tombstones: Record<string, number>;
};

const emptyMemory = (): ProjectMemory => ({ facts: [], lastDistilledSeq: 0, tombstones: {} });

let projectDirResolver: (projectId: string) => string | null = (projectId) =>
  resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());

export function setProjectMemoryDirResolverForTests(resolver: (projectId: string) => string | null): void {
  projectDirResolver = resolver;
}

function memoryFilePath(projectId: string): string | null {
  const root = projectDirResolver(projectId);
  if (!root) return null;
  return path.join(root, ".nomi", "memory.json");
}

function loadMemory(projectId: string): ProjectMemory {
  const file = memoryFilePath(projectId);
  if (!file || !fs.existsSync(file)) return emptyMemory();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ProjectMemory>;
    return {
      facts: Array.isArray(raw.facts) ? (raw.facts as MemoryFact[]) : [],
      lastDistilledSeq: Number(raw.lastDistilledSeq) || 0,
      tombstones: raw.tombstones && typeof raw.tombstones === "object" ? (raw.tombstones as Record<string, number>) : {},
    };
  } catch {
    return emptyMemory(); // 缓存损坏即弃,可全量重建
  }
}

function saveMemory(projectId: string, memory: ProjectMemory): void {
  const file = memoryFilePath(projectId);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(memory, null, 2), "utf8");
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const headOf = (text: string, max = 80): string => {
  const trimmed = String(text || "").trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
};

/** 规则命中产物(纯数据,upsert 在外层统一做)。 */
type RuleHit = { id: string; text: string; kind: MemoryFactKind } | { removeId: string };

/** 零 LLM 提炼规则(v1,总方案 §C 层2 拍板):定妆实体 / 锁约束 / overridesDelta 偏好。 */
function distillEvent(event: NomiEvent): RuleHit[] {
  const payload = event.payload || {};
  if (event.type === "canvas.node.added") {
    const node = asRecord(payload.node);
    const kind = String(node.kind || "");
    if (kind !== "character" && kind !== "scene") return [];
    const title = String(node.title || "").trim();
    if (!title) return [];
    const prompt = headOf(String(node.prompt || ""));
    const noun = kind === "character" ? "角色" : "场景";
    return [{
      id: `node:${String(node.id || "")}`,
      text: prompt ? `${noun}「${title}」：${prompt}` : `项目里有${noun}卡「${title}」`,
      kind: "character",
    }];
  }
  if (event.type === "canvas.node.prompt-changed") {
    // 只更新已存在的实体事实(外层按 id 找不到就忽略——普通镜头节点不进记忆)。
    const nodeId = String(payload.nodeId || "");
    const prompt = headOf(String(payload.prompt || ""));
    if (!nodeId || !prompt) return [];
    return [{ id: `node:${nodeId}`, text: `__UPDATE_PROMPT__${prompt}`, kind: "character" }];
  }
  if (event.type === "canvas.node.removed") {
    const nodeId = String(payload.nodeId || "");
    return nodeId ? [{ removeId: `node:${nodeId}` }, { removeId: `lock:${nodeId}` }] : [];
  }
  if (event.type === "canvas.node.locked") {
    const nodeId = String(payload.nodeId || "");
    if (!nodeId) return [];
    const title = String(payload.title || "").trim();
    return [{
      id: `lock:${nodeId}`,
      text: `「${title || nodeId}」已被用户锁定：不要提议修改/删除/接入它，引用它当参考可以`,
      kind: "constraint",
    }];
  }
  if (event.type === "canvas.node.unlocked") {
    const nodeId = String(payload.nodeId || "");
    return nodeId ? [{ removeId: `lock:${nodeId}` }] : [];
  }
  if (event.type === "agent.proposal.approved") {
    const delta = asRecord(payload.overridesDelta);
    // 最强偏好信号(§1.1 双字段拍板):用户改写了 AI 提议——记一条通用偏好,反复命中只更新溯源。
    if (Object.keys(delta).length === 0) return [];
    return [{
      id: "pref:overrides",
      text: "用户会在确认前改写 AI 提议的内容（提示词等）——给出提议后以用户改后的版本为准，别复述旧版",
      kind: "preference",
    }];
  }
  return [];
}

/** 增量提炼 + 落缓存;返回最新记忆。memory.json 缺失/损坏时自动从 seq 0 全量重建。 */
export function getProjectMemory(projectId: string): ProjectMemory {
  const memory = loadMemory(projectId);
  const events = readEvents(projectId, { fromSeq: memory.lastDistilledSeq });
  if (events.length === 0) return memory;

  const factById = new Map(memory.facts.map((fact) => [fact.id, fact]));
  const tombstones = { ...memory.tombstones };
  const added: MemoryFact[] = [];
  const corrected: string[] = [];
  const removed: string[] = [];

  for (const event of events) {
    // 用户对记忆本身的操作(删/纠正/pin)以日志为真相源回放——memory.json 删掉后
    // 全量重建仍能复原墓碑与用户纠正(「可删可重建,结果等价」的硬前提)。
    if (event.type === "memory.fact.removed" && String(asRecord(event.payload).reason) === "user-removed") {
      const factId = String(asRecord(event.payload).factId || "");
      if (factId) {
        factById.delete(factId);
        tombstones[factId] = event.seq;
      }
      continue;
    }
    if (event.type === "memory.fact.corrected" && String(asRecord(event.payload).origin) === "user") {
      const payload = asRecord(event.payload);
      const fact = factById.get(String(payload.factId || ""));
      if (fact) {
        if (typeof payload.text === "string" && payload.text) {
          fact.text = payload.text;
          fact.origin = "user";
        }
        if (typeof payload.pinned === "boolean") fact.pinned = payload.pinned;
        fact.updatedAt = event.ts;
      }
      continue;
    }
    if (event.type === "memory.fact.user-added") {
      // 用户确认记住的软偏好(提议态转正/手动加)。origin:user,回放纳入(墓碑后于此事件才挡=可重加)。
      const f = asRecord(asRecord(event.payload).fact);
      const id = String(f.id || "");
      if (id && (tombstones[id] ?? -1) < event.seq) {
        factById.set(id, {
          id,
          text: String(f.text || ""),
          kind: (String(f.kind || "preference") as MemoryFactKind),
          origin: "user",
          sourceSeqs: [event.seq],
          pinned: Boolean(factById.get(id)?.pinned),
          updatedAt: event.ts,
        });
      }
      continue;
    }
    if (event.type.startsWith("memory.")) continue; // 提炼器自己的回执不再进规则
    for (const hit of distillEvent(event)) {
      if ("removeId" in hit) {
        const existing = factById.get(hit.removeId);
        if (existing && existing.origin !== "user") {
          factById.delete(hit.removeId);
          removed.push(hit.removeId);
        }
        continue;
      }
      // 墓碑:删除点之前的旧事件不再重提炼;之后的新事件正常(重新上锁理应重新记住)。
      if ((tombstones[hit.id] ?? -1) >= event.seq) continue;
      const existing = factById.get(hit.id);
      const isUpdate = hit.text.startsWith("__UPDATE_PROMPT__");
      if (isUpdate && !existing) continue; // prompt-changed 只更新已知实体
      if (existing?.origin === "user") {
        // 不变量:用户纠正过的文本永不静默覆盖,只补溯源。
        existing.sourceSeqs = [...existing.sourceSeqs.slice(-9), event.seq];
        continue;
      }
      const text = isUpdate
        ? existing!.text.replace(/：.*$/u, `：${hit.text.slice("__UPDATE_PROMPT__".length)}`)
        : hit.text;
      if (existing) {
        if (existing.text !== text) corrected.push(hit.id);
        existing.text = text;
        existing.sourceSeqs = [...existing.sourceSeqs.slice(-9), event.seq];
        existing.updatedAt = event.ts;
      } else {
        const fact: MemoryFact = {
          id: hit.id,
          text,
          kind: hit.kind,
          origin: "auto",
          sourceSeqs: [event.seq],
          pinned: false,
          updatedAt: event.ts,
        };
        factById.set(hit.id, fact);
        added.push(fact);
      }
    }
  }

  const next: ProjectMemory = {
    facts: [...factById.values()],
    lastDistilledSeq: events[events.length - 1].seq,
    tombstones,
  };

  // 回执入日志(审计投影);再把游标推过自己的回执,避免下轮空扫。
  const receipts = [
    ...added.map((fact) => ({ type: "memory.fact.added", payload: { fact: { ...fact } } })),
    ...corrected.map((factId) => ({ type: "memory.fact.corrected", payload: { factId, origin: "auto" } })),
    ...removed.map((factId) => ({ type: "memory.fact.removed", payload: { factId, reason: "source-gone" } })),
  ];
  if (receipts.length > 0) {
    const written = appendEvents(
      projectId,
      receipts.map((receipt) => ({ id: `evt_mem_${Math.random().toString(36).slice(2, 12)}`, source: "system" as const, ...receipt })),
    );
    if (written.length > 0) next.lastDistilledSeq = written[written.length - 1].seq;
  }
  saveMemory(projectId, next);
  return next;
}

/**
 * 注入 system prompt 的记忆段(单一真相源:创作区/生成区共享同一注入,见 agentChatV2)。
 * 预算 ≤约 1.5k token(CJK 按 1 字≈1 token 保守计,上限 1500 字符);
 * 超了按 pinned > 用户纠正 > 自动 + 新近度裁(总方案 §C 层2)。
 * 精度铁律:此处只搬 fact.text 原文,不做任何摘要/改写——精确值逐字进逐字出。
 */
export function formatMemoryForPrompt(facts: readonly MemoryFact[], budgetChars = 1500): string {
  if (facts.length === 0) return "";
  const ranked = [...facts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.origin !== b.origin) return a.origin === "user" ? -1 : 1;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
  const lines: string[] = [];
  let used = 0;
  for (const fact of ranked) {
    const line = `- ${fact.text}`;
    if (used + line.length > budgetChars) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return "";
  return `项目记忆（此前积累的事实，遵守其中的约束与偏好）：\n${lines.join("\n")}`;
}

/**
 * 用户确认记住一条软偏好（提议态「记住」转正 / 手动加）。origin:user、id 按文本 sha1 派生（同文本去重），
 * 永不被自动提炼覆盖（user 不变量）。精度铁律：原文逐字进，不摘要不改写。
 */
export function addUserMemoryFact(
  projectId: string,
  text: string,
  kind: MemoryFactKind = "preference",
): ProjectMemory {
  const clean = text.trim();
  if (!clean) return getProjectMemory(projectId);
  const id = `user:${crypto.createHash("sha1").update(clean).digest("hex").slice(0, 12)}`;
  appendEvents(projectId, [{
    id: `evt_mem_${Math.random().toString(36).slice(2, 12)}`,
    source: "user",
    type: "memory.fact.user-added",
    payload: { fact: { id, text: clean, kind, origin: "user" } },
  }]);
  // getProjectMemory 回放这条 user-added 事件把 fact 纳入（含墓碑判定 + 增量游标推进）。
  return getProjectMemory(projectId);
}

/** 用户改文本(纠正,origin→user)/pin。纠正进日志审计。 */
export function updateMemoryFact(
  projectId: string,
  factId: string,
  patch: { text?: string; pinned?: boolean },
): ProjectMemory {
  const memory = getProjectMemory(projectId);
  const fact = memory.facts.find((candidate) => candidate.id === factId);
  if (!fact) return memory;
  const textChanged = typeof patch.text === "string" && patch.text.trim() && patch.text.trim() !== fact.text;
  const pinChanged = typeof patch.pinned === "boolean" && patch.pinned !== fact.pinned;
  if (!textChanged && !pinChanged) return memory;
  if (pinChanged) fact.pinned = patch.pinned as boolean;
  if (textChanged) {
    fact.text = (patch.text as string).trim();
    fact.origin = "user";
  }
  // 用户操作入日志(纠正审计 + 「可删可重建」的回放源;pin 同理)。
  appendEvents(projectId, [{
    id: `evt_mem_${Math.random().toString(36).slice(2, 12)}`,
    source: "user",
    type: "memory.fact.corrected",
    payload: {
      factId,
      origin: "user",
      ...(textChanged ? { text: fact.text } : {}),
      ...(pinChanged ? { pinned: fact.pinned } : {}),
    },
  }]);
  saveMemory(projectId, memory);
  return memory;
}

/** 用户删除:留墓碑(当前游标),removed 进日志审计。 */
export function removeMemoryFact(projectId: string, factId: string): ProjectMemory {
  const memory = getProjectMemory(projectId);
  if (!memory.facts.some((fact) => fact.id === factId)) return memory;
  memory.facts = memory.facts.filter((fact) => fact.id !== factId);
  memory.tombstones[factId] = memory.lastDistilledSeq;
  appendEvents(projectId, [{
    id: `evt_mem_${Math.random().toString(36).slice(2, 12)}`,
    source: "user",
    type: "memory.fact.removed",
    payload: { factId, reason: "user-removed" },
  }]);
  saveMemory(projectId, memory);
  return memory;
}
