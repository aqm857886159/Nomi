import type { BillingModelKind } from "./types";

type TestInputOverride = {
  prompt?: string;
  params?: Record<string, unknown>;
};

function defaultPrompt(kind: BillingModelKind): string {
  if (kind === "video") return "a red apple rolling on a wooden table, soft daylight";
  if (kind === "text") return "Reply with exactly: Nomi test OK";
  if (kind === "audio") return "Hello from the Nomi API test";
  if (kind === "model3d") return "a simple red apple on a plain background";
  return "a red apple on a wooden table, soft daylight, studio photo";
}

/**
 * 试跑默认仍保持低成本，但允许用户把真实模式的参数原样带进来。这样首尾帧、多参考、
 * 参考视频/音频等问题可以在保存脚本前复现，而不是被固定文生样例制造假绿灯。
 */
export function buildCustomCallTestInput(kind: BillingModelKind, override: TestInputOverride): {
  prompt: string;
  params: Record<string, unknown>;
} {
  const baseParams = kind === "video" ? { duration: 5, n: 1 } : { n: 1 };
  return {
    prompt: override.prompt?.trim() || defaultPrompt(kind),
    params: { ...baseParams, ...(override.params || {}) },
  };
}
