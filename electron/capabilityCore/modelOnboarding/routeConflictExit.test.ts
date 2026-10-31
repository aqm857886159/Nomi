/**
 * Old routes must not be a dead end. A person who connected a relay on an older version holds routes Nomi guessed,
 * with no ownership record. Their Agent reads the docs and submits a correct card with a different wire. Refusing
 * that is right; telling it to "fix the field" is not, because no edit to the card can ever pass.
 *
 * Every exit is walked here through the real tool surface (schema validation + dispatch), so an exit that does not
 * work turns this file red rather than the person's afternoon.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_TOOL_RESOLVER } from "../mcpToolCatalog";
import { validateToolArguments } from "../mcpProtocol";
import { dispatch } from "../dispatcher";
import { mutateCatalog, readCatalog } from "../../catalog/catalogStore";
import { NEWAPI_VIDEO_CREATE_OP, NEWAPI_VIDEO_QUERY_OP } from "../../catalog/newapiTransport";
import { deriveModelAvailability } from "../../shared/modelAvailability";
import { parseCustomCapabilityContract, type CustomCapabilityContractV1 } from "../../shared/customCapabilityContract";
import { relayDeclaration } from "../../../tests/ux/_relayVideoFixture.mjs";
import type { OnboardingExit } from "./envelope";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
    },
  };
});

type Json = Record<string, unknown>;
type Exit = OnboardingExit;
type ExitStep = Exit["steps"][number];
/** A tool reply read field by field: the assertions name what they need, and an absent field fails them. */
type Reply = { ok: boolean; code: string; vendorKey: string; fingerprint: string; consequence: string; nextAction: string; conflicts: Array<{ modelKey: string }>; exits: Exit[]; state: { hasApiKey: boolean } };

const MODEL = "opaque-gamma";
const SIBLING = "sibling-video";
const VENDOR = "legacy-relay";
const OTHER = "other-relay";
let server: http.Server;
let origin = "";
let root = "";

beforeAll(async () => {
  server = http.createServer((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [] })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-route-conflict-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", root);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function mcp(name: string, args: Json): Promise<Reply> {
  const tool = MCP_TOOL_RESOLVER.resolve(name)!;
  expect(tool, `${name} is not on the tool surface`).toBeDefined();
  const invalid = validateToolArguments(tool.name, tool.inputSchema, args);
  if (invalid) throw invalid;
  const method = typeof (tool as { resolveMethod?: unknown }).resolveMethod === "function"
    ? (tool as { resolveMethod: (a: Json) => string }).resolveMethod(args)
    : tool.method;
  return await dispatch(method, tool.build(args) as never, { origin: { host: "codex" } } as never) as Reply;
}

const correctCard = (modelKeys: string[] = [MODEL]) => {
  const card = relayDeclaration(origin) as Json & { models: Json[] };
  card.models = modelKeys.map((modelKey) => ({ ...structuredClone(card.models[0]), modelKey, labelZh: modelKey }));
  return card;
};
const submit = (card: Json, extra: Json = { vendorKey: VENDOR }) => mcp("nomi_model_setup", { action: "submit_declaration", ...extra, declaration: JSON.stringify(card) });

/** A connection with a saved key, a sibling model and a same-name model on another connection. */
function seedConnection(input: { meta?: Json; rows?: Json[] } = {}) {
  mutateCatalog((tx) => {
    for (const vendorKey of [VENDOR, OTHER]) {
      tx.upsertVendor({ key: vendorKey, name: vendorKey, enabled: true, baseUrlHint: origin, authType: "bearer", providerKind: "openai-compatible" });
      tx.upsertApiKey(vendorKey, { apiKey: `key-${vendorKey}`, enabled: true });
      tx.upsertModel({ vendorKey, modelKey: SIBLING, labelZh: SIBLING, kind: "video", enabled: true, meta: {} });
      tx.upsertMapping({ vendorKey, modelKey: SIBLING, taskKind: "text_to_video", name: "sibling", enabled: true, create: { method: "POST", path: "/sibling" } });
    }
    tx.upsertModel({ vendorKey: OTHER, modelKey: MODEL, labelZh: MODEL, kind: "video", enabled: true, meta: {} });
    tx.upsertMapping({ vendorKey: OTHER, modelKey: MODEL, taskKind: "text_to_video", name: "other", enabled: true, create: { method: "POST", path: "/other-connection" } });
    if (input.rows) {
      tx.upsertModel({ vendorKey: VENDOR, modelKey: MODEL, labelZh: MODEL, kind: "video", enabled: true, meta: input.meta ?? {} });
      for (const row of input.rows) tx.upsertMapping({ vendorKey: VENDOR, modelKey: MODEL, name: "existing", enabled: true, ...row } as never);
    }
  });
}
const LEGACY_ROW = { taskKind: "text_to_video", create: NEWAPI_VIDEO_CREATE_OP, query: NEWAPI_VIDEO_QUERY_OP, delivery: "asynchronous" };

/** Everything an exit promises not to touch, compared byte for byte. */
function untouched() {
  const state = readCatalog();
  const on = (vendorKey: string, modelKey?: string) => state.mappings.filter((row) => row.vendorKey === vendorKey && (modelKey ? row.modelKey === modelKey : row.modelKey !== MODEL));
  return {
    siblingRows: on(VENDOR),
    siblingModel: state.models.find((row) => row.vendorKey === VENDOR && row.modelKey === SIBLING),
    otherRows: state.mappings.filter((row) => row.vendorKey === OTHER),
    otherModels: state.models.filter((row) => row.vendorKey === OTHER),
    otherVendor: state.vendors.find((row) => row.key === OTHER),
    keys: state.apiKeysByVendor,
  };
}
const bindingOf = (vendorKey: string) => (readCatalog().vendors.find((row) => row.key === vendorKey)?.meta as Json | undefined)?.credentialBinding;
const rowsOf = (vendorKey: string, modelKey = MODEL) => readCatalog().mappings.filter((row) => row.vendorKey === vendorKey && row.modelKey === modelKey);

/** Run the steps exactly as returned; only the placeholders the reply says are placeholders get filled in. */
async function walk(exit: Exit, card: Json, name = "Second connection"): Promise<Reply[]> {
  const results: Reply[] = [];
  let fingerprint = "";
  for (const step of exit.steps) {
    const args = structuredClone(step.arguments);
    if ("ifUnchanged" in args) { expect(fingerprint, "the fingerprint comes from the read step before it").not.toBe(""); args.ifUnchanged = fingerprint; }
    if ("declaration" in args) args.declaration = JSON.stringify(card);
    if ("name" in args) args.name = name;
    const result = await mcp(step.tool, args);
    if (step.tool === "nomi_read") fingerprint = result.fingerprint;
    results.push(result);
  }
  return results;
}

const SCENARIOS: Array<{ name: string; reason: string; arrange: () => Promise<void> | void; conflictTask?: string; currentPath?: string }> = [
  {
    name: "routes guessed by an older version, no ownership record",
    reason: "unowned",
    conflictTask: "text_to_video",
    currentPath: NEWAPI_VIDEO_CREATE_OP.path,
    arrange: () => seedConnection({ rows: [LEGACY_ROW] }),
  },
  {
    name: "a route edited by hand after the first card",
    reason: "edited",
    conflictTask: "text_to_video",
    currentPath: "/hand-edited",
    arrange: async () => {
      seedConnection();
      expect((await submit(correctCard())).ok).toBe(true);
      mutateCatalog((tx, state) => { tx.upsertMapping({ ...state.mappings.find((row) => row.vendorKey === VENDOR && row.modelKey === MODEL), create: { method: "POST", path: "/hand-edited" } }); });
    },
  },
  {
    name: "an independent mode route",
    reason: "independent_mode",
    conflictTask: "text_to_video",
    currentPath: "/user-mode",
    arrange: async () => {
      seedConnection();
      expect((await submit(correctCard())).ok).toBe(true);
      mutateCatalog((tx) => { tx.upsertMapping({ vendorKey: VENDOR, modelKey: MODEL, modeId: "user-mode", taskKind: "text_to_video", name: "mine", enabled: true, create: { method: "POST", path: "/user-mode" } }); });
    },
  },
  {
    name: "a capability edited by hand after the first card",
    reason: "capability_edited",
    arrange: async () => {
      seedConnection();
      expect((await submit(correctCard())).ok).toBe(true);
      mutateCatalog((tx, state) => {
        const model = state.models.find((row) => row.vendorKey === VENDOR && row.modelKey === MODEL)!;
        const meta = structuredClone(model.meta) as { customCapabilityContract: CustomCapabilityContractV1 };
        meta.customCapabilityContract.modes[0].hint = "edited by hand";
        tx.upsertModel({ ...model, meta });
      });
    },
  },
  {
    name: "a card an Agent submitted on the earlier release, saved with no ownership record and a different wire",
    reason: "unowned",
    conflictTask: "text_to_video",
    currentPath: NEWAPI_VIDEO_CREATE_OP.path,
    arrange: () => seedConnection({
      meta: { adapter: { state: "declared", source: "declaration-card", publicationModes: ["text_to_video"] } },
      rows: [LEGACY_ROW],
    }),
  },
];

describe.each(SCENARIOS)("$name", ({ reason, conflictTask, currentPath, arrange }) => {
  async function refused() {
    await arrange();
    const before = readCatalog();
    const reply = await submit(correctCard());
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: false, code: "route_conflict" });
    expect(readCatalog()).toEqual(before);
    return reply;
  }

  it("says what conflicts, what happens if nothing changes, and what to do next, and never says to fix the card", async () => {
    const reply = await refused();
    expect(reply.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({
      modelKey: MODEL,
      reason,
      ...(conflictTask ? { taskKind: conflictTask } : {}),
      ...(currentPath ? { current: { method: "POST", path: currentPath }, declared: { method: "POST", path: "/v1/videos/generations" } } : {}),
    })]));
    expect(reply.consequence).toMatch(/nothing/i);
    expect(reply.nextAction).not.toMatch(/fix (the|what)|named field/i);
    expect(reply.exits.map((exit: Exit) => exit.id)).toEqual(["replace_model", "separate_connection"]);
    expect(reply.exits[0].needsUserConfirmation).toBe(true);
    expect(reply.exits[1].needsUserConfirmation).toBe(false);
  });

  it("the replace exit works: the model is rebuilt from the card, everything else stays", async () => {
    const reply = await refused();
    const keep = untouched();
    const binding = bindingOf(VENDOR);
    const results = await walk(reply.exits[0], correctCard());
    expect(results.map((result) => result.ok === false ? result.code : "ok")).toEqual(["ok", "ok", "ok"]);
    expect(rowsOf(VENDOR).map((row) => [row.taskKind, row.modeId, row.create.path])).toEqual([["text_to_video", undefined, "/v1/videos/generations"]]);
    const state = readCatalog();
    const model = state.models.find((row) => row.vendorKey === VENDOR && row.modelKey === MODEL)!;
    expect(parseCustomCapabilityContract(model.meta)).toBeTruthy();
    expect(deriveModelAvailability({ model, vendor: { enabled: true, authType: "bearer" }, credentialStatus: () => "ok", evidence: { mappings: state.mappings } })).toMatchObject({ usable: true });
    expect(untouched()).toEqual(keep);
    expect(bindingOf(VENDOR)).toEqual(binding);
    expect(results[2].state.hasApiKey).toBe(true);
  });

  it("the separate-connection exit works: nothing old is touched, the new connection asks for its own key", async () => {
    const reply = await refused();
    const before = readCatalog();
    const results = await walk(reply.exits[1], correctCard());
    expect(results).toHaveLength(1);
    const [created] = results;
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true, state: { hasApiKey: false }, nextAction: { kind: "user_sees_key_page" } });
    expect(created.vendorKey).not.toBe(VENDOR);
    expect(rowsOf(created.vendorKey).map((row) => row.create.path)).toEqual(["/v1/videos/generations"]);
    const after = readCatalog();
    for (const vendorKey of [VENDOR, OTHER]) {
      expect(after.mappings.filter((row) => row.vendorKey === vendorKey)).toEqual(before.mappings.filter((row) => row.vendorKey === vendorKey));
      expect(after.models.filter((row) => row.vendorKey === vendorKey)).toEqual(before.models.filter((row) => row.vendorKey === vendorKey));
      expect(after.vendors.find((row) => row.key === vendorKey)).toEqual(before.vendors.find((row) => row.key === vendorKey));
      expect(after.apiKeysByVendor[vendorKey]).toEqual(before.apiKeysByVendor[vendorKey]);
    }
  });
});

describe("a card naming several models", () => {
  async function arrangeTwoConflicts() {
    seedConnection({ rows: [LEGACY_ROW] });
    mutateCatalog((tx) => {
      tx.upsertModel({ vendorKey: VENDOR, modelKey: "second", labelZh: "second", kind: "video", enabled: true, meta: {} });
      tx.upsertMapping({ vendorKey: VENDOR, modelKey: "second", taskKind: "text_to_video", name: "second", enabled: true, create: { method: "POST", path: "/second-legacy" } });
    });
  }

  it("lists every conflict in one reply, removes only the conflicting models, and the card then lands whole", async () => {
    await arrangeTwoConflicts();
    const card = correctCard([MODEL, "second", "brand-new"]);
    const reply = await submit(card);
    expect(reply).toMatchObject({ ok: false, code: "route_conflict" });
    expect(reply.conflicts.map((conflict) => conflict.modelKey).sort()).toEqual([MODEL, "second"].sort());
    const removal = reply.exits[0].steps.find((step: ExitStep) => step.tool === "nomi_remove_provider");
    expect([...(removal!.arguments.modelKeys as string[])].sort()).toEqual([MODEL, "second"].sort());
    expect(readCatalog().models.some((row) => row.modelKey === "brand-new")).toBe(false);
    const keep = untouched();
    const results = await walk(reply.exits[0], card);
    expect(results.at(-1)).toMatchObject({ ok: true });
    for (const modelKey of [MODEL, "second", "brand-new"]) expect(rowsOf(VENDOR, modelKey).map((row) => row.create.path)).toEqual(["/v1/videos/generations"]);
    expect(untouched()).toEqual({ ...keep, siblingRows: expect.anything() });
    expect(rowsOf(VENDOR, SIBLING)).toEqual(keep.siblingRows.filter((row) => row.modelKey === SIBLING));
  });
});

describe("the guard rails on the exits", () => {
  it("removal is still the destructive tool with a fresh read in front of it", async () => {
    expect(MCP_TOOL_RESOLVER.resolve("nomi_remove_provider")!.annotations).toEqual({ destructiveHint: true });
    seedConnection({ rows: [LEGACY_ROW] });
    const reply = await submit(correctCard());
    expect(reply.exits[0].steps.map((step: ExitStep) => step.tool)).toEqual(["nomi_read", "nomi_remove_provider", "nomi_model_setup"]);
    const read = await mcp("nomi_read", reply.exits[0].steps[0].arguments);
    mutateCatalog((tx) => { tx.upsertModel({ vendorKey: VENDOR, modelKey: "arrived-meanwhile", labelZh: "arrived", kind: "video", enabled: true, meta: {} }); });
    const stale = await mcp("nomi_remove_provider", { ...reply.exits[0].steps[1].arguments, ifUnchanged: read.fingerprint });
    expect(stale).toMatchObject({ ok: false, code: "stale_fingerprint" });
    expect(rowsOf(VENDOR).map((row) => row.create.path)).toEqual([NEWAPI_VIDEO_CREATE_OP.path]);
  });

  it("reusing the existing connection's name lands on the same connection and is refused the same way", async () => {
    const first = await submit(correctCard(), { name: "Relay One" });
    expect(first).toMatchObject({ ok: true });
    mutateCatalog((tx, state) => { tx.upsertMapping({ ...state.mappings.find((row) => row.vendorKey === first.vendorKey && row.modelKey === MODEL), create: { method: "POST", path: "/hand-edited" } }); });
    const reply = await submit(correctCard(), { name: "Relay One" });
    expect(reply).toMatchObject({ ok: false, code: "route_conflict" });
    const before = readCatalog();
    const [again] = await walk(reply.exits[1], correctCard(), "Relay One");
    expect(again).toMatchObject({ ok: false, code: "route_conflict" });
    expect(readCatalog()).toEqual(before);
    const [separate] = await walk(reply.exits[1], correctCard(), "Relay Two");
    expect(separate).toMatchObject({ ok: true });
    expect(separate.vendorKey).not.toBe(first.vendorKey);
    expect(rowsOf(first.vendorKey).map((row) => row.create.path)).toEqual(["/hand-edited"]);
  });

  it("a card that does not conflict never sees the conflict shape", async () => {
    seedConnection();
    const reply = await submit(correctCard());
    expect(reply).toMatchObject({ ok: true });
    expect(reply).not.toHaveProperty("exits");
  });
});
