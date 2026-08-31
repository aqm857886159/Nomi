import path from "node:path";
import { safeStorage } from "electron";

import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
import { setAssetRelayRuntimeConfig } from "../catalog/assetRelayRuntimeConfig";
import { getSettingsRoot } from "./settingsRoot";

const SETTINGS_FILE = "asset-relay.json";

type EncryptedToken = { value: string; enc: "safeStorage" };
type StoredSettings = { schemaVersion: 1; enabled: boolean; endpoint: string; token?: EncryptedToken };

export type AssetRelaySettingsView = {
  enabled: boolean;
  endpoint: string;
  hasToken: boolean;
};

export type AssetRelaySettingsInput = {
  enabled?: unknown;
  endpoint?: unknown;
  token?: unknown;
  clearToken?: unknown;
};

function settingsPath(): string {
  return path.join(getSettingsRoot(), SETTINGS_FILE);
}

function normalizedEndpoint(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.hostname === "127.0.0.1" || url.hostname === "localhost")) return "";
    return raw.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function decryptToken(record: EncryptedToken | undefined): string {
  if (!record?.value || record.enc !== "safeStorage") return "";
  try {
    return safeStorage.decryptString(Buffer.from(record.value, "base64"));
  } catch {
    return "";
  }
}

function readStored(): StoredSettings {
  try {
    const raw = readJsonFile(settingsPath()) as Partial<StoredSettings>;
    return {
      schemaVersion: 1,
      enabled: raw.enabled === true,
      endpoint: normalizedEndpoint(raw.endpoint),
      token: raw.token?.enc === "safeStorage" && typeof raw.token.value === "string" ? raw.token : undefined,
    };
  } catch {
    return { schemaVersion: 1, enabled: false, endpoint: "" };
  }
}

function applyRuntime(stored: StoredSettings): void {
  setAssetRelayRuntimeConfig(stored.enabled ? stored.endpoint : "", stored.enabled ? decryptToken(stored.token) : "");
}

export function hydrateAssetRelayRuntime(): void {
  applyRuntime(readStored());
}

export function readAssetRelaySettings(): AssetRelaySettingsView {
  const stored = readStored();
  return { enabled: stored.enabled, endpoint: stored.endpoint, hasToken: Boolean(decryptToken(stored.token)) };
}

export function writeAssetRelaySettings(input: AssetRelaySettingsInput): AssetRelaySettingsView {
  const current = readStored();
  const rawEndpoint = String(input.endpoint || "").trim();
  const endpoint = normalizedEndpoint(input.endpoint);
  if (rawEndpoint && !endpoint) {
    throw new Error("Relay 地址必须使用 HTTPS（本机地址可用 localhost/127.0.0.1）。");
  }
  const enabled = input.enabled === true && Boolean(endpoint);
  const requestedToken = typeof input.token === "string" ? input.token.trim() : undefined;
  let token = current.token;
  if (input.clearToken === true) token = undefined;
  if (requestedToken) {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("unavailable");
      token = { value: safeStorage.encryptString(requestedToken).toString("base64"), enc: "safeStorage" };
    } catch {
      throw new Error("系统安全存储不可用，无法保存 Relay Token。");
    }
  }
  const next: StoredSettings = { schemaVersion: 1, enabled, endpoint, ...(token ? { token } : {}) };
  writeJsonFileAtomic(settingsPath(), next);
  applyRuntime(next);
  return { enabled: next.enabled, endpoint: next.endpoint, hasToken: Boolean(decryptToken(next.token)) };
}
