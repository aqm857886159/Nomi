import type { ProjectBinding } from "./projectBinding";

export type ProjectAgentProposalCompensation =
  | Readonly<{ kind: "delete-nodes"; nodeIds: readonly string[] }>
  | Readonly<{ kind: "disconnect-edges"; pairs: readonly Readonly<{ source: string; target: string }>[] }>
  | Readonly<{ kind: "restore-prompt"; nodeId: string; prompt: string }>
  | Readonly<{ kind: "restore-graph"; nodes: readonly unknown[]; edges: readonly unknown[] }>
  | Readonly<{
      kind: "restore-snapshot";
      snapshot: Readonly<{ nodes: readonly unknown[]; edges: readonly unknown[]; groups: readonly unknown[] }>;
    }>;

export type ProjectAgentCommittedProposalRecord = Readonly<{
  proposalId: string;
  /** Stable request fingerprint used to distinguish replay from same-id conflict. */
  requestHash?: string;
  hostApprovalId?: string;
  hostActionHash?: string;
  summary: string;
  stepLabels: readonly string[];
  categoryCounts?: readonly Readonly<{ categoryId: string; label: string; count: number }>[];
  compensation: readonly ProjectAgentProposalCompensation[];
  watchNodes: readonly Readonly<{ nodeId: string; title: string; prompt: string }>[];
  reconciliationOk: boolean;
  anchorMessageId?: string;
  anchorTextOffset?: number;
}>;

export const PROJECT_AGENT_PROPOSAL_RECEIPT_LIFECYCLES = [
  "preparing",
  "committed",
  "undoing",
  "undone",
  "effect_unknown",
  "partial",
  "commit_failed",
] as const;

export type ProjectAgentProposalReceiptLifecycle = (typeof PROJECT_AGENT_PROPOSAL_RECEIPT_LIFECYCLES)[number];

export type ProjectAgentProposalReceiptView = Readonly<{
  binding: ProjectBinding;
  revision: number;
  lifecycle: ProjectAgentProposalReceiptLifecycle;
  proposalId: string;
  operationId: string;
  proposal: ProjectAgentCommittedProposalRecord;
  result?: unknown;
}>;

export type ProjectAgentProposalReceiptWrite = Readonly<{
  expectedRevision: number;
  proposalId: string;
  operationId: string;
  lifecycle: Extract<ProjectAgentProposalReceiptLifecycle, "preparing" | "committed">;
  proposal: ProjectAgentCommittedProposalRecord;
  result?: unknown;
}>;

export type ProjectAgentProposalReceiptTransition = Readonly<{
  expectedRevision: number;
  proposalId: string;
  operationId: string;
  lifecycle: Extract<ProjectAgentProposalReceiptLifecycle, "undoing" | "undone" | "effect_unknown" | "partial" | "commit_failed">;
}>;

export type ProjectAgentProposalReceiptClear = Readonly<{
  expectedRevision: number;
  proposalId: string;
  operationId: string;
}>;

const MAX_LIST_ITEMS = 10_000;
const MAX_OBJECT_KEYS = 256;
const MAX_STRING_LENGTH = 1_000_000;
const MAX_JSON_DEPTH = 24;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key));
}

function safeString(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== "string" || value.length > MAX_STRING_LENGTH) return null;
  if (!allowEmpty && (!value.trim() || value !== value.trim())) return null;
  return value;
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) return null;
  const parsed = value.map((item) => safeString(item, true));
  return parsed.every((item): item is string => item !== null) ? Object.freeze(parsed) : null;
}

function jsonClone(value: unknown, depth = 0): unknown | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "string" && value.length > MAX_STRING_LENGTH ? undefined : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > MAX_LIST_ITEMS) return undefined;
    const output: unknown[] = [];
    for (const item of value) {
      const cloned = jsonClone(item, depth + 1);
      if (cloned === undefined) return undefined;
      output.push(cloned);
    }
    return Object.freeze(output);
  }
  const source = record(value);
  if (!source || Object.keys(source).length > MAX_OBJECT_KEYS) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) return undefined;
    const cloned = jsonClone(item, depth + 1);
    if (cloned === undefined) return undefined;
    output[key] = cloned;
  }
  return Object.freeze(output);
}

function parseRestoreNode(value: unknown): unknown | null {
  const source = record(value);
  const position = record(source?.position);
  if (
    !source ||
    safeString(source.id) === null ||
    safeString(source.kind) === null ||
    safeString(source.title, true) === null ||
    !position ||
    typeof position.x !== "number" ||
    !Number.isFinite(position.x) ||
    typeof position.y !== "number" ||
    !Number.isFinite(position.y)
  ) {
    return null;
  }
  return jsonClone(source) ?? null;
}

function parseRestoreEdge(value: unknown): unknown | null {
  const source = record(value);
  if (
    !source ||
    safeString(source.id) === null ||
    safeString(source.source) === null ||
    safeString(source.target) === null
  ) {
    return null;
  }
  return jsonClone(source) ?? null;
}

function parseCompensation(value: unknown): ProjectAgentProposalCompensation | null {
  const source = record(value);
  if (!source || typeof source.kind !== "string") return null;
  if (source.kind === "delete-nodes") {
    if (!exactKeys(source, ["kind", "nodeIds"])) return null;
    const nodeIds = stringList(source.nodeIds);
    return nodeIds ? Object.freeze({ kind: "delete-nodes" as const, nodeIds }) : null;
  }
  if (source.kind === "disconnect-edges") {
    if (!exactKeys(source, ["kind", "pairs"]) || !Array.isArray(source.pairs) || source.pairs.length > MAX_LIST_ITEMS)
      return null;
    const pairs: Array<Readonly<{ source: string; target: string }>> = [];
    for (const value of source.pairs) {
      const pair = record(value);
      if (!pair || !exactKeys(pair, ["source", "target"])) return null;
      const from = safeString(pair.source);
      const to = safeString(pair.target);
      if (from === null || to === null) return null;
      pairs.push(Object.freeze({ source: from, target: to }));
    }
    return Object.freeze({ kind: "disconnect-edges" as const, pairs: Object.freeze(pairs) });
  }
  if (source.kind === "restore-prompt") {
    if (!exactKeys(source, ["kind", "nodeId", "prompt"])) return null;
    const nodeId = safeString(source.nodeId);
    const prompt = safeString(source.prompt, true);
    return nodeId !== null && prompt !== null
      ? Object.freeze({ kind: "restore-prompt" as const, nodeId, prompt })
      : null;
  }
  if (source.kind === "restore-graph") {
    if (
      !exactKeys(source, ["kind", "nodes", "edges"]) ||
      !Array.isArray(source.nodes) ||
      !Array.isArray(source.edges) ||
      source.nodes.length > MAX_LIST_ITEMS ||
      source.edges.length > MAX_LIST_ITEMS
    ) {
      return null;
    }
    const nodes = source.nodes.map(parseRestoreNode);
    const edges = source.edges.map(parseRestoreEdge);
    if (nodes.some((item) => item === null) || edges.some((item) => item === null)) return null;
    return Object.freeze({ kind: "restore-graph" as const, nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
  }
  if (source.kind === "restore-snapshot") {
    const snapshot = record(source.snapshot);
    if (
      !exactKeys(source, ["kind", "snapshot"]) ||
      !snapshot ||
      !exactKeys(snapshot, ["nodes", "edges", "groups"]) ||
      !Array.isArray(snapshot.nodes) ||
      !Array.isArray(snapshot.edges) ||
      !Array.isArray(snapshot.groups) ||
      snapshot.nodes.length > MAX_LIST_ITEMS ||
      snapshot.edges.length > MAX_LIST_ITEMS ||
      snapshot.groups.length > MAX_LIST_ITEMS
    ) return null;
    const nodes = snapshot.nodes.map(parseRestoreNode);
    const edges = snapshot.edges.map(parseRestoreEdge);
    const groups = snapshot.groups.map((group) => jsonClone(group));
    if (
      nodes.some((item) => item === null) ||
      edges.some((item) => item === null) ||
      groups.some((item) => item === undefined)
    ) return null;
    return Object.freeze({
      kind: "restore-snapshot" as const,
      snapshot: Object.freeze({
        nodes: Object.freeze(nodes),
        edges: Object.freeze(edges),
        groups: Object.freeze(groups),
      }),
    });
  }
  return null;
}

/** Fail-closed parser shared by main disk writes/reads and renderer hydration. */
export function parseProjectAgentCommittedProposal(value: unknown): ProjectAgentCommittedProposalRecord | null {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "proposalId",
      "requestHash",
      "hostApprovalId",
      "hostActionHash",
      "summary",
      "stepLabels",
      "categoryCounts",
      "compensation",
      "watchNodes",
      "reconciliationOk",
      "anchorMessageId",
      "anchorTextOffset",
    ])
  ) {
    return null;
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(source)).byteLength > MAX_RECORD_BYTES) return null;
  } catch {
    return null;
  }
  const proposalId = safeString(source.proposalId);
  const requestHash = source.requestHash === undefined ? undefined : safeString(source.requestHash);
  const hasHostApprovalId = source.hostApprovalId !== undefined;
  const hasHostActionHash = source.hostActionHash !== undefined;
  if (hasHostApprovalId !== hasHostActionHash) return null;
  const hostApprovalId = hasHostApprovalId ? safeString(source.hostApprovalId) : null;
  const hostActionHash = hasHostActionHash ? safeString(source.hostActionHash) : null;
  const summary = safeString(source.summary, true);
  const stepLabels = stringList(source.stepLabels);
  if (
    proposalId === null ||
    (source.requestHash !== undefined && (requestHash === undefined || requestHash === null || !/^[a-f0-9]{64}$/.test(requestHash))) ||
    (hasHostApprovalId &&
      (hostApprovalId === null || hostActionHash === null || !/^[a-f0-9]{64}$/.test(hostActionHash))) ||
    summary === null ||
    !stepLabels ||
    !Array.isArray(source.compensation) ||
    source.compensation.length > MAX_LIST_ITEMS ||
    !Array.isArray(source.watchNodes) ||
    source.watchNodes.length > MAX_LIST_ITEMS ||
    typeof source.reconciliationOk !== "boolean"
  ) {
    return null;
  }
  const compensation = source.compensation.map(parseCompensation);
  if (compensation.some((item) => item === null)) return null;

  const watchNodes: Array<Readonly<{ nodeId: string; title: string; prompt: string }>> = [];
  for (const value of source.watchNodes) {
    const watch = record(value);
    if (!watch || !exactKeys(watch, ["nodeId", "title", "prompt"])) return null;
    const nodeId = safeString(watch.nodeId);
    const title = safeString(watch.title, true);
    const prompt = safeString(watch.prompt, true);
    if (nodeId === null || title === null || prompt === null) return null;
    watchNodes.push(Object.freeze({ nodeId, title, prompt }));
  }

  let categoryCounts: Array<Readonly<{ categoryId: string; label: string; count: number }>> | undefined;
  if (source.categoryCounts !== undefined) {
    if (!Array.isArray(source.categoryCounts) || source.categoryCounts.length > MAX_LIST_ITEMS) return null;
    categoryCounts = [];
    for (const value of source.categoryCounts) {
      const category = record(value);
      if (!category || !exactKeys(category, ["categoryId", "label", "count"])) return null;
      const categoryId = safeString(category.categoryId);
      const label = safeString(category.label, true);
      if (
        categoryId === null ||
        label === null ||
        !Number.isSafeInteger(category.count) ||
        (category.count as number) < 0
      ) {
        return null;
      }
      categoryCounts.push(Object.freeze({ categoryId, label, count: category.count as number }));
    }
  }

  const hasAnchorId = source.anchorMessageId !== undefined;
  const hasAnchorOffset = source.anchorTextOffset !== undefined;
  if (hasAnchorId !== hasAnchorOffset) return null;
  const anchorMessageId = hasAnchorId ? safeString(source.anchorMessageId) : null;
  if (
    hasAnchorId &&
    (anchorMessageId === null || !Number.isSafeInteger(source.anchorTextOffset) || (source.anchorTextOffset as number) < 0)
  ) {
    return null;
  }

  return Object.freeze({
    proposalId,
    ...(requestHash ? { requestHash } : {}),
    ...(hostApprovalId !== null && hostActionHash !== null ? { hostApprovalId, hostActionHash } : {}),
    summary,
    stepLabels,
    ...(categoryCounts ? { categoryCounts: Object.freeze(categoryCounts) } : {}),
    compensation: Object.freeze(compensation as ProjectAgentProposalCompensation[]),
    watchNodes: Object.freeze(watchNodes),
    reconciliationOk: source.reconciliationOk,
    ...(anchorMessageId !== null
      ? { anchorMessageId, anchorTextOffset: source.anchorTextOffset as number }
      : {}),
  });
}
