import path from "node:path";

import { readConfigFileOrDefault, writeConfigFileAtomic } from "../configFileStore";
import {
  DEFAULT_AUTOMATION_POLICY_SETTINGS,
  normalizeAutomationPolicySettings,
  type AutomationPolicySettings,
} from "../shared/contracts/automationPolicyContract";
import { getSettingsRoot } from "./settingsRoot";

const AUTOMATION_POLICY_FILE = "automation-policy.json";

export {
  DEFAULT_AUTOMATION_POLICY_SETTINGS,
  normalizeAutomationPolicySettings,
  type AutomationPolicySettings,
} from "../shared/contracts/automationPolicyContract";

export function automationPolicySettingsPath(): string {
  return path.join(getSettingsRoot(), AUTOMATION_POLICY_FILE);
}

export function readAutomationPolicySettings(): AutomationPolicySettings {
  return normalizeAutomationPolicySettings(
    readConfigFileOrDefault<unknown>(automationPolicySettingsPath(), () => DEFAULT_AUTOMATION_POLICY_SETTINGS),
  );
}

export function writeAutomationPolicySettings(value: unknown): AutomationPolicySettings {
  const next = normalizeAutomationPolicySettings(value);
  writeConfigFileAtomic(automationPolicySettingsPath(), next);
  return next;
}
