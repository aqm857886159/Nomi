/**
 * 真实来源合同的模块边界那一半：一个**新入口**不经解析器、不经装配主人，就拿不到能出网的东西。
 * 用仓库自己的 ESLint 配置对虚拟文件跑 lintText——规则就是 `eslint.config.mjs` 里那几块名单，没有第二份。
 * 覆盖的绕法：具名导入、命名空间导入、`export … from` 再导出、动态 `import()`（解构与不解构）、`require`。
 * 名单内的主人、普通错误类 / 类型导入、测试文件不误报。对象层的伪造（裸 Record、快照、克隆）在 `referenceAssemblyBoundary.test.ts`。
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

const NEW_ENTRY = "electron/capabilityCore/newGenerationEntry.ts";
const NEW_LOWERING_SIBLING = "electron/shared/generationLowering/newPlacement.ts";
const NEW_RENDERER_ENTRY = "src/workbench/generationCanvas/runner/newRunner.ts";

async function boundaryErrors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2 && /^(raw-vendor-send|profile-send-owner|template-internals|reference-lowering-owner)\//.test(message.ruleId ?? ""))
    .map((message) => `${message.ruleId}: ${message.message}`);
}

describe("新入口拿不到底层写接口", () => {
  const bypasses: ReadonlyArray<readonly [string, string, string]> = [
    ["具名导入 requestJson", `import { requestJson } from "../vendor/vendorHttp";\nvoid requestJson;\n`, NEW_ENTRY],
    ["具名导入 requestMultipart", `import { requestMultipart } from "../vendor/vendorHttp";\nvoid requestMultipart;\n`, NEW_ENTRY],
    ["具名导入 requestBinary", `import { requestBinary } from "../vendor/vendorHttp";\nvoid requestBinary;\n`, NEW_ENTRY],
    ["命名空间导入", `import * as http from "../vendor/vendorHttp";\nvoid http;\n`, NEW_ENTRY],
    ["再导出", `export { requestJson } from "../vendor/vendorHttp";\n`, NEW_ENTRY],
    ["动态导入后解构", `export async function go() {\n  const { requestJson } = await import("../vendor/vendorHttp");\n  return requestJson;\n}\n`, NEW_ENTRY],
    ["动态导入不解构", `export async function go() {\n  const http = await import("../vendor/vendorHttp");\n  return http;\n}\n`, NEW_ENTRY],
    ["require", `export const http = require("../vendor/vendorHttp");\n`, NEW_ENTRY],
    ["发送入口 sendProfileJson", `import { sendProfileJson } from "../catalog/profileHttpRequest";\nvoid sendProfileJson;\n`, NEW_ENTRY],
    ["变换阶段 transformProfileBody", `import { transformProfileBody } from "../catalog/profileHttpRequest";\nvoid transformProfileBody;\n`, NEW_ENTRY],
    ["模板内部 buildHttpRequest", `import { buildHttpRequest } from "../ai/requestPipeline";\nvoid buildHttpRequest;\n`, NEW_ENTRY],
    ["模板内部 renderTemplateValue", `import { renderTemplateValue } from "../ai/requestPipeline";\nvoid renderTemplateValue;\n`, NEW_ENTRY],
    ["解析器 lowerGenerationIntent", `import { lowerGenerationIntent } from "../shared/generationLowering/lowerGenerationIntent";\nvoid lowerGenerationIntent;\n`, NEW_ENTRY],
    ["并入口 withLoweredReferences", `import { withLoweredReferences } from "../shared/generationLowering/lowerGenerationIntent";\nvoid withLoweredReferences;\n`, NEW_ENTRY],
    ["同目录也没有整目录豁免", `import { lowerGenerationIntent } from "./lowerGenerationIntent";\nvoid lowerGenerationIntent;\n`, NEW_LOWERING_SIBLING],
    ["renderer 新入口", `import { lowerGenerationIntent } from "../../../../electron/shared/generationLowering/lowerGenerationIntent";\nvoid lowerGenerationIntent;\n`, NEW_RENDERER_ENTRY],
    ["runtime 只许 multipart", `import { requestJson } from "./vendor/vendorHttp";\nvoid requestJson;\n`, "electron/runtime.ts"],
  ];
  for (const [name, code, filePath] of bypasses) {
    it(`${name} → lint 红`, async () => {
      expect(await boundaryErrors(code, filePath)).not.toEqual([]);
    });
  }
});

describe("名单内的主人、普通导入不误报", () => {
  const allowed: ReadonlyArray<readonly [string, string, string]> = [
    ["装配主人发 JSON", `import { requestJson } from "../vendor/vendorHttp";\nvoid requestJson;\n`, "electron/catalog/profileHttpRequest.ts"],
    ["runtime 的 multipart", `import { requestMultipart } from "./vendor/vendorHttp";\nvoid requestMultipart;\n`, "electron/runtime.ts"],
    ["引擎 B 用发送入口", `import { sendProfileJson } from "../catalog/profileHttpRequest";\nvoid sendProfileJson;\n`, "electron/capabilityCore/apimartGenerationProvider.ts"],
    ["Run 放置用解析器", `import { lowerGenerationIntent, withLoweredReferences } from "./lowerGenerationIntent";\nvoid lowerGenerationIntent; void withLoweredReferences;\n`, "electron/shared/generationLowering/runReferences.ts"],
    ["错误类不是写接口", `import { VendorRequestError } from "../vendor/vendorHttp";\nvoid VendorRequestError;\n`, NEW_ENTRY],
    ["动态导入错误类", `export async function go() {\n  const { VendorRequestError } = await import("../vendor/vendorHttp");\n  return VendorRequestError;\n}\n`, NEW_ENTRY],
    ["类型导入", `import type { LoweredGeneration } from "../shared/generationLowering/lowerGenerationIntent";\nexport type X = LoweredGeneration;\n`, NEW_ENTRY],
    ["预览构造照旧开放", `import { buildProfileHttpRequest } from "../catalog/profileHttpRequest";\nvoid buildProfileHttpRequest;\n`, NEW_ENTRY],
    ["测试文件可以替身", `import { requestJson } from "../vendor/vendorHttp";\nvoid requestJson;\n`, "electron/capabilityCore/newGenerationEntry.test.ts"],
  ];
  for (const [name, code, filePath] of allowed) {
    it(`${name} → 不报`, async () => {
      expect(await boundaryErrors(code, filePath)).toEqual([]);
    });
  }
});
