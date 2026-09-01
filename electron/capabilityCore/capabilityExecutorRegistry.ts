import {
  ASSET_READ_CAPABILITY,
  assetReadSemanticInputSchema,
  projectAssetReadResult,
  type AssetReadInput,
  type AssetReadResult,
} from "../shared/agentCapabilities/assetRead";
import {
  CANVAS_READ_CAPABILITY,
  canvasReadResultSchema,
  projectCanvasRead,
  type CanvasReadResult,
} from "../shared/agentCapabilities/canvasRead";
import {
  CANVAS_DELETE_CAPABILITY,
  canvasDeleteResultSchema,
  canvasDeleteSemanticInputSchema,
  type CanvasDeleteInput,
  type CanvasDeleteResult,
} from "../shared/agentCapabilities/canvasDelete";
import {
  CANVAS_WRITE_CAPABILITY,
  canvasWriteResultSchema,
  canvasWriteSemanticInputSchema,
  type CanvasWriteResult,
} from "../shared/agentCapabilities/canvasWrite";
import {
  DOCUMENT_READ_CAPABILITY,
  documentReadSemanticInputSchema,
  documentReadResultSchema,
  projectDocumentRead,
  type DocumentReadResult,
} from "../shared/agentCapabilities/documentRead";
import {
  DOCUMENT_WRITE_CAPABILITY,
  documentWriteResultSchema,
  documentWriteSemanticInputSchema,
  type DocumentWriteResult,
} from "../shared/agentCapabilities/documentWrite";
import {
  EXPORT_READ_CAPABILITY,
  EXPORT_WRITE_CAPABILITY,
  exportReadSemanticInputSchema,
  exportWriteSemanticInputSchema,
  projectExportReadResult,
  projectExportWriteResult,
  type ExportReadInput,
  type ExportReadResult,
  type ExportWriteInput,
  type ExportWriteResult,
} from "../shared/agentCapabilities/exportCapabilities";
import {
  TIMELINE_READ_CAPABILITY,
  projectTimelineReadResult,
  timelineReadSemanticInputSchema,
  type TimelineReadResult,
} from "../shared/agentCapabilities/timelineRead";
import {
  TIMELINE_WRITE_CAPABILITY,
  projectTimelineWriteResult,
  timelineWriteSemanticInputSchema,
  type TimelineWriteResult,
} from "../shared/agentCapabilities/timelineWrite";
import {
  CapabilityInvocationError,
  assertVerifiedCapabilityInvocation,
  revalidateVerifiedCapabilityInvocation,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

export type CapabilityExecutionErrorCode =
  | "capability_input_invalid"
  | "capability_output_invalid"
  | "capability_timeout"
  | "capability_cancelled"
  | "capability_execution_failed"
  | "capability_unsupported";

export class CapabilityExecutionError extends Error {
  constructor(readonly code: CapabilityExecutionErrorCode) {
    super(code);
    this.name = "CapabilityExecutionError";
  }
}

/** The only environmental authority available to a canvas.read executor. */
export type CanvasReadPort = Readonly<{
  read(input: Readonly<{ signal: AbortSignal; scope?: "full" | "selection" }>): Promise<unknown>;
}>;

export type DocumentReadPort = Readonly<{
  read(input: Readonly<{ scope: "full" | "selection"; signal: AbortSignal }>): Promise<unknown>;
}>;

export type DocumentWritePort = Readonly<{
  write(
    input: Readonly<{
      operation: "insert" | "replace" | "append";
      content: string;
      target: unknown;
      preconditions: unknown;
      signal: AbortSignal;
    }>,
  ): Promise<unknown>;
}>;

export type CanvasWritePort = Readonly<{
  capture(
    input: Readonly<{
      operation:
        | import("../shared/agentCapabilities/canvasWrite").CanvasWriteOperation
        | CanvasDeleteInput["operation"];
      input?: unknown;
      nodeId?: string;
      signal: AbortSignal;
    }>,
  ): Promise<unknown>;
  write(
    input: Readonly<{
      input: unknown;
      target: unknown;
      preconditions: unknown;
      receiptProposalId: string;
      approvalId: string;
      actionHash: string;
      signal: AbortSignal;
    }>,
  ): Promise<unknown>;
}>;

export type TimelineReadPort = Readonly<{
  read(input: Readonly<{ input: unknown; target: unknown; preconditions: unknown; signal: AbortSignal }>): Promise<unknown>;
}>;

export type TimelineWritePort = Readonly<{
  write(input: Readonly<{
    input: unknown;
    target: unknown;
    preconditions: unknown;
    receiptProposalId: string;
    approvalId: string;
    actionHash: string;
    signal: AbortSignal;
  }>): Promise<unknown>;
}>;

export type AssetReadPort = Readonly<{
  read(input: Readonly<{ input: unknown; target: unknown; preconditions: unknown; signal: AbortSignal }>): Promise<unknown>;
}>;

export type ExportReadPort = Readonly<{
  read(input: Readonly<{ input: unknown; target: unknown; preconditions: unknown; signal: AbortSignal }>): Promise<unknown>;
}>;

export type ExportWritePort = Readonly<{
  write(input: Readonly<{
    input: unknown;
    target: unknown;
    preconditions: unknown;
    receiptProposalId: string;
    approvalId: string;
    actionHash: string;
    signal: AbortSignal;
  }>): Promise<unknown>;
}>;

type AnyVerifiedInvocation = VerifiedCapabilityInvocation<unknown, unknown>;

export type CanvasReadPortResolver = (invocation: AnyVerifiedInvocation) => CanvasReadPort | Promise<CanvasReadPort>;

export type CapabilityExecutorRegistryOptions = Readonly<{
  resolveCanvasReadPort: CanvasReadPortResolver;
  resolveDocumentReadPort?: (invocation: AnyVerifiedInvocation) => DocumentReadPort | Promise<DocumentReadPort>;
  resolveDocumentWritePort?: (invocation: AnyVerifiedInvocation) => DocumentWritePort | Promise<DocumentWritePort>;
  resolveCanvasWritePort?: (invocation: AnyVerifiedInvocation) => CanvasWritePort | Promise<CanvasWritePort>;
  resolveAssetReadPort?: (invocation: AnyVerifiedInvocation) => AssetReadPort | Promise<AssetReadPort>;
  resolveExportReadPort?: (invocation: AnyVerifiedInvocation) => ExportReadPort | Promise<ExportReadPort>;
  resolveExportWritePort?: (invocation: AnyVerifiedInvocation) => ExportWritePort | Promise<ExportWritePort>;
  resolveTimelineReadPort?: (invocation: AnyVerifiedInvocation) => TimelineReadPort | Promise<TimelineReadPort>;
  resolveTimelineWritePort?: (invocation: AnyVerifiedInvocation) => TimelineWritePort | Promise<TimelineWritePort>;
  timeoutMs?: number;
}>;

export type CapabilityExecuteOptions = Readonly<{
  signal?: AbortSignal;
  approval?: Readonly<{
    receiptProposalId: string;
    approvalId: string;
    actionHash: string;
  }>;
}>;

type CapabilityResult<Input> =
  Input extends AssetReadInput ? AssetReadResult
    : Input extends import("../shared/agentCapabilities/documentRead").DocumentReadInput ? DocumentReadResult
      : Input extends import("../shared/agentCapabilities/documentWrite").DocumentWriteInput ? DocumentWriteResult
        : Input extends CanvasDeleteInput ? CanvasDeleteResult
          : Input extends import("../shared/agentCapabilities/canvasWrite").CanvasWriteInput ? CanvasWriteResult
            : Input extends ExportReadInput ? ExportReadResult
              : Input extends ExportWriteInput ? ExportWriteResult
                : Input extends import("../shared/agentCapabilities/timelineRead").TimelineReadInput ? TimelineReadResult
                  : Input extends import("../shared/agentCapabilities/timelineWrite").TimelineWriteInput ? TimelineWriteResult
                    : CanvasReadResult;

const DEFAULT_TIMEOUT_MS = 15_000;
const executionOptionsBySignal = new WeakMap<AbortSignal, CapabilityExecuteOptions>();
const PASSTHROUGH_CODES = new Set([
  "capability_invocation_unverified",
  "capability_authority_invalid",
  "capability_policy_stale",
  "capability_receipt_unresolved",
  "capability_surface_unavailable",
  "capability_target_stale",
  "project_identity_unavailable",
  "project_binding_stale",
  "project_scope_changed",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
  "lease_required",
  "lease_invalid",
  "lease_expired",
  "lease_revoked",
]);

function isStableTypedError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && PASSTHROUGH_CODES.has(code);
}

function safeStageError(error: unknown): Error {
  return isStableTypedError(error) || error instanceof CapabilityExecutionError
    ? error
    : new CapabilityExecutionError("capability_execution_failed");
}

function positiveTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CapabilityExecutionError("capability_execution_failed");
  }
  return value;
}

async function bounded<T>(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>,
  options: CapabilityExecuteOptions = {},
): Promise<T> {
  if (externalSignal?.aborted) throw new CapabilityExecutionError("capability_cancelled");

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    controller.abort();
  };
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  executionOptionsBySignal.set(controller.signal, options);

  try {
    return await Promise.race([
      execute(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => {
            reject(
              new CapabilityExecutionError(
                timedOut ? "capability_timeout" : cancelled ? "capability_cancelled" : "capability_cancelled",
              ),
            );
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    executionOptionsBySignal.delete(controller.signal);
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function proposalApproval(
  invocation: AnyVerifiedInvocation,
  signal: AbortSignal,
): NonNullable<CapabilityExecuteOptions["approval"]> {
  const approval = executionOptionsBySignal.get(signal)?.approval;
  if (
    !approval ||
    Object.keys(approval).some((key) => !["receiptProposalId", "approvalId", "actionHash"].includes(key)) ||
    typeof approval.receiptProposalId !== "string" ||
    !approval.receiptProposalId.trim() ||
    typeof approval.approvalId !== "string" ||
    !approval.approvalId.trim() ||
    approval.actionHash !== invocation.actionHash
  ) {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  return approval;
}

async function revalidate(invocation: AnyVerifiedInvocation): Promise<void> {
  try {
    await revalidateVerifiedCapabilityInvocation(invocation);
  } catch (error) {
    throw safeStageError(error);
  }
}

function parseInput(invocation: AnyVerifiedInvocation): void {
  const schema =
    invocation.capability.id === ASSET_READ_CAPABILITY.id
      ? assetReadSemanticInputSchema
      : invocation.capability.id === DOCUMENT_READ_CAPABILITY.id
      ? documentReadSemanticInputSchema
      : invocation.capability.id === DOCUMENT_WRITE_CAPABILITY.id
        ? documentWriteSemanticInputSchema
        : invocation.capability.id === CANVAS_DELETE_CAPABILITY.id
          ? canvasDeleteSemanticInputSchema
          : invocation.capability.id === CANVAS_WRITE_CAPABILITY.id
          ? canvasWriteSemanticInputSchema
          : invocation.capability.id === EXPORT_READ_CAPABILITY.id
            ? exportReadSemanticInputSchema
            : invocation.capability.id === EXPORT_WRITE_CAPABILITY.id
              ? exportWriteSemanticInputSchema
          : invocation.capability.id === TIMELINE_READ_CAPABILITY.id
            ? timelineReadSemanticInputSchema
            : invocation.capability.id === TIMELINE_WRITE_CAPABILITY.id
              ? timelineWriteSemanticInputSchema
              : CANVAS_READ_CAPABILITY.inputSchema;
  if (!schema.safeParse(invocation.input).success) {
    throw new CapabilityExecutionError("capability_input_invalid");
  }
}

function projectOutput(
  source: unknown,
  invocation: AnyVerifiedInvocation,
): AssetReadResult | CanvasReadResult | DocumentReadResult | DocumentWriteResult | CanvasDeleteResult | CanvasWriteResult | ExportReadResult | ExportWriteResult | TimelineReadResult | TimelineWriteResult {
  if (invocation.capability.id === ASSET_READ_CAPABILITY.id) {
    try {
      return projectAssetReadResult(source, assetReadSemanticInputSchema.parse(invocation.input).operation);
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === DOCUMENT_READ_CAPABILITY.id) {
    try {
      return documentReadResultSchema.parse(projectDocumentRead(source));
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === DOCUMENT_WRITE_CAPABILITY.id) {
    try {
      return documentWriteResultSchema.parse(source);
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === CANVAS_WRITE_CAPABILITY.id) {
    try {
      return canvasWriteResultSchema.parse(source);
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === CANVAS_DELETE_CAPABILITY.id) {
    try {
      return canvasDeleteResultSchema.parse(source);
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === EXPORT_READ_CAPABILITY.id) {
    try {
      return projectExportReadResult(source, exportReadSemanticInputSchema.parse(invocation.input).operation);
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === EXPORT_WRITE_CAPABILITY.id) {
    try {
      return projectExportWriteResult(source, exportWriteSemanticInputSchema.parse(invocation.input).operation);
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === TIMELINE_READ_CAPABILITY.id) {
    try {
      return projectTimelineReadResult(
        source,
        timelineReadSemanticInputSchema.parse(invocation.input).operation,
      );
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  if (invocation.capability.id === TIMELINE_WRITE_CAPABILITY.id) {
    try {
      return projectTimelineWriteResult(
        source,
        timelineWriteSemanticInputSchema.parse(invocation.input).operation,
      );
    } catch {
      throw new CapabilityExecutionError("capability_output_invalid");
    }
  }
  try {
    const canonical = canvasReadResultSchema.safeParse(source);
    if (canonical.success) return canonical.data;
    return canvasReadResultSchema.parse(projectCanvasRead(source));
  } catch {
    throw new CapabilityExecutionError("capability_output_invalid");
  }
}

/**
 * Main-process registry. Registrations are closed over in this module so a
 * transport can neither inject a second canvas.read implementation nor widen
 * the read executor to write/approval ports.
 */
export class CapabilityExecutorRegistry {
  readonly #resolveCanvasReadPort: CanvasReadPortResolver;
  readonly #timeoutMs: number;

  constructor(options: CapabilityExecutorRegistryOptions) {
    const resolveCanvasReadPort = options.resolveCanvasReadPort;
    const resolveDocumentReadPort = options.resolveDocumentReadPort;
    const resolveDocumentWritePort = options.resolveDocumentWritePort;
    const resolveCanvasWritePort = options.resolveCanvasWritePort;
    const resolveAssetReadPort = options.resolveAssetReadPort;
    const resolveExportReadPort = options.resolveExportReadPort;
    const resolveExportWritePort = options.resolveExportWritePort;
    const resolveTimelineReadPort = options.resolveTimelineReadPort;
    const resolveTimelineWritePort = options.resolveTimelineWritePort;
    this.#resolveCanvasReadPort = async (invocation) => {
      const readAdapter = (read: (signal: AbortSignal) => Promise<unknown>): CanvasReadPort => ({
        read: (portInput) => read(portInput.signal),
      });
      const approvedWriteAdapter = (
        resolvePort: ((value: AnyVerifiedInvocation) => Promise<CanvasWritePort | TimelineWritePort | ExportWritePort> | CanvasWritePort | TimelineWritePort | ExportWritePort) | undefined,
      ): CanvasReadPort => {
        if (!resolvePort) throw new CapabilityExecutionError("capability_unsupported");
        return readAdapter(async (signal) => {
          const approval = proposalApproval(invocation, signal);
          const port = await resolvePort(invocation);
          return port.write({
            input: invocation.input,
            target: invocation.target,
            preconditions: invocation.preconditions,
            receiptProposalId: approval.receiptProposalId,
            approvalId: approval.approvalId,
            actionHash: approval.actionHash,
            signal,
          });
        });
      };
      switch (invocation.capability.id) {
        case DOCUMENT_READ_CAPABILITY.id: {
          if (!resolveDocumentReadPort) throw new CapabilityExecutionError("capability_unsupported");
          const port = await resolveDocumentReadPort(invocation);
          return readAdapter((signal) => port.read({
            scope: documentReadSemanticInputSchema.parse(invocation.input).scope,
            signal,
          }));
        }
        case DOCUMENT_WRITE_CAPABILITY.id: {
          if (!resolveDocumentWritePort) throw new CapabilityExecutionError("capability_unsupported");
          const port = await resolveDocumentWritePort(invocation);
          const parsed = documentWriteSemanticInputSchema.parse(invocation.input);
          return readAdapter((signal) => port.write({
            operation: parsed.operation,
            content: parsed.content,
            target: invocation.target,
            preconditions: invocation.preconditions,
            signal,
          }));
        }
        case CANVAS_DELETE_CAPABILITY.id:
        case CANVAS_WRITE_CAPABILITY.id:
          return approvedWriteAdapter(resolveCanvasWritePort);
        case ASSET_READ_CAPABILITY.id: {
          if (!resolveAssetReadPort) throw new CapabilityExecutionError("capability_unsupported");
          const port = await resolveAssetReadPort(invocation);
          return readAdapter((signal) => port.read({
            input: invocation.input,
            target: invocation.target,
            preconditions: invocation.preconditions,
            signal,
          }));
        }
        case EXPORT_READ_CAPABILITY.id: {
          if (!resolveExportReadPort) throw new CapabilityExecutionError("capability_unsupported");
          const port = await resolveExportReadPort(invocation);
          return readAdapter((signal) => port.read({
            input: invocation.input,
            target: invocation.target,
            preconditions: invocation.preconditions,
            signal,
          }));
        }
        case EXPORT_WRITE_CAPABILITY.id:
          return approvedWriteAdapter(resolveExportWritePort);
        case TIMELINE_READ_CAPABILITY.id: {
          if (!resolveTimelineReadPort) throw new CapabilityExecutionError("capability_unsupported");
          const port = await resolveTimelineReadPort(invocation);
          return readAdapter((signal) => port.read({
            input: invocation.input,
            target: invocation.target,
            preconditions: invocation.preconditions,
            signal,
          }));
        }
        case TIMELINE_WRITE_CAPABILITY.id:
          return approvedWriteAdapter(resolveTimelineWritePort);
        default:
          return resolveCanvasReadPort(invocation);
      }
    };
    this.#timeoutMs = positiveTimeout(options.timeoutMs);
  }

  async execute<Input, Target>(
    invocationValue: VerifiedCapabilityInvocation<Input, Target>,
    options: CapabilityExecuteOptions = {},
  ): Promise<CapabilityResult<Input>> {
    assertVerifiedCapabilityInvocation(invocationValue);
    const invocation = invocationValue;
    const isCanvasRead =
      invocation.capability.id === CANVAS_READ_CAPABILITY.id &&
      invocation.capability.version === CANVAS_READ_CAPABILITY.version;
    const isDocumentRead =
      invocation.capability.id === DOCUMENT_READ_CAPABILITY.id &&
      invocation.capability.version === DOCUMENT_READ_CAPABILITY.version;
    const isDocumentWrite =
      invocation.capability.id === DOCUMENT_WRITE_CAPABILITY.id &&
      invocation.capability.version === DOCUMENT_WRITE_CAPABILITY.version;
    const isCanvasWrite =
      invocation.capability.id === CANVAS_WRITE_CAPABILITY.id &&
      invocation.capability.version === CANVAS_WRITE_CAPABILITY.version;
    const isCanvasDelete =
      invocation.capability.id === CANVAS_DELETE_CAPABILITY.id &&
      invocation.capability.version === CANVAS_DELETE_CAPABILITY.version;
    const isAssetRead =
      invocation.capability.id === ASSET_READ_CAPABILITY.id &&
      invocation.capability.version === ASSET_READ_CAPABILITY.version;
    const isExportRead =
      invocation.capability.id === EXPORT_READ_CAPABILITY.id &&
      invocation.capability.version === EXPORT_READ_CAPABILITY.version;
    const isExportWrite =
      invocation.capability.id === EXPORT_WRITE_CAPABILITY.id &&
      invocation.capability.version === EXPORT_WRITE_CAPABILITY.version;
    const isTimelineRead =
      invocation.capability.id === TIMELINE_READ_CAPABILITY.id &&
      invocation.capability.version === TIMELINE_READ_CAPABILITY.version;
    const isTimelineWrite =
      invocation.capability.id === TIMELINE_WRITE_CAPABILITY.id &&
      invocation.capability.version === TIMELINE_WRITE_CAPABILITY.version;
    if (!isAssetRead && !isCanvasRead && !isDocumentRead && !isDocumentWrite && !isCanvasDelete && !isCanvasWrite && !isExportRead && !isExportWrite && !isTimelineRead && !isTimelineWrite) {
      throw new CapabilityExecutionError("capability_unsupported");
    }
    parseInput(invocation);

    return bounded(
      this.#timeoutMs,
      options.signal,
      async (signal) => {
        await revalidate(invocation);
        let port: CanvasReadPort;
        try {
          port = await this.#resolveCanvasReadPort(invocation);
        } catch (error) {
          throw safeStageError(error);
        }
        await revalidate(invocation);

        let source: unknown;
        try {
          source = await (port as CanvasReadPort).read({
            ...(isDocumentRead ? { scope: documentReadSemanticInputSchema.parse(invocation.input).scope } : {}),
            signal,
          });
        } catch (error) {
          if (signal.aborted) throw new CapabilityExecutionError("capability_cancelled");
          throw safeStageError(error);
        }
        await revalidate(invocation);
        return projectOutput(source, invocation) as CapabilityResult<Input>;
      },
      options,
    );
  }
}

export function createMainCapabilityExecutorRegistry(
  options: CapabilityExecutorRegistryOptions,
): CapabilityExecutorRegistry {
  return new CapabilityExecutorRegistry(options);
}
