// 供应商 API 端点拼接（纯函数，无 electron/IO 依赖 → 可在纯 Node 单测里直接导入）。
// 从 runtime.ts 抽出，避免测试为测 endpoint 而 import 整个 runtime（会触发 electron 加载，CI 报错）。

export type VendorEndpointInput = { key: string; baseUrlHint?: string | null };

export function endpoint(vendor: VendorEndpointInput, suffix: string): string {
  const base = String(vendor.baseUrlHint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error(`Base URL missing: ${vendor.key}`);
  // base 已是完整端点（用户把整段 ".../v1/chat/completions" 填进来）→ 原样返回
  if (suffix && base.endsWith(suffix)) return base;
  // 用户常把整段 "https://api.example.com/v1" 填进 Base URL（README 也这么教）。
  // 若 base 以任意版本段结尾（/v1、/v3、/api/v3…）、suffix 又以 /v1/ 开头，去掉 suffix
  // 冗余的 /v1，避免拼成 ".../v1/v1/..." 或 ".../api/v3/v1/..."。
  // （Moonshot 的 base=.../v1 对双 /v1 返回"没找到对象"；火山方舟 base=.../api/v3，
  //  OpenAI 兼容资源路径不带版本前缀 → 正确端点是 .../api/v3/images/generations，Issue #19。）
  if (suffix.startsWith("/v1/") && /\/v\d+$/.test(base)) {
    return `${base}${suffix.slice(3)}`;
  }
  return `${base}${suffix}`;
}
