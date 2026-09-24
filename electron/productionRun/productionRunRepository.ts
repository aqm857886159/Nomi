import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fsyncIfDurable } from "../durability";
import { writeJsonFileAtomic } from "../jsonFile";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { initialPlaybookStages, requireProductionPlaybook } from "./productionPlaybooks";
import { productionRunPaths, productionRunsRoot } from "./productionRunPaths";
import { createProductionRunLock } from "./productionRunLock";
import { applyProductionCommand, type ProductionCommandEffect } from "./productionRunReducer";
import { assertProductionPolicyReady } from "./productionPolicyReadiness";
import {
  applyBudgetEntry,
  createBudgetLedger,
  summarizeBudgetLedger,
  type BudgetLedger,
  type BudgetLedgerEntry,
} from "./budgetLedger";
import {
  PRODUCTION_RUN_SCHEMA_VERSION,
  type Approval,
  type AutomationPolicy,
  type CreateProductionRunInput,
  type ProductionGenerationShot,
  type ProductionRun,
  type ProductionRunSummary,
  type RunCommand,
  type RunCommandResult,
  type RunEvent,
} from "./productionRunTypes";
import type { PlanCandidate } from "../capabilityCore/executionContract";
import { generationShotEnvelopeOf } from "../shared/generationShotEnvelope";
import { buildProductionRunDraftSummary } from "./productionRunDraftSummary";
import { isCurrentRequestDispatched } from "../shared/contracts/productionDispatch";

type SnapshotEnvelope = {
  schemaVersion: number;
  snapshotCursor: number;
  run: ProductionRun;
  checksum: string;
};

type CommandRecord = {
  commandId: string;
  expectedRevision: number;
  resultRevision: number;
  eventCursors: number[];
};

export type ProductionRunRepositoryDeps = {
  projectDirResolver?: (projectId: string) => string | null;
  now?: () => string;
  randomId?: () => string;
};

export class ProductionRunRevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Production run revision conflict: expected ${expected}, actual ${actual}`);
    this.name = "ProductionRunRevisionConflictError";
  }
}

export class ProductionRunParseError extends Error {
  readonly code = "migration_parse_error" as const;

  constructor(filePath: string, lineNumber: number) {
    super(`migration_parse_error: invalid JSON in ${path.basename(filePath)} at line ${lineNumber}`);
    this.name = "ProductionRunParseError";
  }
}

const DEFAULT_POLICY: AutomationPolicy = {
  trustedHosts: [],
  allowedProviders: [],
  allowedModels: [],
  maxSpend: null,
  maxAttemptsPerJob: 1,
  minimizeUploads: true,
};

function checksum(snapshot: Omit<SnapshotEnvelope, "checksum">): string {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function envelopeFor(run: ProductionRun): SnapshotEnvelope {
  const value = { schemaVersion: PRODUCTION_RUN_SCHEMA_VERSION, snapshotCursor: run.snapshotCursor, run };
  return { ...value, checksum: checksum(value) };
}

function appendDurableJsonLine(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "a");
  try {
    fs.writeSync(fd, `${JSON.stringify(value)}\n`, undefined, "utf8");
    fsyncIfDurable(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readOptionalRecord(filePath: string): string | null {
  try { return fs.readFileSync(filePath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // Never turn permissions, I/O failure or an inaccessible path into trusted absence.
    throw Object.assign(new Error("Production run storage read failed"), { cause: error });
  }
}

function readJsonLines<T>(filePath: string, content = readOptionalRecord(filePath)): T[] {
  if (content === null) return [];
  const values: T[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line) as T);
    } catch {
      throw new ProductionRunParseError(filePath, index + 1);
    }
  }
  return values;
}

function runFromEvent(event: RunEvent | undefined): ProductionRun | null {
  const value = event?.payload?.run;
  return value && typeof value === "object" && !Array.isArray(value) ? value as ProductionRun : null;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function approvalFromPayload(value: unknown, runId: string): Approval {
  const record = objectValue(value, "approval");
  if (record.runId !== runId || typeof record.approvalId !== "string" || !record.approvalId.trim()) {
    throw new Error("Invalid production approval");
  }
  return record as Approval;
}

function budgetEntryFromPayload(value: unknown): BudgetLedgerEntry {
  const record = objectValue(value, "budget entry");
  if (typeof record.billingEntryId !== "string" || !record.billingEntryId.trim() || typeof record.kind !== "string") {
    throw new Error("Invalid budget entry");
  }
  return record as BudgetLedgerEntry;
}

/**
 * 2026-09-21 未知价开闸加了 `budget.unknownInFlight`（价格未知的在途笔数）。开闸前封存的快照与
 * 事件里没有这个字段，而当时未知价根本发不出授权，所以它对旧数据恒 0——在**读**的这一层补齐，
 * 不改盘上字节（投影读永远无副作用）。不补的话它会以 `undefined` 的身份流进一个声明为 number
 * 的字段，下游每一处读它的地方都得再猜一次。
 */
function withBudgetDefaults(run: ProductionRun): ProductionRun {
  if (Number.isSafeInteger(run.budget?.unknownInFlight)) return run;
  return { ...run, budget: { ...run.budget, unknownInFlight: 0 } };
}

function validSnapshot(content: string | null): SnapshotEnvelope | null {
  if (content === null) return null;
  try {
    const raw = JSON.parse(content) as SnapshotEnvelope;
    const value = { schemaVersion: raw.schemaVersion, snapshotCursor: raw.snapshotCursor, run: raw.run };
    return raw.checksum === checksum(value) ? raw : null;
  } catch {
    return null;
  }
}

function summarize(run: ProductionRun): ProductionRunSummary {
  const draft = buildProductionRunDraftSummary(run);
  return {
    ...(draft ? { draft } : {}),
    ...(run.authoring ? { authoring: run.authoring } : {}),
    runId: run.runId,
    projectId: run.projectId,
    revision: run.revision,
    status: run.status,
    stageId: run.stageId,
    playbook: run.playbook,
    origin: run.origin,
    budget: run.budget,
    updatedAt: run.updatedAt,
    dispatched: isCurrentRequestDispatched(run),
  };
}

export function createProductionRunRepository(deps: ProductionRunRepositoryDeps = {}) {
  const resolveProjectDir = deps.projectDirResolver ?? ((projectId: string) =>
    resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()));
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const repositoryOwnerId = `production-repository-${process.pid}-${randomId()}`;

  function projectDir(projectId: string): string {
    const dir = resolveProjectDir(String(projectId || "").trim());
    if (!dir) throw new Error(`Production project not found: ${projectId}`);
    return dir;
  }

  type EventPosition = { start: number; end: number; cursor: number; commandId: string };
  // One disposable journal index per repository, never a Run/object cache. Disk bytes remain
  // authoritative on every access; the full decoded UTF-8 content is compared, never size/mtime.
  let indexedJournal: { filePath: string; content: string; positions: EventPosition[] } | undefined;

  function readEventJournal(filePath: string, content = readOptionalRecord(filePath)) {
    const bytes = content ?? "";
    const previous = indexedJournal?.filePath === filePath ? indexedJournal : undefined;
    let positions: EventPosition[];
    if (previous?.content === bytes) positions = previous.positions;
    else {
      // A final line without a newline can still be extended, so never reuse its validation.
      const prefixEnd = previous ? previous.content.lastIndexOf("\n") + 1 : 0;
      const reuse = previous && bytes.startsWith(previous.content.slice(0, prefixEnd));
      const start = reuse ? prefixEnd : 0;
      positions = reuse ? previous.positions.filter(position => position.end < prefixEnd) : [];
      let lineNumber = reuse ? previous.content.slice(0, prefixEnd).split("\n").length : 1;
      let offset = start;
      while (offset < bytes.length) {
        const newline = bytes.indexOf("\n", offset);
        const end = newline === -1 ? bytes.length : newline;
        const line = bytes.slice(offset, end);
        if (line.trim()) {
          let event: RunEvent;
          try { event = JSON.parse(line) as RunEvent; }
          catch { throw new ProductionRunParseError(filePath, lineNumber); }
          positions.push({ start: offset, end, cursor: event?.cursor, commandId: event?.commandId });
        }
        offset = end + 1;
        lineNumber += 1;
      }
      // Commit only after every changed line validates. A malformed append cannot poison the index.
      indexedJournal = { filePath, content: bytes, positions };
    }
    const decode = (position: EventPosition): RunEvent => JSON.parse(bytes.slice(position.start, position.end)) as RunEvent;
    return {
      latest: () => positions.length ? decode(positions[positions.length - 1]) : undefined,
      forCommand: (commandId: string) => positions.filter(position => position.commandId === commandId).map(decode),
      after: (cursor: number) => positions.filter(position => position.cursor > cursor).map(decode),
      // Lazy and newest-first: a reader looking for one archived snapshot decodes until it finds
      // it, instead of paying `JSON.parse` for every event in the journal to look at the last one.
      reverse: function* (): Generator<RunEvent> {
        for (let index = positions.length - 1; index >= 0; index -= 1) yield decode(positions[index]);
      },
    };
  }

  function readEvents(projectId: string, runId: string, afterCursor = 0): RunEvent[] {
    const paths = productionRunPaths(projectDir(projectId), runId);
    return readEventJournal(paths.events).after(afterCursor);
  }

  /** Newest first, decoded on demand. The journal index is the same one `readEvents` uses. */
  function readEventsReverse(projectId: string, runId: string): Iterable<RunEvent> {
    const paths = productionRunPaths(projectDir(projectId), runId);
    return readEventJournal(paths.events).reverse();
  }

  function readApprovals(projectId: string, runId: string): Approval[] {
    const paths = productionRunPaths(projectDir(projectId), runId);
    return readJsonLines<Approval>(paths.approvals);
  }

  function replayBudget(projectId: string, runId: string, currency: string): BudgetLedger {
    const paths = productionRunPaths(projectDir(projectId), runId);
    return readJsonLines<BudgetLedgerEntry>(paths.budgetLedger)
      .reduce((ledger, entry) => applyBudgetEntry(ledger, entry), createBudgetLedger(currency));
  }

  function readBudgetLedger(projectId: string, runId: string): BudgetLedger {
    const run = read(projectId, runId);
    if (!run) throw new Error(`Production run not found: ${runId}`);
    return replayBudget(projectId, runId, run.budget.currency);
  }

  function rebuild(projectId: string, runId: string, throughCursor = Number.POSITIVE_INFINITY): ProductionRun | null {
    const events = readEvents(projectId, runId).filter((event) => event.cursor <= throughCursor);
    return runFromEvent(events.at(-1));
  }

  function read(projectId: string, runId: string): ProductionRun | null {
    const dir = projectDir(projectId);
    const paths = productionRunPaths(dir, runId);
    const eventContent = readOptionalRecord(paths.events);
    const snapshotContent = readOptionalRecord(paths.snapshot);
    if (eventContent === null && snapshotContent === null) return null;
    const latestEvent = readEventJournal(paths.events, eventContent).latest();
    const snapshot = validSnapshot(snapshotContent);
    if (snapshot && snapshot.snapshotCursor === (latestEvent?.cursor ?? snapshot.snapshotCursor)) return withBudgetDefaults(snapshot.run);
    // Reads may rebuild an in-memory projection for callers, but never repair
    // durable bytes. Backup/migration/rewrite belongs to an explicit command;
    // a projection read must be safe to retry after a crash and side-effect free.
    const recovered = runFromEvent(latestEvent);
    if (!recovered) throw new ProductionRunParseError(paths.snapshot, 0);
    return withBudgetDefaults(recovered);
  }

  function create(input: CreateProductionRunInput): ProductionRun {
    // 起草前先验入参：未登记的 playbook / 缺 brief 都造不出可推进的 Run。在**写盘前**抛人话错误，
    // 不静默降级成一个 stages/gates 全空、永远停在 draft 的坏 Run（那会同时污染事件流、快照、
    // 任务卡与 MCP 投影四处）。可用名单见 productionPlaybooks.ts。
    const playbook = requireProductionPlaybook(input.playbook.name);
    const brief = input.brief;
    if (!brief) throw new Error(`playbook「${playbook.name}」需要 brief（至少一句 goal）才能起草`);
    const dir = projectDir(input.projectId);
    const runId = input.runId?.trim() || `run-${randomId()}`;
    const paths = productionRunPaths(dir, runId);
    if (fs.existsSync(paths.events) || fs.existsSync(paths.snapshot)) throw new Error(`Production run already exists: ${runId}`);
    const timestamp = now();
    const stages = initialPlaybookStages(playbook, timestamp);
    const briefArtifact: ProductionRun["artifacts"][number] = { artifactId: "artifact-brief-v1", stageId: playbook.briefStageId, kind: "brief", status: "adopted", projectRelativePath: `.nomi/runs/${runId}/brief-v1.json`, createdAt: timestamp, adoptedAt: timestamp };
    const directionArtifact: ProductionRun["artifacts"][number] = { artifactId: "artifact-direction-v1", stageId: playbook.directionStageId, kind: "direction", status: "candidate", projectRelativePath: `.nomi/runs/${runId}/direction-v1.json`, createdAt: timestamp };
    const directionGate: ProductionRun["gates"][number] = { gateId: "gate-direction-v1", scope: "stage", status: "waiting", planHash: crypto.createHash("sha256").update(JSON.stringify(brief)).digest("hex"), jobIds: [], title: "Confirm creative direction", summary: "Review audience, channel, tone, and truthful selling points before any model or paid API call.", createdAt: timestamp, expiresAt: new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1000).toISOString() };
    const run: ProductionRun = {
      schemaVersion: PRODUCTION_RUN_SCHEMA_VERSION,
      runId,
      projectId: input.projectId,
      revision: 0,
      status: "awaiting_direction",
      stageId: playbook.directionStageId,
      playbook: input.playbook,
      origin: input.origin,
      brief,
      policy: { ...DEFAULT_POLICY, ...input.policy },
      budget: { currency: input.currency || "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
      planVersion: 1,
      snapshotCursor: 1,
      stages,
      gates: [directionGate],
      jobs: [],
      artifacts: [briefArtifact, directionArtifact],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const event: RunEvent = {
      schemaVersion: PRODUCTION_RUN_SCHEMA_VERSION,
      eventId: `evt-${randomId()}`,
      cursor: 1,
      runId,
      runRevision: 0,
      commandId: `create:${runId}`,
      type: "run.created",
      message: input.playbook.name,
      emittedAt: timestamp,
      payload: { run },
    };
    appendDurableJsonLine(paths.events, event);
    writeJsonFileAtomic(path.join(dir, `.nomi/runs/${runId}/brief-v1.json`), { schemaVersion: 1, kind: "brief", brief });
    writeJsonFileAtomic(path.join(dir, `.nomi/runs/${runId}/direction-v1.json`), { schemaVersion: 1, kind: "direction", brief, status: "awaiting_direction" });
    // 事件里的 run 快照必须自带**这条事件**的游标：否则从事件恢复出来的 run 会说自己停在 cursor 1，
    // 与最后一条事件（cursor 2）对不上 ⇒ 每次 read 都判定快照过期、反复重建。
    run.snapshotCursor = 2;
    appendDurableJsonLine(paths.events, {
      ...event,
      eventId: `evt-${randomId()}`,
      cursor: 2,
      type: "gate.waiting",
      message: "direction",
      payload: { run },
    } satisfies RunEvent);
    fs.writeFileSync(paths.commands, "", { encoding: "utf8", flag: "a" });
    writeJsonFileAtomic(paths.snapshot, envelopeFor(run));
    return run;
  }

  /** Create a single-shot generation operation without entering the legacy playbook driver. */
  function createGenerationDraft(input: {
    operationId: string;
    projectId: string;
    origin: ProductionRun['origin'];
    candidate: PlanCandidate;
    currency?: string;
    policy?: Partial<AutomationPolicy>;
    /**
     * P4 S6.5 生产入口: a multi-shot draft seeds its per-shot entries (anchor + video shots) here at
     * create time so patch/preview can shot-address them (S1 `generation.patch` reads plan.shots) and
     * gate_request can seal them into sub-contracts. Draft shots carry candidate/role/included only —
     * their sealed sub-contract is compiled at seal. Absent → single-shot draft (byte-identical to today).
     */
    shots?: ReadonlyArray<Pick<ProductionGenerationShot, "shotId" | "role" | "included" | "candidate">>;
    /** 见 `ProductionGenerationPlan.cardHidden`。 */
    cardHidden?: boolean;
  }): ProductionRun {
    const projectId = String(input.projectId || "").trim();
    const operationId = String(input.operationId || "").trim();
    if (!/^[A-Za-z0-9._:-]{1,240}$/.test(operationId)) throw new Error("Invalid generation operation id");
    const dir = projectDir(projectId);
    const paths = productionRunPaths(dir, operationId);
    if (fs.existsSync(paths.events) || fs.existsSync(paths.snapshot)) throw new Error(`Production run already exists: ${operationId}`);
    const timestamp = now();
    const run: ProductionRun = {
      schemaVersion: PRODUCTION_RUN_SCHEMA_VERSION,
      runId: operationId,
      projectId,
      revision: 0,
      status: "draft",
      stageId: "generate",
      playbook: { name: "generation.single-shot", version: "1.0.0" },
      origin: input.origin,
      policy: { ...DEFAULT_POLICY, ...(input.policy || {}) },
      budget: { currency: input.currency || "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
      planVersion: 1,
      snapshotCursor: 1,
      // A semantic multi-shot generation is one durable production pipeline.  Seed the
      // downstream stages at draft creation so the owner can advance the same Run after
      // the scheduler materializes its jobs; single-shot drafts keep the historical shape.
      stages: input.shots && input.shots.length > 0
        ? [
            { stageId: "generate", title: "Generate", status: "pending", order: 0 },
            { stageId: "qa", title: "QA", status: "pending", order: 1 },
            { stageId: "assemble", title: "Assemble", status: "pending", order: 2 },
            { stageId: "export", title: "Export", status: "pending", order: 3 },
          ]
        : [{ stageId: "generate", title: "Generate", status: "pending", order: 0 }],
      gates: [],
      jobs: [],
      artifacts: [],
      generationPlan: {
        operationId,
        state: "draft",
        ...(input.cardHidden === true ? { cardHidden: true } : {}),
        candidate: structuredClone(input.candidate),
        // P4 S6.5: seed draft shots (candidate/role/included; no sub-contract until seal). Single-shot
        // drafts omit shots entirely — the read path stays on the top-level candidate (老 Run 零迁移).
        ...(input.shots && input.shots.length > 0
          ? { shots: input.shots.map((shot) => ({ ...generationShotEnvelopeOf(shot), candidate: structuredClone(shot.candidate), updatedAt: timestamp })) }
          : {}),
        updatedAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const event: RunEvent = {
      schemaVersion: PRODUCTION_RUN_SCHEMA_VERSION,
      eventId: `evt-${randomId()}`,
      cursor: 1,
      runId: operationId,
      runRevision: 0,
      commandId: `generation.create:${operationId}`,
      type: "run.created",
      message: "generation.single-shot",
      emittedAt: timestamp,
      stageId: "generate",
      payload: { run },
    };
    appendDurableJsonLine(paths.events, event);
    fs.writeFileSync(paths.commands, "", { encoding: "utf8", flag: "a" });
    writeJsonFileAtomic(paths.snapshot, envelopeFor(run));
    return run;
  }

  function executeUnlocked(projectId: string, runId: string, command: RunCommand): RunCommandResult {
    const dir = projectDir(projectId);
    const paths = productionRunPaths(dir, runId);
    const journal = readEventJournal(paths.events);
    const priorEvents = journal.forCommand(command.commandId);
    if (priorEvents.length > 0) {
      const priorRun = runFromEvent(priorEvents.at(-1));
      if (!priorRun) throw new Error(`Production command result is corrupt: ${command.commandId}`);
      return { run: priorRun, events: priorEvents };
    }
    const latestEvent = journal.latest();
    const current = runFromEvent(latestEvent);
    if (!current) throw new Error(`Production run not found: ${runId}`);
    if (current.projectId !== projectId) throw new Error("Production run project mismatch");
    if (current.revision !== command.expectedRevision) {
      throw new ProductionRunRevisionConflictError(command.expectedRevision, current.revision);
    }
    const timestamp = now();
    let effect: ProductionCommandEffect;
    if (command.type === "approval.record") {
      const approval = approvalFromPayload(command.payload.approval, runId);
      const approvals = readJsonLines<Approval>(paths.approvals);
      const existing = approvals.find((item) => item.approvalId === approval.approvalId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(approval)) throw new Error("Approval id conflict");
      if (!existing) appendDurableJsonLine(paths.approvals, approval);
      effect = {
        run: { ...current, updatedAt: timestamp },
        eventType: "approval.recorded",
        message: approval.approvalId,
      };
    } else if (command.type === "budget.entry") {
      const entry = budgetEntryFromPayload(command.payload.entry);
      const ledger = replayBudget(projectId, runId, current.budget.currency);
      const nextLedger = applyBudgetEntry(ledger, entry);
      if (nextLedger !== ledger) appendDurableJsonLine(paths.budgetLedger, entry);
      effect = {
        run: { ...current, budget: summarizeBudgetLedger(nextLedger), updatedAt: timestamp },
        eventType: `budget.${entry.kind}`,
        message: entry.billingEntryId,
      };
    } else if (command.type === "gate.decide" && command.payload.status === "approved") {
      effect = applyProductionCommand(current, command, timestamp);
      const gateId = typeof command.payload.gateId === "string" ? command.payload.gateId.trim() : "";
      const gate = current.gates.find((item) => item.gateId === gateId);
      if (!gate) throw new Error(`Production gate not found: ${gateId}`);
      if (Date.parse(timestamp) >= Date.parse(gate.expiresAt)) throw new Error("Production gate has expired");
      // The budget authorization + policy-readiness check is ONLY for a spend gate (budget_envelope).
      // P4 S4 adds anchor_checkpoint gates that carry the anchor jobIds for reference but authorize NO
      // budget — the checkpoint asks "does the face look right?", not "may Nomi spend?" (the receipt
      // already covered the batch at confirmation). Firing this branch for it would (a) demand
      // policy.maxSpend be set and (b) re-authorize the ledger — neither is correct for a free checkpoint.
      if (command.payload.status === "approved" && gate.scope === "budget_envelope" && gate.jobIds.length > 0) {
        const jobs = gate.jobIds.map((jobId) => {
          const job = current.jobs.find((item) => item.jobId === jobId);
          if (!job) throw new Error(`Production job not found: ${jobId}`);
          return job;
        });
        const plan = current.generationPlan;
        const authorizationEnvelope = gate.authorizationDigest ? plan?.authorizationEnvelope : undefined;
        const receiptId = typeof command.payload.receiptId === "string" ? command.payload.receiptId.trim() : "";
        if (gate.authorizationDigest) {
          if (
            !authorizationEnvelope
            || !receiptId
            || plan?.authorizationDigest !== gate.authorizationDigest
            || plan.authorizationGateId !== gate.gateId
            || gate.planHash !== gate.authorizationDigest
            || authorizationEnvelope.gateId !== gate.gateId
            || authorizationEnvelope.costScope !== gate.costScope
            || authorizationEnvelope.expiresAt !== gate.expiresAt
            || authorizationEnvelope.jobs.map((job) => job.jobId).join("\n") !== gate.jobIds.join("\n")
            || jobs.some((job) => job.authorizationDigest !== gate.authorizationDigest)
          ) {
            throw new Error("Generation authorization gate is incomplete or inconsistent");
          }
        }
        assertProductionPolicyReady(current.policy, jobs);
        const maxSpend = authorizationEnvelope?.budget.maximum ?? current.policy.maxSpend!;
        const ledgerCeiling = authorizationEnvelope?.budget.ledgerCeiling ?? maxSpend;
        const approval: Approval = {
          approvalId: `approval:${gate.gateId}`,
          runId,
          scope: gate.scope,
          planHash: gate.planHash,
          ...(gate.authorizationDigest ? { authorizationDigest: gate.authorizationDigest } : {}),
          ...(receiptId ? { receiptId } : {}),
          jobIds: [...gate.jobIds],
          allowedProviders: [...new Set(jobs.map((job) => job.provider))],
          allowedModels: [...new Set(jobs.map((job) => job.model))],
          currency: current.budget.currency,
          maxSpend,
          maxAttemptsPerJob: current.policy.maxAttemptsPerJob,
          decidedAt: timestamp,
          expiresAt: gate.expiresAt,
        };
        const approvals = readJsonLines<Approval>(paths.approvals);
        const existingApproval = approvals.find((item) => item.approvalId === approval.approvalId);
        if (existingApproval && JSON.stringify(existingApproval) !== JSON.stringify(approval)) {
          throw new Error("Approval id conflict");
        }
        const ledger = replayBudget(projectId, runId, current.budget.currency);
        const authorization: BudgetLedgerEntry = {
          billingEntryId: `${approval.approvalId}:authorize`,
          kind: "authorize",
          amount: ledgerCeiling,
          occurredAt: timestamp,
        };
        const nextLedger = applyBudgetEntry(ledger, authorization);
        if (!existingApproval) appendDurableJsonLine(paths.approvals, approval);
        if (nextLedger !== ledger) appendDurableJsonLine(paths.budgetLedger, authorization);
        effect = { ...effect, run: { ...effect.run, budget: summarizeBudgetLedger(nextLedger) } };
      }
    } else {
      effect = applyProductionCommand(current, command, timestamp);
    }
    const cursor = (latestEvent?.cursor ?? 0) + 1;
    const next: ProductionRun = {
      ...effect.run,
      revision: current.revision + 1,
      snapshotCursor: cursor,
      updatedAt: timestamp,
    };
    const event: RunEvent = {
      schemaVersion: PRODUCTION_RUN_SCHEMA_VERSION,
      eventId: `evt-${randomId()}`,
      cursor,
      runId,
      runRevision: next.revision,
      commandId: command.commandId,
      type: effect.eventType,
      message: effect.message,
      emittedAt: timestamp,
      stageId: next.stageId,
      payload: { run: next, commandType: command.type },
    };
    appendDurableJsonLine(paths.events, event);
    const record: CommandRecord = {
      commandId: command.commandId,
      expectedRevision: command.expectedRevision,
      resultRevision: next.revision,
      eventCursors: [cursor],
    };
    appendDurableJsonLine(paths.commands, record);
    writeJsonFileAtomic(paths.snapshot, envelopeFor(next));
    return { run: next, events: [event] };
  }

  function execute(projectId: string, runId: string, command: RunCommand): RunCommandResult {
    const dir = projectDir(projectId);
    const paths = productionRunPaths(dir, runId);
    const lock = createProductionRunLock({
      filePath: paths.repositoryLock,
      epochPath: paths.repositoryLockEpoch,
      ownerId: repositoryOwnerId,
      now,
      randomId,
      durability: "ephemeral",
    });
    const lease = lock.acquire();
    try {
      return executeUnlocked(projectId, runId, command);
    } finally {
      try { lock.release(lease); } catch { /* preserve the command result or original failure */ }
    }
  }

  function list(projectId: string): ProductionRunSummary[] {
    const root = productionRunsRoot(projectDir(projectId));
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => read(projectId, entry.name))
      .filter((run): run is ProductionRun => run !== null)
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  return { create, createGenerationDraft, read, list, execute, readEvents, readEventsReverse, readApprovals, readBudgetLedger, rebuild };
}

export type ProductionRunRepository = ReturnType<typeof createProductionRunRepository>;
