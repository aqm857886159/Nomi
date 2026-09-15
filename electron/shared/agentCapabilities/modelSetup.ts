import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

/**
 * `model.setup.open`——把「设置 · 模型」面板打开并预填供应商，让**用户**去填 key（设计正本 §5.2 `start_model_setup`）。
 * 它碰不到密钥：输入只有一个供应商提示，输出只有「面板开了没有」。密钥永远由用户在面板里输入。
 */
export const modelSetupOpenInputSchema = z.object({ provider: z.string().trim().min(1).max(80).optional() }).strict();
export const modelSetupOpenResultSchema = z.object({ opened: z.literal(true), provider: z.string().optional() }).strict();
export type ModelSetupOpenInput = z.infer<typeof modelSetupOpenInputSchema>;
export type ModelSetupOpenResult = z.infer<typeof modelSetupOpenResultSchema>;

export const MODEL_SETUP_OPEN_CAPABILITY = {
  id: "model.setup.open",
  version: 1,
  aliases: { pi: "start_model_setup", method: "nomi_open_model_setup" },
  inputSchema: modelSetupOpenInputSchema,
  outputSchema: modelSetupOpenResultSchema,
  effect: "reversible_write",
  effectClass: "reversible_local",
  execution: { port: "document", availability: "renderer_required" },
  exposure: "internal_only",
  requiredScope: "settings:open",
  targetKind: "project",
} as const satisfies CapabilityContract<ModelSetupOpenInput, ModelSetupOpenResult>;
