// 泛化（方案 A）：trustedHosts 不再限定为硬编码四值，任意形状合法的 MCP 客户端 key
// （内置 + 自定义 profile）都可由用户显式勾选加入信任列表。
const MCP_HOST_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * 2026-09-14 设置页删冗余（审计 §⑥ 1/2/5/7）：
 * - `mode`（引导/平衡/策略自动）删——档位唯一 owner 是 Agent 面板的 PermissionTier；
 * - `allowedProviders` / `allowedModels` 删——不再有全局白名单，默认放行全部已接入供应商/模型，
 *   每次提交在付费确认卡上定这次用哪家/哪个模型（run 级 policy 仍按草稿/计划圈定范围）；
 * - `confirmFirstSpend` / `autoContinueWithinBudget` / `confirmIrreversible` 与三个 notifyOn* 删——零读者。
 * 旧持久化文件里的这些键在归一化时直接丢弃（不保留兼容分支）。
 */
export type AutomationPolicySettings = {
  schemaVersion: 1;
  trustedHosts: string[];
  maxAttemptsPerJob: number;
  systemNotifications: boolean;
  minimizeUploads: boolean;
  /** Anonymous temporary hosting is available by default, but UI asks before first use. */
  anonymousAssetHosting: "ask" | "allow" | "deny";
};

export const DEFAULT_AUTOMATION_POLICY_SETTINGS: AutomationPolicySettings = {
  schemaVersion: 1,
  trustedHosts: ["nomi", "claude", "codex"],
  maxAttemptsPerJob: 3,
  systemNotifications: true,
  minimizeUploads: true,
  anonymousAssetHosting: "ask",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function trustedHosts(value: unknown): string[] {
  const requested = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : DEFAULT_AUTOMATION_POLICY_SETTINGS.trustedHosts;
  return ["nomi", ...new Set(requested.filter((item) => item !== "nomi" && MCP_HOST_KEY.test(item)))];
}

export function normalizeAutomationPolicySettings(value: unknown): AutomationPolicySettings {
  const raw = record(value);
  const attempts = typeof raw.maxAttemptsPerJob === "number" && Number.isFinite(raw.maxAttemptsPerJob)
    ? Math.min(10, Math.max(1, Math.floor(raw.maxAttemptsPerJob)))
    : DEFAULT_AUTOMATION_POLICY_SETTINGS.maxAttemptsPerJob;
  const anonymousAssetHosting = raw.anonymousAssetHosting === "allow" || raw.anonymousAssetHosting === "deny"
    ? raw.anonymousAssetHosting
    : DEFAULT_AUTOMATION_POLICY_SETTINGS.anonymousAssetHosting;
  return {
    schemaVersion: 1,
    trustedHosts: trustedHosts(raw.trustedHosts),
    maxAttemptsPerJob: attempts,
    systemNotifications: boolean(raw.systemNotifications, true),
    minimizeUploads: boolean(raw.minimizeUploads, true),
    anonymousAssetHosting,
  };
}
