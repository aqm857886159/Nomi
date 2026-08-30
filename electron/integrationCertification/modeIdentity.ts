import crypto from "node:crypto";
import type { ProfileKind } from "../catalog/types";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function tuple(modelKey: string, taskKind: ProfileKind): string {
  return JSON.stringify({ version: 1, modelKey, taskKind });
}

export function certificationModeIdentity(modelKey: string, taskKind: ProfileKind): string {
  return sha256(`mode:${tuple(modelKey, taskKind)}`);
}

export function certificationModeOperationKey(modelKey: string, taskKind: ProfileKind, attempt: number): string {
  return sha256(`operation:${tuple(modelKey, taskKind)}:${attempt}`);
}

export function isCertificationOperationKey(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
