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

type AnyVerifiedInvocation = VerifiedCapabilityInvocation<unknown, unknown>;

export type CanvasReadPortResolver = (invocation: AnyVerifiedInvocation) => CanvasReadPort | Promise<CanvasReadPort>;

export type CapabilityExecutorRegistryOptions = Readonly<{
  resolveCanvasReadPort: CanvasReadPortResolver;
  resolveDocumentReadPort?: (invocation: AnyVerifiedInvocation) => DocumentReadPort | Promise<DocumentReadPort>;
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
    : CANVAS_READ_CAPABILITY.inputSchema;
  if (!schema.safeParse(invocation.input).success) {
    throw new CapabilityExecutionError("capability_input_invalid");
  }
}

function projectOutput(source: unknown, invocation: AnyVerifiedInvocation): CanvasReadResult | DocumentReadResult {
  if (invocation.capability.id === DOCUMENT_READ_CAPABILITY.id) {
    try {
      return documentReadResultSchema.parse(projectDocumentRead(source));
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
    this.#resolveCanvasReadPort = (invocation) =>
      invocation.capability.id === DOCUMENT_READ_CAPABILITY.id
        ? resolveDocumentReadPort
          ? resolveDocumentReadPort(invocation)
          : Promise.reject(new CapabilityExecutionError("capability_unsupported"))
        : resolveCanvasReadPort(invocation);
    this.#timeoutMs = positiveTimeout(options.timeoutMs);
  }

  async execute<Input, Target>(
    invocationValue: VerifiedCapabilityInvocation<Input, Target>,
    options: CapabilityExecuteOptions = {},
  ): Promise<Input extends import("../shared/agentCapabilities/documentRead").DocumentReadInput ? DocumentReadResult : CanvasReadResult> {
    assertVerifiedCapabilityInvocation(invocationValue);
    const invocation = invocationValue;
    const isCanvasRead = invocation.capability.id === CANVAS_READ_CAPABILITY.id && invocation.capability.version === CANVAS_READ_CAPABILITY.version;
    const isDocumentRead = invocation.capability.id === DOCUMENT_READ_CAPABILITY.id && invocation.capability.version === DOCUMENT_READ_CAPABILITY.version;
    if (!isCanvasRead && !isDocumentRead) {
      throw new CapabilityExecutionError("capability_unsupported");
    }
    parseInput(invocation);

    return bounded(this.#timeoutMs, options.signal, async (signal) => {
      await revalidate(invocation);
      let port: CanvasReadPort | DocumentReadPort;
      try {
        port = await this.#resolveCanvasReadPort(invocation);
      } catch (error) {
        throw safeStageError(error);
      }
      await revalidate(invocation);

      let source: unknown;
      try {
        source = await (port as CanvasReadPort).read({
          scope: isDocumentRead ? documentReadSemanticInputSchema.parse(invocation.input).scope : undefined,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw new CapabilityExecutionError("capability_cancelled");
        throw safeStageError(error);
      }
      await revalidate(invocation);
      return projectOutput(source, invocation) as Input extends import("../shared/agentCapabilities/documentRead").DocumentReadInput
        ? DocumentReadResult
        : CanvasReadResult;
    });
  }
}

export function createMainCapabilityExecutorRegistry(
  options: CapabilityExecutorRegistryOptions,
): CapabilityExecutorRegistry {
  return new CapabilityExecutorRegistry(options);
}
