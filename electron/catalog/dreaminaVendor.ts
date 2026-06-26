// 即梦官方 dreamina CLI 供应商种子。
// 与众不同：它不是 HTTP 端点，而是**本地命令行二进制**（spawn dreamina，见 processOperation.ts）。
//   - authType "none"：凭证不是 HTTP bearer key，而是设备码 OAuth 登录态（dreamina 自己存在 ~/.dreamina_cli）。
//     登录态 + 「是否高级会员/maestro vip」由 dreaminaLoginIpc 检测，接入卡据此 derive 可用性（非 hasApiKey）。
//   - baseUrl 空：CLI 无 HTTP base，op 走 process 声明而非 path。
//   - 门槛诚实：dreamina 生成仅「高级会员 / maestro vip」可用（非任意即梦会员）——接入卡明示，未达档不让点跑。
export const DREAMINA_VENDOR_SEED = {
  key: "dreamina",
  name: "即梦会员（本地 CLI）",
  baseUrl: "",
  authType: "none" as const,
  authHeader: null,
} as const;
