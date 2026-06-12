import { z } from "zod";

export const workspaceProjectRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.literal(2),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  savedAt: z.number().finite().optional(),
  revision: z.number().int().nonnegative().optional(),
  lastKnownRootPath: z.string().min(1).optional(),
  /** 播种来源幂等键（如「一键示例」）。随 manifest 持久化，list 摘要原样带回。 */
  seedKey: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

export type WorkspaceProjectRecordV2 = z.infer<typeof workspaceProjectRecordSchema> & {
  savedAt: number;
  revision: number;
};

export const recentWorkspaceEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  lastOpenedAt: z.number().finite(),
  missing: z.boolean().optional(),
});

export type RecentWorkspaceEntry = z.infer<typeof recentWorkspaceEntrySchema> & {
  missing: boolean;
};

export function normalizeWorkspaceProjectRecord(input: unknown): WorkspaceProjectRecordV2 {
  const parsed = workspaceProjectRecordSchema.parse(input);
  return {
    ...parsed,
    savedAt: parsed.savedAt ?? parsed.updatedAt,
    revision: parsed.revision ?? 0,
  };
}

export function normalizeRecentWorkspaceEntry(input: unknown): RecentWorkspaceEntry {
  const parsed = recentWorkspaceEntrySchema.parse(input);
  return {
    ...parsed,
    missing: parsed.missing ?? false,
  };
}
