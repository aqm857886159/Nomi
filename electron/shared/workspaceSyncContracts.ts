export type WorkspaceSyncStatus =
  | "ready"
  | "external-change"
  | "conflict"
  | "missing-assets"
  | "corrupt-manifest";

export type WorkspaceSyncInspection = {
  status: WorkspaceSyncStatus;
  manifestExists: boolean;
  backupExists: boolean;
  referencedAssetCount: number;
  missingAssetCount: number;
  observedRevision: number | null;
  lastWriterId: string | null;
  contentHash: string | null;
};
