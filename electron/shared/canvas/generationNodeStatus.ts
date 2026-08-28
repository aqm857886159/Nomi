import { z } from "zod";

export const GENERATION_NODE_STATUSES = ["idle", "queued", "running", "success", "error", "recoverable"] as const;

export const generationNodeStatusSchema = z.enum(GENERATION_NODE_STATUSES);

export type GenerationNodeStatus = z.infer<typeof generationNodeStatusSchema>;

export function parseGenerationNodeStatus(value: unknown): GenerationNodeStatus | undefined {
  const parsed = generationNodeStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
