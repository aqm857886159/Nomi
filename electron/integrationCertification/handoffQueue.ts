import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { ipcMain } from "electron";
import { capabilityCoreDir, type CapabilityOriginHost } from "../capabilityCore/security";
import { assertTrustedSender } from "../ipcSenderGuard";
import { writeCertificationJsonAtomic } from "./certificationPersistence";

export type IntegrationHandoffTarget = "credential" | "connection" | "workflow" | "verification";

export type IntegrationHandoff = {
  requestId: string;
  target: IntegrationHandoffTarget;
  sessionId: string;
  revision: number;
  ownerClientId: CapabilityOriginHost;
  createdAt: string;
  /** Safe display metadata only. Never include a key, workflow, path, URL query, or error body. */
  display?: { name?: string; origin?: string; authType?: string; runId?: string; challengeId?: string };
};

type PersistedHandoffState = { version: 1; entries: IntegrationHandoff[] };

const MAX_ENTRIES = 100;
const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const TARGETS = new Set<IntegrationHandoffTarget>(["credential", "connection", "workflow", "verification"]);
const subscribers = new Set<{
  send: (channel: string, payload: unknown) => void;
  once?: (event: string, listener: () => void) => void;
}>();

function normalizeDisplayOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
    throw new Error("Invalid handoff origin");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Invalid handoff origin");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error("Invalid handoff origin");
  }
  const host = parsed.hostname.toLowerCase();
  const ip = net.isIP(host);
  // A handoff is only a display/navigation hint. Private targets require an
  // explicit trusted-origin grant and must never be smuggled through this queue.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    (ip === 4 &&
      (host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        host.startsWith("127.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host))) ||
    (ip === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")))
  ) {
    throw new Error("Private handoff origin requires authorization");
  }
  return parsed.origin;
}

function filePath(): string {
  return path.join(capabilityCoreDir(), "integration-handoff.json");
}

function safeId(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!ID.test(normalized)) throw new Error(`Invalid handoff ${field}`);
  return normalized;
}

function readState(): PersistedHandoffState {
  const target = filePath();
  if (!fs.existsSync(target)) return { version: 1, entries: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(target, "utf8")) as PersistedHandoffState;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES)
      throw new Error("Invalid handoff queue");
    return { version: 1, entries: raw.entries.map(validateEntry) };
  } catch {
    throw new Error("Integration handoff queue is corrupt");
  }
}

function validateEntry(raw: unknown): IntegrationHandoff {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid handoff entry");
  const item = raw as Record<string, unknown>;
  const target = item.target;
  if (typeof target !== "string" || !TARGETS.has(target as IntegrationHandoffTarget))
    throw new Error("Invalid handoff target");
  if (!Number.isSafeInteger(item.revision) || Number(item.revision) < 1) throw new Error("Invalid handoff revision");
  if (typeof item.ownerClientId !== "string") throw new Error("Invalid handoff owner");
  const owner = item.ownerClientId as CapabilityOriginHost;
  if (!["external", "nomi", "claude", "codex", "cursor"].includes(owner)) throw new Error("Invalid handoff owner");
  const createdAt = typeof item.createdAt === "string" && item.createdAt.length <= 80 ? item.createdAt : "";
  if (!createdAt) throw new Error("Invalid handoff timestamp");
  const display =
    item.display && typeof item.display === "object" && !Array.isArray(item.display)
      ? (() => {
          const rawDisplay = item.display as Record<string, unknown>;
          const safe: NonNullable<IntegrationHandoff["display"]> = {};
          for (const key of ["name", "authType", "runId", "challengeId"] as const) {
            const value = rawDisplay[key];
            if (value !== undefined) {
              if (typeof value !== "string" || value.length > 512) throw new Error("Invalid handoff display");
              safe[key] = value;
            }
          }
          if (rawDisplay.origin !== undefined) safe.origin = normalizeDisplayOrigin(rawDisplay.origin);
          return safe;
        })()
      : undefined;
  return {
    requestId: safeId(item.requestId, "requestId"),
    sessionId: safeId(item.sessionId, "sessionId"),
    revision: Number(item.revision),
    target: target as IntegrationHandoffTarget,
    ownerClientId: owner,
    createdAt,
    ...(display && Object.keys(display).length ? { display } : {}),
  };
}

function persist(state: PersistedHandoffState): void {
  writeCertificationJsonAtomic(filePath(), state);
}

export function listIntegrationHandoffs(): IntegrationHandoff[] {
  return structuredClone(readState().entries);
}

export function enqueueIntegrationHandoff(
  input: Omit<IntegrationHandoff, "requestId" | "createdAt"> & { requestId?: string; createdAt?: string },
): IntegrationHandoff {
  const entry = validateEntry({
    ...input,
    requestId: input.requestId || `handoff-${crypto.randomUUID()}`,
    createdAt: input.createdAt || new Date().toISOString(),
  });
  const state = readState();
  const existing = state.entries.find((item) => item.requestId === entry.requestId);
  if (existing) return structuredClone(existing);
  state.entries.push(entry);
  if (state.entries.length > MAX_ENTRIES) state.entries.splice(0, state.entries.length - MAX_ENTRIES);
  persist(state);
  for (const sender of subscribers) {
    try {
      sender.send("nomi:integration-handoff:changed", entry);
    } catch {
      subscribers.delete(sender);
    }
  }
  return structuredClone(entry);
}

/**
 * Drop every queued handoff of one target for a session whose reason to exist is gone.
 *
 * A credential handoff is a durable "someone still has to type a key". Only the GUI wizard
 * used to retire it, by acking after its own save — so a key that arrived through the other
 * route (the MCP loopback page in the user's AI client) left the request queued forever, and
 * the model settings drawer kept yanking the user back to a half-filled "add a model" page for
 * a provider that is already connected. The session service is the earliest layer that knows
 * the credential landed, whichever route wrote it, so the retirement belongs next to that
 * write rather than in each consumer (R28).
 */
export function retireIntegrationHandoffs(sessionId: unknown, target: IntegrationHandoffTarget): number {
  const id = safeId(sessionId, "sessionId");
  const state = readState();
  const next = state.entries.filter((entry) => !(entry.sessionId === id && entry.target === target));
  const removed = state.entries.length - next.length;
  if (removed > 0) persist({ version: 1, entries: next });
  return removed;
}

export function acknowledgeIntegrationHandoff(requestId: unknown): boolean {
  const id = safeId(requestId, "requestId");
  const state = readState();
  const next = state.entries.filter((entry) => entry.requestId !== id);
  if (next.length === state.entries.length) return false;
  persist({ version: 1, entries: next });
  return true;
}

export function registerIntegrationHandoffIpc(): void {
  ipcMain.handle("nomi:integration-handoff:list", (event) => {
    assertTrustedSender(event);
    return listIntegrationHandoffs();
  });
  ipcMain.handle("nomi:integration-handoff:ack", (event, requestId: unknown) => {
    assertTrustedSender(event);
    return { ok: acknowledgeIntegrationHandoff(requestId) };
  });
  ipcMain.on("nomi:integration-handoff:subscribe", (event) => {
    assertTrustedSender(event);
    const sender = event.sender as unknown as {
      send: (channel: string, payload: unknown) => void;
      once?: (event: string, listener: () => void) => void;
    };
    subscribers.add(sender);
    sender.once?.("destroyed", () => subscribers.delete(sender));
  });
}
