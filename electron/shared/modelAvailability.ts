// 「这个模型现在能不能用」的**唯一** owner（2026-09-12，P0-10 根因修复）。
//
// 根因（真实验收 docs/research/2026-09-12-real-onboarding-acceptance/README.md §6）：
// 同一时刻、同一台机器、重启之后，三个地方给了两个答案——设置页说「2 个可使用」，
// 首页横幅说「创作助手尚未连接模型」，创作助手的模型下拉说「目录里没有可用的」。
// 不是刷新问题，是**每个读者各写一份判据**：
//   · 设置页 `resolveModelHomeStatus` 只看 `enabled` + 能力投影，从不看发布资格、从不看钥匙；
//   · 首页横幅走主进程 `isExecutableTextModel`，要 `published` 还要 `configuredCredential`；
//   · 助手下拉走渲染层 `filterUsableAssistantTextModels`，要 `published` 还要 `vendor.hasApiKey`；
//   · 画布走 `modelCatalogCache` 的第三份「能跑的家」。
// 判据各写各的，它们**必然**漂——这份文件就是把那条不变量收回一处：
//
//   可用 = 供应商在且启用 → 模型启用 → 目录发布资格成立 → 这家的钥匙此刻解得开。
//
// 「这个模型是什么角色」（文本/图片/视频、带不带得动工具调用、是不是只给 prompt_refine）
// **不在这里**：那是可用性之上的一层过滤器，不是第二份真相。角色过滤器住在
// `textModelCapabilities.ts` / 各 picker 的 `publishedModes` 判断里，永远只对**已可用**的模型生效。
//
// 放在 `electron/shared/` 而不是 `electron/catalog/`：渲染层要按同一个枚举读同一份结论
// （DTO 带 `availability` 过 IPC），共享层是两侧都 import 得到的那一层。
import { derivePublishedExecution, type PublishedExecutionEvidence, type PublishedExecutionModel } from "./modelPublication";
// 钥匙健康度不在这里另立词表：它的单一 owner 是中立契约 `contracts/apiKeyStatus.ts`（R14.1）。
import type { ApiKeyDecryptStatus } from "./contracts/apiKeyStatus";

/**
 * 不可用的**原因**，一个封闭枚举。
 * 每一条都必须对应一个用户当场做得了的动作——「不可用」而说不出该干什么，等于没说（D4）。
 */
export const MODEL_UNUSABLE_REASONS = [
  /** 目录里没有这一行的供应商（被删了/身份漂了）。 */
  "vendor_missing",
  /** 供应商整家被停用。 */
  "vendor_disabled",
  /** 这一行模型自己被停用。 */
  "model_disabled",
  /**
   * 目录发布资格不成立：适配器还没认证出 active revision，或没有任何可执行 mapping/脚本。
   * 这是 MCP 接入走到一半停下时**最常见**的一档——模型行在、启用着、钥匙也在，就是没发布。
   */
  "model_unpublished",
  /** 这家还没配钥匙。 */
  "credential_missing",
  /** 钥匙来自旧版明文存储，不能用于认证——要在 Nomi 里重存一次。 */
  "credential_needs_resave",
  /** 钥匙在，但当前宿主身份解不开（MCP/命令行宿主与主程序加密身份不一致）。 */
  "credential_locked",
] as const;

export type ModelUnusableReason = (typeof MODEL_UNUSABLE_REASONS)[number];

/** 逐模型的可用性结论。`usable: true` 时没有 `reason`——「可用还带个原因」只会让读者再猜一次。 */
export type ModelAvailability =
  | { usable: true }
  | { usable: false; reason: ModelUnusableReason };

const USABLE: ModelAvailability = Object.freeze({ usable: true });

export type ModelAvailabilityVendor = {
  enabled: boolean;
  /** `"none"` = 这家本来就免鉴权（本地 ComfyUI 等），不参与钥匙判定。 */
  authType?: string | null;
};

export type ModelAvailabilityInput = {
  model: PublishedExecutionModel | null | undefined;
  /** 该模型所属供应商；`null`/`undefined` = 目录里没有这一家。 */
  vendor: ModelAvailabilityVendor | null | undefined;
  /**
   * 这家钥匙的健康度，**惰性**取：只有在前面几档都过了、答案真的取决于钥匙时才调。
   * 做成 thunk 不是风格问题——探一次钥匙就是一次 safeStorage 往返，而且 `authType === "none"`
   * 的本地家（ComfyUI）根本没有钥匙可解，急切求值会去解一把陈旧密文并吐一行假的解密失败日志。
   */
  credentialStatus: () => ApiKeyDecryptStatus;
  /** 发布资格的证据（mapping 表）。与 `derivePublishedExecution` 同一份输入，不另算一遍。 */
  evidence?: PublishedExecutionEvidence;
};

/**
 * 纯函数：一条模型 + 它的供应商 + 这家钥匙的健康度 → 能不能用（不能就说清是哪一档）。
 *
 * 顺序是**用户该先修哪个**的顺序，不是代码顺手的顺序：供应商没了/停了 → 模型停了 →
 * 没发布 → 钥匙。反过来（先报「没钥匙」）会把人送去填一把根本不缺的 key。
 */
export function deriveModelAvailability(input: ModelAvailabilityInput): ModelAvailability {
  const { model, vendor, credentialStatus, evidence } = input;
  if (!vendor) return { usable: false, reason: "vendor_missing" };
  if (!vendor.enabled) return { usable: false, reason: "vendor_disabled" };
  if (!model?.enabled) return { usable: false, reason: "model_disabled" };
  if (!derivePublishedExecution(model, evidence).published) {
    return { usable: false, reason: "model_unpublished" };
  }
  if (vendor.authType === "none") return USABLE;
  switch (credentialStatus()) {
    case "ok":
      return USABLE;
    case "locked":
      return { usable: false, reason: "credential_locked" };
    case "needs_resave":
      return { usable: false, reason: "credential_needs_resave" };
    default:
      return { usable: false, reason: "credential_missing" };
  }
}

/** 不可用原因是不是「钥匙那一档」——给「去填 key」这类指路用，免得各处手抄三个枚举值。 */
export function isCredentialReason(reason: ModelUnusableReason): boolean {
  return reason === "credential_missing"
    || reason === "credential_needs_resave"
    || reason === "credential_locked";
}
