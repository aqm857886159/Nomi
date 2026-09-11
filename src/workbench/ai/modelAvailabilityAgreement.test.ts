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
import { keepUsableModelRows } from "../../config/modelCatalogCache";
import { summarizeModelHomeConnection } from "../../ui/onboarding/modelSettingsHomeState";
import { projectModelSettingsCatalog } from "../../ui/onboarding/modelSettingsCatalogProjection";

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
    settingsReadyCount: summarizeModelHomeConnection(chipModels, state.mappings).ready,
    // 画布 / 分镜选择器：进入渲染层第一处那道闸。
    canvasRows: keepUsableModelRows(rows).length,
  };
}

describe("同一份目录 · 三个界面一个答案（P0-10 类级回归）", () => {
  it("真实验收现场：MCP 接进来但认证没走完的文本模型，三处一致说「不能用」", async () => {
    // 这就是 2026-09-12 那两个 DeepSeek 模型的形状：启用着、钥匙也在，
    // 但 `meta.adapter` 没有 activeRevision（认证卡在 needs_spend_confirmation 没走完）。
    const uncertified = [
      model({ modelKey: "deepseek-flash", meta: { adapter: { modes: [] } } }),
      model({ modelKey: "deepseek-v4-pro", meta: { adapter: { modes: [] } } }),
    ];
    const { readCatalog } = await import("../../../electron/catalog/catalogStore");
    const state = catalog(uncertified);
    vi.mocked(readCatalog).mockReturnValue(state);

    const answers = askEverySurface(state);
    // 修复前这一行是 `settingsReadyCount: 2` 配 `agentDropdown: false` —— 就是那张对不上的表。
    expect(answers).toEqual({ homeBanner: false, agentDropdown: false, settingsReadyCount: 0, canvasRows: 0 });
  });

  it("走完认证的文本模型：三处一致说「能用」", async () => {
    const { readCatalog } = await import("../../../electron/catalog/catalogStore");
    const state = catalog([model({ modelKey: "deepseek-flash" }), model({ modelKey: "deepseek-v4-pro" })]);
    vi.mocked(readCatalog).mockReturnValue(state);

    expect(askEverySurface(state))
      .toEqual({ homeBanner: true, agentDropdown: true, settingsReadyCount: 2, canvasRows: 2 });
  });

  const credentialCases: ReadonlyArray<ApiKeyDecryptStatus> = ["missing", "locked", "needs_resave"];
  for (const credentialStatus of credentialCases) {
    it(`钥匙 ${credentialStatus}：三处一致说「不能用」（设置页不再只看 enabled）`, async () => {
      const { readCatalog } = await import("../../../electron/catalog/catalogStore");
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
    const { readCatalog } = await import("../../../electron/catalog/catalogStore");
    const state = catalog([model()], "ok", [chatMapping], [vendor({ enabled: false })]);
    vi.mocked(readCatalog).mockReturnValue(state);
    expect(askEverySurface(state))
      .toEqual({ homeBanner: false, agentDropdown: false, settingsReadyCount: 0, canvasRows: 0 });
  });

  it("模型行被用户关掉：三处一致说「不能用」，且设置页把它读成「你自己关的」而不是「还差点什么」", async () => {
    const { readCatalog } = await import("../../../electron/catalog/catalogStore");
    const state = catalog([model({ enabled: false })], "ok");
    vi.mocked(readCatalog).mockReturnValue(state);
    const rows = projectRows(state);
    const chipModels = projectModelSettingsCatalog(rows as unknown as Array<Record<string, unknown>>).models;
    const summary = summarizeModelHomeConnection(chipModels, state.mappings);
    expect(summary).toMatchObject({ ready: 0, disabled: 1, needsSetup: 0 });
    expect(askEverySurface(state).agentDropdown).toBe(false);
  });

  it("角色过滤器压在可用性之上：可用的图片模型不会跑进助手的文本下拉", async () => {
    const { readCatalog } = await import("../../../electron/catalog/catalogStore");
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
