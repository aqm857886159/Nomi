import type { CertificationModeIndex, CertificationModeOperation } from "./types";
import { CertificationPersistenceError } from "./certificationPersistence";
import { certificationModeIdentity, certificationModeOperationKey } from "./modeIdentity";

export function migrateV2Operation(
  raw: unknown,
  isRecord: (value: unknown) => value is Record<string, unknown>,
  validateLegacyMode: (value: unknown) => CertificationModeOperation,
): unknown {
  if (!isRecord(raw) || !isRecord(raw.modeOperations)) {
    throw new CertificationPersistenceError("invalid_state", "Invalid legacy certification operation");
  }
  const legacyModes = Object.values(raw.modeOperations).map(validateLegacyMode);
  const latest = new Map<string, CertificationModeOperation>();
  for (const mode of legacyModes) {
    const identity = certificationModeIdentity(mode.modelKey, mode.taskKind);
    const prior = latest.get(identity);
    if (prior && prior.attempt === mode.attempt && prior.operationKey !== mode.operationKey) {
      throw new CertificationPersistenceError("invalid_state", "Legacy mode has duplicate latest attempts");
    }
    if (!prior || mode.attempt > prior.attempt) latest.set(identity, mode);
  }
  const modeOperations: Record<string, CertificationModeOperation> = {};
  const modeOperationKeys: Record<string, CertificationModeIndex> = {};
  const legacyToCurrent = new Map<string, string>();
  for (const [identity, mode] of latest) {
    const operationKey = certificationModeOperationKey(mode.modelKey, mode.taskKind, mode.attempt);
    modeOperations[operationKey] = { ...mode, operationKey };
    modeOperationKeys[identity] = { version: 1, modelKey: mode.modelKey, taskKind: mode.taskKind, latestAttempt: mode.attempt, operationKey };
    for (const legacy of legacyModes) {
      if (legacy.modelKey === mode.modelKey && legacy.taskKind === mode.taskKind) legacyToCurrent.set(legacy.operationKey, operationKey);
    }
  }
  const operationKey = typeof raw.operationKey === "string" ? legacyToCurrent.get(raw.operationKey) : undefined;
  return { ...raw, version: 3, modeOperations, modeOperationKeys, operationKey };
}
