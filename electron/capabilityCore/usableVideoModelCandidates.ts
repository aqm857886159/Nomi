// 「现在有哪些视频模型能用」这份派生的唯一所有者。
//
// 之前它在 appIntegration.ts 与 mcpStdioServer.ts 里各写了一份逐字相同的副本，
// 两份都把结果**在模块装配时算一次就定住**。而钥匙常常是进程起来之后才存进来的
// （用户在设置里接入供应商、走查夹具先起 App 再写 key），于是快照那一刻还没钥匙的
// 供应商被永久判成不可用，直到重启才认——用户可见的样子是「刚接好的供应商，外部助手
// 说没有这个模型」。两份副本犯的是同一个错，stdio 那份只因进程在写钥匙之后才 spawn 才没暴露。
//
// 所以这里同时钉两件事：① 只有一份派生（第三个消费者不会再各写一遍）；
// ② 每次调用都重读目录（catalogStore 是那份可变状态的真相源），绝不缓存。
// 缓存这份结果 = 把上面那个 bug 原样请回来。
import { createCatalogAvailability } from "../catalog/catalogModelAvailability";
import { readCatalog } from "../catalog/catalogStore";
import { buildVideoModelCandidates, videoArchetypeIdFromMeta } from "../shared/videoCapabilities";

// 可用性只有一条判据（createCatalogAvailability）：旧版这里只看 `enabled`，于是外部助手
// 能从上下文里读到一个供应商已停用 / 没发布 / 没钥匙的视频模型，选了它 findExecutableModel 必拒。
export function deriveUsableVideoModelCandidates() {
  const videoCatalog = readCatalog();
  const videoAvailability = createCatalogAvailability(videoCatalog);
  return buildVideoModelCandidates(videoCatalog.models
    .filter((model) => model.kind === "video" && videoAvailability.of(model).usable)
    .map((model) => ({
      provider: model.vendorKey,
      modelKey: model.modelKey,
      label: model.labelZh,
      archetypeId: videoArchetypeIdFromMeta(model.meta),
      parameterControls: model.onboarding?.fields?.map((field) => ({
        key: field.key,
        label: field.displayName,
        type: field.type,
        options: (field.options ?? []).map((option) => ({ value: option.value, label: option.label })),
        ...(field.default === undefined ? {} : { defaultValue: field.default }),
      })),
    })));
}
