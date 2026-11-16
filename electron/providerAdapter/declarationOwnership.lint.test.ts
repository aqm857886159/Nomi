/**
 * 新模型「怎么调、对不对」只有一个家：名单外的新文件拿不到这些判断，接入目录里也不许再手写一份。
 * 第一半用仓库自己的 ESLint 配置对虚拟文件跑 lintText（规则就是 eslint.config.mjs 的 DECLARATION_HOME_GROUPS，没有第二份）。
 * 第二半是形状检查：接入相关目录里，不许出现「哪些任务要参考槽」「任务属于哪种模型」的手抄清单 / 表，或 `startsWith("image_")` 这类按名字猜（语义的主人在 shared 层，这里只读）。
 */
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const NEW_ENTRY = "electron/capabilityCore/modelOnboarding/newOnboardingEntry.ts";

async function homeErrors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2 && /^declaration-/.test(message.ruleId ?? ""))
    .map((message) => `${message.ruleId}: ${message.message}`);
}

describe("新入口拿不到调用判断", () => {
  const bypasses: ReadonlyArray<readonly [string, string, string]> = [
    ["自己拼内置模板草稿", `import { buildOpenAiCompatibleDraft } from "../../providerAdapter/builtinOpenAiCompatibleDraft";\nvoid buildOpenAiCompatibleDraft;\n`, NEW_ENTRY],
    ["自己选内置模板", `import { genericCompilation } from "../../providerAdapter/serviceFallback";\nvoid genericCompilation;\n`, NEW_ENTRY],
    ["外部卡走编译器专用口", `import { validateCompiledAdapterDraft } from "../../providerAdapter/validator";\nvoid validateCompiledAdapterDraft;\n`, NEW_ENTRY],
    ["登记处自己判中性键", `import { assertNeutralDeclarationParameters } from "../providerAdapter/promotionMeta";\nvoid assertNeutralDeclarationParameters;\n`, "electron/catalog/declaredProviderRegistration.ts"],
    ["自己判模式语义", `import { adapterModeDefect } from "../../providerAdapter/validator";\nvoid adapterModeDefect;\n`, NEW_ENTRY],
    ["再导出", `export { validateCompiledAdapterDraft } from "../../providerAdapter/validator";\n`, NEW_ENTRY],
    ["动态导入后解构", `export async function go() {\n  const { genericCompilation } = await import("../../providerAdapter/serviceFallback");\n  return genericCompilation;\n}\n`, NEW_ENTRY],
    ["require", `export const v = require("../../providerAdapter/validator");\n`, NEW_ENTRY],
    ["同目录也不豁免", `import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";\nvoid buildOpenAiCompatibleDraft;\n`, "electron/providerAdapter/service.ts"],
  ];
  for (const [name, code, filePath] of bypasses) {
    it(`${name} → lint 红`, async () => {
      expect(await homeErrors(code, filePath)).not.toEqual([]);
    });
  }
});

describe("主人和收件口不误报", () => {
  const allowed: ReadonlyArray<readonly [string, string, string]> = [
    ["外部卡唯一收件口", `import { validateProviderAdapterDraft } from "../../providerAdapter/validator";\nvoid validateProviderAdapterDraft;\n`, NEW_ENTRY],
    ["编译器用专用口", `import { validateCompiledAdapterDraft } from "./validator";\nvoid validateCompiledAdapterDraft;\n`, "electron/providerAdapter/compiler.ts"],
    ["serviceCompilation 选内置模板", `import { genericCompilation } from "./serviceFallback";\nvoid genericCompilation;\n`, "electron/providerAdapter/serviceCompilation.ts"],
    ["serviceFallback 产出草稿", `import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";\nvoid buildOpenAiCompatibleDraft;\n`, "electron/providerAdapter/serviceFallback.ts"],
    ["validator 判中性键", `import { assertNeutralDeclarationParameters } from "./promotionMeta";\nvoid assertNeutralDeclarationParameters;\n`, "electron/providerAdapter/validator.ts"],
    ["selfCheck 转述", `import { adapterModeDefect } from "./validator";\nvoid adapterModeDefect;\n`, "electron/providerAdapter/selfCheck.ts"],
    ["类型导入", `import type { AdapterModeDefectCode } from "../../providerAdapter/validator";\nexport type X = AdapterModeDefectCode;\n`, NEW_ENTRY],
    ["测试文件可以替身", `import { genericCompilation } from "../../providerAdapter/serviceFallback";\nvoid genericCompilation;\n`, "electron/capabilityCore/modelOnboarding/newOnboardingEntry.test.ts"],
  ];
  for (const [name, code, filePath] of allowed) {
    it(`${name} → 不红`, async () => {
      expect(await homeErrors(code, filePath)).toEqual([]);
    });
  }
});

describe("接入目录里没有第二份「要不要参考槽」的判断", () => {
  const ROOT = path.resolve(__dirname, "../..");
  // catalog 目录只看声明登记这一个文件：其余是 ComfyUI 工作流等别的家，按自己的任务表办事。
  const DIRS = ["electron/providerAdapter", "electron/capabilityCore/modelOnboarding", "electron/integrationCertification"];
  const EXTRA_FILES = ["electron/catalog/declaredProviderRegistration.ts"];
  /** 只看代码：注释里讲历史（「此前这里用的是 startsWith(...)」）不算第二份判断。 */
  const code = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // 这些语义的主人在 shared 层（PROFILE_KIND_REFERENCE_CHANNEL / modelKindForTaskKind / billingKindForTaskKind），
  // validator 与 promotionMeta 只读它们，所以接入目录里**没有任何文件**可以手写，主人自己也不例外。
  const SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
    ["按任务名前缀猜参考槽", /startsWith\(\s*["'`]image_/],
    ["手写要参考的任务清单", /\[\s*["'`](?:image_to_video|image_edit|image_to_3d)["'`]\s*,\s*["'`](?:image_to_video|image_edit|image_to_3d)["'`]/],
    ["手抄任务→模型类型表", /\b(?:text_to_image|image_to_audio|text_to_video)["'`]?\s*:\s*["'`](?:image|audio|video)["'`]/],
  ];
  const files = DIRS.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes("__"))
    .map((name) => path.posix.join(dir, name.split(path.sep).join("/"))))
    .concat(EXTRA_FILES);

  it("扫得到文件（防止目录改名后空扫）", () => {
    expect(files.length).toBeGreaterThan(20);
  });
  for (const [name, shape] of SHAPES) {
    it(`${name}：接入目录里没有`, () => {
      const hits = files.filter((file) => shape.test(code(file)));
      expect(hits).toEqual([]);
    });
  }
});
