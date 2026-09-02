import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_AUTOMATION_POLICY_SETTINGS,
  automationPolicySettingsPath,
  normalizeAutomationPolicySettings,
  readAutomationPolicySettings,
  writeAutomationPolicySettings,
} from "./automationPolicySettings";

let root = "";
const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-automation-settings-"));
  process.env.NOMI_SETTINGS_DIR = root;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (previousSettingsRoot === undefined) delete process.env.NOMI_SETTINGS_DIR;
  else process.env.NOMI_SETTINGS_DIR = previousSettingsRoot;
});

describe("automation policy settings", () => {
  it("uses safe defaults for missing or corrupt JSON", () => {
    expect(readAutomationPolicySettings()).toEqual(DEFAULT_AUTOMATION_POLICY_SETTINGS);
    expect(DEFAULT_AUTOMATION_POLICY_SETTINGS.anonymousAssetHosting).toBe("ask");
    fs.writeFileSync(automationPolicySettingsPath(), "{broken", "utf8");
    expect(readAutomationPolicySettings()).toEqual(DEFAULT_AUTOMATION_POLICY_SETTINGS);
  });

  it("normalizes modes, strips malformed hosts, and preserves mandatory gates", () => {
    // 泛化（方案 A）：合法形状的任意 MCP host key 都保留（内置 + 自定义 profile）；
    // 只有非法形状（含空格/大写/特殊字符）才被剥离。
    expect(normalizeAutomationPolicySettings({
      mode: "anything",
      trustedHosts: ["codex", "Evil Host!", "codex", "cursor"],
      confirmFirstSpend: false,
      confirmIrreversible: false,
      maxAttemptsPerJob: 99,
    })).toMatchObject({
      mode: "balanced",
      trustedHosts: ["nomi", "codex", "cursor"],
      confirmFirstSpend: true,
      confirmIrreversible: true,
      maxAttemptsPerJob: 10,
    });
  });

  it("preserves a valid custom MCP host key in trustedHosts", () => {
    expect(normalizeAutomationPolicySettings({
      trustedHosts: ["nomi", "workbuddy"],
    }).trustedHosts).toEqual(["nomi", "workbuddy"]);
  });

  it("normalizes notification, automation, privacy, and spend values", () => {
    expect(normalizeAutomationPolicySettings({
      systemNotifications: false,
      notificationSound: false,
      autoContinueWithinBudget: false,
      minimizeUploads: false,
      maxSpend: -2,
    })).toMatchObject({
      systemNotifications: false,
      notificationSound: false,
      autoContinueWithinBudget: false,
      minimizeUploads: false,
      maxSpend: null,
    });
  });

  it("keeps anonymous asset hosting available but normalizes its first-use consent state", () => {
    expect(normalizeAutomationPolicySettings({ anonymousAssetHosting: "allow" }).anonymousAssetHosting).toBe("allow");
    expect(normalizeAutomationPolicySettings({ anonymousAssetHosting: "deny" }).anonymousAssetHosting).toBe("deny");
    expect(normalizeAutomationPolicySettings({ anonymousAssetHosting: "anything" }).anonymousAssetHosting).toBe("ask");
  });

  it("persists normalized settings atomically", () => {
    const written = writeAutomationPolicySettings({
      mode: "policy-auto",
      trustedHosts: ["claude"],
      maxSpend: 25,
      maxAttemptsPerJob: 4,
      systemNotifications: true,
      notificationSound: false,
      autoContinueWithinBudget: true,
      minimizeUploads: true,
    });

    expect(readAutomationPolicySettings()).toEqual(written);
    expect(JSON.parse(fs.readFileSync(automationPolicySettingsPath(), "utf8"))).toEqual(written);
    expect(fs.readdirSync(root).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});
