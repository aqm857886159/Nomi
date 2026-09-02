import { z } from "zod";

export const workspaceProjectRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.literal(2),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  savedAt: z.number().finite().optional(),
  revision: z.number().int().nonnegative().optional(),
  /** Stable identity for lease/contract bindings. Old manifests remain readable until maintenance migration. */
  immutableProjectUuid: z.string().uuid().optional(),
  /** Monotonic identity generation; deleting/recreating a project must never reuse the old generation. */
  projectGeneration: z.number().int().positive().optional(),
  lastKnownRootPath: z.string().min(1).optional(),
  /** 播种来源幂等键（如「一键示例」）。随 manifest 持久化，list 摘要原样带回。 */
  seedKey: z.string().min(1).optional(),
  /**
   * 草稿态：新建空白项目零编辑的标记。首次 save（revision→≥1）即清除（promote 为持久态）。
   * 启动 GC 只回收 `draft===true && revision===0` 的 native 空壳 → 库不再堆「未命名」垃圾。
   * 老项目/example/打开文件夹无此字段 → 天然豁免，GC 永不碰。
   */
  draft: z.boolean().optional(),
  payload: z.unknown().optional(),
});

export type WorkspaceProjectRecordV2 = z.infer<typeof workspaceProjectRecordSchema> & {
  savedAt: number;
  revision: number;
};

export class WorkspaceProjectIdentityUnavailableError extends Error {
  readonly code = "project_identity_unavailable";

  constructor(message = "Workspace project identity is unavailable", options?: { cause?: unknown }) {
    super(message);
    this.name = "WorkspaceProjectIdentityUnavailableError";
    if (options && Object.prototype.hasOwnProperty.call(options, "cause")) {
      Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
    }
  }
}

export type WorkspaceProjectSource = "native" | "folder";
export type WorkspaceOrigin = { source: "native"; nativeRootPath: string } | { source: "folder" };

export const recentWorkspaceEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  lastOpenedAt: z.number().finite(),
  missing: z.boolean().optional(),
  source: z.enum(["native", "folder"]).optional(),
  nativeRootPath: z.string().min(1).optional(),
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
  const origin =
    parsed.source === "native" && parsed.nativeRootPath
      ? { source: "native" as const, nativeRootPath: parsed.nativeRootPath }
      : parsed.source === "folder"
        ? { source: "folder" as const }
        : {};
  return {
    ...parsed,
    source: undefined,
    nativeRootPath: undefined,
    ...origin,
    missing: parsed.missing ?? false,
  };
}
