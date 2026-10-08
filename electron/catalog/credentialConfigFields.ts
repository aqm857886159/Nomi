// 「供应商连接配置」字段的凭据分级 —— 结构性预防（P2 心脏：让「凭据字段明文落盘」这类问题**整类不再复发**）。
//
// 背景：apiKey 走 safeStorage 加密（secrets.ts），customConfig 也已挪进同一加密层（catalog v9）。
// 但历史上 `network.proxyUrl`（可带 user:pass）与 `meta.extraHeaders`（可带 Authorization）各自为政、
// 明文落盘。根因不是「某个字段忘了加密」，而是**没有一个统一边界回答「这个字段是不是凭据载荷」**。
//
// 这份登记表就是那个边界：`Vendor` 的**每个**字段都必须显式声明为
//   · "credential-bearing"：能携带密钥/口令/令牌 → 必须走加密存储层（networkConfigStore / secrets）；
//   · "non-credential"    ：公开元数据（名字、baseUrl、能力声明…）→ 明文落盘无妨。
//
// 用 `Record<keyof Vendor, …>` 强约束：**编译期**就要求每个 `Vendor` 键都在表内——将来给 `Vendor`
// 加任何新字段，不在这里分级就编译不过（type guard）；配套的 credentialConfigFields.test.ts 再断言
// 每个 credential-bearing 字段确实经加密层落盘、明文不进 catalog（runtime guard）。两道一起 = 类闭合。
//
// 注意：这不是「值的加密器」，只是「哪些字段属于凭据类」的单一真相源。真正的加解密在
// electron/catalog/secrets.ts（safeStorage 原语）与 networkConfigStore.ts / customConfigStore.ts（编排层）。
import type { Vendor } from "./types";

export type VendorConfigFieldClass = "credential-bearing" | "non-credential";

/**
 * `Vendor` 每个字段的凭据分级（单一真相源）。`Record<keyof Vendor, …>` 保证穷尽：漏一个键 → 编译红。
 *
 * credential-bearing（必须加密落盘）：
 *  - `network`     ：`{ proxyUrl }`，proxyUrl 可含 `user:pass@` userinfo（代理鉴权）。
 *  - `meta`        ：承载 `extraHeaders`（可含 Authorization/bearer 等自定义鉴权头）。meta 的其它子字段
 *                    （adapter/lineage/label…）非凭据，但只要 meta 里**可能**出现凭据子字段，就按凭据类
 *                    处理其加密边界——具体哪些 meta 子键是凭据由 networkConfigStore 精确路由（extraHeaders）。
 *
 * non-credential（明文落盘无妨——公开身份/能力/时间戳，服务器和 UI 都要读）：
 */
export const VENDOR_CONFIG_FIELD_CLASSIFICATION: Record<keyof Vendor, VendorConfigFieldClass> = {
  // 凭据类：值加密进 ApiKeyRecord，明文永不进 catalog（见 networkConfigStore）。
  network: "credential-bearing",
  meta: "credential-bearing",
  // 公开身份 / 能力声明 / 时间戳：无秘密，明文即可。
  key: "non-credential",
  name: "non-credential",
  enabled: "non-credential",
  hasApiKey: "non-credential",
  credentialMaterialSaved: "non-credential",
  credentialVerificationPending: "non-credential",
  baseUrlHint: "non-credential",
  // 凭据**绑定**（§6.1）：记的是「这把 key 去哪、怎么放」，全是公开协议元数据——origin、
  // authType/authHeader/authQueryParam/authScheme（名字不是值），以及一个「当时走不走代理」的布尔。
  // 刻意**不**存 proxyUrl：那一条能带 user:pass@，属于上面的 credential-bearing 那一档。
  credentialBinding: "non-credential",
  authType: "non-credential",
  authHeader: "non-credential",
  // 方案词（"Bearer" / "Key"）是公开协议常量，不是秘密——key 本身仍只走 ApiKeyRecord。
  authScheme: "non-credential",
  authQueryParam: "non-credential",
  providerKind: "non-credential",
  assetIngestion: "non-credential",
  createdAt: "non-credential",
  updatedAt: "non-credential",
};

/** 所有凭据类字段名——供 guard 测试与 DTO 脱敏枚举，避免各处手抄一份漂移。 */
export const CREDENTIAL_BEARING_VENDOR_FIELDS: ReadonlyArray<keyof Vendor> = (
  Object.entries(VENDOR_CONFIG_FIELD_CLASSIFICATION) as Array<[keyof Vendor, VendorConfigFieldClass]>
)
  .filter(([, klass]) => klass === "credential-bearing")
  .map(([field]) => field);
