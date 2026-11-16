import * as store from "./catalogStore";
import { filterUsableAssistantTextModels } from "../../src/workbench/ai/assistantModelIdentity";
import { buildDefaultModelOptions } from "../../src/workbench/settings/defaultGenerationModelOptions";
import { catalogPath } from "./catalogFileAccess";
import { migrateCatalogForward } from "./catalogMigrations";
import { findExecutableModel } from "./executableModel";
import { recordModelExecutionResult } from "./modelExecutionVerification";
import { upsertRendererCatalogModel, upsertRendererCatalogVendorApiKey } from "./rendererCatalogMutation";
import { CURRENT_CATALOG_VERSION } from "./types";
import { repairUnverifiedUsable } from "./unverifiedUsableMigration";
import { revalidatePendingCredential } from "./validateCandidateCredential";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derivePublishedExecution, rowServesMode } from "../shared/modelPublication";
import { deriveModelAvailability } from "../shared/modelAvailability";
const { readCatalog, upsertModelCatalogVendor } = store;
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: {getPath: () => fixture.root, getAppPath: () => process.cwd()}, BrowserWindow: {getAllWindows: () => []}, safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() } }));
vi.mock("../ai/antigravityConnection", () => ({antigravityConnection: {canEnable: () => false, hasPassed: () => false}}));
vi.mock("../ai/onboarding/modelListProbe", async (original) => ({ ...await original<object>(), fetchModelList: vi.fn(async () => ({ok: false, failureKind: "network", statuses: [], error: "offline"})) }));
const t = "2026-11-17T00:00:00.000Z";
const model = {vendorKey: "relay", modelKey: "gpt-image-2", kind: "image", enabled: true, meta: {adapter: {state: "failed", activeRevision: "old-revision", publicationModes: [], modes: [{taskKind: "text_to_image", state: "failed"}]}}, createdAt: t, updatedAt: t};
const mapping = {vendorKey: "relay", modelKey: "gpt-image-2", taskKind: "text_to_image", enabled: true};
beforeEach(() => { fixture.root = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "unverified-usable-")); });
afterEach(() => { fs.rmSync(fixture.root, {recursive: true, force: true}); });
describe("verification is diagnostic", () => {
 it("publishes an existing request format despite failed revision diagnostics", () => {
  expect(derivePublishedExecution(model, {mappings: [mapping]})).toEqual({published: true, publishedModes: ["text_to_image"]});
  expect(deriveModelAvailability({model, vendor: {enabled: true}, credentialStatus: () => "ok", evidence: {mappings: [mapping]}})).toEqual({usable: true});
 });
 it("still refuses a video model without any executable request format", () => {
  expect(deriveModelAvailability({model: {...model, kind: "video"}, vendor: {enabled: true}, credentialStatus: () => "ok"})).toMatchObject({usable: false, reason: "model_unpublished"});
 });
 it("saves an offline credential enabled and leaves pending as a hint", async () => {
  store.upsertModelCatalogVendor({key: "relay", name: "Relay", enabled: true, baseUrlHint: "http://127.0.0.1:54331/v1"});
  await upsertRendererCatalogVendorApiKey("relay", {apiKey: "fixture-key"});
  expect(store.readCatalog().apiKeysByVendor.relay).toMatchObject({enabled: true, verificationPending: true});
 });
 it("does not block first use when a pending probe fails", async () => {
  store.upsertModelCatalogVendor({key: "relay", name: "Relay", enabled: true, baseUrlHint: "http://127.0.0.1:54331/v1"});
  store.upsertModelCatalogVendorApiKey("relay", {apiKey: "fixture-key", enabled: true, verificationPending: true});
  await expect(revalidatePendingCredential("relay")).resolves.toBeUndefined();
  expect(store.readCatalog().apiKeysByVendor.relay.verificationPending).toBe(true);
 });
});


describe("one-time legacy recovery", () => {
 async function legacy() {
  const state = {version: 13, vendors: [{key: "relay", enabled: false}], models: [
   {...model, enabled: false},
   {...model, modelKey: "manual", kind: "text", enabled: false, meta: {adapter: {state: "verified"}}},
   {...model, modelKey: "no-route", kind: "video", enabled: false}
  ], mappings: [mapping], apiKeysByVendor: {relay: {apiKey: "fixture", enabled: true}}};
  const write = vi.fn((value) => value);
  const migrated = migrateCatalogForward(state as never, () => {throw Error("unexpected default");}, write);
  expect(CURRENT_CATALOG_VERSION).toBe(13);
  expect(migrated.version).toBe(13);
  return {migrateCatalogForward, migrated, write};
 }
 it("does not rewrite a deferred legacy secret migration", async () => {
  const old = {version: 8, vendors: [{key: "relay", enabled: true, meta: {customConfig: {token: "legacy"}}}], models: [], mappings: [], apiKeysByVendor: {}};
  const write = vi.fn(value => value);
  const result = migrateCatalogForward(old as never, () => {throw Error("unexpected default");}, write);
  expect(result.version).toBe(8);
  expect(write).not.toHaveBeenCalled();
 });
 it("starts fresh catalogs with the repair receipt so later rejected writes leave them unchanged", async () => {
  const first = readCatalog();
  expect(first.unverifiedUsableRecovered).toBe(true);
  expect(readCatalog()).toEqual(first);
 });
 it("keeps the original v13 bytes before the once-only repair and later writes", async () => {
  const original = JSON.stringify({version: 13, vendors: [], models: [], mappings: [], apiKeysByVendor: {}});
  const file = catalogPath();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, original);
  expect(readCatalog().unverifiedUsableRecovered).toBe(true);
  upsertModelCatalogVendor({key: "later", name: "Later", enabled: false});
  expect(fs.readFileSync(file.replace(/\.json$/, ".v13.bak.json"), "utf8")).toBe(original);
 });
 it("recovers failed models with a format, keeping manual disabled and missing-format rows off", async () => {
  const {migrated} = await legacy();
  expect(migrated.models.map((row) => row.enabled)).toEqual([true, false, false]);
  expect(migrated.vendors[0].enabled).toBe(true);
 });
 it("never reruns recovery after an upgraded model is manually disabled", async () => {
  const {migrateCatalogForward, migrated, write} = await legacy();
  migrated.models[0].enabled = false;
  write.mockClear();
  const reopened = migrateCatalogForward(migrated, () => {throw Error("unexpected default");}, write);
  expect(reopened.models[0].enabled).toBe(false);
  expect(write).not.toHaveBeenCalled();
 });
 it("recovers pending credentials and only models with executable declarations", async () => {
  const state = {version: 13, vendors: [{key: "relay", enabled: false}], models: [{...model, enabled: true, meta: {adapter:{state:"verified",activeRevision:"previous-key"}}}, {...model, modelKey: "missing", kind: "video", enabled: false, meta: {}}], mappings: [mapping], apiKeysByVendor: {relay: {apiKey: "fixture", enabled: false, verificationPending: true}}};
  const migrated = repairUnverifiedUsable(state as never);
  expect(migrated.apiKeysByVendor.relay.enabled).toBe(true);
  expect(migrated.models.map((row) => row.enabled)).toEqual([true, false]);
  expect(migrated.models[0].meta).toMatchObject({adapter:{state:"unverified",activeRevision:"previous-key"}});
 });
});

describe("real execution evidence", () => {
 async function setup(authType = "bearer") {
  store.upsertModelCatalogVendor({key: "relay", name: "Relay", enabled: true, authType, baseUrlHint: "http://127.0.0.1:54331/v1"});
  store.upsertModelCatalogVendorApiKey("relay", {apiKey: "fixture-key", enabled: true, verificationPending: true});
  store.upsertModelCatalogModel(model);
  const state = store.readCatalog();
  const input = {vendor: state.vendors.find(row => row.key === "relay")!, model: state.models.find(row => row.modelKey === model.modelKey)!, apiKey: "fixture-key"};
  return {store, input, recordModelExecutionResult};
 }
 it("clears pending and model diagnostics on success, retaining both on 401 or queued", async () => {
  const {store, input, recordModelExecutionResult} = await setup();
  for (const status of ["failed", "queued"]) {
   recordModelExecutionResult(input, {status, kind: "text_to_image", assets: []});
   expect(store.readCatalog().apiKeysByVendor.relay.verificationPending).toBe(true);
  }
  recordModelExecutionResult(input, {status: "succeeded", kind: "text_to_image", assets: []});
  expect(store.readCatalog().apiKeysByVendor.relay.verificationPending).toBe(true);
  recordModelExecutionResult(input, {status: "succeeded", kind: "text_to_image", assets: [{url: "fixture"}]});
  expect(store.readCatalog().apiKeysByVendor.relay.verificationPending).toBeUndefined();
  expect(store.readCatalog().models.find(row => row.modelKey === model.modelKey)?.meta).toMatchObject({adapter: {state: "verified"}});
 });
 it.each(["bearer", "none"])("does not let an old successful %s request clear a replacement key", async (authType) => {
  const {store, input, recordModelExecutionResult} = await setup(authType);
  store.upsertModelCatalogModel({...input.model, meta:{adapter:{state:"unverified"}}});
  const snapshot = {...input, model:store.readCatalog().models.find(row=>row.vendorKey==="relay")!};
  store.upsertModelCatalogVendorApiKey("relay", {apiKey: "replacement", enabled: true, verificationPending: true});
  expect(store.readCatalog().models.find(row=>row.vendorKey==="relay")?.updatedAt).toBe(snapshot.model.updatedAt);
  recordModelExecutionResult(snapshot, {status: "succeeded", kind: "text_to_image", assets: [{url: "fixture"}]});
  expect(store.readCatalog().apiKeysByVendor.relay.verificationPending).toBe(true);
 });
});


describe("selectors agree with executable resolution", () => {
 it("offers pending and failed configured models on every applicable surface and resolves each ready row", async () => {
  store.upsertModelCatalogVendor({key: "relay", name: "Relay", enabled: true, baseUrlHint: "http://127.0.0.1:54331/v1"});
  store.upsertModelCatalogVendorApiKey("relay", {apiKey: "fixture-key", enabled: true, verificationPending: true});
  for (const kind of ["image", "text", "video"]) store.upsertModelCatalogModel({...model, modelKey: kind, kind});
  store.upsertModelCatalogMapping({...mapping, modelKey: "image", create: {method: "POST", path: "/images/generations"}});
  const rows = store.listModelCatalogModels();
  const relay = rows.filter(row => row.vendorKey === "relay");
  const defaults = buildDefaultModelOptions(relay, () => "Relay", "Auto");
  expect(defaults.optionsByKind.text_to_image).toHaveLength(2);
  expect(defaults.optionsByKind.text_to_video).toHaveLength(1);
  expect(relay.filter(row => rowServesMode(row, "text_to_image")).map(row => row.modelKey)).toEqual(["image"]);
  expect(filterUsableAssistantTextModels(relay).map(row => row.modelKey)).toEqual(["text"]);
  expect(relay.filter(row => row.availability.usable)).toHaveLength(2);
  for (const row of relay.filter(row => row.availability.usable)) expect(findExecutableModel(row.vendorKey, row.modelKey).apiKey).toBe("fixture-key");
 });
});


it("replacing a credential retires old model verification without disabling its request format", async () => {
 store.upsertModelCatalogVendor({key: "relay", name: "Relay", enabled: true, baseUrlHint: "http://127.0.0.1:54331/v1"});
 store.upsertModelCatalogVendorApiKey("relay", {apiKey: "first", enabled: true});
 store.upsertModelCatalogModel({...model, kind: "text", meta: {adapter: {state: "verified", activeRevision: "old"}}});
 store.upsertModelCatalogVendorApiKey("relay", {apiKey: "replacement", enabled: true, verificationPending: true});
 const row = store.listModelCatalogModels().find(row => row.vendorKey === "relay")!;
 expect(row.meta).toMatchObject({adapter: {state: "unverified", activeRevision: "old"}});
 expect(row.availability.usable).toBe(true);
});


it("a pending connection never overrides a disabled model without failed verification evidence", async () => {
 const migrated = repairUnverifiedUsable({version:13,vendors:[{key:"relay",enabled:false}],models:[{...model,kind:"text",enabled:false,meta:{adapter:{state:"verified"}}}],mappings:[],apiKeysByVendor:{relay:{enabled:false,verificationPending:true}}} as never);
 expect(migrated.apiKeysByVendor.relay.enabled).toBe(true);
 expect(migrated.models[0].enabled).toBe(false);
});


it("explicitly enabling a configured model publishes its saved connection independently of diagnostics", async () => {
 store.upsertModelCatalogVendor({key:"relay",name:"Relay",enabled:false,baseUrlHint:"http://127.0.0.1:54331/v1"});
 store.upsertModelCatalogVendorApiKey("relay",{apiKey:"fixture-key",enabled:true});
 store.upsertModelCatalogModel({...model,enabled:false,customCall:{script:"return [];"}});
 upsertRendererCatalogModel({vendorKey:"relay",modelKey:model.modelKey,enabled:true});
 expect(store.listModelCatalogModels().find(row=>row.vendorKey==="relay")?.availability.usable).toBe(true);
});
