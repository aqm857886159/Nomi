/**
 * A deterministic promotion rejection is a terminal result, not an unknown commit.
 * The durable journal is shared by every connection and replays whatever is still in
 * `catalog_committing` before any later promotion, so a rejection that stays replayable
 * would block every later certification, on any connection.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../scripts/_test-temp.mjs";
import type { CompilerLanguageModel } from "./compiler";

let userDataRoot = "";

vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import { readCatalog } from "../catalog/catalogStore";
import { CURRENT_CATALOG_VERSION, type CatalogState, type Mapping } from "../catalog/types";
import { ProviderAdapterService, type ProviderAdapterServiceDependencies } from "./service";
import { defaultCatalog } from "./serviceCatalog";
import { ProviderAdapterStore } from "./store";
import type { ProviderAdapterDraft } from "./types";

const now = "2026-10-31T00:00:00.000Z";
const RELAY = { vendorKey: "relay", baseUrl: "https://relay.example.test/v1" };
const OTHER = { vendorKey: "other-relay", baseUrl: "https://other.example.test/v1" };
type Connection = typeof RELAY;

function row(modelKey: string, overrides: Partial<Mapping> = {}): Mapping {
  return { id: `${modelKey}-row`, vendorKey: RELAY.vendorKey, modelKey, taskKind: "text_to_image", name: "legacy", enabled: true, create: { method: "POST", path: `/legacy/${modelKey}` }, createdAt: now, updatedAt: now, ...overrides };
}

function seed(mappings: Mapping[]): void {
  const vendor = ({ vendorKey, baseUrl }: Connection) => ({ key: vendorKey, name: vendorKey, enabled: false, baseUrlHint: baseUrl, authType: "bearer" as const, providerKind: "openai-compatible" as const, createdAt: now, updatedAt: now });
  const model = (vendorKey: string, modelKey: string) => ({ vendorKey, modelKey, labelZh: modelKey, kind: "image" as const, enabled: false, meta: { adapter: { state: "unverified", modes: [], updatedAt: now } }, createdAt: now, updatedAt: now });
  const key = (vendorKey: string) => ({ vendorKey, apiKey: Buffer.from("key").toString("base64"), enc: "safeStorage" as const, enabled: true, createdAt: now, updatedAt: now });
  const state: CatalogState = {
    version: CURRENT_CATALOG_VERSION,
    vendors: [vendor(RELAY), vendor(OTHER)],
    models: [model(RELAY.vendorKey, "opaque-a"), model(RELAY.vendorKey, "opaque-b"), model(OTHER.vendorKey, "opaque-c")],
    mappings,
    apiKeysByVendor: { [RELAY.vendorKey]: key(RELAY.vendorKey), [OTHER.vendorKey]: key(OTHER.vendorKey) },
  };
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
}

function draftFor(modelKey: string, connection: Connection = RELAY, body: Record<string, unknown> = { prompt: "{{request.prompt}}" }): ProviderAdapterDraft {
  return {
    provider: { baseUrl: connection.baseUrl, authType: "bearer", providerKind: "openai-compatible" },
    sources: [{ url: `${new URL(connection.baseUrl).origin}/docs`, evidence: "API reference" }],
    models: [{ modelKey, labelZh: modelKey, kind: "image", modes: [{ taskKind: "text_to_image", create: { method: "POST", path: `/verified/${modelKey}`, body }, sourceUrls: [`${new URL(connection.baseUrl).origin}/docs`] }] }],
  };
}

function service(runId: string, draft: ProviderAdapterDraft, overrides: Partial<ProviderAdapterServiceDependencies> = {}) {
  return new ProviderAdapterService(new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")), {
    catalog: defaultCatalog,
    schedule: () => {},
    discover: async () => ({ sources: [{ url: `${new URL(draft.provider.baseUrl).origin}/docs`, text: "API reference" }], corpus: "API reference" }),
    resolveLanguageModels: () => [{} as CompilerLanguageModel],
    compile: async () => ({ draft, failures: [] }),
    verify: async ({ mode }) => ({ ok: true, taskKind: mode.taskKind }),
    now: () => now,
    id: () => runId,
    ...overrides,
  });
}

const startInput = (runId: string, modelKey: string, connection: Connection) => ({
  catalogVendorKey: connection.vendorKey, vendorName: connection.vendorKey, baseUrl: connection.baseUrl, apiKey: "key", authType: "bearer" as const, providerKind: "openai-compatible" as const,
  models: [{ modelKey, labelZh: modelKey, kind: "image" as const }],
  certification: { contractDigest: "a".repeat(64), idempotencyKey: `idempotency-${runId}`, remoteIdempotency: "unknown" as const },
});

async function certify(runId: string, modelKey: string, connection: Connection = RELAY, draft: ProviderAdapterDraft = draftFor(modelKey, connection)) {
  const adapter = service(runId, draft);
  const started = await adapter.start(startInput(runId, modelKey, connection));
  await adapter.executeRun(started.id);
  await adapter.awaitTerminalWrites();
  return adapter.getRun(started.id);
}

beforeEach(() => { userDataRoot = makeTempDir("promotion-rejection-"); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(userDataRoot, { recursive: true, force: true }); });

describe("certification promotion rejection", () => {
  it.each([["this connection", "opaque-b", RELAY], ["another connection", "opaque-c", OTHER]] as const)("fails the rejected run with its reason and does not block a later certification on %s", async (_where, modelKey, connection) => {
    const protectedRow = row("opaque-a", { modeId: "user-mode" });
    seed([protectedRow]);
    const rejected = await certify("run-rejected", "opaque-a");
    expect(rejected?.stage).toBe("failed");
    expect(rejected?.error).toMatch(/mappings\.text_to_image/);
    expect(readCatalog().mappings.find((m) => m.id === protectedRow.id)?.create).toEqual(protectedRow.create);

    const later = await certify("run-later", modelKey, connection);
    expect(later?.stage, JSON.stringify(later)).toBe("completed");
    const state = readCatalog();
    expect(state.mappings.find((m) => m.modelKey === modelKey && m.enabled)?.create.path).toBe(`/verified/${modelKey}`);
    expect(state.mappings.find((m) => m.id === protectedRow.id)?.create).toEqual(protectedRow.create);
  });

  it("a draft the compiler refuses at promotion is the same terminal result, not a stuck journal", async () => {
    seed([]);
    const rejected = await certify("run-uncompilable", "opaque-a", RELAY, draftFor("opaque-a", RELAY, { prompt: "{{request.prompt}}", image: "{{request.params.image_url}}" }));
    expect(rejected?.stage).toBe("failed");
    expect(rejected?.error).toMatch(/undeclared reference roles/);

    const later = await certify("run-later", "opaque-c", OTHER);
    expect(later?.stage, JSON.stringify(later)).toBe("completed");
  });

  it("a process that dies before the terminal write does not poison the journal after restart", async () => {
    const protectedRow = row("opaque-a", { modeId: "user-mode" });
    seed([protectedRow]);
    // The terminal write never lands: this is what a crash right after the refusal leaves on disk.
    const rejecting = service("run-crashed", draftFor("opaque-a"), {
      catalog: { ...defaultCatalog, fail: () => { throw new Error("simulated crash before the terminal write"); } },
    });
    const started = await rejecting.start(startInput("run-crashed", "opaque-a", RELAY));
    await rejecting.executeRun(started.id);
    rejecting.stopWatchdog();

    const restarted = service("run-restart", draftFor("opaque-c", OTHER));
    restarted.resumeInterrupted();
    restarted.stopWatchdog();
    const later = await certify("run-later", "opaque-c", OTHER);
    expect(later?.stage, JSON.stringify(later)).toBe("completed");
    expect(readCatalog().mappings.find((m) => m.id === protectedRow.id)?.create).toEqual(protectedRow.create);
  });
});
