import path from "node:path";

import { readConfigFileOrDefault, writeConfigFileAtomic } from "../configFileStore";
import {
  DEFAULT_SYSTEM_PROMPT_OVERRIDES,
  normalizeSystemPromptOverrides,
  type SystemPromptOverrides,
} from "../shared/contracts/systemPromptsContract";
import { getSettingsRoot } from "./settingsRoot";

const SYSTEM_PROMPTS_FILE = "system-prompts.json";

export {
  DEFAULT_SYSTEM_PROMPT_OVERRIDES,
  normalizeSystemPromptOverrides,
  SYSTEM_PROMPT_MAX_LENGTH,
  SYSTEM_PROMPT_MODE_IDS,
  type SystemPromptModeId,
  type SystemPromptOverrides,
} from "../shared/contracts/systemPromptsContract";

export function systemPromptsSettingsPath(): string {
  return path.join(getSettingsRoot(), SYSTEM_PROMPTS_FILE);
}

export function readSystemPromptOverrides(): SystemPromptOverrides {
  return normalizeSystemPromptOverrides(
    readConfigFileOrDefault<unknown>(systemPromptsSettingsPath(), () => DEFAULT_SYSTEM_PROMPT_OVERRIDES),
  );
}

export function writeSystemPromptOverrides(value: unknown): SystemPromptOverrides {
  const next = normalizeSystemPromptOverrides(value);
  writeConfigFileAtomic(systemPromptsSettingsPath(), next);
  return next;
}
