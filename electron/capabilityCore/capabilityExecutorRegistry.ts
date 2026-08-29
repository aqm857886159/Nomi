import {
  CANVAS_READ_CAPABILITY,
  canvasReadResultSchema,
  projectCanvasRead,
  type CanvasReadResult,
} from "../shared/agentCapabilities/canvasRead";
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
  write(input: Readonly<{
    operation: "insert" | "replace" | "append";
    content: string;
    target: unknown;
    preconditions: unknown;
    signal: AbortSignal;
  }>): Promise<unknown>;
}>;

type AnyVerifiedInvocation = VerifiedCapabilityInvocation<unknown, unknown>;

export type CanvasReadPortResolver = (invocation: AnyVerifiedInvocation) => CanvasReadPort | DocumentReadPort | DocumentWritePort | Promise<CanvasReadPort | DocumentReadPort | DocumentWritePort>;

export type CapabilityExecutorRegistryOptions = Readonly<{
  resolveCanvasReadPort: CanvasReadPortResolver;
  resolveDocumentReadPort?: (invocation: AnyVerifiedInvocation) => DocumentReadPort | Promise<DocumentReadPort>;
  resolveDocumentWritePort?: (invocation: AnyVerifiedInvocation) => DocumentWritePort | Promise<DocumentWritePort>;
  timeoutMs?: number;
}>;

export type CapabilityExecuteOptions = Readonly<{
  signal?: AbortSignal;
}>;

const DEFAULT_TIMEOUT_MS = 15_000;
const PASSTHROUGH_CODES = new Set([
  "capability_invocation_unverified",
  "capability_authority_invalid",
  "capability_policy_stale",
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
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

async function revalidate(invocation: AnyVerifiedInvocation): Promise<void> {
  try {
    await revalidateVerifiedCapabilityInvocation(invocation);
  } catch (error) {
    throw safeStageError(error);
  }
}

function parseInput(invocation: AnyVerifiedInvocation): void {
  const schema = invocation.capability.id === DOCUMENT_READ_CAPABILITY.id
    ? documentReadSemanticInputSchema
    : invocation.capability.id === DOCUMENT_WRITE_CAPABILITY.id
      ? documentWriteSemanticInputSchema
      : CANVAS_READ_CAPABILITY.inputSchema;
  if (!schema.safeParse(invocation.input).success) {
    throw new CapabilityExecutionError("capability_input_invalid");
  }
}

function projectOutput(source: unknown, invocation: AnyVerifiedInvocation): CanvasReadResult | DocumentReadResult | DocumentWriteResult {
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
    this.#resolveCanvasReadPort = (invocation) =>
      invocation.capability.id === DOCUMENT_READ_CAPABILITY.id
        ? resolveDocumentReadPort
            ? Promise.resolve(resolveDocumentReadPort(invocation)).then((port): CanvasReadPort => ({
              read: (portInput: Readonly<{ signal: AbortSignal; scope?: "full" | "selection" }>) => port.read({
                scope: documentReadSemanticInputSchema.parse(invocation.input).scope,
                signal: portInput.signal,
              }),
            }))
          : Promise.reject(new CapabilityExecutionError("capability_unsupported"))
        : invocation.capability.id === DOCUMENT_WRITE_CAPABILITY.id
          ? resolveDocumentWritePort
            ? Promise.resolve(resolveDocumentWritePort(invocation)).then((port): CanvasReadPort => ({
                read: (portInput: Readonly<{ signal: AbortSignal; scope?: "full" | "selection" }>) => port.write({
                  operation: documentWriteSemanticInputSchema.parse(invocation.input).operation,
                  content: documentWriteSemanticInputSchema.parse(invocation.input).content,
                  target: invocation.target,
                  preconditions: invocation.preconditions,
                  signal: portInput.signal,
                }),
              }))
            : Promise.reject(new CapabilityExecutionError("capability_unsupported"))
          : resolveCanvasReadPort(invocation);
    this.#timeoutMs = positiveTimeout(options.timeoutMs);
  }

  async execute<Input, Target>(
    invocationValue: VerifiedCapabilityInvocation<Input, Target>,
    options: CapabilityExecuteOptions = {},
  ): Promise<Input extends import("../shared/agentCapabilities/documentRead").DocumentReadInput ? DocumentReadResult :
    Input extends import("../shared/agentCapabilities/documentWrite").DocumentWriteInput ? DocumentWriteResult : CanvasReadResult> {
    assertVerifiedCapabilityInvocation(invocationValue);
    const invocation = invocationValue;
    const isCanvasRead = invocation.capability.id === CANVAS_READ_CAPABILITY.id && invocation.capability.version === CANVAS_READ_CAPABILITY.version;
    const isDocumentRead = invocation.capability.id === DOCUMENT_READ_CAPABILITY.id && invocation.capability.version === DOCUMENT_READ_CAPABILITY.version;
    const isDocumentWrite = invocation.capability.id === DOCUMENT_WRITE_CAPABILITY.id && invocation.capability.version === DOCUMENT_WRITE_CAPABILITY.version;
    if (!isCanvasRead && !isDocumentRead && !isDocumentWrite) {
      throw new CapabilityExecutionError("capability_unsupported");
    }
    parseInput(invocation);

    return bounded(this.#timeoutMs, options.signal, async (signal) => {
      await revalidate(invocation);
      let port: CanvasReadPort | DocumentReadPort | DocumentWritePort;
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
      return projectOutput(source, invocation) as unknown as Input extends import("../shared/agentCapabilities/documentRead").DocumentReadInput
        ? DocumentReadResult
        : Input extends import("../shared/agentCapabilities/documentWrite").DocumentWriteInput
          ? DocumentWriteResult
          : CanvasReadResult;
    }) as Promise<Input extends import("../shared/agentCapabilities/documentRead").DocumentReadInput ? DocumentReadResult :
      Input extends import("../shared/agentCapabilities/documentWrite").DocumentWriteInput ? DocumentWriteResult : CanvasReadResult>;
  }
}

export function createMainCapabilityExecutorRegistry(
  options: CapabilityExecutorRegistryOptions,
): CapabilityExecutorRegistry {
  return new CapabilityExecutorRegistry(options);
}
