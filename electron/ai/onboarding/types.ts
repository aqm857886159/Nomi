/**
 * Shared types for the model onboarding agent.
 *
 * The onboarding agent's job: given an API documentation URL + an API key,
 * produce a complete vendor + model + mapping configuration that is verified
 * to work via a real HTTP test request.
 *
 * The agent runs in main process (Electron) or as a standalone CLI (Lab mode).
 * Both paths share this module — keep it free of Electron globals.
 */

export type ModelKind = "text" | "image" | "video" | "audio";

// R1：providerKind 的真相源是 catalog/types 的 AiSdkProviderKind（3 值，含 openai-responses）。
// 这里 import + re-export（别名 ProviderKind）而非平行定义，避免 2 值/3 值漂移。分层
// electron/ai → electron/catalog 单向，与 buildAiSdkModel 同样 import catalog/types，无循环。
import type { AiSdkProviderKind } from "../../catalog/types";
export type ProviderKind = AiSdkProviderKind;

export type AuthType = "bearer" | "x-api-key" | "query" | "none";

export type ParameterControlType = "select" | "number" | "text" | "boolean" | "image-url";

export type ParameterOption = {
  value: string | number | boolean;
  label: string;
};

export type FieldEvidence = {
  field: string;
  evidence: string;
  evidence_location: string;
  confidence: "high" | "medium" | "low";
};

export type FieldDefinition = {
  key: string;
  displayName: string;
  type: ParameterControlType;
  options?: ParameterOption[];
  default?: string | number | boolean;
  evidence: FieldEvidence;
};

export type RequestProfileStage = "create" | "query";

export type RequestProfileOperation = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  response_mapping?: Record<string, string>;
};

export type OnboardingDraft = {
  sessionId: string;
  startedAt: number;
  targetKind: ModelKind;

  // vendor
  vendorKey?: string;
  vendorName?: string;
  vendorBaseUrl?: string;
  vendorAuth?: {
    type: AuthType;
    headerName?: string;
    queryParam?: string;
  };
  vendorProviderKind?: ProviderKind;

  // model
  modelKey?: string;
  modelDisplayName?: string;
  modelFields: FieldDefinition[];

  // mapping
  mappingCreate?: RequestProfileOperation;
  mappingQuery?: RequestProfileOperation;

  // documentation snapshots (for replay / debug)
  fetchedDocs: Array<{ url: string; contentType: string; bytes: number; markdownPath: string }>;

  // test attempts
  testAttempts: Array<{
    timestamp: number;
    stage: RequestProfileStage;
    request: { method: string; url: string; headers: Record<string, string>; body: unknown };
    response: { status: number; body: unknown };
    ok: boolean;
    diagnostics: string[];
  }>;

  // completeness self-check
  completenessCheck?: {
    kind: ModelKind;
    items: Array<{ field: string; status: "has" | "no" | "unsure"; reasoning: string }>;
  };
};

/**
 * Outcome of a trial — what we record after running the agent once.
 */
export type TrialOutcome = {
  trialId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  docsUrl: string;
  targetKind: ModelKind;
  agentModel: string;

  status: "success" | "partial" | "failure";
  failureReason?: string;

  rounds: number;             // how many LLM steps
  toolCalls: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  draft: OnboardingDraft;
};

/**
 * Event emitted during a trial run — used by reporter to write trace.
 */
export type TrialEvent =
  | { type: "trial-start"; trialId: string; docsUrl: string; targetKind: ModelKind; agentModel: string }
  | { type: "llm-step"; stepIndex: number; text?: string }
  | { type: "tool-call"; toolName: string; args: unknown; toolCallId: string }
  | { type: "tool-result"; toolName: string; result: unknown; toolCallId: string }
  | { type: "tool-error"; toolName: string; error: string; toolCallId: string }
  | { type: "trial-end"; outcome: TrialOutcome };
