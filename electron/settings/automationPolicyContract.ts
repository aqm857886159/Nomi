import { normalizeMaxConcurrentJobs, type AutomationMode } from "../productionRun/productionRunTypes";

const TRUSTED_HOSTS = new Set(["nomi", "claude", "codex", "cursor"]);
const SAFE_CATALOG_KEY = /^[A-Za-z0-9._:-]{1,160}$/;

export type AutomationPolicySettings = {
  schemaVersion: 1;
  mode: AutomationMode;
  trustedHosts: string[];
  allowedProviders: string[];
  allowedModels: string[];
  maxSpend: number | null;
  maxAttemptsPerJob: number;
  maxConcurrentJobs: number;
  confirmFirstSpend: true;
  autoContinueWithinBudget: boolean;
  confirmIrreversible: true;
  systemNotifications: boolean;
  notificationSound: boolean;
  notifyOnGate: boolean;
  notifyOnFailure: boolean;
  notifyOnCompletion: boolean;
  minimizeUploads: boolean;
};

export const DEFAULT_AUTOMATION_POLICY_SETTINGS: AutomationPolicySettings = {
  schemaVersion: 1,
  mode: "balanced",
  trustedHosts: ["nomi", "claude", "codex"],
  allowedProviders: [],
  allowedModels: [],
  maxSpend: null,
  maxAttemptsPerJob: 3,
  maxConcurrentJobs: 1,
  confirmFirstSpend: true,
  autoContinueWithinBudget: true,
  confirmIrreversible: true,
  systemNotifications: true,
  notificationSound: true,
  notifyOnGate: true,
  notifyOnFailure: true,
  notifyOnCompletion: true,
  minimizeUploads: true,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function catalogKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => SAFE_CATALOG_KEY.test(item)))];
}

function trustedHosts(value: unknown): string[] {
  const requested = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : DEFAULT_AUTOMATION_POLICY_SETTINGS.trustedHosts;
  return ["nomi", ...new Set(requested.filter((item) => item !== "nomi" && TRUSTED_HOSTS.has(item)))];
}

export function normalizeAutomationPolicySettings(value: unknown): AutomationPolicySettings {
  const raw = record(value);
  const mode = raw.mode === "guided" || raw.mode === "policy-auto" ? raw.mode : "balanced";
  const maxSpend = typeof raw.maxSpend === "number" && Number.isFinite(raw.maxSpend) && raw.maxSpend >= 0
    ? raw.maxSpend
    : null;
  const attempts = typeof raw.maxAttemptsPerJob === "number" && Number.isFinite(raw.maxAttemptsPerJob)
    ? Math.min(10, Math.max(1, Math.floor(raw.maxAttemptsPerJob)))
    : DEFAULT_AUTOMATION_POLICY_SETTINGS.maxAttemptsPerJob;
  const maxConcurrentJobs = normalizeMaxConcurrentJobs(raw.maxConcurrentJobs, DEFAULT_AUTOMATION_POLICY_SETTINGS.maxConcurrentJobs);
  return {
    schemaVersion: 1,
    mode,
    trustedHosts: trustedHosts(raw.trustedHosts),
    allowedProviders: catalogKeys(raw.allowedProviders),
    allowedModels: catalogKeys(raw.allowedModels),
    maxSpend,
    maxAttemptsPerJob: attempts,
    maxConcurrentJobs,
    confirmFirstSpend: true,
    autoContinueWithinBudget: boolean(raw.autoContinueWithinBudget, true),
    confirmIrreversible: true,
    systemNotifications: boolean(raw.systemNotifications, true),
    notificationSound: boolean(raw.notificationSound, true),
    notifyOnGate: boolean(raw.notifyOnGate, true),
    notifyOnFailure: boolean(raw.notifyOnFailure, true),
    notifyOnCompletion: boolean(raw.notifyOnCompletion, true),
    minimizeUploads: boolean(raw.minimizeUploads, true),
  };
}
