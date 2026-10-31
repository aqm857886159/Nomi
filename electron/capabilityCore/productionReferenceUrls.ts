import { readCatalog } from '../catalog/catalogStore';
import type { ReferenceLinkPolicy } from '../catalog/assetLocalization';
import { assetIngestionResolver, assetLocalizationOptions, localizeForSend, referenceLinkPolicy } from '../catalog/assetTransportRuntime';
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload, putBinaryForAssetUpload } from '../assets/localAssetFile';
import { projectSpendReferenceAssets, type SpendReferenceAssets } from './pendingSpendReferences';
import { spendReferenceKey } from '../shared/contracts/pendingSpendConfirm';
import type { GenerationReference } from '../shared/agentCapabilities/generationPlanSchemas';

/** Existing asset transport performs uploads before the deterministic request seal. */
async function localize(providerId: string, urls: readonly string[]): Promise<readonly string[]> {
  const catalog = readCatalog();
  const vendor = catalog.vendors.find(vendor => vendor.key === providerId);
  if (!vendor) throw new Error('generation_reference_provider_unavailable');
  const result = await localizeForSend({ urls }, assetIngestionResolver(vendor, catalog),
    readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload,
    assetLocalizationOptions(vendor, undefined), putBinaryForAssetUpload);
  const values = (result.value as { urls?: unknown }).urls;
  if (!Array.isArray(values) || values.length !== urls.length || values.some(value => typeof value !== 'string' || !/^https?:\/\//.test(value))) {
    throw new Error('generation_reference_url_unavailable');
  }
  return values;
}

export async function resolveProductionReferenceUrls(input: Readonly<{
  projectId: string;
  providerId: string;
  references: readonly GenerationReference[];
  assertCurrent: () => void;
}>, deps: Readonly<{
  assets: SpendReferenceAssets;
  localize: typeof localize;
}> = { assets: projectSpendReferenceAssets, localize }): Promise<Readonly<Record<string, string>>> {
  input.assertCurrent();
  if (input.references.length === 0) return {};
  const indexed = deps.assets.list(input.projectId);
  const verify = (reference: GenerationReference): void => {
    const identity = deps.assets.identity(input.projectId, reference.assetId);
    if (!identity || identity.contentHash !== reference.contentHash || identity.version !== reference.version) {
      throw new Error('generation_reference_identity_changed');
    }
  };
  const urls = input.references.map(reference => {
    verify(reference);
    const asset = indexed.find(asset => asset.id === reference.assetId);
    if (!asset || typeof asset.data.url !== 'string') throw new Error('generation_reference_asset_unavailable');
    if (reference.kind && (typeof asset.data.contentType !== 'string' || !asset.data.contentType.startsWith(`${reference.kind}/`))) {
      throw new Error('generation_reference_kind_mismatch');
    }
    return asset.data.url;
  });
  const localized = await deps.localize(input.providerId, urls);
  input.assertCurrent();
  input.references.forEach(verify);
  if (localized.length !== input.references.length) throw new Error('generation_reference_url_unavailable');
  return Object.fromEntries(input.references.map((reference, index) => [spendReferenceKey(reference), localized[index]]));
}

/** 这条连接此刻的链接处置（拒绝过没有 + 怎么试探）；连接不在目录里 = 没有，调用方沿用原来的。 */
function linkPolicyOf(providerId: string): ReferenceLinkPolicy | null {
  const vendor = readCatalog().vendors.find((candidate) => candidate.key === providerId);
  return vendor ? referenceLinkPolicy(vendor) : null;
}

/**
 * 做片返工：沿用上一次批准冻住的链接表，还是重新换链接？
 *
 * 以前一律沿用（同一份合同、同一批参考，不因为「又一份授权」去重新上传一遍）。可冻住的是**当时**发出去的链接：
 * 其中一条是服务商的临时链接时，它会过期、会被拦，返工发的还是同一条死链接，模型再拒一次、再扣一次。
 * 所以只在两种情况下重新走 `resolveProductionReferenceUrls`（经唯一决定点 `localizeAssetsForVendor`）：
 *   ① 这条连接的模型拒绝过临时链接；② 冻住的链接试探明确失效（判断不了不算）。
 * 其余照旧沿用、不重传——没记过拒绝、链接也没死的返工，行为一字不变。返回 `undefined` = 沿用。
 */
export async function reworkReferenceUrls(
  input: Readonly<{
    projectId: string;
    providerId: string;
    references: readonly GenerationReference[];
    frozen: Readonly<Record<string, string>> | undefined;
    assertCurrent: () => void;
  }>,
  deps: Readonly<{
    policyOf: (providerId: string) => ReferenceLinkPolicy | null;
    resolve: typeof resolveProductionReferenceUrls;
  }> = { policyOf: linkPolicyOf, resolve: resolveProductionReferenceUrls },
): Promise<Readonly<Record<string, string>> | undefined> {
  if (!input.frozen || input.references.length === 0) return undefined;
  const policy = deps.policyOf(input.providerId);
  if (!policy) return undefined;
  const stale = policy.refused || (await Promise.all(Object.values(input.frozen).map((url) => policy.probe(url)))).includes('dead');
  if (!stale) return undefined;
  return deps.resolve({ projectId: input.projectId, providerId: input.providerId, references: input.references, assertCurrent: input.assertCurrent });
}
