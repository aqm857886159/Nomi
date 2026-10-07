import { z } from "zod";

const primitiveEnumValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

const parameterFieldSchema = z.object({
  /**
   * `any` = 「这个键送得出去，但取值域只有供应商知道」。目录里绝大多数参数键的唯一证据就是
   * mapping 的线缆模板引用了它（`{{request.params.X}}`），模板不带类型。此前这一档不存在，
   * 于是这些键根本进不了参数表，被 `compileParameters` 当成「不支持」整包丢掉（付款卡改 2K
   * 最后发出去 1k 的根因）。写一个猜的类型比不写更糟：那是凭空造出的第二份真相源。
   */
  type: z.enum(["string", "number", "integer", "boolean", "enum", "object", "array", "any"]),
  required: z.boolean().optional(),
  enum: z.array(primitiveEnumValueSchema).min(1).optional(),
  description: z.string().optional(),
  /**
   * Declared numeric bounds. Absent means the catalog row never published a
   * range for this key — the admission boundary then says so instead of
   * inventing one (R17: judge what is judgeable, state the rest honestly).
   */
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  /**
   * 档案声明的默认值（只有档案投影出来的字段才有；目录派生的没有就不写，不猜）。
   * 准入层不读它（缺省值由供应商那一侧兜）；语义翻译读它：同一个比例有好几档像素尺寸时，
   * 「和默认同一档」是判得出的那一档（`electron/shared/aspectRatioValue.ts`）。
   */
  default: primitiveEnumValueSchema.optional(),
}).strict();

const recoveryCapabilitiesSchema = z.object({
  submitIdempotency: z.boolean(),
  query: z.boolean(),
  reconcile: z.boolean(),
  cancel: z.boolean(),
  /** Optional provider-owned terminal output extraction; older manifests may omit it. */
  materialize: z.boolean().optional(),
}).strict();

const modelProfileSchema = z.object({
  modelId: z.string().trim().min(1),
  modes: z.array(z.string().trim().min(1)).min(1),
  parameterSchema: z.record(parameterFieldSchema),
  capabilities: recoveryCapabilitiesSchema,
}).strict();

const providerProfileSchema = z.object({
  providerId: z.string().trim().min(1),
  models: z.array(modelProfileSchema).min(1),
}).strict();

export const moduleManifestSchema = z.object({
  moduleId: z.string().trim().min(1),
  version: z.string().trim().min(1),
  inputKinds: z.array(z.string().trim().min(1)).min(1),
  outputKinds: z.array(z.string().trim().min(1)).min(1),
  modes: z.array(z.string().trim().min(1)).min(1),
  parameterSchema: z.record(parameterFieldSchema),
  assetInputSchema: z.record(z.object({
    kind: z.string().trim().min(1),
    max: z.number().int().positive().optional(),
    required: z.boolean().optional(),
  }).strict()),
  providers: z.array(providerProfileSchema).min(1),
}).strict();

export type ParameterField = z.infer<typeof parameterFieldSchema>;
export type ProviderRecoveryCapabilities = z.infer<typeof recoveryCapabilitiesSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export class ModuleManifestValidationError extends Error {
  readonly code = "module_manifest_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "ModuleManifestValidationError";
  }
}

export function parseModuleManifest(value: unknown): ModuleManifest {
  try {
    return moduleManifestSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ModuleManifestValidationError(error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
    throw error;
  }
}
