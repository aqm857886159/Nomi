// 供应商 API 端点拼接（纯函数，无 electron/IO 依赖 → 可在纯 Node 单测里直接导入）。
// 从 runtime.ts 抽出，避免测试为测 endpoint 而 import 整个 runtime（会触发 electron 加载，CI 报错）。
//
// P1 单一真相源：拼接 + 版本段去重逻辑只活在 joinUrl（requestPipeline.ts，生产 operation 路径
// 与 onboarding test-curl 共用）。endpoint() 只在它之上加「base 缺失带 vendor.key 报错」一层，
// 不再平行实现去重——此前两套去重漂移，joinUrl 缺版本去重，导致 code-newcli-com 拼成
// ".../codex/v1/v1/images/generations" 404（vendorEndpoint 有去重、joinUrl 没有）。
import { joinUrl } from "./ai/requestPipeline";

export type VendorEndpointInput = { key: string; baseUrlHint?: string | null };

export function endpoint(vendor: VendorEndpointInput, suffix: string): string {
  const base = String(vendor.baseUrlHint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error(`Base URL missing: ${vendor.key}`);
  return joinUrl(base, suffix);
}
