// 阶跃星辰（StepFun）供应商种子 —— 标准 OpenAI 兼容端点。
// API 形状：POST https://api.stepfun.com/v1/chat/completions，Bearer key。
// 文档：platform.stepfun.com/docs/guide/api-reference/text/text

export const STEPFUN_VENDOR_SEED = {
  key: "stepfun",
  name: "阶跃星辰",
  baseUrl: "https://api.stepfun.com/v1",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;
