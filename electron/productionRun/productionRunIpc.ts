import { ipcMain } from "electron";

import { createProductionRunRepository, type ProductionRunRepository } from "./productionRunRepository";
import { getProductionRunService } from "./productionRunRuntime";
import type { ProductionRunService } from "./productionRunService";
import type { CreateProductionRunInput, RunCommand } from "./productionRunTypes";

const RENDERER_COMMAND_TYPES = new Set([
  "run.status",
  "gate.decide",
  "artifact.adopt",
  "plan.attach",
  "policy.refresh",
  "job.reconcile",
  "jobs.reassign",
]);

function identifier(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === "." || normalized === "..") throw new Error(`Invalid ${label} id`);
  return normalized;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function rendererCommandPayload(type: string, value: unknown): Record<string, unknown> {
  const raw = objectValue(value, "production command payload");
  if (type === "run.status") {
    return { status: typeof raw.status === "string" ? raw.status.trim() : raw.status };
  }
  if (type === "gate.decide") {
    return {
      gateId: identifier(raw.gateId, "gate"),
      status: typeof raw.status === "string" ? raw.status.trim() : raw.status,
    };
  }
  if (type === "plan.attach") {
    const rawBindings = Array.isArray(raw.bindings) ? raw.bindings : [];
    if (rawBindings.length > 128) throw new Error("Too many production bindings");
    const bindings = rawBindings.map((value, index) => {
      const binding = objectValue(value, `production binding ${index}`);
      const model = typeof binding.model === "string" ? binding.model.trim() : "";
      const hasControlCharacter = Array.from(model).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
      });
      if (!model || model.length > 240 || hasControlCharacter || model.startsWith("/") || model.startsWith("\\") || model.split(/[\\/]+/).includes("..")) {
        throw new Error(`Invalid production binding model ${index}`);
      }
      return {
        nodeId: identifier(binding.nodeId, "node"),
        provider: identifier(binding.provider, "provider"),
        model,
        stageId: identifier(binding.stageId ?? "generate", "stage"),
      };
    });
    return {
      artifactId: identifier(raw.artifactId, "artifact"),
      bindings,
    };
  }
  if (type === "policy.refresh") return {};
  if (type === "job.reconcile") {
    const outcome = typeof raw.outcome === "string" ? raw.outcome.trim() : "";
    if (outcome !== "found" && outcome !== "not_found") throw new Error("Invalid production reconciliation outcome");
    return { jobId: identifier(raw.jobId, "job"), outcome };
  }
  if (type === "jobs.reassign") {
    const rawJobIds = Array.isArray(raw.jobIds) ? raw.jobIds : [];
    return {
      jobIds: rawJobIds.map((jobId) => identifier(jobId, "job")),
      provider: identifier(raw.provider, "provider"),
      model: identifier(raw.model, "model"),
      reason: typeof raw.reason === "string" ? raw.reason.trim() : raw.reason,
    };
  }
  return { artifactId: identifier(raw.artifactId, "artifact") };
}

function createDraftInput(value: unknown): CreateProductionRunInput {
  const raw = objectValue(value, "production draft");
  const playbook = objectValue(raw.playbook, "playbook");
  const origin = objectValue(raw.origin, "origin");
  const rawBrief = raw.brief && typeof raw.brief === 'object' && !Array.isArray(raw.brief) ? raw.brief as Record<string, unknown> : null;
  const goal = typeof rawBrief?.goal === 'string' ? rawBrief.goal.trim() : '';
  const brief = goal ? {
    goal,
    ...(typeof rawBrief?.audience === 'string' && rawBrief.audience.trim() ? { audience: rawBrief.audience.trim() } : {}),
    ...(typeof rawBrief?.channel === 'string' && rawBrief.channel.trim() ? { channel: rawBrief.channel.trim() } : {}),
    ...(typeof rawBrief?.tone === 'string' && rawBrief.tone.trim() ? { tone: rawBrief.tone.trim() } : {}),
    ...(typeof rawBrief?.durationSeconds === 'number' ? { durationSeconds: rawBrief.durationSeconds } : {}),
    ...(Array.isArray(rawBrief?.sellingPoints) ? { sellingPoints: rawBrief.sellingPoints.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) } : {}),
  } : undefined;
  return {
    projectId: identifier(raw.projectId, "project"),
    playbook: {
      name: identifier(playbook.name, "playbook"),
      version: typeof playbook.version === "string" && playbook.version.trim() ? playbook.version.trim() : "1.0.0",
    },
    origin: {
      host: identifier(origin.host, "origin host"),
      ...(typeof origin.actorId === "string" && origin.actorId.trim() ? { actorId: origin.actorId.trim() } : {}),
    },
    ...(brief ? { brief } : {}),
  };
}

function rendererCommand(value: unknown): RunCommand {
  const raw = objectValue(value, "production command");
  const type = typeof raw.type === "string" ? raw.type.trim() : "";
  if (!RENDERER_COMMAND_TYPES.has(type)) throw new Error("Production command is not available to the renderer");
  if (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0) {
    throw new Error("Invalid production command revision");
  }
  return {
    commandId: identifier(raw.commandId, "command"),
    expectedRevision: Number(raw.expectedRevision),
    type,
    payload: rendererCommandPayload(type, raw.payload),
    issuedAt: typeof raw.issuedAt === "string" && raw.issuedAt.trim() ? raw.issuedAt.trim() : new Date().toISOString(),
  };
}

function projectRunPayload(value: unknown): { projectId: string; runId: string; raw: Record<string, unknown> } {
  const raw = objectValue(value, "production run request");
  return {
    projectId: identifier(raw.projectId, "project"),
    runId: identifier(raw.runId, "run"),
    raw,
  };
}

function assertProjectRun(repository: ProductionRunRepository, projectId: string, runId: string) {
  const run = repository.read(projectId, runId);
  if (!run) throw new Error(`Production run not found: ${runId}`);
  if (run.projectId !== projectId) throw new Error("Production run project mismatch");
  return run;
}

export function registerProductionRunIpc(
  repositoryOrService: ProductionRunRepository | ProductionRunService = getProductionRunService(),
): void {
  const service = "command" in repositoryOrService
    ? repositoryOrService
    : null;
  const repository: ProductionRunRepository | null = service ? null : (repositoryOrService as ProductionRunRepository || createProductionRunRepository());
  const read = (projectId: string, runId: string) => service ? service.readFull(projectId, runId) : repository!.read(projectId, runId);
  const list = (projectId: string) => repository ? repository.list(projectId) : service!.listFull(projectId);
  ipcMain.handle("nomi:production-runs:list", async (_event, payload: unknown) => {
    const raw = objectValue(payload, "production run list request");
    return list(identifier(raw.projectId, "project"));
  });
  ipcMain.handle("nomi:production-runs:read", async (_event, payload: unknown) => {
    const { projectId, runId } = projectRunPayload(payload);
    const run = read(projectId, runId);
    if (run && run.projectId !== projectId) throw new Error("Production run project mismatch");
    return run;
  });
  ipcMain.handle("nomi:production-runs:create-draft", async (_event, payload: unknown) =>
    service ? service.createDraft(createDraftInput(payload)) : repository!.create(createDraftInput(payload)));
  ipcMain.handle("nomi:production-runs:command", async (_event, payload: unknown) => {
    const { projectId, runId, raw } = projectRunPayload(payload);
    if (service) {
      if (!read(projectId, runId)) throw new Error(`Production run not found: ${runId}`);
      return service.command(projectId, runId, rendererCommand(raw.command));
    }
    assertProjectRun(repository!, projectId, runId);
    return repository!.execute(projectId, runId, rendererCommand(raw.command));
  });
  ipcMain.handle("nomi:production-runs:events", async (_event, payload: unknown) => {
    const { projectId, runId, raw } = projectRunPayload(payload);
    if (!read(projectId, runId)) throw new Error(`Production run not found: ${runId}`);
    const cursor = raw.afterCursor === undefined ? 0 : Number(raw.afterCursor);
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error("Invalid production event cursor");
    return repository ? repository.readEvents(projectId, runId, cursor) : service!.readEvents(projectId, runId, cursor, 0).then((value) => value.events);
  });
}
