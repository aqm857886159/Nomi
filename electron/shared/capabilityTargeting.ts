export type DocumentAnchorRef =
  | Readonly<{ kind: "whole-document" }>
  | Readonly<{ kind: "range"; from: number; to: number; selectedTextHash: string }>
  | Readonly<{ kind: "cursor"; position: number; beforeHash: string; afterHash: string }>
  | Readonly<{ kind: "document-end"; trailingTextHash: string }>;

export type TargetRef =
  | Readonly<{ kind: "document"; documentId: string; anchor: DocumentAnchorRef }>
  | Readonly<{ kind: "canvas"; nodeIds: readonly string[]; groupIds?: readonly string[] }>
  | Readonly<{ kind: "canvas-result"; nodeId: string; resultId: string }>
  | Readonly<{ kind: "asset"; assetIds: readonly string[] }>
  | Readonly<{ kind: "timeline"; clipIds: readonly string[] }>
  | Readonly<{ kind: "export"; jobId?: string; timelineRevision?: string }>
  | Readonly<{
      kind: "artifact";
      runId: string;
      artifactId: string;
      version: number;
      contentHash: string;
    }>
  | Readonly<{ kind: "production"; runId: string; gateId?: string; jobId?: string }>;

export type PreconditionSet = Readonly<{
  document?: Readonly<{ revision: number; contentHash?: string }>;
  nodes?: readonly Readonly<{ nodeId: string; revision?: number; contentHash: string }>[];
  groups?: readonly Readonly<{ groupId: string; membershipHash: string }>[];
  edges?: readonly Readonly<{ relationHash: string }>[];
  results?: readonly Readonly<{ nodeId: string; resultId: string; pointerHash: string }>[];
  clips?: readonly Readonly<{ clipId: string; revision?: number; contentHash: string }>[];
  timeline?: Readonly<{ revision: string }>;
  run?: Readonly<{ runId: string; revision: number }>;
}>;

export type TaskRef =
  | Readonly<{
      kind: "production-run";
      runId: string;
      expectedRunRevision?: number;
      stageId?: string;
      jobId?: string;
      shotId?: string;
    }>
  | Readonly<{
      kind: "export-job";
      jobId: string;
    }>;
