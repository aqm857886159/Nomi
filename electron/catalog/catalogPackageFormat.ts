// `desktop-local-v1` —— 模型接入包（导出/导入）的**公开契约**。
//
// 它为什么需要一份 schema：这个包是「配置是独立文件」这条路的落点——一个人把中转站/自建端点
// 接好，导出一份 JSON，别人（或一个 LLM，照着供应商的接口文档）直接写一份同样形状的文件导进去。
// 在 2026-09-10 之前它只有一个实现（catalogStore 的 export/import 两个函数），没有任何一处
// 说得清「这个文件长什么样」：外面的人要么逆向我们的代码，要么先在 Nomi 里点一遍再导出来照抄。
//
// 单一真相：形状由 `electron/catalog/types.ts` 的 Vendor / Model / Mapping 定义，这里只声明
// **包信封**和每类条目的身份字段，其余字段一律 `additionalProperties: true` 原样透传——
// 我们不在这里抄第二份 Vendor 定义（抄了必然漂移）。身份字段与 TS 类型之间有编译期桥（见下），
// 谁改了 `Vendor.enabled` 的名字，tsc 当场红。
import { z } from "zod";
import { modeDeliveryDefect } from "./transportDelivery";
import { nowIso } from "../jsonUtils";
import { decryptApiKeyRecord } from "./secrets";
import { publicVendor } from "./customConfigStore";
import { exportableVendorWithNetworkConfig } from "./networkConfigStore";
import type { CatalogState, Mapping, Model, Vendor } from "./types";

export const CATALOG_PACKAGE_VERSION = "desktop-local-v1";

export type CatalogPackageApiKey = {
  apiKey: string;
  enabled?: boolean;
  customConfig?: Record<string, unknown>;
};

export type CatalogPackageVendorBundle = {
  vendor: Vendor;
  apiKey?: CatalogPackageApiKey;
  models: Model[];
  mappings: Mapping[];
};

export type CatalogPackage = {
  version: typeof CATALOG_PACKAGE_VERSION;
  exportedAt: string;
  vendors: CatalogPackageVendorBundle[];
};

// 编译期桥：身份字段的名字与类型直接绑在 catalog 的 TS 类型上。
// 这不是文档，是断言——重命名或改类型会让下面三行编译不过，schema 与 types.ts 无法悄悄漂移。
type VendorIdentity = Pick<Vendor, "key" | "name" | "enabled">;
type ModelIdentity = Pick<Model, "modelKey" | "vendorKey" | "labelZh" | "kind" | "enabled">;
type MappingIdentity = Pick<Mapping, "id" | "vendorKey" | "taskKind" | "name" | "create">;
const _vendorIdentity: VendorIdentity = { key: "", name: "", enabled: true };
const _modelIdentity: ModelIdentity = { modelKey: "", vendorKey: "", labelZh: "", kind: "text", enabled: true };
const _mappingIdentity: MappingIdentity = {
  id: "",
  vendorKey: "",
  taskKind: "chat",
  name: "",
  create: { method: "POST", path: "/" },
};
void _vendorIdentity;
void _modelIdentity;
void _mappingIdentity;

const vendorSchema = z
  .object({
    key: z.string().min(1).describe("Stable provider id inside the catalog."),
    name: z.string().min(1),
    enabled: z.boolean(),
    baseUrlHint: z.string().nullable().optional(),
    authType: z.string().optional(),
    providerKind: z.string().optional(),
  })
  .passthrough()
  .describe("A catalog vendor. Shape: electron/catalog/types.ts Vendor. Credential values are never part of this object.");

const modelSchema = z
  .object({
    modelKey: z.string().min(1),
    vendorKey: z.string().min(1),
    labelZh: z.string().min(1),
    kind: z.enum(["text", "image", "video", "audio", "model3d"]),
    enabled: z.boolean(),
  })
  .passthrough()
  .describe("A catalog model. Shape: electron/catalog/types.ts Model.");

const mappingSchema = z
  .object({
    id: z.string().min(1),
    vendorKey: z.string().min(1),
    taskKind: z.string().min(1),
    name: z.string(),
    create: z.object({ method: z.string().min(1), path: z.string().min(1) }).passthrough(),
    /**
     * 这条 wire 的交付形状，由**上游契约**声明，不由媒体类型推断（见 transportDelivery.ts）。
     * 声明 asynchronous 就必须带上 query 与 statusMapping，否则一个已受理的远端任务会被丢掉——
     * 这正是 2026-09-11「图片中转永远验不过」那条类根因。缺省时按存量数据的「有 query 即异步」推断。
     */
    delivery: z.enum(["synchronous", "asynchronous"]).optional()
      .describe("How this endpoint delivers results, declared by the provider contract and never inferred from the media type. 'asynchronous' requires query and statusMapping so an accepted remote task is polled to completion instead of dropped."),
  })
  .passthrough()
  .superRefine((mapping, context) => {
    const defect = modeDeliveryDefect(mapping as Parameters<typeof modeDeliveryDefect>[0]);
    if (defect) context.addIssue({ code: "custom", message: `Mapping ${String(mapping.id)} ${defect}` });
  })
  .describe("One task mapping (create/query/result HTTP declarations). Shape: electron/catalog/types.ts Mapping.");

const vendorBundleSchema = z
  .object({
    vendor: vendorSchema,
    apiKey: z
      .object({
        apiKey: z.string(),
        enabled: z.boolean().optional(),
        customConfig: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional()
      .describe("Present only when the export was asked to carry credentials; re-import re-encrypts on the target machine."),
    models: z.array(modelSchema).optional(),
    mappings: z.array(mappingSchema).optional(),
  })
  .passthrough();

/**
 * 完整包（导出侧写的、也是我们发布出去的那份契约）。
 * 导入侧刻意更宽（见 `catalogPackageImportSchema`）：`version` 缺失也收。
 */
export const catalogPackageSchema = z
  .object({
    version: z.literal(CATALOG_PACKAGE_VERSION),
    exportedAt: z.string().min(1).describe("ISO 8601 timestamp of the export."),
    vendors: z.array(vendorBundleSchema),
  })
  .passthrough()
  .describe("Nomi model catalog package (desktop-local-v1): one file that carries providers, their models and task mappings between machines.");

/**
 * 导入侧信封。**只判骨架**：vendors 是不是数组、每个 bundle 是不是对象、vendor 在不在、
 * models/mappings 是不是对象数组。条目内容一律交给既有的 apply*Upsert 归一——它同时收新旧两种
 * mapping 形状、labelZh 缺席时从 modelKey 派生、apiKey 只带 customConfig 时只改配置不动钥匙。
 *
 * 为什么导入比导出宽（Postel 不是借口，是这两侧的真实职责不同）：导出是**我们承诺写出来的形状**，
 * 所以按完整契约写；导入面对的是别人的手写文件与更老版本的导出，把「派生得出来的字段」当必填
 * 只会把一直能用的输入判死（2026-09-10 首次接上这道闸时，labelZh 与只带 customConfig 的 apiKey
 * 当场把三条既有用例判死——那正是这条纪律的实证）。
 * **故意不要求 version**：现役调用方传的就是 `{ vendors }`；给了就必须对得上。
 */
const importBundleSchema = z
  .object({
    vendor: z.object({}).passthrough(),
    apiKey: z.object({}).passthrough().optional(),
    models: z.array(z.object({}).passthrough()).optional(),
    mappings: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();

export const catalogPackageImportSchema = z
  .object({
    version: z.literal(CATALOG_PACKAGE_VERSION).optional(),
    exportedAt: z.string().optional(),
    vendors: z.array(importBundleSchema).max(2_000).optional(),
  })
  .passthrough();

/**
 * 导出侧的包构造（2026-09-10 从 catalogStore 移来）。
 *
 * 为什么和契约同住一个文件：它写出来的形状**就是**上面那份 zod 契约承诺的形状，两者贴在一起
 * 才能一眼看出「导出写的」和「schema 说的」是不是同一件事；分开住，漂移只会在别人导入失败时
 * 才被发现。它是纯函数（state 由调用方读好传进来），所以与 catalogStore 之间没有反向依赖。
 */
export function buildCatalogPackage(state: CatalogState, options: { includeApiKeys: boolean }): CatalogPackage {
  const { includeApiKeys } = options;
  return {
    version: CATALOG_PACKAGE_VERSION,
    exportedAt: nowIso(),
    vendors: state.vendors.map((vendor) => ({
      // The exported vendor is public (no credential-bearing values) UNLESS keys are
      // included for portability, in which case the effective (decrypted) proxy/headers
      // ride the vendor plaintext exactly like the API key does, and re-import re-encrypts
      // them on the target machine. Without includeApiKeys, no credential leaves the box.
      vendor: includeApiKeys
        ? exportableVendorWithNetworkConfig(publicVendor(vendor), state.apiKeysByVendor[vendor.key])
        : publicVendor(vendor),
      // Export carries plaintext keys for portability; re-import will re-encrypt on the target machine.
      ...(includeApiKeys && state.apiKeysByVendor[vendor.key]
        ? {
            apiKey: {
              apiKey: decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]),
              enabled: state.apiKeysByVendor[vendor.key].enabled,
            },
          }
        : {}),
      models: state.models.filter((model) => model.vendorKey === vendor.key),
      mappings: state.mappings.filter((mapping) => mapping.vendorKey === vendor.key),
    })),
  };
}
