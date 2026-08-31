import { transitionJob, transitionRun } from "./productionRunState";
import type {
  BudgetLedgerSummary,
  ProductionArtifact,
  ProductionDirectionCandidate,
  ProductionGate,
  ProductionJob,
  ProductionJobStatus,
  ProductionRun,
  ProductionRunStatus,
  ProductionStage,
  RunCommand,
} from "./productionRunTypes";

export type ProductionCommandEffect = {
  run: ProductionRun;
  eventType: string;
  message: string;
};

function record(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Missing ${key}`);
  return value as Record<string, unknown>;
}

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}`);
  return value.trim();
}

const ARTIFACT_STATUSES = new Set<ProductionArtifact["status"]>([
  "candidate",
  "ready",
  "adopted",
  "rejected",
]);
const GATE_STATUSES = new Set<ProductionGate["status"]>(["waiting", "approved", "rejected", "expired", "revoked"]);

type ArtifactReviewDecision = "approved" | "changes_requested" | "rejected";

function artifactVersion(value: ProductionArtifact): number {
  return Number.isInteger(value.version) && (value.version as number) > 0 ? value.version as number : 1;
}

function artifactHash(value: ProductionArtifact | undefined): string | undefined {
  return value?.contentHash;
}

function isApprovedScript(value: ProductionArtifact | undefined): boolean {
  return Boolean(value && value.kind === "script" && value.status === "adopted" && (value.reviewStatus === undefined || value.reviewStatus === "approved"));
}

function reviewDecision(payload: Record<string, unknown>): ArtifactReviewDecision {
  const value = typeof payload.decision === "string" ? payload.decision : payload.status;
  if (value !== "approved" && value !== "changes_requested" && value !== "rejected") {
    throw new Error("Invalid artifact review decision");
  }
  return value;
}

/** Return whether this candidate has passed review and can become the adopted artifact. */
export function canAdoptArtifact(run: ProductionRun, artifactId: string): boolean {
  const candidate = run.artifacts.find((item) => item.artifactId === artifactId);
  if (!candidate || candidate.status !== "candidate" || candidate.reviewStatus !== "approved") return false;
  if (candidate.kind === "storyboard") {
    try {
      assertStoryboardSourceApproved(run, artifactId);
    } catch {
      return false;
    }
  }
  return true;
}

/** Enforce the one-way script → storyboard provenance boundary. */
export function assertStoryboardSourceApproved(run: ProductionRun, artifactId: string): void {
  const storyboard = run.artifacts.find((item) => item.artifactId === artifactId);
  if (!storyboard || storyboard.kind !== "storyboard") throw new Error("Storyboard artifact not found");
  const sourceId = storyboard.sourceArtifactId || storyboard.sourceScriptArtifactId;
  const source = sourceId ? run.artifacts.find((item) => item.artifactId === sourceId) : undefined;
  if (!isApprovedScript(source)) throw new Error("approved script required");
  const sourceVersion = storyboard.sourceVersion ?? storyboard.sourceScriptVersion;
  if (sourceVersion !== undefined && sourceVersion !== artifactVersion(source!)) {
    throw new Error("storyboard source script version is stale");
  }
  const sourceHash = storyboard.sourceContentHash || storyboard.sourceHash || storyboard.sourceScriptHash;
  if (sourceHash && artifactHash(source) && sourceHash !== artifactHash(source)) {
    throw new Error("storyboard source script hash is stale");
  }
}

/** Mark derived artifacts rejected when their source is superseded or explicitly changed. */
export function markDerivedArtifactsStale(run: ProductionRun, sourceArtifactId: string): ProductionRun {
  const artifacts = run.artifacts.map((item) => {
    if (item.sourceArtifactId !== sourceArtifactId || item.status === "rejected") return item;
    return { ...item, status: "rejected" as const, reviewStatus: "changes_requested" as const };
  });
  return { ...run, artifacts };
}

function normalizeArtifactContract(value: ProductionArtifact): ProductionArtifact {
  const next: ProductionArtifact = {
    ...value,
    version: artifactVersion(value),
    ...(value.source ? {} : { source: "nomi-agent" as const }),
    ...(value.status === "candidate" && !value.reviewStatus ? { reviewStatus: "waiting" as const } : {}),
  };
  return next;
}

function artifact(payload: Record<string, unknown>): ProductionArtifact {
  const value = record(payload, "artifact");
  if (!ARTIFACT_STATUSES.has(value.status as ProductionArtifact["status"])) {
    throw new Error("Invalid artifact status");
  }
  return normalizeArtifactContract(value as ProductionArtifact);
}

/** B1：校验方向候选 —— 2-3 个、key 唯一且安全、title/oneLiner 非空且截断。别信 LLM 原样入库。 */
function directionCandidates(value: unknown): ProductionDirectionCandidate[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) throw new Error("Direction candidates must be 2 or 3 options");
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid direction candidate ${index}`);
    const raw = item as Record<string, unknown>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const oneLiner = typeof raw.oneLiner === "string" ? raw.oneLiner.trim() : "";
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(key) || seen.has(key)) throw new Error(`Invalid direction candidate key ${index}`);
    if (!title || !oneLiner) throw new Error(`Direction candidate ${index} needs a title and one-liner`);
    seen.add(key);
    return { key, title: title.slice(0, 80), oneLiner: oneLiner.slice(0, 200) };
  });
}

function replaceById<T>(items: T[], id: string, readId: (item: T) => string, update: (item: T) => T): T[] {
  let found = false;
  const next = items.map((item) => {
    if (readId(item) !== id) return item;
    found = true;
    return update(item);
  });
  if (!found) throw new Error(`Production entity not found: ${id}`);
  return next;
}

function validateBudget(value: Record<string, unknown>, current: BudgetLedgerSummary): BudgetLedgerSummary {
  const next = { ...current };
  for (const key of ["authorized", "reserved", "actual", "unsettled"] as const) {
    if (value[key] === undefined) continue;
    const amount = Number(value[key]);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid budget ${key}`);
    next[key] = amount;
  }
  if (typeof value.currency === "string" && value.currency.trim()) next.currency = value.currency.trim();
  if (next.reserved + next.actual + next.unsettled > next.authorized) {
    throw new Error("Budget liability exceeds authorization");
  }
  return next;
}

export function applyProductionCommand(
  current: ProductionRun,
  command: RunCommand,
  now: string,
): ProductionCommandEffect {
  switch (command.type) {
    case "run.status": {
      const status = text(command.payload, "status") as ProductionRunStatus;
      const next = transitionRun(current, status, now);
      return {
        run: ["running", "awaiting_direction"].includes(status) && next.attention ? { ...next, attention: undefined } : next,
        eventType: "run.status.changed",
        message: status,
      };
    }
    case "run.attention": {
      const code = text(command.payload, "code");
      const message = text(command.payload, "message");
      const operation = text(command.payload, "operation");
      const retryable = command.payload.retryable !== false;
      const next = current.status === "needs_attention"
        ? { ...current, updatedAt: now }
        : transitionRun(current, "needs_attention", now);
      const attention = { code, message: message.slice(0, 400), operation, retryable, occurredAt: now };
      return { run: { ...next, attention }, eventType: "run.needs_attention", message: attention.message };
    }
    case "run.stage": {
      const stageId = text(command.payload, "stageId");
      return { run: { ...current, stageId, updatedAt: now }, eventType: "run.stage.changed", message: stageId };
    }
    case "stage.upsert": {
      const stage = record(command.payload, "stage") as ProductionStage;
      const stages = current.stages.some((item) => item.stageId === stage.stageId)
        ? current.stages.map((item) => (item.stageId === stage.stageId ? stage : item))
        : [...current.stages, stage];
      return { run: { ...current, stages, updatedAt: now }, eventType: "stage.updated", message: stage.stageId };
    }
    case "job.add": {
      const job = record(command.payload, "job") as ProductionJob;
      if (current.jobs.some((item) => item.jobId === job.jobId)) throw new Error(`Duplicate job: ${job.jobId}`);
      return { run: { ...current, jobs: [...current.jobs, job], updatedAt: now }, eventType: "job.created", message: job.jobId };
    }
    case "qa.retry.schedule": {
      // Budget reservation and retry-job creation are one durable command. A
      // crash cannot leave a reserved unit with no job to consume it.
      const job = record(command.payload, "job") as ProductionJob;
      if (current.jobs.some((item) => item.jobId === job.jobId)) throw new Error(`Duplicate job: ${job.jobId}`);
      const budget = validateBudget({ ...current.budget, reserved: current.budget.reserved + 1 }, current.budget);
      return {
        run: { ...current, budget, jobs: [...current.jobs, job], updatedAt: now },
        eventType: "qa.retry.scheduled",
        message: job.jobId,
      };
    }
    case "job.status": {
      const jobId = text(command.payload, "jobId");
      const status = text(command.payload, "status") as ProductionJobStatus;
      const patch = command.payload.patch && typeof command.payload.patch === "object"
        ? command.payload.patch as Partial<ProductionJob>
        : {};
      const jobs = replaceById(current.jobs, jobId, (job) => job.jobId, (job) => ({
        ...transitionJob(job, status, now),
        ...patch,
        jobId: job.jobId,
        status,
        updatedAt: now,
      }));
      return { run: { ...current, jobs, updatedAt: now }, eventType: `job.${status}`, message: jobId };
    }
    case "gate.add": {
      const gate = record(command.payload, "gate") as ProductionGate;
      if (current.gates.some((item) => item.gateId === gate.gateId)) throw new Error(`Duplicate gate: ${gate.gateId}`);
      return { run: { ...current, gates: [...current.gates, gate], updatedAt: now }, eventType: "gate.waiting", message: gate.gateId };
    }
    case "gate.set_candidates": {
      // B1：方向门候选挂到 waiting 的 gate 上（driver 拟好后调）。只允许方向门、只在 waiting 时设。
      const gateId = text(command.payload, "gateId");
      const candidates = directionCandidates(command.payload.candidates);
      const currentGate = current.gates.find((gate) => gate.gateId === gateId);
      if (!currentGate) throw new Error(`Production entity not found: ${gateId}`);
      if (currentGate.scope !== "stage" || !gateId.startsWith("gate-direction-")) throw new Error("Direction candidates apply only to a direction gate");
      if (currentGate.status !== "waiting") throw new Error(`Production gate is already decided: ${gateId}`);
      const gates = replaceById(current.gates, gateId, (gate) => gate.gateId, (gate) => ({
        ...gate,
        directionCandidates: candidates,
      }));
      return { run: { ...current, gates, updatedAt: now }, eventType: "gate.candidates", message: gateId };
    }
    case "gate.decide": {
      const gateId = text(command.payload, "gateId");
      const status = text(command.payload, "status") as ProductionGate["status"];
      if (!GATE_STATUSES.has(status) || status === "waiting") throw new Error("Invalid production gate decision");
      const currentGate = current.gates.find((gate) => gate.gateId === gateId);
      if (!currentGate) throw new Error(`Production entity not found: ${gateId}`);
      if (currentGate.status !== "waiting") throw new Error(`Production gate is already decided: ${gateId}`);
      // B1：方向门批准可带 choiceKey（用户选中的候选）。校验它确属该门候选之一，留痕进 gate。
      const rawChoice = typeof command.payload.choiceKey === "string" ? command.payload.choiceKey.trim() : "";
      const choiceKey = status === "approved" && rawChoice && (currentGate.directionCandidates ?? []).some((candidate) => candidate.key === rawChoice)
        ? rawChoice
        : undefined;
      const gates = replaceById(current.gates, gateId, (gate) => gate.gateId, (gate) => ({
        ...gate,
        status,
        decidedAt: now,
        ...(choiceKey ? { decidedChoiceKey: choiceKey } : {}),
      }));
      const jobs = status === "approved"
        ? current.jobs.map((job) => currentGate.jobIds.includes(job.jobId) && job.status === "authorization_required"
          ? transitionJob(job, "authorized", now)
          : job)
        : current.jobs;
      const approvesDirection = status === "approved" && current.status === "awaiting_direction"
        && currentGate.scope === "stage" && gateId.startsWith("gate-direction-");
      const approvesBuild = status === "approved" && current.status === "awaiting_contract"
        && currentGate.scope === "budget_envelope";
      const stages = current.stages.map((stage) => {
        if (approvesDirection && stage.stageId === "direction") {
          return { ...stage, status: "completed" as const, completedAt: now };
        }
        if (approvesBuild && stage.stageId === "build") {
          return { ...stage, status: "completed" as const, completedAt: now };
        }
        return stage;
      });
      const run = status === "approved" && current.status === "awaiting_contract"
        ? transitionRun({ ...current, gates, jobs, stages }, "ready", now)
        : status === "approved" && current.status === "awaiting_direction"
          ? transitionRun({ ...current, gates, jobs, stages }, "running", now)
        : status === "approved" && current.status === "awaiting_rough_cut_review"
          ? transitionRun({ ...current, gates, jobs, stages }, "awaiting_export", now)
        : { ...current, gates, jobs, stages, updatedAt: now };
      return { run, eventType: "gate.decided", message: gateId };
    }
    case "plan.proposed": {
      const proposed = Array.isArray(command.payload.artifacts) ? command.payload.artifacts.map((item) => artifact({ artifact: item })) : [];
      if (proposed.length === 0) throw new Error("Production plan artifacts are required");
      if (proposed.some((nextArtifact) => current.artifacts.some((item) => item.artifactId === nextArtifact.artifactId))) {
        throw new Error("Duplicate production plan artifact");
      }
      const scriptProposal = proposed.find((item) => item.kind === "script");
      const storyboardProposal = proposed.find((item) => item.kind === "storyboard");
      if (storyboardProposal) {
        const withProposed = { ...current, artifacts: [...current.artifacts, ...proposed] };
        assertStoryboardSourceApproved(withProposed, storyboardProposal.artifactId);
      }
      const stages = current.stages.map((stage) => {
        if (scriptProposal && stage.stageId === "script") return { ...stage, status: "awaiting_gate" as const, startedAt: stage.startedAt || now };
        if (!scriptProposal && stage.stageId === "script" || storyboardProposal && stage.stageId === "storyboard") return { ...stage, status: "completed" as const, completedAt: now };
        if (stage.stageId === "build") return { ...stage, status: "awaiting_gate" as const };
        return stage;
      });
      const next = { ...current, artifacts: [...current.artifacts, ...proposed], stages, stageId: scriptProposal ? "script" : "storyboard", updatedAt: now };
      const run = scriptProposal && ["running", "awaiting_storyboard_review"].includes(current.status)
        ? transitionRun(next, "awaiting_script_review", now)
        : storyboardProposal && current.status === "running"
          ? transitionRun(next, "awaiting_storyboard_review", now)
          : next;
      return { run, eventType: "plan.proposed", message: proposed[0].artifactId };
    }
    case "script.review":
    case "artifact.review": {
      const artifactId = text(command.payload, "artifactId");
      const decision = reviewDecision(command.payload);
      const target = current.artifacts.find((item) => item.artifactId === artifactId);
      if (!target) throw new Error(`Production entity not found: ${artifactId}`);
      if (target.status !== "candidate") throw new Error("Only candidate artifacts can be reviewed");
      if (decision === "approved" && target.kind === "storyboard") assertStoryboardSourceApproved(current, artifactId);
      let artifacts = current.artifacts.map((item) => item.artifactId === artifactId
        ? {
            ...item,
            status: decision === "approved" ? "adopted" as const : decision === "rejected" ? "rejected" as const : "candidate" as const,
            reviewStatus: decision === "approved" ? "approved" as const : "changes_requested" as const,
            ...(decision === "approved" ? { adoptedAt: now } : {}),
          }
        : item);
      let next: ProductionRun = { ...current, artifacts, updatedAt: now };
      if (decision === "approved" && target.kind === "script") {
        next = markDerivedArtifactsStale(next, artifactId);
        const stages = next.stages.map((stage) => stage.stageId === "script"
          ? { ...stage, status: "completed" as const, completedAt: now }
          : stage);
        next = { ...next, stages, stageId: "storyboard" };
        if (current.status === "awaiting_script_review") next = transitionRun(next, "running", now);
      }
      return { run: next, eventType: decision === "approved" ? "artifact.adopted" : "artifact.reviewed", message: artifactId };
    }
    case "plan.attach": {
      const artifactId = text(command.payload, "artifactId");
      const jobs = Array.isArray(command.payload.jobs)
        ? command.payload.jobs.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as ProductionJob : (() => { throw new Error("Invalid production job"); })())
        : [];
      const gate = record(command.payload, "gate") as unknown as ProductionGate;
      const nextArtifact = current.artifacts.find((item) => item.artifactId === artifactId);
      if (!nextArtifact) throw new Error(`Production entity not found: ${artifactId}`);
      if (nextArtifact.kind !== 'storyboard' || nextArtifact.status !== 'adopted' || (nextArtifact.reviewStatus !== undefined && nextArtifact.reviewStatus !== 'approved')) throw new Error("Approved storyboard artifact required before attach");
      if (current.gates.some((item) => item.gateId === gate.gateId)) throw new Error(`Duplicate gate: ${gate.gateId}`);
      if (jobs.some((job) => current.jobs.some((item) => item.jobId === job.jobId))) throw new Error("Duplicate production job");
      const stages = current.stages.map((stage) => {
        if (stage.stageId === "script" || stage.stageId === "storyboard") return { ...stage, status: "completed" as const, completedAt: now };
        if (stage.stageId === "build") return { ...stage, status: "awaiting_gate" as const };
        return stage;
      });
      const artifacts = current.artifacts.map((item) => item.artifactId === artifactId ? { ...item, status: "adopted" as const, adoptedAt: now } : item);
      const attached = { ...current, artifacts, jobs: [...current.jobs, ...jobs], gates: [...current.gates, gate], stages, stageId: "build", updatedAt: now };
      const run = current.status === "running" || current.status === "awaiting_storyboard_review"
        ? transitionRun(attached, "awaiting_contract", now)
        : attached;
      return { run, eventType: "plan.attached", message: nextArtifact.artifactId };
    }
    case "skill.evidence": {
      const skillName = text(command.payload, "skillName");
      const artifactId = typeof command.payload.artifactId === "string" ? command.payload.artifactId.trim() : "";
      const evidence = Array.isArray(command.payload.skillEvidence)
        ? command.payload.skillEvidence.filter((item): item is { name: string; version: string; stageId: string } => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            const value = item as Record<string, unknown>;
            return typeof value.name === "string" && typeof value.version === "string" && typeof value.stageId === "string";
          })
        : [];
      const artifacts = artifactId && evidence.length > 0
        ? current.artifacts.map((item) => item.artifactId === artifactId ? { ...item, skillEvidence: evidence } : item)
        : current.artifacts;
      return { run: { ...current, artifacts, updatedAt: now }, eventType: "skill.loaded", message: skillName };
    }
    case "qa.verdict": {
      // W1.5 审片判决：生成后一镜一条「过检 / 红标」的耐久事实事件（同 skill.evidence 的写法——
      // 只留痕、不改 run 结构）。message = 一句话人话判决（per-shot），经投影 sanitizer 后
      // nomi_subscribe_run 读得到；不是新门、不弹确认、不改任何状态机语义。
      const summary = text(command.payload, "summary");
      return { run: { ...current, updatedAt: now }, eventType: "qa.verdict", message: summary };
    }
    case "artifact.add": {
      const nextArtifact = artifact(command.payload);
      if (current.artifacts.some((item) => item.artifactId === nextArtifact.artifactId)) {
        throw new Error(`Duplicate artifact: ${nextArtifact.artifactId}`);
      }
      return { run: { ...current, artifacts: [...current.artifacts, nextArtifact], updatedAt: now }, eventType: "artifact.ready", message: nextArtifact.artifactId };
    }
    case "artifact.adopt": {
      const artifactId = text(command.payload, "artifactId");
      if (!canAdoptArtifact(current, artifactId)) throw new Error("Artifact requires approved review");
      const artifacts = replaceById(current.artifacts, artifactId, (artifact) => artifact.artifactId, (artifact): ProductionArtifact => ({
        ...artifact,
        status: "adopted",
        reviewStatus: "approved",
        adoptedAt: now,
      }));
      const next = current.artifacts.find((artifact) => artifact.artifactId === artifactId)?.kind === "script"
        ? markDerivedArtifactsStale({ ...current, artifacts, updatedAt: now }, artifactId)
        : { ...current, artifacts, updatedAt: now };
      return { run: next, eventType: "artifact.adopted", message: artifactId };
    }
    case "budget.set": {
      const budget = validateBudget(record(command.payload, "budget"), current.budget);
      return { run: { ...current, budget, updatedAt: now }, eventType: "budget.updated", message: budget.currency };
    }
    case "policy.set": {
      const policy = record(command.payload, "policy") as unknown as ProductionRun["policy"];
      return { run: { ...current, policy, updatedAt: now }, eventType: "policy.updated", message: policy.mode };
    }
    default:
      throw new Error(`Unknown production command: ${command.type}`);
  }
}
