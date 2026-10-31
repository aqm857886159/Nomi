// 目录状态的版本迁移住这里，catalogStore 只负责读写与事务。
import { migrateRelayImageEditProtocols } from "./relayImageEditMigration";
import { migrateRelayVideoImageToVideo } from "./relayVideoI2vMigration";
import { migrateComfyWorkflowOutputs } from "./comfyuiWorkflowOutputMigration";
import { migrateCatalogMediaContracts } from "./catalogMediaContractMigration";
import { migrateRelayImageEditCapability, migrateRelayParamMaps } from "./relayLegacyMigrations";
import { migrateVendorFieldLossV13 } from "./vendorFieldLossRepair";
import { normalizeLegacyMappings } from "./legacyMappingMigration";
import { hasLegacyCustomConfigField } from "./customConfigStore";
import { hasLegacyNetworkConfigField } from "./networkConfigStore";
import { CURRENT_CATALOG_VERSION, type CatalogState } from "./types";
import type { ApiKeyRecord } from "./secrets";
import { logWarn } from "../logging/logger";

/**
 * In-place forward migration. Unknown future versions stay untouched. A v8
 * catalog carrying legacy plaintext custom config intentionally stays at v8
 * until an explicit credential write can migrate every secret atomically.
 */
export function migrateCatalogForward(
  state: CatalogState,
  defaultCatalog: () => CatalogState,
  writeCatalog: (state: CatalogState) => CatalogState,
): CatalogState {
  let s = state;

  if (!s.version || (s.version as number) < 1) {
    // Garbled state — fall back to defaults rather than risk corruption.
    return defaultCatalog();
  }

  if (s.version === 1) {
    // v1 → v2: tag every existing API key as plaintext so M5.2 knows what to upgrade.
    const apiKeysByVendor: Record<string, ApiKeyRecord> = {};
    for (const [k, rec] of Object.entries(s.apiKeysByVendor || {})) {
      apiKeysByVendor[k] = { ...rec, enc: rec.enc || "plain" };
    }
    s = { ...s, version: 2, apiKeysByVendor };
    writeCatalog(s);
  }

  if (s.version === 2) {
    // v2 → v3: collapse legacy {requestMapping,responseMapping} into flat
    // {create,query}. Handles three legacy shapes — bare op, v2 envelope, and
    // split create/query rows — and dedupes by (vendorKey, taskKind).
    s = { ...s, version: 3, mappings: normalizeLegacyMappings(s.mappings) };
    writeCatalog(s);
  }

  if (s.version === 3) {
    // v3 → v4: 给用户自建中转的旧图像/视频 op 补 paramMap（铁律翻译层），修「档案中性化后比例/清晰度
    // 发不出去」。只碰非内置 vendor 的 OpenAI 兼容 relay op（见 migrateRelayParamMaps）。
    const { mappings } = migrateRelayParamMaps(s.mappings);
    s = { ...s, version: 4, mappings };
    writeCatalog(s);
  }

  if (s.version === 4) {
    // v4 → v5: 存量中转 image 条目补图生图能力（image_edit mapping + supportsReferenceImages +
    // 老标准参数升级）。此前这些字段只在新接入写，老条目要「删了重加」——迁移根治（见
    // migrateRelayImageEditCapability 注释 + docs/plan/2026-07-06-i2i-reference-reliability.md）。
    const migrated = migrateRelayImageEditCapability(s);
    s = { ...migrated.state, version: 5 };
    writeCatalog(s);
  }

  if (s.version === 5) {
    // v5 → v6：同一中转的不同图片模型按真实 image_edit 协议精确分流；存量 Grok 自动修复，无需删后重加。
    const migrated = migrateRelayImageEditProtocols(s);
    s = { ...migrated.state, version: 6 };
    writeCatalog(s);
  }

  if (s.version === 6) {
    // v6 → v7：**重跑**协议分流。v6 迁移跑在「gpt-image/dall-e-2 还没接 OpenAI multipart edits」之前，
    // 故存量 gpt-image-2 等被留在 chat/completions（图生图在只认 /v1/images/edits 的中转站接不上）。
    // migrateRelayImageEditProtocols 幂等，重跑即按新智能默认把 gpt-image/dall-e-2 升到 multipart。
    // 无版本 bump 就不会重跑（v6 已是终版）——所以必须 bump 到 v7 强制存量用户也升级。
    const migrated = migrateRelayImageEditProtocols(s);
    s = { ...migrated.state, version: 7 };
    writeCatalog(s);
  }

  if (s.version === 7) {
    // v7 → v8：存量中转 video 条目补「图生视频」通道（image_to_video mapping）。接入路径此前只建
    // text_to_video，视频节点一连参考图就报「没有配置图生视频通道 · 请删除后重新接入」——而重接
    // 也不会建（根因在接入路径，已同 commit 修）。迁移让存量直接可用，不必删了重加。
    const migrated = migrateRelayVideoImageToVideo(s);
    s = { ...migrated.state, version: 8 };
    writeCatalog(s);
  }

  if (s.version === 8) {
    const hasLegacyCustomConfig = s.vendors.some(hasLegacyCustomConfigField);
    if (!hasLegacyCustomConfig) {
      s = { ...s, version: 9 };
      writeCatalog(s);
    }
  }

  if (s.version === 9) {
    s = { ...migrateComfyWorkflowOutputs(s), version: 10 };
    writeCatalog(s);
  }

  if (s.version === 10) {
    const before = s;
    const migrated = migrateCatalogMediaContracts(s);
    s = migrated.unresolved ? migrated.state : { ...migrated.state, version: 11 };
    if (!migrated.unresolved || migrated.state !== before) writeCatalog(s);
    if (migrated.unresolved) logWarn("catalog", "v11-media-migration-unresolved");
  }

  if (s.version === 11) {
    // v11 → v12: credential-bearing network config (proxyUrl / extraHeaders) moves to the
    // encrypted credential record. Like v8→v9 customConfig, defer the secret encryption until
    // an explicit vendor write can migrate every secret atomically — a plain forward read must
    // not open the keychain to re-encrypt. Advance the version only when nothing legacy remains.
    const hasLegacyNetworkConfig = s.vendors.some(hasLegacyNetworkConfigField);
    if (!hasLegacyNetworkConfig) {
      s = { ...s, version: 12 };
      writeCatalog(s);
    }
  }

  // v12 → v13: 补回被上一版 upsert 抹掉的 authScheme / assetIngestion，补不了的自建家盖一条可见提示
  // （判据、以及「为什么是一次性迁移而不是加载时补齐」都在 vendorFieldLossRepair.ts）。
  if (s.version === 12) {
    s = migrateVendorFieldLossV13(s);
    writeCatalog(s);
  }

  if ((s.version as number) > CURRENT_CATALOG_VERSION) {
    // Newer file than this app understands — return it untouched so it stays
    // readable, and let `writeCatalog` REFUSE any write back (read-only guard).
    // This actually enforces "don't downgrade" instead of only warning about it.
    logWarn("catalog", "file-newer-than-app-readonly", { fileVersion: s.version, appVersion: CURRENT_CATALOG_VERSION });
    return s;
  }

  return s;
}
