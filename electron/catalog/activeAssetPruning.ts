// 本地化前后对请求体做的两件小事（从 assetLocalization.ts 原样搬出，行为不变；那个文件在体积门岗上冻结着，
// 新增决定逻辑要腾地方，这两个只被它自己用的纯函数是最干净的一块）：
//   · pruneInactiveLocalAssets：渲染层给了「当前还在用的素材」名单时，剪掉请求里画布上早已过期的残留引用；
//   · stripTransportHints：内部传输提示（activeAssetUrls）只给本地上传策略看，绝不能泄漏到供应商请求体。
import { classifyAssetValue, isLocalizableAssetValue } from "./assetValueScheme";

export function pruneInactiveLocalAssets(value: unknown, active: ReadonlySet<string>): unknown {
  // 内联字节永远算「活的」：它是本次请求**当场带进来**的，不可能是画布上早已过期的残留引用
  // （剪枝要解决的是那个）。若按 activeAssetUrls 名单剪，调用方自己拼名单时漏了它 = 参考被
  // 静默丢掉照样出图照样扣费——这是本次修复最不该复制的失败形状。
  if (classifyAssetValue(value) === "inline-data") return value;
  if (isLocalizableAssetValue(value)) return active.has(value as string) ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => pruneInactiveLocalAssets(item, active)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = pruneInactiveLocalAssets(item, active);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
}

/** 内部传输提示只给本地上传策略使用，绝不能泄漏到供应商请求体。 */
export function stripTransportHints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTransportHints);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "activeAssetUrls") continue;
      out[key] = stripTransportHints(item);
    }
    return out;
  }
  return value;
}
