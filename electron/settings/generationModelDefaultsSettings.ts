import path from "node:path";

import { readConfigFileOrDefault, writeConfigFileAtomic } from "../configFileStore";
import {
  DEFAULT_GENERATION_MODEL_DEFAULTS,
  normalizeGenerationModelDefaults,
  type GenerationModelDefaults,
} from "../shared/contracts/generationModelDefaultsContract";
import { getSettingsRoot } from "./settingsRoot";

const GENERATION_MODEL_DEFAULTS_FILE = "generation-model-defaults.json";

export {
  DEFAULT_GENERATION_MODEL_DEFAULTS,
  GENERATION_DEFAULT_TASK_KINDS,
  normalizeGenerationModelDefaults,
  type GenerationDefaultTaskKind,
  type GenerationModelDefault,
  type GenerationModelDefaults,
} from "../shared/contracts/generationModelDefaultsContract";

export function generationModelDefaultsSettingsPath(): string {
  return path.join(getSettingsRoot(), GENERATION_MODEL_DEFAULTS_FILE);
}

export function readGenerationModelDefaults(): GenerationModelDefaults {
  return normalizeGenerationModelDefaults(
    readConfigFileOrDefault<unknown>(generationModelDefaultsSettingsPath(), () => DEFAULT_GENERATION_MODEL_DEFAULTS),
  );
}

export function writeGenerationModelDefaults(value: unknown): GenerationModelDefaults {
  const next = normalizeGenerationModelDefaults(value);
  writeConfigFileAtomic(generationModelDefaultsSettingsPath(), next);
  return next;
}
