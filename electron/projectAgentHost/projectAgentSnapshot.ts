export class ProjectAgentSnapshotError extends Error {
  constructor() {
    super("invalid_json_snapshot");
    this.name = "ProjectAgentSnapshotError";
  }
}

function assertPlainJson(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ProjectAgentSnapshotError();
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new ProjectAgentSnapshotError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new ProjectAgentSnapshotError();
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((child) => assertPlainJson(child, ancestors));
  } else {
    Object.values(value as Record<string, unknown>).forEach((child) => assertPlainJson(child, ancestors));
  }
  ancestors.delete(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  return Object.freeze(value);
}

/** Freeze one newly-created reducer record without cloning or rewalking an existing frozen subtree. */
export function freezeProjectAgentIncremental<T>(value: T): T {
  return deepFreeze(value);
}

export function stableProjectAgentJson(value: unknown): string {
  assertPlainJson(value, new Set());
  return canonicalJson(value);
}

export function freezeProjectAgentSnapshot<T>(value: T): T {
  return deepFreeze(JSON.parse(stableProjectAgentJson(value)) as T);
}
