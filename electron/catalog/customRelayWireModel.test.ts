// 自定义中转的线上 model 串：**最终报文**里必须是连接契约约定的那个名字（2026-10-16，两位用户 0.23.1 反馈：
// 中转回「No available channel for model gpt-image-2-…-text-to-image」）。
//
// 断言纪律：不断言档案产出什么，只断言「用户配的模型名 + 不同档案 / 模式 / 变体 / 连接」走完真实入口之后，
// 渲染出来的 body（或 multipart 字段）里的 model。入口按 door-map 数全：
//   · 画布 UI：渲染层 buildCatalogTaskRequest → 主进程 buildProfileHttpRequest / runMultipartProfileOperation；
//   · headless / MCP（引擎 A）：applyHeadlessParamDefaults → buildProfileHttpRequest；
//   · Agent 付款卡 / 全自动 Run（引擎 B）：createCatalogGenerationProvider.buildRequest；
//   · 自定义调用脚本：taskTemplateParams 交给脚本的 params。
// 正向对照：内置目录（登记表盖章的 kie 契约）仍按模式发它自己的拆分名，证明不是一刀切掉了模式线上名。
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-custom-relay-wire-model", getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  webContents: { getAllWebContents: () => [] },
}));

import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import type { GenerationCanvasNode } from "../../src/workbench/generationCanvas/model/generationCanvasTypes";
import { buildProfileHttpRequest } from "./profileHttpRequest";
import { runMultipartProfileOperation } from "./multipartOperation";
import { applyHeadlessParamDefaults, taskTemplateParams } from "./taskParams";
import {
  NEWAPI_IMAGE_CREATE_OP,
  NEWAPI_IMAGE_EDIT_OP,
  NEWAPI_VIDEO_CREATE_OP,
  OPENAI_MULTIPART_IMAGE_EDIT_OP,
  XAI_JSON_IMAGE_EDIT_OP,
} from "./newapiTransport";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { createCatalogGenerationProvider } from "../capabilityCore/apimartGenerationProvider";
import type { CatalogState, HttpOperation, Mapping, Model, Vendor } from "./types";
import type { TaskRequest } from "../runtime";
import { wireReferencedParamKeys } from "./paramTranslate";
import { operationSelectsArchetypeWireModel } from "../shared/modelArchetypes/wireModelIdentity";
import { builtinVendorSeed } from "./builtinVendorSeeds";
import { getArchetypeById } from "../shared/modelArchetypes";
import fs from "node:fs";
import path from "node:path";

const RELAY_KEY = "gw-relay-example-com";
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function relayVendor(): Vendor {
  return { key: RELAY_KEY, name: "My relay", enabled: true, baseUrlHint: "http://127.0.0.1:9", authType: "bearer", createdAt: "now", updatedAt: "now" } as Vendor;
}

function relayModel(modelKey: string, kind: Model["kind"], extra: Partial<Model> = {}): Model {
  return { modelKey, vendorKey: RELAY_KEY, labelZh: modelKey, kind, enabled: true, createdAt: "now", updatedAt: "now", ...extra } as Model;
}

function node(kind: "image" | "video", meta: Record<string, unknown>): GenerationCanvasNode {
  return { id: `node-${kind}`, kind, title: "", prompt: "a red paper crane", position: { x: 0, y: 0 }, meta } as GenerationCanvasNode;
}

/** 画布 UI 那条路：渲染层真构造 → 主进程真渲染。 */
function uiRequest(modelKey: string, kind: "image" | "video", archetype: Record<string, unknown>, references: Record<string, unknown> = {}): TaskRequest {
  const built = buildCatalogTaskRequest(node(kind, { modelKey, modelVendor: RELAY_KEY, archetype }), { references: references as never });
  return built.request as unknown as TaskRequest;
}

function jsonBodyModel(request: TaskRequest, model: Model, operation: HttpOperation): unknown {
  const built = buildProfileHttpRequest({ vendor: relayVendor(), model, apiKey: "sk-test", request, operation });
  return (built.body as Record<string, unknown>).model;
}

async function multipartModel(request: TaskRequest, model: Model): Promise<unknown> {
  let sent: FormData | null = null;
  await runMultipartProfileOperation(
    { vendor: relayVendor(), model, apiKey: "sk-test", request, operation: OPENAI_MULTIPART_IMAGE_EDIT_OP },
    async (_url, _headers, _query, form) => {
      sent = form;
      return { data: [{ url: "https://relay.test/out.png" }] };
    },
  );
  return (sent as FormData | null)?.get("model");
}

describe("自定义中转 · 画布 UI 入口：最终报文的 model 是用户配的模型名", () => {
  it.each([
    ["gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst"],
    ["gpt-image-2", "gpt-image-2"],
  ])("文生图 %s：报文 model 不被档案的拆分线上名盖掉", (modelKey, archetypeId) => {
    const request = uiRequest(modelKey, "image", { id: archetypeId, modeId: "t2i" });
    expect(request.kind).toBe("text_to_image");
    expect(jsonBodyModel(request, relayModel(modelKey, "image"), NEWAPI_IMAGE_CREATE_OP)).toBe(modelKey);
  });

  it("连接配了别名：发的是别名（与 {{model.modelKey}} 同一个表达式）", () => {
    const request = uiRequest("gpt-image-2.5-sunburst", "image", { id: "gpt-image-2.5-sunburst", modeId: "t2i" });
    const model = relayModel("gpt-image-2.5-sunburst", "image", { modelAlias: "sunburst-relay-alias" });
    expect(jsonBodyModel(request, model, NEWAPI_IMAGE_CREATE_OP)).toBe("sunburst-relay-alias");
  });

  it.each([
    ["chat/completions", NEWAPI_IMAGE_EDIT_OP],
    ["xAI JSON edits", XAI_JSON_IMAGE_EDIT_OP],
  ])("改图（%s）：报文 model 是用户配的模型名", (_label, operation) => {
    const request = uiRequest("gpt-image-2.5-sunburst", "image", { id: "gpt-image-2.5-sunburst", modeId: "i2i" }, { referenceImages: [PNG_DATA_URL] });
    expect(request.kind).toBe("image_edit");
    expect(jsonBodyModel(request, relayModel("gpt-image-2.5-sunburst", "image"), operation)).toBe("gpt-image-2.5-sunburst");
  });

  it("改图（OpenAI multipart edits）：表单里的 model 字段是用户配的模型名", async () => {
    const request = uiRequest("gpt-image-2", "image", { id: "gpt-image-2", modeId: "i2i" }, { referenceImages: [PNG_DATA_URL] });
    expect(await multipartModel(request, relayModel("gpt-image-2", "image"))).toBe("gpt-image-2");
  });

  it("视频（带变体的档案、选了「快速」）：报文 model 仍是用户配的模型名，不是 kie 的变体串", () => {
    const request = uiRequest("seedance-2", "video", { id: "seedance-2", modeId: "t2v", variantId: "fast" });
    expect(jsonBodyModel(request, relayModel("seedance-2", "video"), NEWAPI_VIDEO_CREATE_OP)).toBe("seedance-2");
  });
});

describe("自定义中转 · headless / MCP 入口（引擎 A 缺参兜底之后）", () => {
  it.each([
    ["gpt-image-2.5-sunburst", "text_to_image", "image", NEWAPI_IMAGE_CREATE_OP],
    ["seedance-2", "image_to_video", "video", NEWAPI_VIDEO_CREATE_OP],
  ] as const)("%s：目录行带 archetypeId 时，兜底默认值也不许把 model 换成档案名", (modelKey, taskKind, kind, operation) => {
    const model = relayModel(modelKey, kind, { meta: { archetypeId: modelKey } });
    const extras = applyHeadlessParamDefaults({ modelKey }, modelKey, taskKind, RELAY_KEY, operation.defaultParams, operation.body, modelKey);
    const request = { kind: taskKind, prompt: "a red paper crane", extras } as TaskRequest;
    expect(jsonBodyModel(request, model, operation)).toBe(modelKey);
  });
});

describe("自定义中转 · 自定义调用脚本入口", () => {
  it("脚本拿到的 params.model 是连接的模型名", () => {
    const request = uiRequest("gpt-image-2.5-sunburst", "image", { id: "gpt-image-2.5-sunburst", modeId: "t2i" });
    // 自定义脚本那条路拿到的是这个模型在该桶上的 mapping op（中转 op 没有收档案名的声明）。
    const params = taskTemplateParams(request, {
      vendorKey: RELAY_KEY,
      modelKey: "gpt-image-2.5-sunburst",
      operation: NEWAPI_IMAGE_CREATE_OP,
    });
    expect(params.model).toBe("gpt-image-2.5-sunburst");
  });
});

function relayCatalog(modelKey: string, kind: "image" | "video", taskKind: Mapping["taskKind"], create: HttpOperation): CatalogState {
  const adapter = { state: "verified", activeRevision: "fixture", modes: [{ taskKind, state: "verified" }] };
  return {
    version: 11,
    vendors: [relayVendor()],
    models: [relayModel(modelKey, kind, { meta: { archetypeId: modelKey, adapter } })],
    mappings: [{ id: `${RELAY_KEY}-${taskKind}`, vendorKey: RELAY_KEY, modelKey, taskKind, name: "relay", enabled: true, create, createdAt: "now", updatedAt: "now" } as Mapping],
    apiKeysByVendor: {},
  } as unknown as CatalogState;
}

function engineBInput(modelId: string, mode: string, extra: Record<string, unknown> = {}) {
  return {
    moduleId: "generation.single-shot", providerId: RELAY_KEY, modelId, mode, prompt: "a red paper crane",
    parameters: {}, references: [], contractHash: "a".repeat(64), idempotencyKey: "k", requestFingerprint: "b".repeat(64),
    executionBinding: {
      immutableProjectUuid: "p", projectGeneration: 1, runId: "r", shotId: "s", contractHash: "a".repeat(64), runtimeTaskId: "t",
      providerNamespace: RELAY_KEY, providerIdempotencyKey: "k", requestFingerprint: "b".repeat(64), runtimeEnvelopeRef: ".nomi/runs/r/runtime.json", fencingEpoch: 1,
    },
    ...extra,
  };
}

describe("自定义中转 · Agent 付款卡 / 全自动 Run 入口（引擎 B）", () => {
  it("文生图：报文 model 是用户配的模型名", () => {
    const state = relayCatalog("gpt-image-2.5-sunburst", "image", "text_to_image", NEWAPI_IMAGE_CREATE_OP);
    const provider = createCatalogGenerationProvider({ vendorKey: RELAY_KEY, resolveConnection: () => ({ apiKey: "k" }), catalogReader: () => state, initialState: state });
    const body = provider.buildRequest(engineBInput("gpt-image-2.5-sunburst", "text_to_image", { modeId: "t2i" }) as never) as Record<string, unknown>;
    expect(body.model).toBe("gpt-image-2.5-sunburst");
  });

  it("视频：宿主封进合同的变体 / 模式不许改写中转的模型名", () => {
    const state = relayCatalog("seedance-2", "video", "text_to_video", NEWAPI_VIDEO_CREATE_OP);
    const provider = createCatalogGenerationProvider({ vendorKey: RELAY_KEY, resolveConnection: () => ({ apiKey: "k" }), catalogReader: () => state, initialState: state });
    const body = provider.buildRequest(engineBInput("seedance-2", "text_to_video", {
      modeId: "t2v", variantId: "fast", transportModelId: "bytedance/seedance-2-fast",
    }) as never) as Record<string, unknown>;
    expect(body.model).toBe("seedance-2");
  });
});

describe("正向对照：内置目录契约仍按模式发自己的拆分名", () => {
  const seeded = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState, "now").state;
  const kieVendor = seeded.vendors.find((vendor) => vendor.key === "kie")!;
  const kieMapping = (taskKind: Mapping["taskKind"]) => seeded.mappings.find((mapping) => mapping.id === `seed-kie-gpt-image-2-${taskKind}`)!;
  it.each([
    ["t2i", "text_to_image", "gpt-image-2-text-to-image"],
    ["i2i", "image_edit", "gpt-image-2-image-to-image"],
  ] as const)("kie GPT Image 2 %s → %s", (modeId, taskKind, expected) => {
    const mapping = kieMapping(taskKind);
    const row = seeded.models.find((model) => model.vendorKey === "kie" && model.modelKey === "gpt-image-2-text-to-image")!;
    const request = buildCatalogTaskRequest(
      node("image", { modelKey: row.modelKey, modelVendor: "kie", archetype: { id: "gpt-image-2", modeId } }),
      { references: (taskKind === "image_edit" ? { referenceImages: [PNG_DATA_URL] } : {}) as never },
    ).request as unknown as TaskRequest;
    const built = buildProfileHttpRequest({ vendor: kieVendor, model: row, apiKey: "k", request, operation: mapping.create });
    expect((built.body as Record<string, unknown>).model).toBe(expected);
  });
});

describe("类检查：谁有资格收档案线上名（普查真实内置目录 + 全部中转报文）", () => {
  const seeded = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState, "now").state;

  /** 这条 mapping 服务的模型里，有没有档案带「模式线上名 / 变体」——只有这种才需要声明。 */
  const servesNamedArchetype = (mapping: Mapping) => seeded.models
    .filter((model) => model.vendorKey === mapping.vendorKey && (!mapping.modelKey || model.modelKey === mapping.modelKey))
    .some((model) => {
      const archetype = getArchetypeById(String((model.meta as { archetypeId?: unknown } | undefined)?.archetypeId ?? ""));
      return Boolean(archetype && ((archetype.variants?.length ?? 0) > 0 || archetype.modes.some((mode) => mode.modelEnum)));
    });

  it("内置目录里引用 params.model、且服务带模式线上名 / 变体档案的 create op 都声明了（漏了就发连接名、拆 id 的模式全坏）", () => {
    const missing = seeded.mappings
      .filter((mapping) => wireReferencedParamKeys(mapping.create).includes("model") && !operationSelectsArchetypeWireModel(mapping.create))
      .filter(servesNamedArchetype)
      .map((mapping) => `${mapping.vendorKey}/${mapping.id}`);
    expect(missing).toEqual([]);
    expect(seeded.mappings.some((mapping) => operationSelectsArchetypeWireModel(mapping.create))).toBe(true);
  });

  it("声明只出现在内置家的报文上", () => {
    const outside = seeded.mappings
      .filter((mapping) => operationSelectsArchetypeWireModel(mapping.create) && !builtinVendorSeed(mapping.vendorKey))
      .map((mapping) => `${mapping.vendorKey}/${mapping.id}`);
    expect(outside).toEqual([]);
  });

  it.each([
    ["POST /v1/images/generations", NEWAPI_IMAGE_CREATE_OP],
    ["POST /v1/chat/completions（image_url）", NEWAPI_IMAGE_EDIT_OP],
    ["POST /v1/images/edits（JSON）", XAI_JSON_IMAGE_EDIT_OP],
    ["POST /v1/images/edits（multipart）", OPENAI_MULTIPART_IMAGE_EDIT_OP],
    ["POST /v1/video/generations", NEWAPI_VIDEO_CREATE_OP],
  ] as const)("通用中转报文（%s）没有声明", (_label, operation) => {
    expect(operationSelectsArchetypeWireModel(operation)).toBe(false);
  });
});

/**
 * 类检查（静态普查）：生产代码里「自己用 modelAlias || modelKey 算一个模型名」的地方，只许出现在 owner
 * 和下面逐个登记、写明为什么不是出站报文的文件里。2026-10-16 独立验收（V-1207）抓到两处漏门：无 mapping
 * 兜底报文与自定义脚本的顶层 model 各算一份——新增任何出站构造都会在这里红，逼它改问 owner。
 */
describe("类检查：出站模型名不许绕过 owner 自己算（全仓普查 electron/ 生产代码）", () => {
  const ALLOWED: Record<string, string> = {
    "electron/shared/modelArchetypes/wireModelIdentity.ts": "owner 本身（connectionWireModel）",
    "electron/ai/vendorModelConnection.ts": "文本对话模型（AI SDK）连接，不经生成报文、不涉及档案线上名",
    "electron/agentLane/laneDesktopInput.ts": "按模型名查请求体 profile，不写出站 model 字段",
    "electron/capabilityCore/appIntegrationCanvasShot.ts": "日志 / 回执里的模型标识，不出站",
    "electron/catalog/catalogCommit.ts": "冒烟请求的 extras 身份；出站 model 仍经 templateContext → owner",
    "electron/catalog/modelListReconcile.ts": "与供应商模型列表对账，不出站",
    "electron/catalog/parameterReferenceContract.ts": "节点 meta 的目录身份，不出站",
    "electron/providerAdapter/serviceCatalog.ts": "接入登记时别名的默认值（写目录，不是出站报文）",
    "electron/vendor/provenance.ts": "产物出处记录，不出站",
  };
  const PATTERN = /modelAlias\s*\)?\s*\|\|\s*[\w.?()]*modelKey/;
  function productionFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : productionFiles(full);
      return /\.(ts|mts)$/.test(entry.name) && !/\.(test|spec)\.|\.d\.ts$/.test(entry.name) ? [full] : [];
    });
  }

  it("直接拼模型名的生产代码只在 owner 与登记过的非出站文件里", () => {
    const root = path.resolve(__dirname, "../..");
    const offenders = productionFiles(path.join(root, "electron")).flatMap((file) => {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (ALLOWED[rel]) return [];
      return fs.readFileSync(file, "utf8").split(/\r?\n/)
        .map((line, index) => ({ line: line.trim(), index }))
        .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*") && PATTERN.test(line))
        .map(({ index }) => `${rel}:${index + 1}`);
    });
    expect(offenders, "出站模型名改问 wireModelIdentity（resolveWireModel / connectionWireModel）；确实不出站就登记进 ALLOWED 写明理由").toEqual([]);
  });
});
