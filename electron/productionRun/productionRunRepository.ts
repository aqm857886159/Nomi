import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../jsonFile";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { productionRunPaths, productionRunsRoot } from "./productionRunPaths";
import { applyProductionCommand, type ProductionCommandEffect } from "./productionRunReducer";
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
  type ProductionRun,
  type ProductionRunSummary,
  type RunCommand,
  type RunCommandResult,
  type RunEvent,
} from "./productionRunTypes";

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

const DEFAULT_POLICY: AutomationPolicy = {
  mode: "balanced",
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
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readJsonLines<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const values: T[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line) as T);
    } catch {
      break;
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

function validSnapshot(filePath: string): SnapshotEnvelope | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as SnapshotEnvelope;
    const value = { schemaVersion: raw.schemaVersion, snapshotCursor: raw.snapshotCursor, run: raw.run };
    return raw.checksum === checksum(value) ? raw : null;
  } catch {
    return null;
  }
}

function summarize(run: ProductionRun): ProductionRunSummary {
  return {
    runId: run.runId,
    projectId: run.projectId,
    revision: run.revision,
    status: run.status,
    stageId: run.stageId,
    playbook: run.playbook,
    origin: run.origin,
    budget: run.budget,
    updatedAt: run.updatedAt,
  };
}

export function createProductionRunRepository(deps: ProductionRunRepositoryDeps = {}) {
  const resolveProjectDir = deps.projectDirResolver ?? ((projectId: string) =>
    resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()));
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());

  function projectDir(projectId: string): string {
    const dir = resolveProjectDir(String(projectId || "").trim());
    if (!dir) throw new Error(`Production project not found: ${projectId}`);
    return dir;
  }

  function readEvents(projectId: string, runId: string, afterCursor = 0): RunEvent[] {
    const paths = productionRunPaths(projectDir(projectId), runId);
    return readJsonLines<RunEvent>(paths.events).filter((event) => event.cursor > afterCursor);
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
    if (!fs.existsSync(paths.events) && !fs.existsSync(paths.snapshot)) return null;
    const events = readJsonLines<RunEvent>(paths.events);
    const latestEvent = events.at(-1);
    const snapshot = fs.existsSync(paths.snapshot) ? validSnapshot(paths.snapshot) : null;
    if (snapshot && snapshot.snapshotCursor === (latestEvent?.cursor ?? snapshot.snapshotCursor)) return snapshot.run;
    if (fs.existsSync(paths.snapshot) && !snapshot) {
      const backup = path.join(paths.dir, `run.corrupt-${Date.now()}-${randomId().slice(0, 8)}.json`);
      fs.copyFileSync(paths.snapshot, backup);
    }
    const recovered = runFromEvent(latestEvent);
    if (recovered) writeJsonFileAtomic(paths.snapshot, envelopeFor(recovered));
    return recovered;
  }

  function create(input: CreateProductionRunInput): ProductionRun {
    const dir = projectDir(input.projectId);
    const runId = input.runId?.trim() || `run-${randomId()}`;
    const paths = productionRunPaths(dir, runId);
    if (fs.existsSync(paths.events) || fs.existsSync(paths.snapshot)) throw new Error(`Production run already exists: ${runId}`);
    const timestamp = now();
    const isBrandPromo = input.playbook.name === "brand.promo" && Boolean(input.brief);
    const stages: ProductionRun["stages"] = isBrandPromo
      ? [
          { stageId: "brief", title: "Brief", status: "completed", order: 0, startedAt: timestamp, completedAt: timestamp },
          { stageId: "direction", title: "Direction", status: "awaiting_gate", order: 1, startedAt: timestamp },
          { stageId: "script", title: "Script", status: "pending", order: 2 },
          { stageId: "storyboard", title: "Storyboard", status: "pending", order: 3 },
          { stageId: "build", title: "Canvas", status: "pending", order: 4 },
          { stageId: "generate", title: "Generate", status: "pending", order: 5 },
          { stageId: "qa", title: "QA", status: "pending", order: 6 },
          { stageId: "assemble", title: "Assemble", status: "pending", order: 7 },
          { stageId: "export", title: "Export", status: "pending", order: 8 },
        ]
      : [];
    const briefArtifact: ProductionRun["artifacts"][number] | undefined = input.brief && isBrandPromo
      ? { artifactId: "artifact-brief-v1", stageId: "brief", kind: "brief", status: "adopted", projectRelativePath: `.nomi/runs/${runId}/brief-v1.json`, createdAt: timestamp, adoptedAt: timestamp }
      : undefined;
    const directionArtifact: ProductionRun["artifacts"][number] | undefined = input.brief && isBrandPromo
      ? { artifactId: "artifact-direction-v1", stageId: "direction", kind: "direction", status: "candidate", projectRelativePath: `.nomi/runs/${runId}/direction-v1.json`, createdAt: timestamp }
      : undefined;
    const directionGate: ProductionRun["gates"][number] | undefined = isBrandPromo
      ? { gateId: "gate-direction-v1", scope: "stage", status: "waiting", planHash: crypto.createHash("sha256").update(JSON.stringify(input.brief || {})).digest("hex"), jobIds: [], title: "Confirm creative direction", summary: "Review audience, channel, tone, and truthful selling points before any model or paid API call.", createdAt: timestamp, expiresAt: new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1000).toISOString() }
      : undefined;
    const initialArtifacts = [briefArtifact, directionArtifact].filter((value): value is ProductionRun["artifacts"][number] => Boolean(value));
    const run: ProductionRun = {
      schemaVersion: PRODUCTION_RUN_SCHEMA_VERSION,
      runId,
      projectId: input.projectId,
      revision: 0,
      status: isBrandPromo ? "awaiting_direction" : "draft",
      stageId: isBrandPromo ? "direction" : "brief",
      playbook: input.playbook,
      origin: input.origin,
      ...(input.brief ? { brief: input.brief } : {}),
      policy: { ...DEFAULT_POLICY, ...input.policy },
      budget: { currency: input.currency || "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
      planVersion: 1,
      snapshotCursor: 1,
      stages,
      gates: directionGate ? [directionGate] : [],
      jobs: [],
      artifacts: initialArtifacts,
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
    if (input.brief && isBrandPromo) {
      writeJsonFileAtomic(path.join(dir, `.nomi/runs/${runId}/brief-v1.json`), { schemaVersion: 1, kind: "brief", brief: input.brief });
      writeJsonFileAtomic(path.join(dir, `.nomi/runs/${runId}/direction-v1.json`), { schemaVersion: 1, kind: "direction", brief: input.brief, status: "awaiting_direction" });
      appendDurableJsonLine(paths.events, {
        ...event,
        eventId: `evt-${randomId()}`,
        cursor: 2,
        type: "gate.waiting",
        message: "direction",
        payload: { run },
      } satisfies RunEvent);
      run.snapshotCursor = 2;
    }
    fs.writeFileSync(paths.commands, "", { encoding: "utf8", flag: "a" });
    writeJsonFileAtomic(paths.snapshot, envelopeFor(run));
    return run;
  }

  function execute(projectId: string, runId: string, command: RunCommand): RunCommandResult {
    const dir = projectDir(projectId);
    const paths = productionRunPaths(dir, runId);
    const allEvents = readJsonLines<RunEvent>(paths.events);
    const priorEvents = allEvents.filter((event) => event.commandId === command.commandId);
    if (priorEvents.length > 0) {
      const priorRun = runFromEvent(priorEvents.at(-1));
      if (!priorRun) throw new Error(`Production command result is corrupt: ${command.commandId}`);
      return { run: priorRun, events: priorEvents };
    }
    const current = runFromEvent(allEvents.at(-1));
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
      if (gate.jobIds.length > 0) {
        const maxSpend = current.policy.maxSpend;
        if (maxSpend === null || !Number.isFinite(maxSpend) || maxSpend < 0) {
          throw new Error("Production approval requires a hard spend limit");
        }
        const jobs = gate.jobIds.map((jobId) => {
          const job = current.jobs.find((item) => item.jobId === jobId);
          if (!job) throw new Error(`Production job not found: ${jobId}`);
          if (!current.policy.allowedProviders.includes(job.provider) || !current.policy.allowedModels.includes(job.model)) {
            throw new Error(`Production job is outside the current policy: ${jobId}`);
          }
          return job;
        });
        const approval: Approval = {
          approvalId: `approval:${gate.gateId}`,
          runId,
          scope: gate.scope,
          planHash: gate.planHash,
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
          amount: maxSpend,
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
    const cursor = (allEvents.at(-1)?.cursor ?? 0) + 1;
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

  return { create, read, list, execute, readEvents, readApprovals, readBudgetLedger, rebuild };
}

export type ProductionRunRepository = ReturnType<typeof createProductionRunRepository>;
