import type { AutomationMode } from "../productionRun/productionRunTypes";

// 泛化（方案 A）：trustedHosts 不再限定为硬编码四值，任意形状合法的 MCP 客户端 key
// （内置 + 自定义 profile）都可由用户显式勾选加入信任列表。
const MCP_HOST_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/
const SAFE_CATALOG_KEY = /^[A-Za-z0-9._:-]{1,160}$/;

export type AutomationPolicySettings = {
  schemaVersion: 1;
  mode: AutomationMode;
  trustedHosts: string[];
  allowedProviders: string[];
  allowedModels: string[];
  maxSpend: number | null;
  maxAttemptsPerJob: number;
  confirmFirstSpend: true;
  autoContinueWithinBudget: boolean;
  confirmIrreversible: true;
  systemNotifications: boolean;
  notificationSound: boolean;
  notifyOnGate: boolean;
  notifyOnFailure: boolean;
  notifyOnCompletion: boolean;
  minimizeUploads: boolean;
  /** Anonymous temporary hosting is available by default, but UI asks before first use. */
  anonymousAssetHosting: "ask" | "allow" | "deny";
};

export const DEFAULT_AUTOMATION_POLICY_SETTINGS: AutomationPolicySettings = {
  schemaVersion: 1,
  mode: "balanced",
  // 默认信任 nomi + claude + codex（不含 cursor，保持历史默认；用户可自行勾选）。
  trustedHosts: ["nomi", "claude", "codex"],
  allowedProviders: [],
  allowedModels: [],
  maxSpend: null,
  maxAttemptsPerJob: 3,
  confirmFirstSpend: true,
  autoContinueWithinBudget: true,
  confirmIrreversible: true,
  systemNotifications: true,
  notificationSound: true,
  notifyOnGate: true,
  notifyOnFailure: true,
  notifyOnCompletion: true,
  minimizeUploads: true,
  anonymousAssetHosting: "ask",
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
  // 泛化：任意形状合法的 MCP host key 都能进（nomi 恒在首位），不再限死内置四值。
  return ["nomi", ...new Set(requested.filter((item) => item !== "nomi" && MCP_HOST_KEY.test(item)))];
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
  const anonymousAssetHosting = raw.anonymousAssetHosting === "allow" || raw.anonymousAssetHosting === "deny"
    ? raw.anonymousAssetHosting
    : DEFAULT_AUTOMATION_POLICY_SETTINGS.anonymousAssetHosting;
  return {
    schemaVersion: 1,
    mode,
    trustedHosts: trustedHosts(raw.trustedHosts),
    allowedProviders: catalogKeys(raw.allowedProviders),
    allowedModels: catalogKeys(raw.allowedModels),
    maxSpend,
    maxAttemptsPerJob: attempts,
    confirmFirstSpend: true,
    autoContinueWithinBudget: boolean(raw.autoContinueWithinBudget, true),
    confirmIrreversible: true,
    systemNotifications: boolean(raw.systemNotifications, true),
    notificationSound: boolean(raw.notificationSound, true),
    notifyOnGate: boolean(raw.notifyOnGate, true),
    notifyOnFailure: boolean(raw.notifyOnFailure, true),
    notifyOnCompletion: boolean(raw.notifyOnCompletion, true),
    minimizeUploads: boolean(raw.minimizeUploads, true),
    anonymousAssetHosting,
  };
}
