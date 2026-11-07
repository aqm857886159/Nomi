/**
 * An upgrade must not touch the models people already use.
 *
 * The directories under tests/fixtures/old-user-data/catalogs were written by the real functions of the release named in the
 * directory (real service, real store, real promote, real card registration), not typed by hand. For each of them, and for every
 * model in it, this checks what a person would notice after updating:
 *   1. the model is still in the model list;
 *   2. it publishes at least the modes the mainline publishes for the same directory;
 *   3. every one of those modes still sends exactly one POST, to the same path, with the same body.
 *
 * "The mainline" is not written by hand: each directory has an expected.json recorded by running this very file on the
 * mainline commit named inside it. A mismatch means the upgrade changed something an existing person relies on.
 * To record a new baseline (when the mainline moves on purpose), see tests/fixtures/old-user-data/README.md.
 *
 * Loopback only: the fake service listens on a random port, every address in the directory copy is rewritten to it,
 * the fixtures in the repository are never touched, and no key in them is real.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    app: { getPath: () => String(process.env.NOMI_SETTINGS_DIR), getAppPath: () => process.cwd(), isPackaged: false },
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
  };
});

/** Set only when recording a baseline on a clean mainline checkout: where the fixtures are, and where expected.json goes. */
const RECORD_ROOT = String(process.env.NOMI_RECORD_OLD_USER_DATA || "").trim();
const FIXTURE_ROOT = RECORD_ROOT || fileURLToPath(new URL("../../tests/fixtures/old-user-data", import.meta.url));
const CATALOGS = path.join(FIXTURE_ROOT, "catalogs");
/** Every address in the saved directories points at this one. It is replaced by the random port of the fake service. */
const SAVED_ORIGIN = "http://127.0.0.1:39017";

type Json = Record<string, unknown>;
type Sent = { method: string; url: string; contentType: string; authorization: string; body: Buffer };
type Posted = {
  method: string; path: string; contentType: string; authScheme: string; body?: string;
  multipart?: { fields: Array<[string, string]>; files: Array<{ name: string; fileName: string; type: string; bytes: number; sha256: string }> };
};
/** `task` = the task as an Agent or script sends it; `canvas` = the request a canvas node builds for a model whose picture reaches the wire only through its archetype slots. */
type ModeRecord = { posts: number; via?: "task" | "canvas"; request?: Posted; unverified?: string; refusal?: string };
type ModelRecord = { kind: string; listed: boolean; published: string[]; modes: Record<string, ModeRecord> };
type Observed = { diskVersionAfterRead: number; backupFiles: string[]; models: Record<string, ModelRecord> };
type Expected = Observed & { recordedFrom: string };

/**
 * One tiny picture for the modes that need an input image, served by the fake service itself. Inline pictures are never used:
 * the app uploads those to its public temporary host when a connection declares no upload channel, and nothing here may leave the machine.
 */
const PICTURE_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PICTURE_PATH = "/reference.png";
const NEEDS_PICTURE = new Set(["image_edit", "image_to_video", "image_to_3d"]);

/** A directory as a cell of the matrix. `handWrittenHalfContract` also writes a partial capability contract on every media model that publishes two modes or more. */
type Cell = { name: string; directory: string; expectedFile: string; handWrittenHalfContract?: boolean };
function cells(): Cell[] {
  const directories = fs.readdirSync(CATALOGS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const out: Cell[] = directories.map((directory) => ({ name: directory, directory, expectedFile: "expected.json" }));
  // A person who opened the capability form on a model the wizard connected and wrote only the text mode, while the routes also serve the picture mode.
  out.push({ name: "v0.24.0-wizard + hand-written half contract", directory: "v0.24.0-wizard", expectedFile: "expected.hand-written-half-contract.json", handWrittenHalfContract: true });
  return out;
}

const opened: Array<{ server: http.Server; root: string }> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const item of opened.splice(0)) {
    await new Promise<void>((resolve) => item.server.close(() => resolve()));
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

/** A contract that states only the text mode, written the way the capability form writes it. */
function halfContract(kind: string, taskKind: string): Json {
  return {
    version: 1, kind, defaultModeId: "text", transportTaskKind: taskKind,
    modes: [{ id: "text", intent: "text", vendorTerm: "Hand-written text mode", hint: "", promptRequired: true, transportTaskKind: taskKind, slots: [], params: [] }],
  };
}

/** Copy a saved directory, point it at the fake service, and load the app modules against it with nothing shared with an earlier cell. */
async function openDirectory(cell: Cell) {
  const sent: Sent[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "GET" && String(request.url) === PICTURE_PATH) {
        response.setHeader("content-type", "image/png");
        response.end(PICTURE_BYTES);
        return;
      }
      if (request.method === "POST") {
        sent.push({
          method: request.method, url: String(request.url), contentType: String(request.headers["content-type"] || ""),
          authorization: String(request.headers.authorization || ""), body: Buffer.concat(chunks),
        });
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "task-1", task_id: "task-1", status: "processing" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-old-user-data-"));
  opened.push({ server, root });
  const settings = path.join(root, "settings");
  fs.cpSync(path.join(CATALOGS, cell.directory), settings, { recursive: true });
  for (const file of fs.readdirSync(settings)) if (file.startsWith("expected")) fs.rmSync(path.join(settings, file));
  for (const file of listFiles(settings).filter((name) => name.endsWith(".json"))) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes(SAVED_ORIGIN)) fs.writeFileSync(file, text.split(SAVED_ORIGIN).join(origin));
  }
  if (cell.handWrittenHalfContract) {
    const file = path.join(settings, "model-catalog.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { models: Array<{ vendorKey: string; modelKey: string; kind: string; meta?: Json }>; mappings: Array<{ vendorKey: string; modelKey: string; taskKind: string; enabled?: boolean }> };
    let written = 0;
    for (const model of raw.models.filter((row) => row.kind !== "text")) {
      const modes = raw.mappings.filter((row) => row.vendorKey === model.vendorKey && row.modelKey === model.modelKey && row.enabled !== false).map((row) => row.taskKind);
      const textMode = modes.find((taskKind) => taskKind.startsWith("text_to_"));
      if (modes.length < 2 || !textMode) continue;
      model.meta = { ...(model.meta || {}), customCapabilityContract: halfContract(model.kind, textMode) };
      written += 1;
    }
    expect(written, "the directory must have models whose routes serve more than their text mode").toBeGreaterThan(0);
    fs.writeFileSync(file, JSON.stringify(raw));
  }
  vi.stubEnv("NOMI_SETTINGS_DIR", settings);
  // The product's own test guard: any request to a host that is not loopback fails instead of leaving the machine.
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  vi.resetModules();
  const catalog = await import("./catalogStore");
  const listing = await import("./modelCatalogListing");
  const publication = await import("../shared/modelPublication");
  const runtime = await import("../runtime");
  const archetypes = await import("../shared/modelArchetypes");
  const transport = await import("../shared/videoCapabilities/modeTransport");
  const canvas = await import("../../src/workbench/generationCanvas/runner/catalogTaskActions");
  return { sent, origin, root, settings, catalog, listing, publication, runtime, archetypes, transport, canvas };
}

/** What a person would see on the wire, with the random address and the random multipart boundary taken out. */
async function shapeOf(item: Sent, origin: string): Promise<Posted> {
  const scrub = (value: string) => value.split(origin).join("{{origin}}");
  const type = item.contentType.split(";")[0].trim().toLowerCase();
  const base = { method: item.method, path: scrub(item.url), contentType: type, authScheme: item.authorization.split(" ")[0] || "" };
  if (type !== "multipart/form-data") return { ...base, body: scrub(item.body.toString("utf8")) };
  const form = await new Response(new Uint8Array(item.body), { headers: { "content-type": item.contentType } }).formData();
  const fields: Array<[string, string]> = [];
  const files: NonNullable<Posted["multipart"]>["files"] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") fields.push([name, scrub(value)]);
    else files.push({ name, fileName: value.name, type: value.type, bytes: value.size, sha256: crypto.createHash("sha256").update(Buffer.from(await value.arrayBuffer())).digest("hex") });
  }
  return { ...base, multipart: { fields, files } };
}

type Opened = Awaited<ReturnType<typeof openDirectory>>;
type CatalogModel = ReturnType<Opened["catalog"]["readCatalog"]>["models"][number];
type SendRequest = { vendor: string; request: Json };

/** The task as an Agent or a script sends it. */
function taskRequest(directory: Opened, vendorKey: string, projectId: string, modelKey: string, taskKind: string): SendRequest {
  const extras: Json = { projectId, modelKey, ...(NEEDS_PICTURE.has(taskKind) ? { referenceImages: [`${directory.origin}${PICTURE_PATH}`] } : {}) };
  return { vendor: vendorKey, request: { kind: taskKind, prompt: "a blue marble", extras } };
}

/** What a canvas node builds: the node's archetype mode that sends this task, with the picture on the slot that mode offers. */
function canvasRequest(directory: Opened, vendorKey: string, projectId: string, model: CatalogModel, taskKind: string): SendRequest | null {
  const archetype = directory.archetypes.resolveArchetypeForModel({ modelKey: model.modelKey, modelAlias: model.modelAlias, vendorKey, meta: model.meta });
  const mode = archetype?.modes.find((candidate) => directory.transport.modeTransportFor(candidate, archetype, vendorKey) === taskKind);
  if (!archetype || !mode) return null;
  const picture = `${directory.origin}${PICTURE_PATH}`;
  const node = {
    id: "node-1", kind: model.kind, title: "", prompt: "a blue marble", position: { x: 0, y: 0 },
    meta: { modelKey: model.modelKey, modelVendor: vendorKey, archetype: { id: archetype.id, modeId: mode.id, variantId: "" } },
  };
  try {
    const built = directory.canvas.buildCatalogTaskRequest(node as never, { references: taskKind === "image_to_video" ? { firstFrameUrl: picture } : { referenceImages: [picture] } } as never);
    return { vendor: built.vendor, request: { ...built.request, extras: { ...(built.request.extras || {}), projectId } } as unknown as Json };
  } catch {
    return null;
  }
}

async function attempt(directory: Opened, via: "task" | "canvas", send: SendRequest | null): Promise<ModeRecord> {
  if (!send) return { posts: 0, via, refusal: "no request could be built for this mode" };
  const before = directory.sent.length;
  let refusal = "";
  try {
    await directory.runtime.runTask(send as never, { spendGate: async () => {} } as never);
  } catch (error) {
    // The fake service answers every create with "processing"; what a person pays for is whether the request left, so the count below decides.
    refusal = String((error as Error)?.message || error).slice(0, 240);
  }
  const posts = directory.sent.length - before;
  return posts === 1 ? { posts, via, request: await shapeOf(directory.sent[before], directory.origin) } : { posts, via, refusal };
}

async function sendMode(directory: Opened, vendorKey: string, projectId: string, model: CatalogModel, taskKind: string, via?: "task" | "canvas"): Promise<ModeRecord> {
  const direct = via === "canvas" ? null : await attempt(directory, "task", taskRequest(directory, vendorKey, projectId, model.modelKey, taskKind));
  if (direct && (direct.posts === 1 || !NEEDS_PICTURE.has(taskKind))) return direct;
  // A route whose picture only reaches the wire through its archetype slots refuses a plain task before any POST; the canvas builds the request that carries it.
  return attempt(directory, "canvas", canvasRequest(directory, vendorKey, projectId, model, taskKind));
}

async function observe(cell: Cell, wanted?: Expected): Promise<Observed> {
  const directory = await openDirectory(cell);
  const state = directory.catalog.readCatalog();
  const vendor = state.vendors.find((row) => String(row.baseUrlHint).includes("127.0.0.1"));
  if (!vendor) throw new Error(`fixture ${cell.directory} has no loopback connection`);
  const diskVersionAfterRead = (JSON.parse(fs.readFileSync(path.join(directory.settings, "model-catalog.json"), "utf8")) as { version: number }).version;
  const backupFiles = fs.readdirSync(directory.settings).filter((file) => /^model-catalog\.v\d+\.bak\.json$/.test(file)).sort();
  const picker = directory.listing.deriveModelListing(state, { keyStatusProbe: () => "ok" } as never);
  const project = directory.runtime.createProject({ name: "Upgrade", rootPath: path.join(directory.root, "project") });
  const models: Record<string, ModelRecord> = {};
  for (const model of state.models.filter((row) => row.vendorKey === vendor.key)) {
    const published = directory.publication.derivePublishedExecution(model, { mappings: state.mappings }).publishedModes as string[];
    const record: ModelRecord = { kind: model.kind, listed: picker.some((row) => row.vendor === vendor.key && row.modelKey === model.modelKey), published: [...published].sort(), modes: {} };
    // Modes to send: in a recording whatever the mainline publishes; in a check whatever the recording holds.
    const toSend = wanted ? Object.keys(wanted.models[model.modelKey]?.modes || {}) : published;
    for (const taskKind of toSend) {
      const recorded = wanted?.models[model.modelKey]?.modes[taskKind];
      record.modes[taskKind] = recorded?.unverified ? { posts: 0, unverified: recorded.unverified } : await sendMode(directory, vendor.key, project.id, model, taskKind, recorded?.via);
    }
    models[model.modelKey] = record;
  }
  return { diskVersionAfterRead, backupFiles, models };
}

describe.each(cells())("saved by an older release: $name", (cell) => {
  it("keeps every model listed, published and sending the same request", async () => {
    const expectedPath = path.join(CATALOGS, cell.directory, cell.expectedFile);
    if (RECORD_ROOT) {
      const seen = await observe(cell);
      const unsent = Object.entries(seen.models).flatMap(([model, record]) => Object.entries(record.modes).filter(([, mode]) => mode.posts !== 1 && !mode.unverified).map(([taskKind]) => `${model}/${taskKind}`));
      expect(unsent, "a published mode that does not send exactly one POST on the mainline means the fixture or the harness is wrong").toEqual([]);
      const recorded: Expected = { recordedFrom: String(process.env.NOMI_RECORD_COMMIT || ""), ...seen };
      fs.writeFileSync(expectedPath, `${JSON.stringify(recorded, null, 2)}\n`);
      return;
    }
    const wanted = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as Expected;
    expect(wanted.recordedFrom, "expected.json says which mainline commit it was recorded from").toMatch(/^[0-9a-f]{40}$/);
    const seen = await observe(cell, wanted);
    expect({ diskVersionAfterRead: seen.diskVersionAfterRead, backupFiles: seen.backupFiles }, "the catalog version and the backups it leaves are the mainline's").toEqual({ diskVersionAfterRead: wanted.diskVersionAfterRead, backupFiles: wanted.backupFiles });
    expect(Object.keys(seen.models).sort(), "every model the directory had is still there").toEqual(expect.arrayContaining(Object.keys(wanted.models).sort()));
    for (const [model, want] of Object.entries(wanted.models)) {
      const got = seen.models[model];
      if (want.listed) expect(got.listed, `${model} is in the model list`).toBe(true);
      for (const taskKind of want.published) expect(got.published, `${model} still publishes ${taskKind}`).toContain(taskKind);
      for (const [taskKind, mode] of Object.entries(want.modes)) {
        if (mode.unverified) continue;
        expect(got.modes[taskKind]?.posts, `${model} ${taskKind} sends exactly one POST (${got.modes[taskKind]?.refusal ?? "no refusal"})`).toBe(1);
        expect(got.modes[taskKind]?.request, `${model} ${taskKind} sends the mainline's path and body`).toEqual(mode.request);
      }
    }
  }, 120_000);
});

/** Loaded only by the cells that need them, and only after openDirectory has chosen the directory and reset the module registry. */
async function loadAdapter() {
  const { ProviderAdapterService } = await import("../providerAdapter/service");
  const { defaultCatalog } = await import("../providerAdapter/serviceCatalog");
  const { ProviderAdapterStore } = await import("../providerAdapter/store");
  return { ProviderAdapterService, defaultCatalog, ProviderAdapterStore };
}
async function loadToolSurface() {
  const { MCP_TOOL_RESOLVER } = await import("../capabilityCore/mcpToolCatalog");
  const { validateToolArguments } = await import("../capabilityCore/mcpProtocol");
  const { dispatch } = await import("../capabilityCore/dispatcher");
  const { relayDeclaration } = await import("../../tests/ux/_relayVideoFixture.mjs");
  return { MCP_TOOL_RESOLVER, validateToolArguments, dispatch, relayDeclaration };
}

/** What one model looks like to a person right now: in the list, switched on, which modes it publishes, and the request each of them sends. */
async function snapshotModel(directory: Opened, projectId: string, vendorKey: string, modelKey: string) {
  const state = directory.catalog.readCatalog();
  const model = state.models.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey);
  if (!model) return { present: false as const };
  const picker = directory.listing.deriveModelListing(state, { keyStatusProbe: () => "ok" } as never);
  const published = [...(directory.publication.derivePublishedExecution(model, { mappings: state.mappings }).publishedModes as string[])].sort();
  const requests: Record<string, ModeRecord> = {};
  for (const taskKind of published) requests[taskKind] = await sendMode(directory, vendorKey, projectId, model, taskKind);
  return { present: true as const, enabled: model.enabled, listed: picker.some((row) => row.vendor === vendorKey && row.modelKey === modelKey), published, requests };
}

describe("the person opens the connection wizard again on a directory an older release saved", () => {
  it("a re-verification that fails leaves the old video models listed, switched on and sending the same request", async () => {
    const directory = await openDirectory({ name: "wizard", directory: "v0.24.0-wizard", expectedFile: "" });
    const { ProviderAdapterService, defaultCatalog, ProviderAdapterStore } = await loadAdapter();
    const first = directory.catalog.readCatalog();
    const vendor = first.vendors.find((row) => String(row.baseUrlHint).includes("127.0.0.1"))!;
    const project = directory.runtime.createProject({ name: "Reverify", rootPath: path.join(directory.root, "project") });
    const videoModels = first.models.filter((row) => row.vendorKey === vendor.key && row.kind === "video");
    expect(videoModels.length, "the directory has video models the wizard connected").toBeGreaterThan(0);
    let runIndex = 0;
    for (const model of videoModels) {
      const before = await snapshotModel(directory, project.id, vendor.key, model.modelKey);
      expect(before, `${model.modelKey} works before the wizard is opened`).toMatchObject({ present: true, enabled: true, listed: true });
      runIndex += 1;
      // The same stand-ins the service tests use: a loopback host is not documented, so nothing is compiled or fetched.
      const adapter = new ProviderAdapterService(new ProviderAdapterStore(path.join(directory.settings, "provider-adapters.json")), {
        catalog: defaultCatalog, schedule: () => {},
        discover: async () => ({ sources: [], corpus: "" }), resolveLanguageModels: () => [],
        compile: async () => { throw new Error("not used on a loopback host"); },
        verify: async ({ mode }: { mode: { taskKind: string } }) => ({ ok: true, taskKind: mode.taskKind }),
        now: () => "2026-10-31T00:00:00.000Z", id: () => `reverify-${runIndex}`,
      } as never);
      const started = await adapter.start({
        catalogVendorKey: vendor.key, vendorName: vendor.key, baseUrl: String(vendor.baseUrlHint), apiKey: "fixture-key-not-real", authType: "bearer", providerKind: "openai-compatible",
        models: [{ modelKey: model.modelKey, labelZh: model.modelKey, kind: "video" }],
        certification: { contractDigest: "a".repeat(64), idempotencyKey: `idempotency-reverify-${runIndex}`, remoteIdempotency: "unknown" },
      } as never);
      await adapter.executeRun(started.id);
      await adapter.awaitTerminalWrites?.();
      (adapter as unknown as { stopWatchdog?: () => void }).stopWatchdog?.();
      expect(adapter.getRun(started.id)?.stage, "a video model on a connection with no documented protocol cannot be verified").toBe("failed");
      const after = await snapshotModel(directory, project.id, vendor.key, model.modelKey);
      expect(after, `${model.modelKey} after the failed re-verification`).toEqual(before);
    }
  }, 120_000);
});

describe("the person has an Agent submit a new card on a directory an older release saved", () => {
  type Reply = { ok: boolean; code?: string; vendorKey: string; fingerprint: string; consequence: string; state: { hasApiKey: boolean }; exits: Array<{ id: string; needsUserConfirmation: boolean; steps: Array<{ tool: string; arguments: Json }> }> };

  /** `model` is one of the directory's own models; `card` is a correct card for it whose routes differ from the ones the older release saved. */
  const CASES: Array<{ name: string; directory: string; pick: (models: CatalogModel[]) => CatalogModel | undefined; card: (declare: (origin: string, options: Json) => unknown, origin: string, baseUrl: string, saved: Json | null, modelKey: string) => Json }> = [
    {
      name: "a model the wizard connected",
      directory: "v0.24.0-wizard",
      pick: (models) => models.find((row) => row.kind === "video"),
      card: (declare, origin, baseUrl, _saved, modelKey) => ({ ...(declare(origin, { id: modelKey, shape: "legacy-url" }) as Json), provider: { baseUrl, authType: "bearer", providerKind: "openai-compatible" } }),
    },
    {
      name: "a model an Agent connected with the earlier release's card",
      directory: "v0.24.0-declared-card",
      pick: (models) => models.find((row) => row.kind === "video"),
      card: (_declare, _origin, _baseUrl, saved) => saved as Json,
    },
  ];

  it.each(CASES)("$name: refused first with nothing written, the old model keeps sending, and the replace exit rebuilds only that model", async (scenario) => {
    const directory = await openDirectory({ name: scenario.name, directory: scenario.directory, expectedFile: "" });
    const { MCP_TOOL_RESOLVER, validateToolArguments, dispatch, relayDeclaration } = await loadToolSurface();
    const mcp = async (name: string, args: Json): Promise<Reply> => {
      const tool = MCP_TOOL_RESOLVER.resolve(name)!;
      expect(tool, `${name} is on the tool surface`).toBeDefined();
      const invalid = validateToolArguments(tool.name, tool.inputSchema, args);
      if (invalid) throw invalid;
      const method = typeof (tool as { resolveMethod?: unknown }).resolveMethod === "function" ? (tool as unknown as { resolveMethod: (a: Json) => string }).resolveMethod(args) : tool.method;
      return await dispatch(method, tool.build(args) as never, { origin: { host: "codex" } } as never) as Reply;
    };
    const first = directory.catalog.readCatalog();
    const vendor = first.vendors.find((row) => String(row.baseUrlHint).includes("127.0.0.1"))!;
    const model = scenario.pick(first.models.filter((row) => row.vendorKey === vendor.key))!;
    const savedCardFile = path.join(directory.settings, "card.json");
    const savedCard = fs.existsSync(savedCardFile) ? JSON.parse(fs.readFileSync(savedCardFile, "utf8")) as Json : null;
    const card = scenario.card(relayDeclaration as never, directory.origin, String(vendor.baseUrlHint), savedCard, model.modelKey);
    const project = directory.runtime.createProject({ name: "Resubmit", rootPath: path.join(directory.root, "project") });
    const catalogFile = path.join(directory.settings, "model-catalog.json");
    const others = () => {
      const state = directory.catalog.readCatalog();
      const binding = (state.vendors.find((row) => row.key === vendor.key)?.meta as Json | undefined)?.credentialBinding;
      return { models: state.models.filter((row) => row.modelKey !== model.modelKey), mappings: state.mappings.filter((row) => row.modelKey !== model.modelKey), keys: state.apiKeysByVendor, binding };
    };

    // Before: the old model works.
    const working = await snapshotModel(directory, project.id, vendor.key, model.modelKey);
    expect(working, "the old model works before any card is submitted").toMatchObject({ present: true, enabled: true, listed: true });
    expect((working as { published: string[] }).published.length).toBeGreaterThan(0);
    const bytesBefore = fs.readFileSync(catalogFile, "utf8");
    const othersBefore = others();

    // First submit: refused, and nothing is written.
    const refused = await mcp("nomi_model_setup", { action: "submit_declaration", vendorKey: vendor.key, declaration: JSON.stringify(card) });
    expect(refused, JSON.stringify(refused).slice(0, 400)).toMatchObject({ ok: false, code: "route_conflict" });
    expect(fs.readFileSync(catalogFile, "utf8"), "a refused card writes nothing").toBe(bytesBefore);
    // The refusal says the old model keeps sending to its current routes. That has to be true.
    expect(refused.consequence).toMatch(/keeps sending to its current routes/);
    expect(await snapshotModel(directory, project.id, vendor.key, model.modelKey), "the old model sends exactly what it sent before the card").toEqual(working);

    // The exit that needs the person's confirmation: remove only that model, submit the same card again.
    const replace = refused.exits.find((exit) => exit.id === "replace_model")!;
    expect(replace.needsUserConfirmation).toBe(true);
    let fingerprint = "";
    let last: Reply | undefined;
    for (const step of replace.steps) {
      const args = structuredClone(step.arguments);
      if ("ifUnchanged" in args) args.ifUnchanged = fingerprint;
      if ("declaration" in args) args.declaration = JSON.stringify(card);
      last = await mcp(step.tool, args);
      expect(last, `${step.tool}: ${JSON.stringify(last).slice(0, 300)}`).not.toMatchObject({ ok: false });
      if (step.tool === "nomi_read") fingerprint = last.fingerprint;
    }
    expect(last?.state.hasApiKey, "the saved key is still there").toBe(true);
    expect(others(), "no other model, route or key changed, and the connection is still bound to the same address").toEqual(othersBefore);

    // After: the new card is in force and the model sends what the card declares.
    const state = directory.catalog.readCatalog();
    const rebuilt = state.models.find((row) => row.vendorKey === vendor.key && row.modelKey === model.modelKey)!;
    expect(rebuilt.meta, "the model now carries its capability").toMatchObject({ customCapabilityContract: { kind: "video" } });
    const declaredPaths = (card.models as Array<{ modes: Array<{ create: { path: string } }> }>)[0].modes.map((mode) => mode.create.path);
    expect(state.mappings.filter((row) => row.vendorKey === vendor.key && row.modelKey === model.modelKey).map((row) => row.create.path)).toEqual(declaredPaths);
    const sent = await snapshotModel(directory, project.id, vendor.key, model.modelKey);
    expect(sent).toMatchObject({ present: true, enabled: true, listed: true });
    expect(Object.values((sent as { requests: Record<string, ModeRecord> }).requests).map((mode) => mode.posts)).toEqual([1]);
  }, 120_000);
});
