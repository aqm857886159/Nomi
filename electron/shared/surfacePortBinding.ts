import type { MediaImportRejection } from "./contracts/mediaImportPolicy";
import type { ProjectBinding } from "./projectBinding";
import type { CanvasWriteOperation } from "./agentCapabilities/canvasWrite";
import type { DirectorWriteOperation } from "./agentCapabilities/directorWrite";
import type { CanvasDeleteInput } from "./agentCapabilities/canvasDelete";
import type { AssetReadInput } from "./agentCapabilities/assetRead";
import type { ExportReadInput, ExportWriteInput } from "./agentCapabilities/exportCapabilities";
import type { TimelineReadInput } from "./agentCapabilities/timelineRead";
import type { TimelineWriteInput } from "./agentCapabilities/timelineWrite";

export const SURFACE_PORT_BINDING_VERSION = 1 as const;
export const CAPTURED_CANVAS_READ_SNAPSHOT_VERSION = 1 as const;
export const SURFACE_CANVAS_READ_REQUEST_CHANNEL = "nomi:surface:canvasRead:request" as const;
export const SURFACE_CANVAS_READ_REPLY_CHANNEL = "nomi:surface:canvasRead:reply" as const;
export const SURFACE_DOCUMENT_READ_REQUEST_CHANNEL = "nomi:surface:documentRead:request" as const;
export const SURFACE_DOCUMENT_READ_REPLY_CHANNEL = "nomi:surface:documentRead:reply" as const;
export const SURFACE_DOCUMENT_WRITE_REQUEST_CHANNEL = "nomi:surface:documentWrite:request" as const;
export const SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL = "nomi:surface:documentWrite:reply" as const;
export const SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL = "nomi:surface:canvasWrite:capture:request" as const;
export const SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL = "nomi:surface:canvasWrite:capture:reply" as const;
export const SURFACE_CANVAS_WRITE_EXECUTE_REQUEST_CHANNEL = "nomi:surface:canvasWrite:execute:request" as const;
export const SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL = "nomi:surface:canvasWrite:execute:reply" as const;
export const SURFACE_TIMELINE_READ_REQUEST_CHANNEL = "nomi:surface:timelineRead:request" as const;
export const SURFACE_TIMELINE_READ_REPLY_CHANNEL = "nomi:surface:timelineRead:reply" as const;
export const SURFACE_TIMELINE_WRITE_REQUEST_CHANNEL = "nomi:surface:timelineWrite:request" as const;
export const SURFACE_TIMELINE_WRITE_REPLY_CHANNEL = "nomi:surface:timelineWrite:reply" as const;
export const SURFACE_ASSET_READ_REQUEST_CHANNEL = "nomi:surface:assetRead:request" as const;
export const SURFACE_ASSET_READ_REPLY_CHANNEL = "nomi:surface:assetRead:reply" as const;
export const SURFACE_EXPORT_READ_REQUEST_CHANNEL = "nomi:surface:exportRead:request" as const;
export const SURFACE_EXPORT_READ_REPLY_CHANNEL = "nomi:surface:exportRead:reply" as const;
export const SURFACE_EXPORT_WRITE_REQUEST_CHANNEL = "nomi:surface:exportWrite:request" as const;
export const SURFACE_EXPORT_WRITE_REPLY_CHANNEL = "nomi:surface:exportWrite:reply" as const;
export const SURFACE_PORT_CANCEL_REQUEST_CHANNEL = "nomi:surface:request:cancel" as const;

export type ProjectBindingWire = ProjectBinding;

export type SurfaceSuspensionWire = Readonly<{
  version: typeof SURFACE_PORT_BINDING_VERSION;
  suspensionId: string;
  surfaceInstanceId: string;
  portRevision: number;
  nonce: string;
}>;

export type SurfacePortBindingWire = Readonly<{
  version: typeof SURFACE_PORT_BINDING_VERSION;
  bindingId: string;
  binding: ProjectBindingWire;
  webContentsId: number;
  processId: number;
  frameRoutingId: number;
  origin: string;
  surfaceInstanceId: string;
  portRevision: number;
  nonce: string;
}>;

/**
 * 「这两份端口绑定是不是同一个」——**唯一**比对函数（C2，2026-09-18）。
 *
 * 在这之前这件事在三层各写了一遍，维度数是 13 / 13 / **7**：
 * 主进程登记表 `canvasReadSurfaceRegistry.sameBindingWire` 与渲染层
 * `projectCanvasReadSurface.sameBinding` 比全 13 维；而 **preload**
 * （`surfacePortPreloadBridge.sameSurfaceAuthority`）只比 7 维——漏掉 `version`、
 * `webContentsId`、`processId`、`frameRoutingId`、`origin`。
 *
 * 漏在 preload 尤其要命：它正是主进程与渲染层之间那道信任边界，「这条回复是不是发给我的」
 * 要靠它答。两份绑定只在 `webContentsId` 上不同（同一个项目、另一个窗口）时，
 * 它会说「是同一个」。#802 那次「少一个维度」就是这个形状。
 *
 * 维度的定义在类型 `SurfacePortBindingWire` 上，比对跟着类型走：上游加字段时，
 * `check:identity-compare` 会因为「owner 之外又出现一个身份比对」报红，而不是让三层各自
 * 决定要不要跟上。
 */
export function sameSurfacePortBindingWire(
  left: SurfacePortBindingWire | null | undefined,
  right: SurfacePortBindingWire | null | undefined,
): boolean {
  if (!left || !right || !left.binding || !right.binding) return false;
  return left.version === right.version
    && left.bindingId === right.bindingId
    && left.binding.projectId === right.binding.projectId
    && left.binding.immutableProjectUuid === right.binding.immutableProjectUuid
    && left.binding.projectGeneration === right.binding.projectGeneration
    && left.webContentsId === right.webContentsId
    && left.processId === right.processId
    && left.frameRoutingId === right.frameRoutingId
    && left.origin === right.origin
    && left.surfaceInstanceId === right.surfaceInstanceId
    && left.portRevision === right.portRevision
    && left.nonce === right.nonce;
}

/**
 * 「这两条描述指的是同一个渲染帧吗」——**唯一**比对函数（C2，2026-09-18）。
 *
 * 它比的是「哪个 webContents / 哪个进程 / 哪个帧 / 哪个源」，不是端口绑定那一整套。
 * 之前 `canvasReadSurfaceRegistry.ts` 与 `canvasReadCapturedSnapshotRegistry.ts` 各写了一遍
 * 逐字相同的六维——两份副本今天一致，改一处就开始不一致，而它们一起决定
 * 「这次快照能不能算数」。
 *
 * 入参用结构类型而不是 import 那两个登记表的具体类型：owner 模块不该反过来依赖消费者。
 */
export function sameSurfaceFrameOwner(
  left: Readonly<{ contents: unknown; frame: unknown; webContentsId: number; processId: number; frameRoutingId: number; origin: string }>,
  right: Readonly<{ contents: unknown; frame: unknown; webContentsId: number; processId: number; frameRoutingId: number; origin: string }>,
): boolean {
  return left.contents === right.contents
    && left.frame === right.frame
    && left.webContentsId === right.webContentsId
    && left.processId === right.processId
    && left.frameRoutingId === right.frameRoutingId
    && left.origin === right.origin;
}

export type CanvasReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
}>;

export type CanvasReadSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type DocumentReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  documentId: string;
  scope: "full" | "selection";
}>;

export type DocumentReadSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type DocumentWriteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  documentId: string;
  operation: "insert" | "replace" | "append";
  content: string;
  target: unknown;
  preconditions: unknown;
}>;

export type DocumentWriteSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type CanvasWriteCaptureSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  operation: CanvasWriteOperation | CanvasDeleteInput["operation"] | DirectorWriteOperation;
  input?: unknown;
  nodeId?: string;
}>;

export type CanvasWriteCaptureSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type CanvasWriteExecuteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: unknown;
  target: unknown;
  preconditions: unknown;
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type CanvasWriteExecuteSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type TimelineReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: TimelineReadInput;
  target: unknown;
  preconditions: unknown;
}>;

export type TimelineReadSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type TimelineWriteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: TimelineWriteInput;
  target: unknown;
  preconditions: unknown;
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type TimelineWriteSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type AssetReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: AssetReadInput;
  target: unknown;
  preconditions: unknown;
}>;

export type ExportReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: ExportReadInput;
  target: unknown;
  preconditions: unknown;
}>;

export type ExportWriteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: ExportWriteInput;
  target: unknown;
  preconditions: unknown;
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type SurfacePortCancelRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
}>;

/** Opaque main-issued, owner-bound, one-shot admission for a captured turn. */
export type CapturedCanvasReadSnapshotHandleWire = Readonly<{
  version: typeof CAPTURED_CANVAS_READ_SNAPSHOT_VERSION;
  handleId: string;
  nonce: string;
}>;

export type CanvasReadSurfaceBridge = Readonly<{
  suspend(input: Readonly<{ surfaceInstanceId: string }>): Promise<Readonly<{ suspension: SurfaceSuspensionWire }>>;
  commitCanvasRead(
    input: Readonly<{
      projectId: string;
      suspension: SurfaceSuspensionWire;
    }>,
  ): Promise<Readonly<{ binding: SurfacePortBindingWire }>>;
  captureCanvasReadSnapshot(
    input: Readonly<{
      binding: SurfacePortBindingWire;
      snapshot: unknown;
    }>,
  ): Promise<Readonly<{ handle: CapturedCanvasReadSnapshotHandleWire }>>;
  release(
    input: Readonly<{
      authority: SurfaceSuspensionWire | SurfacePortBindingWire;
    }>,
  ): Promise<Readonly<{ released: true }>>;
  onCanvasRead(
    handler: (request: Readonly<{ binding: SurfacePortBindingWire }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ): () => void;
  onDocumentRead: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        documentId: string;
        scope: "full" | "selection";
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onDocumentWrite: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        documentId: string;
        operation: "insert" | "replace" | "append";
        content: string;
        target: unknown;
        preconditions: unknown;
        signal: AbortSignal;
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onCanvasWriteCapture: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        operation: CanvasWriteOperation | CanvasDeleteInput["operation"] | DirectorWriteOperation;
        input?: unknown;
        nodeId?: string;
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onCanvasWriteExecute: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        input: unknown;
        target: unknown;
        preconditions: unknown;
        receiptProposalId: string;
        approvalId: string;
        actionHash: string;
        signal: AbortSignal;
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onTimelineRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: TimelineReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onTimelineWrite: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: TimelineWriteInput;
      target: unknown;
      preconditions: unknown;
      receiptProposalId: string;
      approvalId: string;
      actionHash: string;
      signal: AbortSignal;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onAssetRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: AssetReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onExportRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: ExportReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onExportWrite: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: ExportWriteInput;
      target: unknown;
      preconditions: unknown;
      receiptProposalId: string;
      approvalId: string;
      actionHash: string;
      signal: AbortSignal;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
}>;

/**
 * 端口线上错误码的**唯一值源**（C4，2026-09-18）。
 *
 * 这一族码在仓库里曾有 15 份定义、8 个文件，其中 6 份是手抄——连这里自己都抄了两遍
 * （一份联合类型 + 一份同样内容的 Set 字面量）。代价不是好看不好看：拆
 * `surface_port_stale` 为「不存在 / 已过期」两码时，漏改任意一份，那条通道就把新码当未知码
 * 吞掉，模型收到的是「读一遍再试」而不是真原因（`docs/audit/2026-09-17-ownership-lifetime-census.md` §4）。
 *
 * 现在只有这一条元组是手写的，类型和 Set 都从它 derive；下游 adapter 只许
 * `new Set([...SURFACE_PORT_WIRE_ERROR_CODES, ...自己那几个])`，不许重列。
 * `check:vocabularies` 的错误码一类看的就是「整条都是字面量」——**派生即隐身，手抄才现形**。
 */
export const SURFACE_PORT_WIRE_ERROR_CODE_LIST = [
  "capability_execution_failed",
  "capability_cancelled",
  "capability_input_invalid",
  "capability_receipt_unresolved",
  "capability_target_stale",
  "capability_unsupported",
  // 文稿的选区 / 光标位置只在创作页编辑器里有（NF-1001-0001）。它和泛泛的「做不了」是两句不同的下一步：
  // 这一句能告诉模型改读整篇、告诉用户回创作页选中那段。
  "document_position_unavailable",
  "project_identity_unavailable",
  "project_binding_stale",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
  // Domain-level reversible write refusal that must survive the renderer/main
  // surface boundary so the Agent can explain a same-object conflict.
  "undo_conflict",
] as const;

export type SurfacePortWireErrorCode = (typeof SURFACE_PORT_WIRE_ERROR_CODE_LIST)[number];

export const SURFACE_PORT_WIRE_ERROR_CODES: ReadonlySet<SurfacePortWireErrorCode> =
  new Set(SURFACE_PORT_WIRE_ERROR_CODE_LIST);

/**
 * 端口码之上，传输层自己多出来的那几个「这一次调用本身没验过 / 没授权 / 策略过期 / 出参不合法 /
 * 超时」的码。它们不属于端口身份，但每一个 transport adapter 的公开面都要放行。
 */
export const CAPABILITY_TRANSPORT_VERIFICATION_ERROR_CODE_LIST = [
  "capability_invocation_unverified",
  "capability_authority_invalid",
  "capability_policy_stale",
  "capability_output_invalid",
  "capability_timeout",
] as const;

export type CapabilityTransportVerificationErrorCode =
  (typeof CAPABILITY_TRANSPORT_VERIFICATION_ERROR_CODE_LIST)[number];

/**
 * 每个 transport adapter 公开面的**共同底座**：端口码 + 传输验证码。
 *
 * 在这之前，canvasRead / documentRead / documentWrite / phase4Surface / timeline 各自手抄了
 * 一份「这 17 个码可以放行」，抄出来的结果是 15/14/15/16/20 五个不同的数——
 * `documentRead` 少了 `capability_receipt_unresolved`，`timeline` 少了
 * `project_identity_unavailable`，`canvasRead` 两个都少。少掉的那些不会报错，只会被
 * 静默替换成 `capability_execution_failed`，于是模型收到的是「执行失败，读一遍再试」
 * 而不是「项目身份取不到」——**它按那句话重试，永远修不好真问题**。
 *
 * adapter 只许 `new Set([...CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES, ...自己那几个])`。
 */
export const CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  ...SURFACE_PORT_WIRE_ERROR_CODE_LIST,
  ...CAPABILITY_TRANSPORT_VERIFICATION_ERROR_CODE_LIST,
]);

export type SurfacePortFailure = Readonly<{ code: SurfacePortWireErrorCode; reason?: MediaImportRejection["reason"] }>;
export type SurfacePortHandlerResult<T = unknown> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: SurfacePortFailure }>;

/** Error normalization happens in the originating realm, before contextBridge. */
export function surfacePortFailure(error: unknown): SurfacePortFailure {
  const failure = parseSurfacePortFailure(error);
  if (failure) return failure;
  if (error instanceof DOMException && error.name === "AbortError") return { code: "capability_cancelled" };
  return { code: "capability_execution_failed" };
}

/** Invoke immediately: deferring run would capture a different project's store. */
export function settleSurfacePortHandler(
  run: () => unknown | Promise<unknown>,
): SurfacePortHandlerResult | Promise<SurfacePortHandlerResult> {
  try {
    const value = run();
    if (value && typeof (value as PromiseLike<unknown>).then === "function") {
      return Promise.resolve(value).then(
        (resolved) => ({ ok: true as const, value: resolved }),
        (error) => ({ ok: false as const, error: surfacePortFailure(error) }),
      );
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: surfacePortFailure(error) };
  }
}

export function parseSurfacePortFailure(value: unknown): SurfacePortFailure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as { code?: unknown }).code;
  if (typeof code !== "string" || !SURFACE_PORT_WIRE_ERROR_CODES.has(code as SurfacePortWireErrorCode)) return null;
  const reason = (value as { reason?: unknown }).reason;
  return { code: code as SurfacePortWireErrorCode,
    ...(code === "capability_execution_failed" && (reason === "unsupported-kind" || reason === "no-disk-space" || reason === "over-hard-cap")
      ? { reason } : {}),
  };
}

/** Strict callback protocol: arbitrary legacy handler results are not success. */
export function surfacePortReplyPayload(value: unknown): { result: unknown } | { error: SurfacePortFailure } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const envelope = value as Record<string, unknown>;
    if (envelope.ok === true && Object.prototype.hasOwnProperty.call(envelope, "value")) {
      return { result: envelope.value };
    }
    if (envelope.ok === false) {
      const error = parseSurfacePortFailure(envelope.error);
      if (error) return { error };
    }
  }
  return { error: { code: "surface_port_unavailable" } };
}

/** Model-facing recovery advice is derived only from the safe failure contract. */
export function surfacePortFailureAdvice(failure: SurfacePortFailure): { message: string; nextAction: string } {
  switch (failure.reason) {
    case "no-disk-space": return { message: "The artifact could not be saved because the project disk has insufficient free space.",
      nextAction: "Free space on the project disk before trying this action again." };
    case "unsupported-kind": return { message: "The artifact format is not accepted by this destination.",
      nextAction: "Choose a format supported by the destination before trying again." };
    case "over-hard-cap": return { message: "The artifact exceeds the destination's supported size limit.",
      nextAction: "Reduce the artifact size to the destination's limit before trying again." };
  }
  // 「去核对回执」对模型是一句做不到的话（它没有读回执的工具）——NF-1001-0002 那一轮它就停在这里。
  // 给它一个做得到的核对：用对应的读工具看改动在不在。
  if (failure.code === "capability_receipt_unresolved") return {
    message: "The change may or may not have landed: its outcome could not be confirmed (capability_receipt_unresolved).",
    nextAction: "Read the current state with the matching read tool (read_script for the script, look_at_canvas for the canvas, read_timeline for the timeline) and compare it with what you meant to change. If the change is there, do not write it again; if it is not, write it once more. A new write can be refused for about a minute while the previous one settles.",
  };
  if (failure.code === "capability_cancelled") return {
    message: "The action was cancelled.", nextAction: "Wait for a new user instruction before starting another action.",
  };
  // 「这个面现在做不了这件事」和「目标过期」是两句不同的建议：前者重读多少次都不会变。
  if (failure.code === "document_position_unavailable") return {
    message: "The user is not on the creation page, so the script has no selection or cursor position right now (document_position_unavailable).",
    nextAction: "Do not ask for it again. If the user means the script, call read_script without scope (whole script) or write_script with where append/replace; if \"this\" means something on the page they are on, read that page instead (look_at_canvas / read_timeline); if still unclear, ask the user.",
  };
  if (failure.code === "capability_unsupported") return {
    message: "This action is not available from where the user is right now (capability_unsupported).",
    nextAction: "Do not repeat the same call. Use a different tool that this surface supports, or ask the user which page or object they mean.",
  };
  if (failure.code === "capability_execution_failed") return {
    message: "The action could not be completed.", nextAction: "Review the failure and the current result before deciding whether to retry.",
  };
  return { message: `The current target could not accept this action (${failure.code}).`,
    nextAction: "Read the current surface again and use its current identifiers and revision before retrying." };
}

export class SurfacePortWireError extends Error {
  constructor(readonly code: SurfacePortWireErrorCode, readonly reason?: SurfacePortFailure["reason"]) {
    super(code);
    this.name = "SurfacePortWireError";
  }
}

export function unwrapSurfacePortIpcResponse<T>(response: unknown): T {
  const reply = surfacePortReplyPayload(response);
  if ("error" in reply) throw new SurfacePortWireError(reply.error.code, reply.error.reason);
  return reply.result as T;
}
