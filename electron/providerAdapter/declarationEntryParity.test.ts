/**
 * 同一份调用方式，从三条真实入口进来，结论必须一样。
 *
 * 三条路：① 设置向导 / 旧会话恢复 —— `ProviderAdapterService.start` 带卡（卡落在 run 的边表里，
 * process 读它）；② 外部助手的接入会话 —— `IntegrationSessionService.propose` 收卡、`start` 交给 ①；
 * ③ 外部助手整卡提交 —— `submitDeclaration`。这里不直接调校验器，也不拿同一个对象喂两个消费者：
 * 每条路都从自己的入口吃同一份 JSON。
 *
 * 判据两条：同一份声明从哪条路进来结果都一样；不放行发不出请求的声明。
 * 有意保留的差异不在这里比：会话路不收纯文本卡（文本不需要卡）；文本条目在认证路上统一走原生通道。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import type { ProviderAdapterDraft } from "./types";
import { ProviderAdapterStore } from "./store";
import { ProviderAdapterService, type ProviderAdapterCatalogPort, type ProviderAdapterServiceDependencies } from "./service";
import { verifyAdapterMode } from "./verifier";
import { checkAdapterModeContract } from "./selfCheck";
import { IntegrationSessionService } from "../integrationCertification/integrationSession";
import { submitDeclaration } from "../capabilityCore/modelOnboarding/submitDeclaration";
import { readCatalog } from "../catalog/catalogStore";

const BASE = "http://127.0.0.1:9000";
const DOC = "https://docs.example.test/api";
const now = "2026-11-17T00:00:00.000Z";
const dirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
beforeEach(() => {
  vi.stubEnv("NOMI_SETTINGS_DIR", tempDir("nomi-parity-settings-"));
  vi.stubEnv("NOMI_CAPABILITY_DIR", tempDir("nomi-parity-cap-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Card = ProviderAdapterDraft & { assetIngestion?: unknown };
type CardModel = ProviderAdapterDraft["models"][number];

function imageModel(): CardModel {
  return {
    modelKey: "paint-x",
    labelZh: "Paint X",
    kind: "image",
    modes: [{
      taskKind: "text_to_image",
      create: { method: "POST", path: "/vendor-image", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { image_url: "data.0.url" } },
      sourceUrls: [DOC],
    }],
  };
}

function card(models: CardModel[] = [imageModel()]): Card {
  return {
    provider: { baseUrl: BASE, authType: "bearer" },
    sources: [{ url: DOC, evidence: "POST /vendor-image returns data[0].url" }],
    assetIngestion: { strategy: "none", sourceUrl: DOC },
    models,
  } as Card;
}

type Verdict = { accepted: boolean; error?: string; modes?: Record<string, string>; contract?: "passed" | "defects" };

// ③ 整卡提交
async function viaSubmit(input: Card): Promise<Verdict> {
  const reply = await submitDeclaration({ name: "parity", declaration: JSON.stringify(input) }) as Record<string, unknown>;
  if (reply.ok !== true) {
    const rejections = (reply.rejections as Array<{ path: string; code: string; message: string }> | undefined) || [];
    return { accepted: false, error: [reply.message, ...rejections.map((r) => `${r.code} ${r.path} ${r.message}`)].join(" | ") };
  }
  const state = reply.state as { vendorKey: string; selfCheck: { contract: "passed" | "defects" } };
  const mappings = readCatalog().mappings.filter((row) => row.vendorKey === state.vendorKey);
  return {
    accepted: true,
    contract: state.selfCheck.contract,
    modes: Object.fromEntries(mappings.map((row) => [row.taskKind, `${row.create?.method} ${row.create?.path}`])),
  };
}

function fakeCatalog(models: ReadonlyArray<Pick<Model, "modelKey" | "labelZh" | "kind">>, vendorMeta?: Record<string, unknown>) {
  const vendor: Vendor = { key: "relay-local", name: "Relay", enabled: false, baseUrlHint: BASE, authType: "bearer", ...(vendorMeta ? { meta: vendorMeta } : {}), createdAt: now, updatedAt: now };
  const rows: Model[] = models.map((model) => ({ vendorKey: vendor.key, ...model, modelAlias: (model as Model).modelAlias, enabled: false, createdAt: now, updatedAt: now }));
  const catalog: ProviderAdapterCatalogPort & { promoted: ProviderAdapterDraft[]; failed: string[] } = {
    promoted: [],
    failed: [],
    register: (input) => ({ vendor, models: rows.filter((row) => input.models.some((m) => m.modelKey === row.modelKey)) }),
    stage: () => ({ vendor, models: rows, lineageRootVendorKey: vendor.key, supersededVendorKeys: [] }),
    findStagedRun: () => ({ vendorKey: vendor.key, lineageRootVendorKey: vendor.key }),
    load: (_vendorKey, selected) => ({ vendor, models: rows.filter((row) => selected.includes(row.modelKey)), apiKey: "sk-loopback" }),
    promote(input) {
      catalog.promoted.push(input.draft);
      return { status: "committed", committedModes: input.verifiedModes };
    },
    fail(run) { catalog.failed.push(run.id); },
  };
  return catalog;
}

function service(catalog: ReturnType<typeof fakeCatalog>): { service: ProviderAdapterService; store: ProviderAdapterStore } {
  const store = new ProviderAdapterStore(path.join(tempDir("nomi-parity-adapter-"), "provider-adapters.json"));
  const deps: ProviderAdapterServiceDependencies = {
    catalog,
    schedule: () => {},
    discover: async () => ({ sources: [], corpus: "" }),
    resolveLanguageModels: () => [],
    compile: async () => { throw new Error("parity runs never compile"); },
    probeCredential: async () => ({ ok: true as const, modelIds: [], listed: false }),
    // 真实的自检（形状判据），只把凭据探测换成免费假答复。
    verify: (input) => verifyAdapterMode({ ...input, credential: { ok: true, modelIds: [], listed: false } }),
    now: () => now,
    id: () => `run-${Math.random().toString(36).slice(2)}`,
  };
  return { service: new ProviderAdapterService(store, deps), store };
}

type StartModel = { modelKey: string; labelZh: string; kind: CardModel["kind"]; modelAlias?: string };

// ① 认证 run（设置向导、会话交来的卡、旧会话恢复都落在这里）
async function viaCertification(models: StartModel[], adapterDraft?: unknown, vendorMeta?: Record<string, unknown>): Promise<Verdict & { draft?: ProviderAdapterDraft }> {
  const catalog = fakeCatalog(models, vendorMeta);
  const { service: adapter, store } = service(catalog);
  const run = await adapter.start({
    vendorName: "Relay",
    baseUrl: BASE,
    apiKey: "sk-loopback",
    authType: "bearer",
    providerKind: "openai-compatible",
    headers: {},
    models: models.map(({ modelKey, labelZh, kind }) => ({ modelKey, labelZh, kind })),
    ...(adapterDraft ? { adapterDraft: adapterDraft as ProviderAdapterDraft } : {}),
    certification: { contractDigest: "0".repeat(64), idempotencyKey: `parity-${Math.random()}`, remoteIdempotency: "unknown" },
  });
  await adapter.executeRun(run.id);
  const final = store.getRun(run.id)!;
  const draft = catalog.promoted[0];
  if (!draft) {
    const modeErrors = final.models.flatMap((model) => model.modes.map((mode) => `${model.modelKey}/${mode.taskKind}: ${mode.error || mode.state}`));
    return { accepted: false, error: [final.error || final.stage, ...modeErrors].join(" | ") };
  }
  const failedContract = final.models.some((model) => model.modes.some((mode) => mode.state === "failed"));
  return {
    accepted: true,
    draft,
    contract: failedContract ? "defects" : "passed",
    modes: Object.fromEntries(draft.models.filter((m) => m.kind !== "text").flatMap((m) => m.modes.map((mode) => [mode.taskKind, `${mode.create.method} ${mode.create.path}`]))),
  };
}

// ② 接入会话：propose 收卡，start 把会话里锁好身份的卡交给 ①
async function viaSession(input: Card): Promise<Verdict> {
  const started: Array<Record<string, unknown>> = [];
  const sessions = new IntegrationSessionService({
    filePath: path.join(tempDir("nomi-parity-session-"), "sessions.json"),
    certification: { startHttp: vi.fn(async (input: { connection: Record<string, unknown> }) => { started.push(input.connection); return { id: "child", stage: "completed", childRunRef: { runId: "child", revisionDigest: "c".repeat(64) } }; }) } as never,
    credentialResolver: () => "sk-loopback",
    compilerAvailable: () => false,
    save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    enqueueHandoff: () => undefined,
  });
  const session = sessions.begin({ kind: "http-api-provider", name: "Relay", baseUrl: BASE }, "codex");
  const ready = sessions.markCredentialReady(session.id, "opaque", "codex");
  const { provider: _provider, ...supplied } = input;
  let proposed;
  try {
    proposed = await sessions.propose(session.id, ready.revision, "codex", {
      candidates: input.models.map((m) => ({ modelKey: m.modelKey, kind: m.kind })),
      selections: input.models.map((m) => ({ modelKey: m.modelKey })),
      adapterDraft: JSON.stringify(supplied),
    });
  } catch (error) {
    return { accepted: false, error: error instanceof Error ? error.message : String(error) };
  }
  const after = await sessions.start(session.id, proposed.revision, "codex", "parity-start");
  if (!started[0]) return { accepted: false, error: `session did not start: ${JSON.stringify(after)}` };
  const connection = started[0] as { models: StartModel[]; adapterDraft?: unknown };
  const verdict = await viaCertification(connection.models.map((m) => ({ ...m, labelZh: m.labelZh || m.modelKey })), connection.adapterDraft);
  delete (verdict as { draft?: unknown }).draft;
  return verdict;
}

async function allThree(input: Card) {
  const [certified, session, submitted] = [
    await viaCertification(input.models.map(({ modelKey, labelZh, kind }) => ({ modelKey, labelZh, kind })), input),
    await viaSession(input),
    await viaSubmit(input),
  ];
  delete (certified as { draft?: unknown }).draft;
  return { certified, session, submitted };
}

function expectSameAcceptance(results: Awaited<ReturnType<typeof allThree>>, accepted: boolean, errorPattern?: RegExp) {
  for (const [entry, verdict] of Object.entries(results)) {
    expect(verdict.accepted, `${entry}: ${JSON.stringify(verdict)}`).toBe(accepted);
    if (errorPattern) expect(verdict.error, entry).toMatch(errorPattern);
  }
}

describe("同一份调用方式，三条入口结论一致", () => {
  it("合格卡：三条路都收，最终 create 路径逐字相同（U1：私网主机上交了卡就用卡）", async () => {
    const results = await allThree(card());
    expectSameAcceptance(results, true);
    expect(results.certified.modes).toEqual({ text_to_image: "POST /vendor-image" });
    expect(results.session.modes).toEqual(results.certified.modes);
    expect(results.submitted.modes).toEqual(results.certified.modes);
    expect([results.certified.contract, results.session.contract, results.submitted.contract]).toEqual(["passed", "passed", "passed"]);
  });

  it("U4：改图漏 referenceShape —— 三条路都在同一字段拒，自检对同一模式也说缺参考槽", async () => {
    const model = imageModel();
    model.modes.push({ taskKind: "image_edit", create: { method: "POST", path: "/vendor-edit", body: { image: "{{request.params.reference_images}}" }, response_mapping: { image_url: "data.0.url" } }, referenceParam: "reference_images", sourceUrls: [DOC] });
    expectSameAcceptance(await allThree(card([model])), false, /referenceShape/);
    // 收件处先拒了，三条路走不到自检；自检单独对同一模式也得给同一个结论（它只转述校验器）。
    const catalogModel = { vendorKey: "relay", modelKey: model.modelKey, labelZh: model.labelZh, kind: "image", enabled: true, createdAt: now, updatedAt: now } as Model;
    expect(checkAdapterModeContract(catalogModel, model.modes[1])).toMatchObject({ ok: false, reason: "reference_slot_missing", error: expect.stringMatching(/referenceShape/) });
  });

  it("U5：image_to_prompt 没有参考槽 —— 认证与整卡提交都收，自检都说站得住", async () => {
    const vision: CardModel = { modelKey: "see-x", labelZh: "See X", kind: "text", modes: [{ taskKind: "image_to_prompt", create: { method: "POST", path: "/v1/chat/completions", body: { model: "{{model.modelKey}}" }, response_mapping: { text: "choices.0.message.content" } }, sourceUrls: [DOC] }] };
    const input = card([vision]);
    const certified = await viaCertification([{ modelKey: "see-x", labelZh: "See X", kind: "text" }], input);
    const submitted = await viaSubmit(input);
    expect(certified).toMatchObject({ accepted: true, contract: "passed" });
    expect(submitted).toMatchObject({ accepted: true, contract: "passed" });
  });

  it("U6：image_to_audio —— Nomi 投不成产品能力，三条路都在收件处拒，目录不写", async () => {
    const model: CardModel = { modelKey: "voice-x", labelZh: "Voice X", kind: "audio", modes: [{ taskKind: "image_to_audio", create: { method: "POST", path: "/vendor-audio", body: { image: "{{request.params.reference_images}}" }, response_mapping: { audio_url: "data.url" } }, referenceParam: "reference_images", referenceShape: "array", sourceUrls: [DOC] }] };
    const results = await allThree(card([model]));
    expectSameAcceptance(results, false, /image_to_audio/);
    expect(results.submitted.error).toMatch(/declaration_rejected|rejected the declaration/i);
    expect(readCatalog().models.filter((row) => row.modelKey === "voice-x")).toEqual([]);
  });

  it("U7：外部卡省了 assetIngestion —— 三条路都拒，拒绝句带字段路径和合法取值", async () => {
    const input = card();
    delete input.assetIngestion;
    const results = await allThree(input);
    expectSameAcceptance(results, false, /assetIngestion/);
    for (const verdict of Object.values(results)) expect(verdict.error).toMatch(/upload_strategy_unsupported/);
    for (const verdict of Object.values(results)) expect(verdict.error).toMatch(/none.*inline-base64.*upload-url/s);
  });

  it("U8：参数键写成线缆名 seconds —— 三条路都在同一字段拒，给出可照做的中性键", async () => {
    const video: CardModel = {
      modelKey: "clip-x", labelZh: "Clip X", kind: "video",
      parameters: [{ key: "seconds", label: "Seconds", type: "number", default: 5 }],
      modes: [{ taskKind: "text_to_video", create: { method: "POST", path: "/vendor-video", body: { prompt: "{{request.prompt}}", seconds: "{{request.params.seconds}}" }, response_mapping: { video_url: "data.url" } }, sourceUrls: [DOC] }],
    };
    expectSameAcceptance(await allThree(card([video])), false, /parameters\.seconds.*duration/);
  });
});

describe("设置向导：没有卡时标准模板保住模型的完整身份", () => {
  it("U2：私网中转的不透明 id + 别名 gpt-image-2 —— 改图走 multipart /v1/images/edits", async () => {
    const result = await viaCertification([{ modelKey: "custom-1", labelZh: "Custom 1", kind: "image", modelAlias: "gpt-image-2" }]);
    expect(result.accepted).toBe(true);
    const edit = result.draft!.models.find((m) => m.modelKey === "custom-1")!.modes.find((mode) => mode.taskKind === "image_edit")!;
    expect(edit.create.path).toBe("/v1/images/edits");
    expect(edit.create.multipart).toBeTruthy();
  });

  it("U3：私网中转写明 openai-videos-v1 —— 文生视频有 create / query / result", async () => {
    const result = await viaCertification([{ modelKey: "sora-x", labelZh: "Sora X", kind: "video" }], undefined, { mediaProtocols: ["openai-videos-v1"] });
    expect(result.accepted, JSON.stringify(result)).toBe(true);
    const mode = result.draft!.models.find((m) => m.modelKey === "sora-x")!.modes.find((m) => m.taskKind === "text_to_video")!;
    expect(mode.query).toBeTruthy();
    expect(mode.result).toBeTruthy();
  });

  it("没交卡的私网主机仍用内置模板（不是交了卡才有的路）", async () => {
    const result = await viaCertification([{ modelKey: "paint-x", labelZh: "Paint X", kind: "image" }]);
    expect(result.accepted).toBe(true);
    expect(result.modes?.text_to_image).not.toBe("POST /vendor-image");
  });
});
