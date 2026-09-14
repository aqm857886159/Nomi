import { describe, expect, it, vi } from "vitest";
import {
  MODEL_UNUSABLE_REASONS,
  deriveModelAvailability,
  isCredentialReason,
  type ModelAvailabilityInput,
} from "./modelAvailability";
import type { ApiKeyDecryptStatus } from "./contracts/apiKeyStatus";
import type { PublishedExecutionModel } from "./modelPublication";

/** 一条「按老路接进来、有可执行 mapping」的文本模型（无 adapter metadata = legacy 发布路径）。 */
function textModel(overrides: Partial<PublishedExecutionModel> = {}): PublishedExecutionModel {
  return { enabled: true, vendorKey: "deepseek", modelKey: "deepseek-v4-pro", kind: "text", ...overrides };
}

/**
 * 一条**走 MCP 接入、认证没走完**的文本模型：`meta.adapter` 在（说明它属于认证域），
 * 但没有 `activeRevision`。这正是 2026-09-12 真实验收里那两个 DeepSeek 模型的形状。
 */
function uncertifiedAdapterModel(): PublishedExecutionModel {
  return { enabled: true, vendorKey: "deepseek", modelKey: "deepseek-flash", kind: "text", meta: { adapter: { modes: [], publicationModes: [] } } };
}

function input(overrides: Partial<ModelAvailabilityInput> = {}): ModelAvailabilityInput {
  return {
    model: textModel(),
    vendor: { enabled: true, authType: "bearer" },
    credentialStatus: () => "ok",
    ...overrides,
  };
}

describe("deriveModelAvailability — 全 App 唯一那条「现在能不能用」", () => {
  it("供应商启用 + 模型启用 + 发布资格成立 + 钥匙解得开 → 可用", () => {
    expect(deriveModelAvailability(input())).toEqual({ usable: true });
  });

  it("可用时不带 reason（「可用还带个原因」只会让读者再猜一次）", () => {
    expect(Object.keys(deriveModelAvailability(input()))).toEqual(["usable"]);
  });

  it("目录里没有这一家 → vendor_missing", () => {
    expect(deriveModelAvailability(input({ vendor: null }))).toEqual({ usable: false, reason: "vendor_missing" });
  });

  it("这家被停用 → vendor_disabled（早于模型与钥匙，用户该先修这个）", () => {
    expect(deriveModelAvailability(input({ vendor: { enabled: false, authType: "bearer" }, credentialStatus: () => "missing" })))
      .toEqual({ usable: false, reason: "vendor_disabled" });
  });

  it("这一行被停用 → model_disabled（不是「没配钥匙」）", () => {
    expect(deriveModelAvailability(input({ model: textModel({ enabled: false }), credentialStatus: () => "missing" })))
      .toEqual({ usable: false, reason: "model_disabled" });
  });

  it("P0-10 现场：启用着、钥匙也在，但认证没走完 → model_unpublished，不是可用", () => {
    expect(deriveModelAvailability(input({ model: uncertifiedAdapterModel(), credentialStatus: () => "ok" })))
      .toEqual({ usable: false, reason: "model_unpublished" });
  });

  it("免鉴权供应商（本地 ComfyUI 等）不看钥匙", () => {
    expect(deriveModelAvailability(input({ vendor: { enabled: true, authType: "none" }, credentialStatus: () => "missing" })))
      .toEqual({ usable: true });
  });

  const credentialCases: ReadonlyArray<[ApiKeyDecryptStatus, string]> = [
    ["missing", "credential_missing"],
    ["locked", "credential_locked"],
    ["needs_resave", "credential_needs_resave"],
  ];
  for (const [status, reason] of credentialCases) {
    it(`钥匙 ${status} → ${reason}`, () => {
      expect(deriveModelAvailability(input({ credentialStatus: () => status }))).toEqual({ usable: false, reason });
    });
  }

  it("答案不取决于钥匙时绝不去探钥匙（免鉴权的本地家没有钥匙可解，探了只会吐一行假失败）", () => {
    const probe = vi.fn((): ApiKeyDecryptStatus => "missing");
    deriveModelAvailability(input({ vendor: { enabled: true, authType: "none" }, credentialStatus: probe }));
    deriveModelAvailability(input({ vendor: { enabled: false, authType: "bearer" }, credentialStatus: probe }));
    deriveModelAvailability(input({ model: uncertifiedAdapterModel(), credentialStatus: probe }));
    expect(probe).not.toHaveBeenCalled();
  });

  it("模型行整条不在（null）→ model_disabled，绝不 throw", () => {
    expect(deriveModelAvailability(input({ model: null }))).toEqual({ usable: false, reason: "model_disabled" });
  });
});

describe("矩阵：认证 × 钥匙 × 启停 × 角色 —— 同一份输入只有一个答案", () => {
  // 类级断言：任意组合下结论都是**同一个函数**给的，所以不存在「设置页说可用、下拉说没有」。
  const published = [true, false];
  const credentials: ApiKeyDecryptStatus[] = ["ok", "missing", "locked", "needs_resave"];
  const enabledStates = [true, false];

  it("笛卡尔积里，可用 ⇔ 发布资格成立且（免鉴权或钥匙 ok）且两级都启用", () => {
    for (const isPublished of published) {
      for (const credentialStatus of credentials) {
        for (const modelEnabled of enabledStates) {
          for (const vendorEnabled of enabledStates) {
            const result = deriveModelAvailability({
              model: isPublished ? textModel({ enabled: modelEnabled }) : { ...uncertifiedAdapterModel(), enabled: modelEnabled },
              vendor: { enabled: vendorEnabled, authType: "bearer" },
              credentialStatus: () => credentialStatus,
            });
            expect(result.usable).toBe(vendorEnabled && modelEnabled && isPublished && credentialStatus === "ok");
            if (!result.usable) expect(MODEL_UNUSABLE_REASONS).toContain(result.reason);
          }
        }
      }
    }
  });

  it("角色（text/image/video）不参与可用性——它是压在可用性之上的过滤器，不是第二份真相", () => {
    // 同一条 image 模型：有 image_edit mapping 就发布，可用性与它是什么 kind 无关。
    const imageModel: PublishedExecutionModel = { enabled: true, vendorKey: "kie", modelKey: "nano-banana", kind: "image" };
    const evidence = { mappings: [{ enabled: true, vendorKey: "kie", taskKind: "text_to_image" }] };
    expect(deriveModelAvailability({ model: imageModel, vendor: { enabled: true, authType: "bearer" }, credentialStatus: () => "ok", evidence }))
      .toEqual({ usable: true });
  });
});

describe("isCredentialReason", () => {
  it("只有钥匙那三档为真", () => {
    expect(MODEL_UNUSABLE_REASONS.filter(isCredentialReason))
      .toEqual(["credential_missing", "credential_needs_resave", "credential_locked"]);
  });
});
