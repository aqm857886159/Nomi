export type LocalRuntimeKind =
  | "localai"
  | "comfyui"
  | "sglang"
  | "vllm-omni"
  | "openai-compatible";

export type LocalRuntimeHealth = "ready" | "degraded" | "offline" | "unauthorized";
export type LocalRuntimeOutput = "text" | "image" | "video" | "audio" | "model3d";
export type LocalRuntimeSupport = "stream" | "tools" | "submit" | "query" | "reconcile" | "cancel";
export type LocalRuntimeCertification = "uncertified" | "partially_certified" | "certified";

export type LocalRuntimeCapability = {
  modelId: string;
  outputs: LocalRuntimeOutput[];
  inputModes: string[];
  supports: LocalRuntimeSupport[];
  evidence: {
    source: "discovery" | "probe" | "user";
    endpoint: string;
    checkedAt: string;
  };
};

export type LocalRuntimeDiagnostic = {
  stage: "discovery" | "readiness" | "version" | "capabilities" | "models";
  code: "network" | "unauthorized" | "unsupported" | "invalid_response" | "starting" | "upstream";
  status?: number;
};

/**
 * Evidence about an external runtime. It never implies that Nomi owns the
 * process, installation, model weights, or a model's production certification.
 */
export type LocalRuntimeDescriptor = {
  schemaVersion: 1;
  deployment: "external";
  runtimeId: string;
  kind: LocalRuntimeKind;
  origin: string;
  apiBaseUrl: string;
  version?: string;
  identity: "confirmed" | "assumed";
  auth: {
    mode: "none" | "api-key";
    scope: "none" | "user" | "admin" | "unknown";
  };
  health: LocalRuntimeHealth;
  capabilities: LocalRuntimeCapability[];
  certification: LocalRuntimeCertification;
  diagnostics: LocalRuntimeDiagnostic[];
  checkedAt: string;
};
