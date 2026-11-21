// 「怎么说」的家（D-1117-delete-verification）：五档、点色、连接级折叠（Q1 / Q2，协调 2026-11-18 批）。
// 这里钉的是**规则本身**：每个出口都只拿这里的结论，所以出口之间不会再说成两句话。
import { describe, expect, it } from "vitest";
import { deriveModelAvailability, MODEL_UNUSABLE_REASONS, type ModelAvailability } from "./modelAvailability";
import {
  MODEL_STATUS_STATES,
  presentConnectionStatus,
  presentModelStatus,
  presentStatusCount,
  type ModelStatusInput,
} from "./modelStatusPresentation";

const usable: ModelAvailability = { usable: true };
const unusable = (reason: Exclude<ModelAvailability, { usable: true }>["reason"]): ModelAvailability => ({ usable: false, reason } as ModelAvailability);

describe("模型级：五档，只看主人的结论 + 格式任务在不在跑", () => {
  it.each([
    ["可使用", usable, false, "ready", "success"],
    ["能用时哪怕格式任务在跑也是可使用（能选就是绿）", usable, true, "ready", "success"],
    ["不能用、格式任务在跑 → 配置中", unusable("model_unpublished"), true, "configuring", "active"],
    ["没 key → 待接入", unusable("credential_missing"), false, "notConnected", "neutral"],
    ["模型被关 → 已关闭", unusable("model_disabled"), false, "disabled", "neutral"],
    ["连接被关 → 已关闭", unusable("vendor_disabled"), false, "disabled", "neutral"],
    ["缺请求格式 → 待设置", unusable("model_unpublished"), false, "needsSetup", "warning"],
    ["声明缺字段 → 待设置", unusable("capability_incomplete"), false, "needsSetup", "warning"],
    ["钥匙解不开 → 待设置", unusable("credential_locked"), false, "needsSetup", "warning"],
    ["钥匙要重存 → 待设置", unusable("credential_needs_resave"), false, "needsSetup", "warning"],
    ["形状不认（没有结论）→ 待设置，不默默当可用", undefined, false, "needsSetup", "warning"],
  ] as const)("%s", (_name, availability, formatInProgress, state, tone) => {
    expect(presentModelStatus({ availability, formatInProgress })).toEqual({
      state,
      tone,
      labelKey: `onboardingProviders.modelStatus.${state}`,
    });
  });

  it("主人的每一种原因都落到五档之一（新加原因不会掉进空档）", () => {
    for (const reason of MODEL_UNUSABLE_REASONS) {
      const presentation = presentModelStatus({ availability: { usable: false, reason } as ModelAvailability });
      expect(MODEL_STATUS_STATES).toContain(presentation.state);
      expect(presentation.state).not.toBe("ready");
    }
  });

  it("手动关了一个本来就缺请求格式的模型 → 待设置，不说已关闭（协调 11-18 批的边角）", () => {
    const availability = deriveModelAvailability({
      model: { enabled: false, vendorKey: "relay", modelKey: "relay-video", kind: "video", meta: { adapter: { modes: [], publicationModes: [] } } },
      vendor: { enabled: true, authType: "bearer" },
      credentialStatus: () => "ok",
    });
    expect(availability).toEqual({ usable: false, reason: "model_unpublished" });
    expect(presentModelStatus({ availability }).state).toBe("needsSetup");
  });

  it("手动关了一个有请求格式的模型 → 已关闭", () => {
    const availability = deriveModelAvailability({
      model: { enabled: false, vendorKey: "deepseek", modelKey: "deepseek-chat", kind: "text" },
      vendor: { enabled: true, authType: "bearer" },
      credentialStatus: () => "ok",
    });
    expect(availability).toEqual({ usable: false, reason: "model_disabled" });
    expect(presentModelStatus({ availability }).state).toBe("disabled");
  });
});

describe("连接级折叠（Q2 的顺序）", () => {
  const row = (availability: ModelAvailability | undefined, formatInProgress = false): ModelStatusInput => ({ availability, formatInProgress });

  it("① 没 key → 待接入，不带数，哪怕其它行看起来可用", () => {
    expect(presentConnectionStatus({ keyMissing: true, models: [row(usable)] })).toEqual({
      state: "notConnected",
      tone: "neutral",
      labelKey: "onboardingProviders.modelStatus.notConnected",
    });
  });

  it("① 调用方给不出 keyMissing 时，任何一行 credential_missing 也说明这家没 key", () => {
    expect(presentConnectionStatus({ models: [row(unusable("credential_missing")), row(unusable("credential_missing"))] }).state)
      .toBe("notConnected");
  });

  it("② 全部已关闭 → N 个已关闭", () => {
    expect(presentConnectionStatus({ models: [row(unusable("model_disabled")), row(unusable("model_disabled"))] }))
      .toEqual(presentStatusCount("disabled", 2));
  });

  it("③ 有可使用 → N 个可使用（绿），哪怕还有缺格式和在编的", () => {
    expect(presentConnectionStatus({
      models: [row(usable), row(usable), row(unusable("model_unpublished")), row(unusable("model_unpublished"), true), row(unusable("model_disabled"))],
    })).toEqual({ state: "ready", tone: "success", labelKey: "onboardingProviders.modelStatus.count.ready", count: 2 });
  });

  it("④ 没有可使用、有在编 → N 个配置中", () => {
    expect(presentConnectionStatus({ models: [row(unusable("model_unpublished"), true), row(unusable("model_unpublished"))] }))
      .toEqual(presentStatusCount("configuring", 1));
  });

  it("⑤ 否则 → N 个待设置（关着的不算进待设置的数）", () => {
    expect(presentConnectionStatus({ models: [row(unusable("model_unpublished")), row(unusable("capability_incomplete")), row(unusable("model_disabled"))] }))
      .toEqual(presentStatusCount("needsSetup", 2));
  });

  it("一个模型都还没选的连接 → 0 个待设置，不说「0 个已关闭」", () => {
    expect(presentConnectionStatus({ models: [] })).toEqual(presentStatusCount("needsSetup", 0));
  });

  it("带数的键和不带数的键各自成一组，词条键只从这里出", () => {
    for (const state of ["ready", "configuring", "needsSetup", "disabled"] as const) {
      expect(presentStatusCount(state, 3).labelKey).toBe(`onboardingProviders.modelStatus.count.${state}`);
    }
  });
});
