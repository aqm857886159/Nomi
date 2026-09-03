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
    // 泛化后：任意格式合法的 key（小写字母/数字/横杠）都通过，不限定白名单四值。
    // "Evil Host!"（含非法字符）被过滤；格式合法的 key（含自定义 profile key）通过。
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

  it("accepts arbitrary valid-format custom client keys in trustedHosts", () => {
    // 方案 A：自定义客户端 key（合法格式）可以出现在 trustedHosts 里，不被白名单过滤。
    const result = normalizeAutomationPolicySettings({
      trustedHosts: ["claude", "workbuddy", "my-tool-42"],
    });
    expect(result.trustedHosts).toEqual(["nomi", "claude", "workbuddy", "my-tool-42"]);
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
