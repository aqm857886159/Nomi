// Fixture user accepts the quote card; the real taskSpend guard still runs.
vi.mock("./capabilityCore/rendererBridge", () => ({
  // 付费确认等的是**人**，走没有墙钟期限的那条（2026-09-11 拍板：审批卡永不因空闲超时）。
  requestRendererDecision: vi.fn(async (operation: string) => {
    if (operation !== "spend.confirm") throw new Error(`Unexpected renderer operation: ${operation}`);
    return { confirmed: true };
  }),
  // 带超时的那条是给「渲染层自己干活」用的。付费路径再走到它就是回归，所以这里直接炸。
  requestRenderer: vi.fn(async (operation: string) => {
    throw new Error(`Spend confirmation must not use the timeout-bound bridge: ${operation}`);
  }),
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareCli: vi.fn(), restore: vi.fn(), hasPassed: vi.fn(), readEvidence: vi.fn(),
  readLocal: vi.fn(), fetch: vi.fn(), validateImage: vi.fn(), runProcess: vi.fn(),
  requested: vi.fn(), completed: vi.fn(), admitted: vi.fn(),
}));

let userDataRoot = "";
vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock("./ai/antigravityConnection", () => ({
  prepareAntigravity: (...args: unknown[]) => mocks.prepareCli(...args),
  antigravityConnection: { restore: mocks.restore, hasPassed: mocks.hasPassed },
}));
vi.mock("./ai/antigravityEvidenceStore", () => ({ readAntigravityEvidence: () => mocks.readEvidence() }));
vi.mock("./ai/antigravityProcess", () => ({ runAntigravityProcess: (...args: unknown[]) => mocks.runProcess(...args) }));
vi.mock("./ai/antigravityArtifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/antigravityArtifacts")>();
  return { ...actual, validateAntigravityImage: (...args: unknown[]) => mocks.validateImage(...args) };
});
vi.mock("./assets/localAssetFile", () => ({
  readNomiLocalAsset: (...args: unknown[]) => mocks.readLocal(...args),
  postJsonForAssetUpload: vi.fn(), postMultipartForAssetUpload: vi.fn(),
}));
vi.mock("./hardenedFetch", () => ({ hardenedFetch: (...args: unknown[]) => mocks.fetch(...args) }));
vi.mock("./events/vendorCallTrace", () => ({
  traceVendorRequested: (...args: unknown[]) => mocks.requested(...args),
  traceVendorCompleted: (...args: unknown[]) => mocks.completed(...args),
}));
vi.mock("./tasks/taskAdmission", () => ({
  markTaskAdmitted: (...args: unknown[]) => mocks.admitted(...args), wasTaskAdmitted: () => false,
}));

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5foAAAAASUVORK5CYII=", "base64");
const preparedCli = {
  discovery: { version: "1.1.21", models: [] }, invocation: { command: "/probe/A/agy", args: [] }, env: {},
  identity: { realpath: "/probe/A/agy", dev: "1", ino: "2", size: "3", mtimeNs: "4", ctimeNs: "5" },
};

async function writeCatalog() {
  const [{ antigravityImageMappings }, { CURRENT_CATALOG_VERSION }] = await Promise.all([
    import("./catalog/antigravityCatalog"), import("./catalog/types"),
  ]);
  const status = { state: "ready" as const, version: "1.1.21", checkedAt: Date.now(), loginCommand: "agy", models: [],
    checks: [{ capability: "edit" as const, modelId: "auto", state: "passed" as const, version: "1.1.21", checkedAt: Date.now() }] };
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify({
    version: CURRENT_CATALOG_VERSION,
    vendors: [{ key: "antigravity-cli", name: "Antigravity CLI", authType: "none", enabled: true, baseUrlHint: "local://antigravity" }],
    models: [{ vendorKey: "antigravity-cli", modelKey: "generate_image", labelZh: "Antigravity image", kind: "image", enabled: true,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }],
    mappings: [antigravityImageMappings(status)[1]], apiKeysByVendor: {},
  }), "utf8");
}

async function request(grantId: string, referenceImages: string[]) {
  const { runTask } = await import("./runtime");
  return runTask({ vendor: "antigravity-cli", request: { kind: "image_edit", prompt: "edit once",
    extras: { modelKey: "generate_image", projectId: "project", nodeId: "node", grantId, referenceImages } } });
}

describe("runTask Antigravity media preflight", () => {
  beforeEach(async () => {
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-runtime-antigravity-media-"));
    vi.resetModules(); vi.restoreAllMocks(); vi.clearAllMocks();
    mocks.prepareCli.mockResolvedValue(preparedCli); mocks.hasPassed.mockReturnValue(true); mocks.readEvidence.mockReturnValue([]);
    mocks.readLocal.mockReturnValue({ bytes: png, contentType: "image/png" });
    mocks.validateImage.mockResolvedValue({ mimeType: "image/png", extension: "png", width: 1, height: 1 });
    mocks.runProcess.mockResolvedValue({ text: "done", conversationId: "c", usage: {}, artifacts: [] });
    await writeCatalog();
  });
  afterEach(async () => {
    (await import("./spendGrant")).__resetSpendGrantsForTests();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  it.each([
    ["file URL", ["file:///private/secret.png"], undefined],
    ["missing local asset", ["nomi-local://asset/project/missing.png"], null],
    ["more than four images", Array(5).fill("nomi-local://asset/project/ref.png"), undefined],
    ["malformed data URL", ["data:image/png;base64,%%"], undefined],
  ] as const)("rejects %s before spend, local job, trace, admission, or queued response", async (_name, refs, localResult) => {
    if (localResult === null) mocks.readLocal.mockReturnValueOnce(null);
    const jobs = await import("./tasks/localTaskJobs");
    const start = vi.spyOn(jobs.LocalTaskJobs.prototype, "start");
    const spend = await import("./spendGrant");
    const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
    await expect(request(grantId, [...refs])).rejects.toThrow(/ANTIGRAVITY_(IMAGE_SOURCE_INVALID|INVALID_IMAGES)/);
    expect(spend.__spendGrantCountForTests()).toBe(1);
    expect(start).not.toHaveBeenCalled(); expect(mocks.runProcess).not.toHaveBeenCalled();
    expect(mocks.requested).not.toHaveBeenCalled(); expect(mocks.admitted).not.toHaveBeenCalled();
  });

  it("rejects a local reader failure before every paid or queued side effect", async () => {
    mocks.readLocal.mockImplementationOnce(() => { throw new Error("local read failed"); });
    const jobs = await import("./tasks/localTaskJobs");
    const start = vi.spyOn(jobs.LocalTaskJobs.prototype, "start");
    const spend = await import("./spendGrant");
    const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
    await expect(request(grantId, ["nomi-local://asset/project/ref.png"])).rejects.toThrow("local read failed");
    expect(spend.__spendGrantCountForTests()).toBe(1);
    expect(start).not.toHaveBeenCalled(); expect(mocks.runProcess).not.toHaveBeenCalled();
    expect(mocks.requested).not.toHaveBeenCalled(); expect(mocks.admitted).not.toHaveBeenCalled();
  });

  it("rejects syntactically valid data whose decoded image is invalid before every side effect", async () => {
    mocks.validateImage.mockRejectedValueOnce(new Error("ANTIGRAVITY_IMAGE_INVALID"));
    const jobs = await import("./tasks/localTaskJobs");
    const start = vi.spyOn(jobs.LocalTaskJobs.prototype, "start");
    const spend = await import("./spendGrant");
    const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
    await expect(request(grantId, ["data:image/png;base64,AAAA"])).rejects.toThrow("ANTIGRAVITY_IMAGE_INVALID");
    expect(spend.__spendGrantCountForTests()).toBe(1);
    expect(start).not.toHaveBeenCalled(); expect(mocks.runProcess).not.toHaveBeenCalled();
    expect(mocks.requested).not.toHaveBeenCalled(); expect(mocks.admitted).not.toHaveBeenCalled();
  });

  it.each([
    ["same-count replacement", ["nomi-local://asset/project/a.png", "nomi-local://asset/project/b.png"],
      ["nomi-local://asset/project/a.png", "nomi-local://asset/project/c.png"]],
    ["reordering", ["nomi-local://asset/project/a.png", "nomi-local://asset/project/b.png"],
      ["nomi-local://asset/project/b.png", "nomi-local://asset/project/a.png"]],
  ])("rejects %s after media preflight before spend, job, trace, admission, or queued response",
    async (_name, initial, mutated) => {
      const refs = [...initial];
      mocks.prepareCli.mockImplementationOnce(async () => { refs.splice(0, refs.length, ...mutated); return preparedCli; });
      const jobs = await import("./tasks/localTaskJobs");
      const start = vi.spyOn(jobs.LocalTaskJobs.prototype, "start");
      const spend = await import("./spendGrant");
      const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
      await expect(request(grantId, refs)).rejects.toThrow("ANTIGRAVITY_PREFLIGHT_MISMATCH");
      expect(spend.__spendGrantCountForTests()).toBe(1);
      expect(start).not.toHaveBeenCalled(); expect(mocks.runProcess).not.toHaveBeenCalled();
      expect(mocks.requested).not.toHaveBeenCalled(); expect(mocks.admitted).not.toHaveBeenCalled();
    });

  it.each([
    ["local", "nomi-local://asset/project/ref.png"],
    ["data", `data:image/png;base64,${png.toString("base64")}`],
  ])("materializes and validates one %s image before spend, then reuses its bytes in the job", async (source, url) => {
    const jobs = await import("./tasks/localTaskJobs");
    const { prepareAntigravityMedia } = await import("./ai/antigravityMedia");
    const start = vi.spyOn(jobs.LocalTaskJobs.prototype, "start");
    const spend = await import("./spendGrant");
    let grantsAtRead = -1;
    let stagedBytes: Buffer | undefined;
    mocks.readLocal.mockImplementation(() => {
      grantsAtRead = spend.__spendGrantCountForTests();
      return { bytes: png, contentType: "image/png" };
    });
    mocks.runProcess.mockImplementationOnce(async (input: { capability: "edit" }, options: { preparedImages: never[] }) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-agy-prepared-media-"));
      try { stagedBytes = (await prepareAntigravityMedia(cwd, input.capability, options.preparedImages)).snapshots[0].bytes; }
      finally { fs.rmSync(cwd, { recursive: true, force: true }); }
      return { text: "done", conversationId: "c", usage: {}, artifacts: [] };
    });
    const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
    await expect(request(grantId, [url])).resolves.toMatchObject({ status: "queued" });
    await vi.waitFor(() => { expect(mocks.runProcess).toHaveBeenCalledOnce(); expect(stagedBytes).toBeDefined(); });
    if (source === "local") {
      expect(mocks.readLocal).toHaveBeenCalledOnce(); expect(grantsAtRead).toBe(1);
      expect(mocks.readLocal.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
    } else expect(mocks.readLocal).not.toHaveBeenCalled();
    expect(mocks.validateImage).toHaveBeenCalledOnce();
    expect(mocks.runProcess).toHaveBeenCalledWith(expect.objectContaining({ prompt: "edit once", capability: "edit" }),
      expect.objectContaining({ preparedImages: [expect.any(Object)] }));
    expect(stagedBytes).toEqual(png); expect(stagedBytes).not.toBe(png);
    expect(spend.__spendGrantCountForTests()).toBe(0);
    expect(start).toHaveBeenCalledOnce(); expect(mocks.requested).toHaveBeenCalledOnce(); expect(mocks.admitted).toHaveBeenCalledOnce();
  });
});
