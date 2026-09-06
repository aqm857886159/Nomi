import { archetypeIdForModel } from "./archetypeIdentity";
import { nativeWireProfileForArchetype, type NativeWireProfile } from "./nativeWireProfiles";
import { probeNativeEndpoint } from "./nativeEndpointProbe";
import type { ProfileKind } from "./types";
import { BUILTIN_VENDOR_KEYS } from "./relayImageEditMigration";
import { decryptApiKeyRecord } from "./secrets";
import {
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  readCatalog,
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
} from "./catalogStore";
import { logInfo } from "../logging/logger";

// ---------------------------------------------------------------------------
// 存量自愈：已经接进来的中转模型，如果这家其实提供了该模型档案的**原生端点**，就把 mapping
// 升级成那份完整报文（首尾帧/角色图/参考视频/参考音频/generate_audio 全在），用户不必删了重加。
//
// 为什么不放进 catalog 版本迁移：迁移是同步纯函数（读盘那一刻跑完），**发不了网络请求**，而
// 「这家到底有没有那个端点」只能探。所以走启动后的异步一次性体检：幂等、失败静默、不阻塞启动。
// ---------------------------------------------------------------------------

let ranThisProcess = false;

type UpgradeOutcome = { vendorKey: string; modelKey: string; archetypeId: string; upgraded: boolean; detail: string };

/** 这个模型现在用的是不是已经是该档案的原生形状（幂等判据：create.path 已是原生 path）。 */
function alreadyNative(vendorKey: string, modelKey: string, profile: NativeWireProfile): boolean {
  const nativePath = profile.create.text_to_video?.path;
  if (!nativePath) return false;
  return listModelCatalogMappings().some(
    (m) =>
      m.vendorKey === vendorKey &&
      m.taskKind === "text_to_video" &&
      (!m.modelKey || m.modelKey === modelKey) &&
      m.create?.path === nativePath,
  );
}

/**
 * 跑一轮体检。返回每个候选模型的结论（给日志/测试看）。
 * 只碰非内置 vendor（内置由 seedBuiltins 管自己的报文）。
 */
export async function upgradeRelayModelsToNativeWire(): Promise<UpgradeOutcome[]> {
  const out: UpgradeOutcome[] = [];
  const vendors = new Map(listModelCatalogVendors().map((v) => [v.key, v]));
  // 每个 (vendor, probePath) 只探一次。
  const probeCache = new Map<string, Promise<boolean>>();
  for (const model of listModelCatalogModels()) {
    if (model.kind !== "video" || BUILTIN_VENDOR_KEYS.has(model.vendorKey)) continue;
    const archetypeId = archetypeIdForModel(model.modelKey, model.modelAlias);
    const profile = nativeWireProfileForArchetype(archetypeId);
    if (!profile) continue;
    if (alreadyNative(model.vendorKey, model.modelKey, profile)) continue;
    const vendor = vendors.get(model.vendorKey);
    const baseUrl = String(vendor?.baseUrlHint || "").trim();
    if (!/^https?:\/\//i.test(baseUrl)) continue;
    const cacheKey = `${model.vendorKey}\0${profile.probePath}`;
    let pending = probeCache.get(cacheKey);
    if (!pending) {
      const apiKey = decryptApiKeyRecord(readCatalog().apiKeysByVendor[model.vendorKey]) || undefined;
      pending = probeNativeEndpoint(baseUrl, profile.probePath, apiKey).then((r) => r.exists).catch(() => false);
      probeCache.set(cacheKey, pending);
    }
    const exists = await pending;
    if (!exists) {
      out.push({ vendorKey: model.vendorKey, modelKey: model.modelKey, archetypeId: profile.archetypeId, upgraded: false, detail: "这家没有该原生端点，保持通用模板" });
      continue;
    }
    for (const [taskKind, create] of Object.entries(profile.create)) {
      if (!create) continue;
      upsertModelCatalogMapping({
        vendorKey: model.vendorKey,
        taskKind: taskKind as ProfileKind,
        modelKey: model.modelKey,
        name: `${model.labelZh || model.modelKey} · ${profile.wireName}`,
        enabled: true,
        create,
        ...(profile.query ? { query: profile.query } : {}),
        ...(profile.statusMapping ? { statusMapping: profile.statusMapping } : {}),
      });
    }
    // 诚实标注：这个模型现在走的是哪套 wire（排障与护栏都读它）。
    upsertModelCatalogModel({
      modelKey: model.modelKey,
      vendorKey: model.vendorKey,
      // archetypeId 同时标上：headless/MCP 缺参靠它兜档案默认（generate_audio 等），UI 路不受影响。
      meta: {
        ...(model.meta && typeof model.meta === "object" ? model.meta : {}),
        wireProfile: profile.archetypeId,
        archetypeId: profile.archetypeId,
      },
    });
    out.push({ vendorKey: model.vendorKey, modelKey: model.modelKey, archetypeId: profile.archetypeId, upgraded: true, detail: `升级到${profile.wireName}报文` });
  }
  return out;
}

/** 启动时调一次（不 await，失败静默）。同一进程内只跑一轮。 */
export function scheduleRelayNativeWireUpgrade(): void {
  if (ranThisProcess) return;
  ranThisProcess = true;
  void upgradeRelayModelsToNativeWire()
    .then((results) => {
      const upgraded = results.filter((r) => r.upgraded);
      if (upgraded.length) {
        logInfo("catalog", "relay-models-upgraded-to-native-wire", {
          count: upgraded.length,
          models: upgraded.map((r) => r.modelKey).join(","),
        });
      }
    })
    .catch(() => { /* 体检失败不影响使用，保持通用模板 */ });
}
