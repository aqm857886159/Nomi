// 类级回归：**同一份目录，三个界面必须给同一个答案**。
//
// 2026-09-12 真实验收 P0-10（docs/research/2026-09-12-real-onboarding-acceptance/README.md §6）：
// 同一时刻、同一台机器、重启之后——
//   · 设置 → 模型   说「1 个连接 · 2 个模型」「2 个可使用」
//   · 项目库首页横幅 说「创作助手尚未连接模型」
//   · 创作助手模型下拉 说「目录里没有可用的」
// 三份判据各写各的，于是它们漂开了。这份测试不验某一个界面对不对，验的是**它们对得上**：
// 拿一份目录状态喂给三条现役读取链，它们的结论必须一致。任何一条以后又长出自己的判据，这里当场红。
import { describe, expect, it, vi } from "vitest";

import { createCatalogAvailability } from "../../../electron/catalog/catalogModelAvailability";
import type { ApiKeyRecord } from "../../../electron/catalog/secrets";
import { derivePublishedExecution } from "../../../electron/shared/modelPublication";
import type { ApiKeyDecryptStatus } from "../../../electron/shared/contracts/apiKeyStatus";
import { selectTextModelCandidates } from "../../../electron/ai/textBrainResolver";
import type { CatalogState, Mapping, Model, Vendor } from "../../../electron/catalog/types";
import type { ModelCatalogModelDto } from "../api/modelCatalogApi";
import { filterUsableAssistantTextModels } from "./assistantModelIdentity";
import { notifyModelOptionsRefresh, preloadModelOptions, keepUsableModelRows } from "../../config/modelCatalogCache";
import { countModelHomeStates } from "../../ui/onboarding/modelSettingsHomeState";
import { projectModelSettingsCatalog } from "../../ui/onboarding/modelSettingsCatalogProjection";

import { readCatalog } from "../../../electron/catalog/catalogStore";

// 两条链（主进程首页横幅 / 渲染层投影）都走**真**的 `apiKeyDecryptStatus`，
// 所以钥匙那一档也是同一个判据在答——测试里不注入第二份钥匙状态，否则就验不到它们一致。
const safeStorageMocks = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer): string => {
    if (value.toString("utf8") === "GOOD") return "sk-live";
    throw new Error("test keychain identity mismatch");
  }),
}));
vi.mock("electron", () => ({ safeStorage: { decryptString: safeStorageMocks.decryptString } }));
vi.mock("../../../electron/catalog/catalogStore", () => ({ readCatalog: vi.fn() }));

const KEY_RECORDS: Record<ApiKeyDecryptStatus, ApiKeyRecord | undefined> = {
  ok: { vendorKey: "deepseek", apiKey: Buffer.from("GOOD").toString("base64"), enc: "safeStorage", enabled: true, createdAt: "", updatedAt: "" },
  locked: { vendorKey: "deepseek", apiKey: Buffer.from("BAD").toString("base64"), enc: "safeStorage", enabled: true, createdAt: "", updatedAt: "" },
  needs_resave: { vendorKey: "deepseek", apiKey: "plaintext-key", enc: "plain", enabled: true, createdAt: "", updatedAt: "" },
  missing: undefined,
};

const vendor = (overrides: Partial<Vendor> = {}): Vendor =>
  ({ key: "deepseek", name: "DeepSeek 官方 API", enabled: true, authType: "bearer", createdAt: "", updatedAt: "", ...overrides });

const model = (overrides: Partial<Model> = {}): Model =>
  ({ vendorKey: "deepseek", modelKey: "deepseek-flash", labelZh: "DeepSeek Flash", kind: "text", enabled: true, createdAt: "", updatedAt: "", ...overrides });

const chatMapping: Mapping = { vendorKey: "deepseek", taskKind: "chat", enabled: true } as unknown as Mapping;

function catalog(
  models: Model[],
  credentialStatus: ApiKeyDecryptStatus = "ok",
  mappings: Mapping[] = [chatMapping],
  vendors: Vendor[] = [vendor()],
): CatalogState {
  const record = KEY_RECORDS[credentialStatus];
  return {
    version: 12,
    vendors,
    models,
    mappings,
    apiKeysByVendor: record ? { deepseek: record } : {},
  } as CatalogState;
}

/**
 * 主进程投影：`listModelCatalogModels` 交给渲染层的那一行（published / publishedModes / availability）。
 * 这里复刻它的**组装**，判据本身仍是生产那两个函数——不另写一份。
 */
function projectRows(state: CatalogState): ModelCatalogModelDto[] {
  const availability = createCatalogAvailability(state);
  return state.models.map((row) => ({
    ...row,
    ...derivePublishedExecution(row, { mappings: state.mappings }),
    availability: availability.of(row),
  })) as unknown as ModelCatalogModelDto[];
}

/** 三条现役读取链，对同一份目录各答一次「有没有能用的文本模型」。 */
function askEverySurface(state: CatalogState): {
  homeBanner: boolean;
  agentDropdown: boolean;
  settingsReadyCount: number;
  canvasRows: number;
} {
  const rows = projectRows(state);
  const chipModels = projectModelSettingsCatalog(rows as unknown as Array<Record<string, unknown>>).models;
  return {
    // 首页横幅：`resolveTextBrainStatus` → `resolveConfiguredTextBrain` → 候选表非空。
    homeBanner: selectTextModelCandidates(state).length > 0,
    // 创作助手下拉：`chatModelChoices(data.models)`，data.models 来自这道门。
    agentDropdown: filterUsableAssistantTextModels(rows).length > 0,
    // 设置 → 模型：每个连接行上那句「N 个可使用」。
    settingsReadyCount: countModelHomeStates(chipModels).ready,
    // 画布 / 分镜选择器：进入渲染层第一处那道闸。
    canvasRows: keepUsableModelRows(rows).length,
  };
}

describe("同一份目录 · 三个界面一个答案（P0-10 类级回归）", () => {
  it("有标准请求格式的未验证文本模型，三个界面一致可用", async () => {
    // 空的验证模式只表示缺少诊断证据，不下架有标准格式的文本模型。
    const uncertified = [
      model({ modelKey: "deepseek-flash", meta: { adapter: { modes: [], publicationModes: [] } } }),
      model({ modelKey: "deepseek-v4-pro", meta: { adapter: { modes: [], publicationModes: [] } } }),
    ];
    const state = catalog(uncertified);
    vi.mocked(readCatalog).mockReturnValue(state);

    const answers = askEverySurface(state);
    // 修复前这一行是 `settingsReadyCount: 2` 配 `agentDropdown: false` —— 就是那张对不上的表。
    expect(answers).toEqual({ homeBanner: true, agentDropdown: true, settingsReadyCount: 2, canvasRows: 2 });
  });

  it("自检失败不下架：没有发布限制的已配置文本模型，各入口仍一致可用", () => {
    const state = catalog([model({ meta: { adapter: { state: "failed", modes: [] } } })]);
    expect(askEverySurface(state))
      .toEqual({ homeBanner: true, agentDropdown: true, settingsReadyCount: 1, canvasRows: 1 });
  });

  it("走完认证的文本模型：三处一致说「能用」", async () => {
    const state = catalog([model({ modelKey: "deepseek-flash" }), model({ modelKey: "deepseek-v4-pro" })]);
    vi.mocked(readCatalog).mockReturnValue(state);

    expect(askEverySurface(state))
      .toEqual({ homeBanner: true, agentDropdown: true, settingsReadyCount: 2, canvasRows: 2 });
  });

  const credentialCases: ReadonlyArray<ApiKeyDecryptStatus> = ["missing", "locked", "needs_resave"];
  for (const credentialStatus of credentialCases) {
    it(`钥匙 ${credentialStatus}：三处一致说「不能用」（设置页不再只看 enabled）`, async () => {
      const state = catalog([model()], credentialStatus);
      vi.mocked(readCatalog).mockReturnValue(state);
      const answers = askEverySurface(state);
      expect(answers.agentDropdown).toBe(false);
      expect(answers.settingsReadyCount).toBe(0);
      expect(answers.canvasRows).toBe(0);
      expect(answers.homeBanner).toBe(false);
    });
  }

  it("供应商被停用：三处一致说「不能用」", async () => {
    const state = catalog([model()], "ok", [chatMapping], [vendor({ enabled: false })]);
    vi.mocked(readCatalog).mockReturnValue(state);
    expect(askEverySurface(state))
      .toEqual({ homeBanner: false, agentDropdown: false, settingsReadyCount: 0, canvasRows: 0 });
  });

  it("模型行被用户关掉：三处一致说「不能用」，且设置页把它读成「你自己关的」而不是「还差点什么」", async () => {
    const state = catalog([model({ enabled: false })], "ok");
    vi.mocked(readCatalog).mockReturnValue(state);
    const rows = projectRows(state);
    const chipModels = projectModelSettingsCatalog(rows as unknown as Array<Record<string, unknown>>).models;
    const summary = countModelHomeStates(chipModels);
    expect(summary).toMatchObject({ ready: 0, disabled: 1, needsSetup: 0 });
    expect(askEverySurface(state).agentDropdown).toBe(false);
  });

  it("角色过滤器压在可用性之上：可用的图片模型不会跑进助手的文本下拉", async () => {
    const imageMapping = { vendorKey: "deepseek", taskKind: "text_to_image", enabled: true } as unknown as Mapping;
    const state = catalog([model({ modelKey: "some-image", kind: "image" })], "ok", [imageMapping]);
    vi.mocked(readCatalog).mockReturnValue(state);
    const rows = projectRows(state);
    // 目录层说「能用」（画布图片选择器该看得到它）……
    expect(keepUsableModelRows(rows)).toHaveLength(1);
    // ……但它不是文本大脑，所以助手下拉与首页横幅都不认它。
    expect(filterUsableAssistantTextModels(rows)).toHaveLength(0);
    expect(selectTextModelCandidates(state)).toHaveLength(0);
  });
});


// 从真实目录到各处最终候选，不能只在 keepUsableModelRows 中间层数行。
const pickerApi = vi.hoisted(() => ({ models: vi.fn(), vendors: vi.fn() }));
vi.mock("../api/modelCatalogApi", () => ({
  listWorkbenchModelCatalogModels: pickerApi.models,
  listWorkbenchModelCatalogVendors: pickerApi.vendors,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { APIMART_IMAGE_MODELS } from "../../../electron/catalog/apimartImages";
import { buildDefaultModelOptions } from "../settings/defaultGenerationModelOptions";
import { buildV4ModelRows } from "./v4/agentPanelV4ModelRows";
import { buildModelMenu } from "../common/useDedupedModelSelect";
import { dedupeModelOptions } from "../../config/modelIdentity";
import { ModelSettingsHome } from "../../ui/onboarding/ModelSettingsHome";
import { CustomVendorCard } from "../../ui/onboarding/CustomVendorCard";
import { VendorOnboardCard } from "../../ui/onboarding/VendorOnboardCard";
import { getKnownVendor } from "../../config/knownVendors";
import i18n from "../../i18n";

function apimartImages(): CatalogState {
  const models = APIMART_IMAGE_MODELS.map(seed => model({
    vendorKey: "apimart", modelKey: seed.modelKey, labelZh: seed.labelZh, kind: "image",
    meta: { archetypeId: seed.archetypeId },
  }));
  const mappings = APIMART_IMAGE_MODELS.flatMap(seed => seed.mappings.map(mapping => ({
    ...mapping, vendorKey: "apimart", modelKey: seed.modelKey, enabled: true,
  }))) as Mapping[];
  const state = catalog(models, "missing", mappings, [vendor({ key: "apimart", name: "APIMart" })]);
  state.apiKeysByVendor = { apimart: { ...KEY_RECORDS.ok!, vendorKey: "apimart" } };
  return state;
}

it("真实 APIMart 图片逐身份对账：设置、默认、助手、画布菜单一个都不能少", async () => {
  const rows = projectRows(apimartImages());
  const settings = projectModelSettingsCatalog(rows as unknown as Array<Record<string, unknown>>).models;
  const identity = (row: { vendorKey: string; modelKey: string }) => `${row.vendorKey}/${row.modelKey}`;
  const expected = settings.filter(row => row.availability?.usable).map(identity).sort();
  expect(expected).toHaveLength(APIMART_IMAGE_MODELS.length);
  expect(expected).toContain("apimart/gemini-3.1-flash-lite-image");
  const defaults = buildDefaultModelOptions(rows, key => key, "auto");
  const defaultIds = defaults.optionsByKind.text_to_image.filter(option => option.value).map(option => identity(defaults.decode(option.value)!)).sort();
  const selected: string[] = [];
  const agent = buildV4ModelRows({
    models: [], generationModels: rows, vendors: { apimart: "APIMart" }, orderedVendorKeys: [],
    selectedModel: undefined, modelLabel: "", selectModel: () => {}, generationDefaults: {},
    setGenerationDefault: (_kind, value) => { if (value) selected.push(identity(value)); },
  }, key => key).find(row => row.slot === "agentPanelV4.imageDefault")!;
  for (const option of agent.options ?? []) if (option.value) agent.onChange!(option.value);
  pickerApi.models.mockResolvedValue(rows);
  pickerApi.vendors.mockResolvedValue([{ key: "apimart", name: "APIMart" }]);
  notifyModelOptionsRefresh();
  const options = await preloadModelOptions("image");
  const menu = buildModelMenu(dedupeModelOptions(options), () => false);
  // 从实际选项（含「更多」）寻址；只数内部 rows 会漏掉菜单末端再次过滤。
  const canvasIds = [...new Set(menu.options.flatMap(option => menu.rows.get(option.value)?.model.providers.map(provider =>
    identity({ vendorKey: provider.vendor!, modelKey: provider.option.value }),
  ) ?? []))].sort();
  expect(defaultIds, "默认模型身份").toEqual(expected);
  expect(selected.sort(), "助手模型身份").toEqual(expected);
  expect(canvasIds, "画布菜单候选身份（含更多）").toEqual(expected);
});

const statusCases = [
  { state: "ready", enabled: true, formats: true, tone: "success", dot: "bg-workbench-success", zh: "1 个可使用", en: "1 ready to use" },
  { state: "disabled", enabled: false, formats: true, tone: "neutral", dot: "bg-nomi-ink-30", zh: "1 个已关闭", en: "1 disabled" },
  { state: "needsSetup", enabled: true, formats: false, tone: "warning", dot: "bg-nomi-warning", zh: "1 个待设置", en: "1 needs setup" },
] as const;
for (const language of ["zh-CN", "en"]) {
  for (const sample of statusCases) {
    it(`${language} 列表/内置/自接详情末端同词同色：${sample.state}`, async () => {
      await i18n.changeLanguage(language);
      const state = apimartImages();
      state.models = [state.models[0]!];
      state.models[0] = { ...state.models[0]!, enabled: sample.enabled };
      if (!sample.formats) state.mappings = [];
      const chips = projectModelSettingsCatalog(projectRows(state) as unknown as Array<Record<string, unknown>>).models;
      const noop = () => {};
      const render = (element: React.ReactElement) => renderToStaticMarkup(React.createElement(MantineProvider, { children: element }));
      const home = render(React.createElement(ModelSettingsHome, {
        connections: [{ vendorKey: "apimart", name: "APIMart", kind: "api", models: chips, onOpen: noop }],
        availableConnections: [], loaded: true, bridgeMissing: false, loadError: null, readOnly: null,
        taskCount: 0, onReload: noop, onCustomApi: noop, onDirectScript: noop, onImported: noop,
      }));
      const detail = render(React.createElement(VendorOnboardCard, {
        directory: getKnownVendor("apimart")!, vendorName: "APIMart", baseUrl: "https://api.apimart.ai",
        hasApiKey: true, models: chips, onChanged: noop, detailMode: true,
      }));
      const label = sample[language === "en" ? "en" : "zh"];
      const customDetail = render(React.createElement(CustomVendorCard, {
        vendorKey: "apimart", name: "APIMart", models: chips, detailMode: true,
        onToggle: noop, onDelete: noop, onCustomCall: noop, onRetype: noop, onChanged: noop,
      }));
      for (const html of [home, detail, customDetail]) {
        const badge = html.match(/<span data-model-status="[^"]+" data-model-status-tone="[^"]+"[^>]*><span[^>]*><\/span>(.*?)<\/span>/)?.[0];
        expect(badge).toBeDefined();
        expect(badge).toContain(`data-model-status="${sample.state}"`);
        expect(badge).toContain(`data-model-status-tone="${sample.tone}"`);
        expect(badge).toContain(sample.dot);
        expect(badge).toContain(label);
      }
      await i18n.changeLanguage("zh-CN");
    });
  }
}
