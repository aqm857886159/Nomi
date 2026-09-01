import {
  experienceEvidenceSchema,
  hashExperienceContent,
  type ExperienceCandidate,
  type ExperienceCandidateDraft,
  type ExperienceEvidence,
  type ExperienceReuse,
  type ExperienceRisk,
  type ExperienceStatus,
} from "./experienceTypes";
import { redactDeep } from "../events/redact";
import { desktopT } from "../i18n";

type BuildContext = { projectId: string; trajectoryId: string; now?: string };

const destinations: Record<ExperienceCandidate["kind"], ExperienceCandidate["destination"]> = {
  fact: "memory",
  procedure: "skill",
  troubleshooting: "runbook",
  invariant: "gate",
  decision: "adr",
  "training-example": "training-data",
  incident: "incident",
};

const destinationForKind = (kind: ExperienceCandidate["kind"]): ExperienceCandidate["destination"] => destinations[kind];

const risks: Record<ExperienceCandidate["kind"], ExperienceRisk> = {
  fact: "green",
  procedure: "yellow",
  troubleshooting: "yellow",
  invariant: "red",
  decision: "red",
  "training-example": "red",
  incident: "green",
};

const riskForKind = (kind: ExperienceCandidate["kind"]): ExperienceRisk => risks[kind];

const evidenceComplete = (evidence: ExperienceEvidence): boolean =>
  [evidence.problem, evidence.action, evidence.outcome, evidence.verification].every((value) => Boolean(value?.trim()));

const asIso = (now?: string): string => {
  const date = now ? new Date(now) : new Date();
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function statusFor(risk: ExperienceRisk, complete: boolean, scope: ExperienceCandidate["scope"]): ExperienceStatus {
  if (!complete || scope === "global") return scope === "global" ? "quarantined" : "active";
  return risk === "green" ? "active" : risk === "yellow" ? "shadow" : "quarantined";
}

export function buildExperienceCandidate(draft: ExperienceCandidateDraft, context: BuildContext): ExperienceCandidate {
  const safeDraft = redactDeep(draft) as ExperienceCandidateDraft;
  const now = asIso(context.now);
  const evidence = experienceEvidenceSchema.parse({
    problem: safeDraft.evidence.problem ?? "",
    action: safeDraft.evidence.action ?? "",
    outcome: safeDraft.evidence.outcome ?? "",
    verification: safeDraft.evidence.verification ?? "",
    eventSeqs: safeDraft.evidence.eventSeqs ?? [],
  });
  const complete = evidenceComplete(evidence);
  const effectiveKind = complete ? safeDraft.kind : "incident";
  const scope = safeDraft.scope ?? "project";
  const destination = complete ? destinationForKind(effectiveKind) : "incident";
  const risk = complete ? riskForKind(effectiveKind) : "green";
  const status = statusFor(risk, complete, scope);
  const hash = hashExperienceContent({ ...safeDraft, kind: effectiveKind, scope, projectId: context.projectId, evidence });
  return {
    candidateId: `exp_${hash.slice(0, 16)}`,
    contentHash: hash,
    trajectoryId: context.trajectoryId,
    projectId: context.projectId,
    kind: effectiveKind,
    destination,
    scope,
    risk,
    title: safeDraft.title.trim().slice(0, 160) || desktopT("experience.untitled"),
    content: safeDraft.content.trim().slice(0, 4000) || "未形成可复用内容",
    evidence,
    confidence: Math.max(0, Math.min(1, Number.isFinite(safeDraft.confidence) ? safeDraft.confidence : 0)),
    consent: safeDraft.consent === true,
    status,
    eligibleForPrompt: status === "active" && destination !== "incident" && scope === "project",
    reuseCount: 0,
    failureCount: 0,
    processedTrajectoryIds: [],
    successfulTrajectoryIds: [],
    createdAt: now,
    updatedAt: now,
    ...(risk === "green" ? {} : { expiresAt: addDays(now, 90) }),
  };
}

function withStatus(candidate: ExperienceCandidate, status: ExperienceStatus, now: string, reason?: string): ExperienceCandidate {
  return {
    ...candidate,
    status,
    eligibleForPrompt: status === "active" && candidate.destination !== "incident" && candidate.scope === "project",
    updatedAt: now,
    ...(reason ? { demotionReason: reason } : {}),
  };
}

export function recordExperienceReuse(candidate: ExperienceCandidate, reuse: ExperienceReuse): ExperienceCandidate {
  if (["demoted", "expired", "superseded"].includes(candidate.status)) return candidate;
  const now = asIso(reuse.now);
  if (candidate.processedTrajectoryIds.includes(reuse.trajectoryId)) return candidate;
  const next: ExperienceCandidate = {
    ...candidate,
    reuseCount: candidate.reuseCount + (reuse.verified ? 1 : 0),
    failureCount: candidate.failureCount + (reuse.verified ? 0 : 1),
    processedTrajectoryIds: [...candidate.processedTrajectoryIds, reuse.trajectoryId].slice(-200),
    successfulTrajectoryIds: reuse.verified
      ? [...candidate.successfulTrajectoryIds, reuse.trajectoryId].slice(-100)
      : candidate.successfulTrajectoryIds,
    ...(reuse.verified ? { lastVerifiedAt: now } : {}),
    updatedAt: now,
  };
  if (reuse.contradicted) return withStatus(next, "demoted", now, "出现与该经验矛盾的已验证证据");
  if (next.failureCount >= 3) return withStatus(next, "demoted", now, "连续三次复用失败");
  if (next.status === "shadow" && reuse.verified && (next.reuseCount >= 2 || reuse.regressionPassed === true)) {
    return withStatus(next, "active", now);
  }
  return next;
}

export function expireExperience(candidate: ExperienceCandidate, now = new Date().toISOString()): ExperienceCandidate {
  if (!candidate.expiresAt || new Date(candidate.expiresAt).getTime() > new Date(now).getTime()) return candidate;
  return withStatus(candidate, "expired", asIso(now), "超过验证有效期");
}
