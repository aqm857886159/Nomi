import { z } from "zod";
import {
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
} from "./productionRun";
import { ARTIFACT_REVIEW_DECISIONS } from "./productionRun";

const runId = z.string().trim().min(1).max(160).describe("The run id returned by start_production_run.");
const artifactId = z.string().trim().min(1).max(160).describe("The artifact id from the run projection.");

// 说明书（描述/何时用/何时不用）**不住这里**：唯一 owner 是 `verbs/productionVerbs.ts`；这里只剩名字与 schema。
const descriptors = {
  get_production_run: {
    name: "get_production_run",
    parameters: z.object({ runId }).strict(),
  },
  subscribe_production_run: {
    name: "subscribe_production_run",
    parameters: z.object({
      runId,
      afterCursor: z.number().int().nonnegative().optional().describe("Last consumed event cursor; default 0."),
      waitMs: z.number().int().min(0).max(25_000).optional().describe("Optional bounded wait for new progress."),
    }).strict(),
  },
  read_production_artifact: {
    name: "read_production_artifact",
    parameters: z.object({ runId, artifactId }).strict(),
  },
  read_production_artifact_content: {
    name: "read_production_artifact_content",
    parameters: z.object({ runId, artifactId }).strict(),
  },
  start_production_run: {
    name: "start_production_run",
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
    parameters: z.object({
      runId,
      action: z.enum(["pause", "resume", "cancel", "set_trust"]),
      trustLevel: z.enum(["key_confirm", "budget_only", "confirm_all"]).optional(),
    }).strict(),
  },
  decide_production_gate: {
    name: "decide_production_gate",
    parameters: z.object({
      runId,
      gateId: z.string().trim().min(1).max(160),
      decision: z.enum(ARTIFACT_REVIEW_DECISIONS).exclude(["changes_requested"]),
      choiceKey: z.string().trim().min(1).max(40).optional(),
    }).strict(),
  },
  revise_production_artifact: {
    name: "revise_production_artifact",
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
    parameters: z.object({
      runId,
      artifactId,
      expectedVersion: z.number().int().min(1),
      decision: z.enum(ARTIFACT_REVIEW_DECISIONS),
    }).strict(),
  },
  materialize_production_storyboard: {
    name: "materialize_production_storyboard",
    parameters: z.object({ runId, artifactId, expectedVersion: z.number().int().min(1) }).strict(),
  },
} as const;

export const productionRunToolDescriptors = descriptors;
export const productionRunToolNames = Object.keys(descriptors) as Array<keyof typeof descriptors>;
export const productionRunReadToolNames = new Set<string>([
  PRODUCTION_RUN_READ_CAPABILITY.aliases.method,
  ...(PRODUCTION_RUN_READ_CAPABILITY.additionalAliases?.method ?? []),
]);
export const productionRunWriteToolNames = new Set<string>([
  PRODUCTION_RUN_WRITE_CAPABILITY.aliases.method,
  ...(PRODUCTION_RUN_WRITE_CAPABILITY.additionalAliases?.method ?? []),
]);
export const productionArtifactWriteToolNames = new Set<string>([
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY.aliases.method,
  ...(PRODUCTION_ARTIFACT_WRITE_CAPABILITY.additionalAliases?.method ?? []),
]);

export type ProductionRunToolName = keyof typeof descriptors;
