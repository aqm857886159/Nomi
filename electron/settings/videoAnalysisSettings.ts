import path from "node:path";

import {
  decryptApiKeyRecord,
  isSafeStorageAvailable,
  makeApiKeyRecordFromPlain,
  type ApiKeyRecord,
} from "../catalog/secrets";
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
import { normalizeLoopbackEngineUrl } from "../videoAnalysis/engineUrl";
import { getSettingsRoot } from "./settingsRoot";

const VIDEO_ANALYSIS_SETTINGS_FILE = "video-analysis.json";

export type VideoAnalysisSourceRetention = "delete_after_analysis" | "keep";

export type VideoAnalysisSettings = {
  schemaVersion: 1;
  engineOrigin: string;
  hasApiToken: boolean;
  externalInference: boolean;
  engineSourceRetention: VideoAnalysisSourceRetention;
};

export type VideoAnalysisEngineConfig = Omit<VideoAnalysisSettings, "schemaVersion" | "hasApiToken"> & {
  token: string;
};

type PersistedVideoAnalysisSettings = {
  schemaVersion: 1;
  engineOrigin: string;
  externalInference: boolean;
  engineSourceRetention: VideoAnalysisSourceRetention;
  apiToken: ApiKeyRecord | null;
};

export const DEFAULT_VIDEO_ANALYSIS_SETTINGS: VideoAnalysisSettings = {
  schemaVersion: 1,
  engineOrigin: "http://127.0.0.1:8931",
  hasApiToken: false,
  externalInference: false,
  engineSourceRetention: "delete_after_analysis",
};

export function videoAnalysisSettingsPath(): string {
  return path.join(getSettingsRoot(), VIDEO_ANALYSIS_SETTINGS_FILE);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function retention(value: unknown): VideoAnalysisSourceRetention {
  return value === "keep" ? "keep" : "delete_after_analysis";
}

function decryptVideoAnalysisToken(value: ApiKeyRecord | null): string {
  return value?.enc === "safeStorage" ? decryptApiKeyRecord(value) : "";
}

function readPersisted(): PersistedVideoAnalysisSettings {
  try {
    const raw = record(readJsonFile(videoAnalysisSettingsPath()));
    const apiToken = raw.apiToken && typeof raw.apiToken === "object" && !Array.isArray(raw.apiToken)
      ? raw.apiToken as ApiKeyRecord
      : null;
    return {
      schemaVersion: 1,
      engineOrigin: normalizeLoopbackEngineUrl(raw.engineOrigin ?? DEFAULT_VIDEO_ANALYSIS_SETTINGS.engineOrigin),
      externalInference: raw.externalInference === true,
      engineSourceRetention: retention(raw.engineSourceRetention),
      apiToken,
    };
  } catch {
    return {
      schemaVersion: 1,
      engineOrigin: DEFAULT_VIDEO_ANALYSIS_SETTINGS.engineOrigin,
      externalInference: false,
      engineSourceRetention: "delete_after_analysis",
      apiToken: null,
    };
  }
}

function publicSettings(value: PersistedVideoAnalysisSettings): VideoAnalysisSettings {
  return {
    schemaVersion: 1,
    engineOrigin: value.engineOrigin,
    hasApiToken: Boolean(decryptVideoAnalysisToken(value.apiToken)),
    externalInference: value.externalInference,
    engineSourceRetention: value.engineSourceRetention,
  };
}

export function readVideoAnalysisSettings(): VideoAnalysisSettings {
  return publicSettings(readPersisted());
}

export function readVideoAnalysisEngineConfig(): VideoAnalysisEngineConfig {
  const stored = readPersisted();
  return {
    engineOrigin: stored.engineOrigin,
    token: decryptVideoAnalysisToken(stored.apiToken),
    externalInference: stored.externalInference,
    engineSourceRetention: stored.engineSourceRetention,
  };
}

export function writeVideoAnalysisSettings(value: unknown): VideoAnalysisSettings {
  const input = record(value);
  const current = readPersisted();
  const engineOrigin = input.engineOrigin === undefined
    ? current.engineOrigin
    : normalizeLoopbackEngineUrl(input.engineOrigin);
  let apiToken = current.apiToken;
  if (input.clearApiToken === true) apiToken = null;
  if (typeof input.apiToken === "string" && input.apiToken.trim()) {
    const token = input.apiToken.trim();
    if (token.length > 512 || /[\r\n]/.test(token)) throw new Error("Invalid e-cut API token");
    if (!isSafeStorageAvailable()) {
      throw new Error("Secure OS credential storage is unavailable; the e-cut token was not saved");
    }
    const timestamp = new Date().toISOString();
    apiToken = makeApiKeyRecordFromPlain(token, "video-analysis-e-cut", true, timestamp, timestamp);
  }
  const next: PersistedVideoAnalysisSettings = {
    schemaVersion: 1,
    engineOrigin,
    externalInference: typeof input.externalInference === "boolean" ? input.externalInference : current.externalInference,
    engineSourceRetention: input.engineSourceRetention === undefined
      ? current.engineSourceRetention
      : retention(input.engineSourceRetention),
    apiToken,
  };
  writeJsonFileAtomic(videoAnalysisSettingsPath(), next);
  return publicSettings(next);
}
