import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import { RpcError, type RpcPublicErrorCode } from "./rpcError";

const PUBLIC_CODES = new Set([
  "lease_required",
  "lease_invalid",
  "lease_expired",
  "lease_revoked",
  "project_scope_changed",
  "project_binding_stale",
  "project_identity_unavailable",
  "capability_authority_invalid",
  "capability_input_invalid",
  "capability_output_invalid",
  "capability_timeout",
  "capability_cancelled",
  "capability_execution_failed",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
]);
const PROJECT_SESSION_RECOVERY_CODES = new Set([
  "lease_required",
  "lease_invalid",
  "lease_expired",
  "lease_revoked",
  "project_scope_changed",
  "project_binding_stale",
]);
const OPEN_PROJECT_SESSION = "Choose a project and open a new project session";

/** One safe typed projection shared by local RPC and one-shot internal host. */
export function canvasReadRpcError(error: unknown): RpcError {
  const candidate =
    error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  const rawCode =
    typeof candidate === "string" && PUBLIC_CODES.has(candidate) ? candidate : "capability_execution_failed";
  const message = error instanceof Error ? error.message : "";
  // Preserve the established lease boundary: malformed/cross-connection
  // failures are public `lease_invalid`; only a genuine hint/scope change uses
  // `project_scope_changed`.
  const code =
    rawCode === "project_scope_changed" && !/does not match (?:the )?current scope|scope is insufficient/i.test(message)
      ? "lease_invalid"
      : rawCode;
  const httpStatus =
    code === "capability_input_invalid"
      ? 400
      : code === "lease_required" ||
          code === "lease_invalid" ||
          code === "lease_expired" ||
          code === "lease_revoked" ||
          code === "project_scope_changed" ||
          code === "project_binding_stale" ||
          code === "capability_authority_invalid"
        ? 403
        : code === "capability_timeout"
          ? 504
          : code === "surface_port_stale" || code === "surface_owner_mismatch"
            ? 409
            : code === "project_identity_unavailable" ||
                code === "surface_port_suspended" ||
                code === "surface_port_unavailable"
              ? 503
              : 500;
  return new RpcError("Canvas read capability failed", httpStatus, {
    code: code as RpcPublicErrorCode,
    nextAction: PROJECT_SESSION_RECOVERY_CODES.has(code) ? OPEN_PROJECT_SESSION : "Retry the canvas read",
    capability: CANVAS_READ_CAPABILITY.id,
  });
}

export function canvasReadLeaseRequiredRpcError(): RpcError {
  return new RpcError("A verified project session lease is required", 403, {
    code: "lease_required",
    nextAction: OPEN_PROJECT_SESSION,
    capability: CANVAS_READ_CAPABILITY.id,
  });
}
