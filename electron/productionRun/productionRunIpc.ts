import { ipcMain } from "electron";

import { createProductionRunRepository, type ProductionRunRepository } from "./productionRunRepository";
import { getProductionRunService } from "./productionRunRuntime";
import type { ProductionRunService } from "./productionRunService";
import type { CreateProductionRunInput, RunCommand } from "./productionRunTypes";

import { assertTrustedSender } from "../ipcSenderGuard";
const RENDERER_COMMAND_TYPES = new Set(["run.status", "run.control", "gate.decide", "artifact.adopt", "artifact.review", "plan.attach", "policy.refresh", "job.reconcile", "plan.detach-shot-nodes"]);

function identifier(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === "." || normalized === "..") throw new Error(`Invalid ${label} id`);
  return normalized;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function storyboardMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const key of ["shotId", "ffDesc", "motionDesc", "subtitle", "dialogue", "lfDesc"]) {
    if (typeof raw[key] === "string" && raw[key].trim()) metadata[key] = raw[key].trim();
  }
  const transition = raw.transition;
  const transitionType = transition && typeof transition === "object" && !Array.isArray(transition)
    ? (transition as Record<string, unknown>).type
    : transition;
  if (transitionType === "cut" || transitionType === "dissolve" || transitionType === "fade" || transitionType === "match_cut" || transitionType === "whip_pan") {
    const durationFrames = transition && typeof transition === "object" && !Array.isArray(transition)
      ? (transition as Record<string, unknown>).durationFrames
      : undefined;
    metadata.transition = {
      type: transitionType,
      ...(typeof durationFrames === "number" && Number.isInteger(durationFrames) && durationFrames > 0 ? { durationFrames } : {}),
    };
  }
  if (raw.variationType === "large" || raw.variationType === "medium" || raw.variationType === "small") metadata.variationType = raw.variationType;
  if (typeof raw.camIdx === "number" && Number.isInteger(raw.camIdx) && raw.camIdx >= 0) metadata.camIdx = raw.camIdx;
  if (raw.continuity !== undefined && (typeof raw.continuity === "string" || typeof raw.continuity === "number" || (typeof raw.continuity === "object" && raw.continuity !== null && !Array.isArray(raw.continuity)))) metadata.continuity = raw.continuity;
  return Object.keys(metadata).length ? metadata : undefined;
}

function rendererCommandPayload(type: string, value: unknown): Record<string, unknown> {
  const raw = objectValue(value, "production command payload");
  if (type === "run.status") {
    return { status: typeof raw.status === "string" ? raw.status.trim() : raw.status };
  }
  if (type === "gate.decide") {
    // B1：方向门批准可带 choiceKey（用户选中的候选）。key 形状受限，非法则丢弃（reducer 再校验属不属该门）。
    const rawChoice = typeof raw.choiceKey === "string" ? raw.choiceKey.trim() : "";
    const choiceKey = /^[A-Za-z0-9._-]{1,40}$/.test(rawChoice) ? rawChoice : undefined;
    return {
      gateId: identifier(raw.gateId, "gate"),
      status: typeof raw.status === "string" ? raw.status.trim() : raw.status,
      ...(choiceKey ? { choiceKey } : {}),
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
      const metadata = storyboardMetadata(binding.metadata ?? binding);
      return {
        nodeId: identifier(binding.nodeId, "node"),
        provider: identifier(binding.provider, "provider"),
        model,
        stageId: identifier(binding.stageId ?? "generate", "stage"),
        ...(metadata ? { metadata } : {}),
      };
    });
    return {
      artifactId: identifier(raw.artifactId, "artifact"),
      ...(raw.sourceScriptArtifactId !== undefined ? { sourceScriptArtifactId: identifier(raw.sourceScriptArtifactId, "source script artifact") } : {}),
      ...(raw.sourceScriptVersion !== undefined ? { sourceScriptVersion: Number.isInteger(raw.sourceScriptVersion) && Number(raw.sourceScriptVersion) > 0 ? Number(raw.sourceScriptVersion) : (() => { throw new Error("Invalid source script version"); })() } : {}),
      ...(raw.sourceScriptHash !== undefined ? { sourceScriptHash: typeof raw.sourceScriptHash === "string" && raw.sourceScriptHash.trim() && raw.sourceScriptHash.length <= 256 ? raw.sourceScriptHash.trim() : (() => { throw new Error("Invalid source script hash"); })() } : {}),
      bindings,
    };
  }
  if (type === "policy.refresh") return {};
  if (type === "job.reconcile") {
    const outcome = typeof raw.outcome === "string" ? raw.outcome.trim() : "";
    if (outcome !== "found" && outcome !== "not_found") throw new Error("Invalid production reconciliation outcome");
    return { jobId: identifier(raw.jobId, "job"), outcome };
  }
  // A4 暂停/继续/取消。合法性（当前状态允不允许这个动作）由 applyRunControl 判，这里只管形状。
  if (type === "run.control") {
    const action = typeof raw.action === "string" ? raw.action.trim() : "";
    if (!["pause", "resume", "cancel"].includes(action)) throw new Error("Invalid production control action");
    return { action };
  }
  // P4 S5：用户把这些占位节点从画布删掉（整批 Cmd+Z / 手动删）→ Run 记 detached（撤销事实优先，恢复不复活）。
  // 渲染层发起是合法的（这是「用户删了画布节点」的忠实映射）；只收 nodeId 数组，形状受限、上限防滥用。
  if (type === "plan.detach-shot-nodes") {
    const rawNodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds : [];
    if (rawNodeIds.length > 256) throw new Error("Too many detached nodes");
    const nodeIds = rawNodeIds.map((value, index) => identifier(value, `node ${index}`));
    return { nodeIds };
  }
  if (type === "artifact.adopt") return { artifactId: identifier(raw.artifactId, "artifact") };
  if (type === "artifact.review") {
    const decision = typeof raw.decision === "string" ? raw.decision.trim() : "";
    if (!["approved", "changes_requested", "rejected"].includes(decision)) throw new Error("Invalid artifact review decision");
    return { artifactId: identifier(raw.artifactId, "artifact"), decision };
  }
  // 白名单里有、这里却没建 payload 的类型必须**响亮地**炸。原先这行是 artifact.adopt 的兜底 return，
  // 于是 run.control 掉进来被当成产物命令，用户在 Nomi 里点取消只会看到「Invalid artifact id」——
  // 暂停/继续/取消从渲染端就没通过（2026-08-18 走查逮到）。默认分支不许再替别人猜形状。
  throw new Error(`Production command payload is not implemented: ${type}`);
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
  ipcMain.handle("nomi:production-runs:list", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const raw = objectValue(payload, "production run list request");
    return list(identifier(raw.projectId, "project"));
  });
  ipcMain.handle("nomi:production-runs:read", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const { projectId, runId } = projectRunPayload(payload);
    const run = read(projectId, runId);
    if (run && run.projectId !== projectId) throw new Error("Production run project mismatch");
    return run;
  });
  ipcMain.handle("nomi:production-runs:create-draft", async (event, payload: unknown) => {
    assertTrustedSender(event);
    return service ? service.createDraft(createDraftInput(payload)) : repository!.create(createDraftInput(payload));
  });
  ipcMain.handle("nomi:production-runs:command", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const { projectId, runId, raw } = projectRunPayload(payload);
    if (service) {
      if (!read(projectId, runId)) throw new Error(`Production run not found: ${runId}`);
      return service.command(projectId, runId, rendererCommand(raw.command));
    }
    assertProjectRun(repository!, projectId, runId);
    return repository!.execute(projectId, runId, rendererCommand(raw.command));
  });
  ipcMain.handle("nomi:production-runs:materialize-storyboard", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const { projectId, runId, raw } = projectRunPayload(payload);
    if (!read(projectId, runId)) throw new Error(`Production run not found: ${runId}`);
    const artifactId = identifier(raw.artifactId, "artifact");
    const expectedVersion = Number(raw.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) throw new Error("Invalid storyboard artifact version");
    if (!service) throw new Error("Storyboard materialization requires the production service");
    return service.materializeStoryboard({ projectId, runId, artifactId, expectedVersion });
  });
  ipcMain.handle("nomi:production-runs:events", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const { projectId, runId, raw } = projectRunPayload(payload);
    if (!read(projectId, runId)) throw new Error(`Production run not found: ${runId}`);
    const cursor = raw.afterCursor === undefined ? 0 : Number(raw.afterCursor);
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error("Invalid production event cursor");
    return repository ? repository.readEvents(projectId, runId, cursor) : service!.readEvents(projectId, runId, cursor, 0).then((value) => value.events);
  });
}
