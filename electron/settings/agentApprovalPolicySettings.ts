import path from "node:path";

import { readConfigFileOrDefault, writeConfigFileAtomic } from "../configFileStore";
import { getSettingsRoot } from "./settingsRoot";
import {
  DEFAULT_AGENT_APPROVAL_POLICY_SETTINGS,
  normalizeAgentApprovalPolicySettings,
} from "./agentApprovalPolicyContract";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";

export {
  DEFAULT_AGENT_APPROVAL_POLICY_SETTINGS,
  normalizeAgentApprovalPolicySettings,
  type AgentApprovalPolicySettings,
} from "./agentApprovalPolicyContract";

const AGENT_APPROVAL_POLICY_FILE = "agent-approval-policy.json";

export function agentApprovalPolicySettingsPath(): string {
  return path.join(getSettingsRoot(), AGENT_APPROVAL_POLICY_FILE);
}

/**
 * 主进程侧「用户现在选的权限档」的**唯一**读口。**没有这份文件** = 默认档（更常问的那一档）。
 *
 * 2026-09-21 合并 ①：本函数原先是 `try { readJsonFile } catch { DEFAULT }`——正是批次 E
 * 在全仓删掉的那种写法。它把「文件不存在」和「文件读不出来（被锁 / 语法坏了）」答成同一句话，
 * 于是读不出来时**悄悄按默认档跑**：用户选的是「每步都问」，这一次却按「全自动」放行。
 * 权限档在花钱轴上，这条路上的默认绝不能靠一个 catch 决定。改走 `configFileStore` 那份原语：
 * 缺文件给默认，读得出来但坏了的会被改名留底（原字节不动）并拦下写回，不会被一次默认覆盖掉。
 */
export function readAgentApprovalPolicy(): ProjectAgentApprovalPolicy {
  return normalizeAgentApprovalPolicySettings(
    readConfigFileOrDefault<unknown>(
      agentApprovalPolicySettingsPath(),
      () => DEFAULT_AGENT_APPROVAL_POLICY_SETTINGS,
    ),
  ).policy;
}

/**
 * 写口同样只有一个：用户在 Agent 面板切档 → 渲染层沿**已有的** lane composer IPC 把新档位推进
 * 主进程（`laneDesktopRuntime.updatePolicy` / `configure`）→ 那里落盘。不新增设置界面、不新增 IPC。
 */
export function writeAgentApprovalPolicy(value: unknown): ProjectAgentApprovalPolicy {
  const next = normalizeAgentApprovalPolicySettings(value);
  // 档位未变时不触发 .bak.json 轮转与 fsyncSync 同步写盘；
  // 先经唯一读口读当前生效值（缺文件 = 默认档，坏文件自动隔离并在写口拒写）。
  if (readAgentApprovalPolicy().mode === next.policy.mode) {
    return next.policy;
  }
  writeConfigFileAtomic(agentApprovalPolicySettingsPath(), next);
  return next.policy;
}
