import crypto from "node:crypto";
import { z } from "zod";

const boundedText = (max = 2000) => z.string().trim().max(max);

export const experienceKindSchema = z.enum([
  "fact",
  "procedure",
  "troubleshooting",
  "invariant",
  "decision",
  "training-example",
  "incident",
]);
export type ExperienceKind = z.infer<typeof experienceKindSchema>;

export const experienceDestinationSchema = z.enum(["memory", "skill", "runbook", "gate", "adr", "training-data", "incident"]);
export type ExperienceDestination = z.infer<typeof experienceDestinationSchema>;

export const experienceScopeSchema = z.enum(["project", "global"]);
export type ExperienceScope = z.infer<typeof experienceScopeSchema>;

export const experienceRiskSchema = z.enum(["green", "yellow", "red"]);
export type ExperienceRisk = z.infer<typeof experienceRiskSchema>;

export const experienceStatusSchema = z.enum(["quarantined", "shadow", "active", "demoted", "superseded", "expired"]);
export type ExperienceStatus = z.infer<typeof experienceStatusSchema>;

/** Evidence is deliberately permissive at the wire boundary; policy decides whether it is complete. */
export const experienceEvidenceSchema = z.object({
  problem: boundedText(),
  action: boundedText(),
  outcome: boundedText(),
  verification: boundedText(),
  eventSeqs: z.array(z.number().int().positive()).max(64).default([]),
});
export type ExperienceEvidence = z.infer<typeof experienceEvidenceSchema>;

export const learningEnvelopeSchema = z.object({
  kind: experienceKindSchema.exclude(["incident"]),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(4000),
  scope: experienceScopeSchema.default("project"),
  evidence: experienceEvidenceSchema,
  confidence: z.number().min(0).max(1),
  /** Training samples remain quarantined unless the user has opted in. */
  consent: z.boolean().default(false),
}).superRefine((value, ctx) => {
  for (const key of ["problem", "action", "outcome", "verification"] as const) {
    if (!value.evidence[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", key], message: "evidence is required" });
  }
  if (value.evidence.eventSeqs.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "eventSeqs"], message: "at least one source event is required" });
  }
});
export type LearningEnvelope = z.infer<typeof learningEnvelopeSchema>;

export const trajectoryEventSchema = z.object({
  type: z.string().min(1).max(120),
  seq: z.number().int().positive().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const trajectorySchema = z.object({
  trajectoryId: z.string().trim().min(1).max(160),
  projectId: z.string().trim().min(1).max(160),
  sessionId: z.string().trim().min(1).max(160),
  threadId: z.string().trim().min(1).max(160).optional(),
  area: z.enum(["creation", "generation"]).optional(),
  prompt: boundedText(),
  response: boundedText(),
  events: z.array(trajectoryEventSchema).max(256),
  completedAt: z.string().trim().min(1).max(64),
  learningEnvelope: z.unknown().optional(),
});
export type ExperienceTrajectory = z.infer<typeof trajectorySchema>;

export const experienceCandidateSchema = z.object({
  candidateId: z.string().regex(/^exp_[a-f0-9]{16}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  trajectoryId: z.string().min(1).max(160),
  projectId: z.string().min(1).max(160),
  kind: experienceKindSchema,
  destination: experienceDestinationSchema,
  scope: experienceScopeSchema,
  risk: experienceRiskSchema,
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(4000),
  evidence: experienceEvidenceSchema,
  confidence: z.number().min(0).max(1),
  consent: z.boolean().default(false),
  status: experienceStatusSchema,
  eligibleForPrompt: z.boolean().default(false),
  reuseCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  /** Every reuse event is keyed by its source trajectory, including failures. */
  processedTrajectoryIds: z.array(z.string().min(1).max(160)).max(200).default([]),
  successfulTrajectoryIds: z.array(z.string().min(1).max(160)).max(100),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
  lastVerifiedAt: z.string().min(1).max(64).optional(),
  expiresAt: z.string().min(1).max(64).optional(),
  demotionReason: z.string().max(400).optional(),
});
export type ExperienceCandidate = z.infer<typeof experienceCandidateSchema>;

export type ExperienceCandidateDraft = {
  kind: Exclude<ExperienceKind, "incident">;
  title: string;
  content: string;
  scope?: ExperienceScope;
  evidence: Partial<ExperienceEvidence>;
  confidence: number;
  consent?: boolean;
};

export type ExperienceReuse = {
  trajectoryId: string;
  verified: boolean;
  regressionPassed?: boolean;
  contradicted?: boolean;
  now?: string;
};

export function hashExperienceContent(value: { kind: ExperienceKind; title: string; content: string; scope?: ExperienceScope; projectId: string; evidence: ExperienceEvidence }): string {
  const canonical = JSON.stringify({
    projectId: value.projectId,
    scope: value.scope ?? "project",
    kind: value.kind,
    title: value.title.trim(),
    content: value.content.trim(),
    // Source sequence numbers are provenance, not identity: the same solved problem
    // must merge across independent conversations instead of creating parallel candidates.
    evidence: {
      problem: value.evidence.problem,
      action: value.evidence.action,
      outcome: value.evidence.outcome,
      verification: value.evidence.verification,
    },
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
