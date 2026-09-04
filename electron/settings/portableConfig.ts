import { z } from "zod";

const portableConfigBundleSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().min(1),
  app: z.object({ product: z.literal("Nomi") }),
  catalog: z.object({
    vendors: z.array(z.unknown()),
    models: z.array(z.unknown()),
    mappings: z.array(z.unknown()),
  }),
  defaults: z.unknown(),
  prompts: z.unknown(),
  preferences: z.object({ language: z.enum(["zh-CN", "en"]).optional(), theme: z.enum(["light", "dark"]).optional() }),
  redactions: z.object({ apiKeys: z.literal("omitted"), absolutePaths: z.literal("omitted"), deviceState: z.literal("omitted") }),
});

export type PortableConfigBundleV1 = z.infer<typeof portableConfigBundleSchema>;

const SECRET_KEYS = new Set(["apiKey", "apiKeys", "customConfig", "token", "password", "accessToken", "refreshToken"]);

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function sanitize(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.has(key)) return undefined;
  if (typeof value === "string") return isAbsolutePath(value) ? undefined : value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const next = sanitize(entryValue, entryKey);
    if (next !== undefined) output[entryKey] = next;
  }
  return output;
}

export function createPortableConfigBundle(input: {
  catalog: { vendors: unknown[]; models: unknown[]; mappings: unknown[] };
  defaults: unknown;
  prompts: unknown;
  preferences?: { language?: "zh-CN" | "en"; theme?: "light" | "dark" };
  exportedAt?: string;
}): PortableConfigBundleV1 {
  return portableConfigBundleSchema.parse({
    schemaVersion: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    app: { product: "Nomi" },
    catalog: sanitize(input.catalog),
    defaults: sanitize(input.defaults),
    prompts: sanitize(input.prompts),
    preferences: input.preferences ?? {},
    redactions: { apiKeys: "omitted", absolutePaths: "omitted", deviceState: "omitted" },
  });
}

export function parsePortableConfigBundle(payload: unknown): PortableConfigBundleV1 {
  return portableConfigBundleSchema.parse(payload);
}

export function portableConfigJson(bundle: PortableConfigBundleV1): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
