import { z } from "zod";
import {
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
} from "../../shared/agentCapabilities/productionRun";
import { ARTIFACT_REVIEW_DECISIONS } from "../../productionRun/productionRunReducer";

const runId = z.string().trim().min(1).max(160).describe("The run id returned by start_production_run.");
const artifactId = z.string().trim().min(1).max(160).describe("The artifact id from the run projection.");

const descriptors = {
  get_production_run: {
    name: "get_production_run",
    description: "Read one production task's current status, gates, jobs, budget, and artifact refs. Read-only.",
    parameters: z.object({ runId }).strict(),
  },
  subscribe_production_run: {
    name: "subscribe_production_run",
    description: "Read meaningful progress after a cursor; use the returned nextCursor to continue without duplicate events.",
    parameters: z.object({
      runId,
      afterCursor: z.number().int().nonnegative().optional().describe("Last consumed event cursor; default 0."),
      waitMs: z.number().int().min(0).max(25_000).optional().describe("Optional bounded wait for new progress."),
    }).strict(),
  },
  read_production_artifact: {
    name: "read_production_artifact",
    description: "Read a versioned artifact's metadata and preview ref; use the content tool only when the actual text/plan is needed.",
    parameters: z.object({ runId, artifactId }).strict(),
  },
  read_production_artifact_content: {
    name: "read_production_artifact_content",
    description: "Read one persisted script or storyboard only when its content is needed for the next decision; bounded by the domain owner.",
    parameters: z.object({ runId, artifactId }).strict(),
  },
  start_production_run: {
    name: "start_production_run",
    description: "Create a reviewable brief/playbook draft only; it stops at the first review gate and never generates media. For a concrete image/video request or a multi-minute finished piece, use the generation plan intent; Nomi Host handles preview, approval, and start transitions.",
    parameters: z.object({
      goal: z.string().trim().min(1).max(2_000).describe("What the finished piece should achieve; do not force the user into a schema."),
      playbook: z.string().trim().min(1).max(160).optional().describe("Optional registered playbook name; omit to use the default."),
      playbookVersion: z.string().trim().min(1).max(64).optional(),
      audience: z.string().trim().min(1).max(500).optional(),
      channel: z.string().trim().min(1).max(200).optional(),
      tone: z.string().trim().min(1).max(200).optional(),
      durationSeconds: z.number().finite().int().min(1).max(3_600).optional(),
      sellingPoints: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    }).strict(),
  },
  control_production_run: {
    name: "control_production_run",
    description: "Pause, resume, cancel, or change the run trust level. Paid gates and unknown provider receipts remain protected.",
    parameters: z.object({
      runId,
      action: z.enum(["pause", "resume", "cancel", "set_trust"]),
      trustLevel: z.enum(["key_confirm", "budget_only", "confirm_all"]).optional(),
    }).strict(),
  },
  decide_production_gate: {
    name: "decide_production_gate",
    description: "Record a user's decision for a creative or anchor checkpoint gate; budget and paid gates stay in Nomi.",
    parameters: z.object({
      runId,
      gateId: z.string().trim().min(1).max(160),
      decision: z.enum(ARTIFACT_REVIEW_DECISIONS).exclude(["changes_requested"]),
      choiceKey: z.string().trim().min(1).max(40).optional(),
    }).strict(),
  },
  revise_production_artifact: {
    name: "revise_production_artifact",
    description: "Request a new script or storyboard version from an existing artifact; never overwrite the source version.",
    parameters: z.object({
      runId,
      artifactId,
      expectedVersion: z.number().int().min(1),
      kind: z.enum(["script", "storyboard"]),
      instruction: z.string().trim().min(1).max(4_000),
    }).strict(),
  },
  review_production_artifact: {
    name: "review_production_artifact",
    description: "Approve, request changes to, or reject one exact artifact version; the version is never implicit.",
    parameters: z.object({
      runId,
      artifactId,
      expectedVersion: z.number().int().min(1),
      decision: z.enum(ARTIFACT_REVIEW_DECISIONS),
    }).strict(),
  },
  materialize_production_storyboard: {
    name: "materialize_production_storyboard",
    description: "Attach an approved storyboard version to the real generation canvas, preserving run/artifact provenance.",
    parameters: z.object({ runId, artifactId, expectedVersion: z.number().int().min(1) }).strict(),
  },
} as const;

export const productionRunToolDescriptors = descriptors;
export const productionRunToolNames = Object.keys(descriptors) as Array<keyof typeof descriptors>;
export const productionRunReadToolNames = new Set<string>([
  PRODUCTION_RUN_READ_CAPABILITY.aliases.pi,
  ...(PRODUCTION_RUN_READ_CAPABILITY.additionalAliases?.pi ?? []),
]);
export const productionRunWriteToolNames = new Set<string>([
  PRODUCTION_RUN_WRITE_CAPABILITY.aliases.pi,
  ...(PRODUCTION_RUN_WRITE_CAPABILITY.additionalAliases?.pi ?? []),
]);
export const productionArtifactWriteToolNames = new Set<string>([
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY.aliases.pi,
  ...(PRODUCTION_ARTIFACT_WRITE_CAPABILITY.additionalAliases?.pi ?? []),
]);

export type ProductionRunToolName = keyof typeof descriptors;
