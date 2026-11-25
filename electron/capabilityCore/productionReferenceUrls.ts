import { providerReferenceValueValidator, type ProviderReferenceValueValidator } from './generationProviderReferenceValue';
import { matchNomiErrorCode } from '../shared/nomiErrorCodes';
import { readCatalog } from '../catalog/catalogStore';
import { assetUploadChannelKind, referenceNeedsUpload, type ReferenceLinkPolicy, type IngestionResolver } from '../catalog/assetLocalization';
import { assetIngestionResolver, assetLocalizationOptions, localizeForSend, referenceLinkPolicy } from '../catalog/assetTransportRuntime';
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload, putBinaryForAssetUpload } from '../assets/localAssetFile';
import { projectSpendReferenceAssets, type SpendReferenceAssets } from './pendingSpendReferences';
import { spendReferenceKey } from '../shared/contracts/pendingSpendConfirm';
import type { GenerationReference } from '../shared/agentCapabilities/generationPlanSchemas';

type LocalizeProductionReferenceUrlsDeps = Readonly<{
  readCatalog: typeof readCatalog;
  localizeForSend: typeof localizeForSend;
  assetIngestionResolver: typeof assetIngestionResolver;
  assetLocalizationOptions: typeof assetLocalizationOptions;
}>;

const DEFAULT_LOCALIZE_DEPS: LocalizeProductionReferenceUrlsDeps = {
  readCatalog,
  localizeForSend,
  assetIngestionResolver,
  assetLocalizationOptions,
};

/**
 * Existing asset transport performs uploads before the deterministic request seal.
 * 不改写 localizeForSend 抛出的 asset-too-large / asset-upload-failed 首行本地化通道摘要
 * （也不覆盖 AnonymousAssetConsentRequiredError 自身的 hostingDisabled 文案，NF-1107-0002），
 * 同时截断换行后的诊断明细，避免文件名或签名 URL 经由错误消息外泄（#1638）。
 */
export async function localizeProductionReferenceUrls(
  providerId: string,
  urls: readonly string[],
  deps: LocalizeProductionReferenceUrlsDeps = DEFAULT_LOCALIZE_DEPS,
): Promise<readonly string[]> {
  const catalog = deps.readCatalog();
  const vendor = catalog.vendors.find(vendor => vendor.key === providerId);
  if (!vendor) throw new Error('generation_reference_provider_unavailable');
  const result = await deps.localizeForSend({ urls }, deps.assetIngestionResolver(vendor, catalog),
    readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload,
    deps.assetLocalizationOptions(vendor, undefined), putBinaryForAssetUpload).catch((error: unknown) => {
      // Only the first line is the localized channel summary. The detail can contain file names or signed URLs.
      if (error instanceof Error && error.message.includes('\n')) {
        const code = matchNomiErrorCode(error.message);
        if (code === 'asset-upload-failed' || code === 'asset-too-large') throw new Error(error.message.split('\n')[0]);
      }
      throw error;
    });
  const values = (result.value as { urls?: unknown }).urls;
  if (!Array.isArray(values) || values.length !== urls.length || !values.every(providerReferenceValueValidator(vendor))) {
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
  localize: (providerId: string, urls: readonly string[]) => Promise<readonly string[]>;
}> = { assets: projectSpendReferenceAssets, localize: localizeProductionReferenceUrls }): Promise<Readonly<Record<string, string>>> {
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

type ReworkReferencePolicy = ReferenceLinkPolicy & {
  channels: IngestionResolver;
  isDeliverable: ProviderReferenceValueValidator;
};

function linkPolicyOf(providerId: string): ReworkReferencePolicy | null {
  const catalog = readCatalog();
  const vendor = catalog.vendors.find(candidate => candidate.key === providerId);
  return vendor ? {
    ...referenceLinkPolicy(vendor),
    channels: assetIngestionResolver(vendor, catalog),
    isDeliverable: providerReferenceValueValidator(vendor),
  } : null;
}

/** Reuse the frozen receipt unless its current probe and delivery channels require replacement. */
export async function reworkReferenceUrls(
  input: Readonly<{
    projectId: string;
    providerId: string;
    references: readonly GenerationReference[];
    frozen: Readonly<Record<string, string>> | undefined;
    assertCurrent: () => void;
  }>,
  deps: Readonly<{
    policyOf: (providerId: string) => ReworkReferencePolicy | null;
    resolve: typeof resolveProductionReferenceUrls;
  }> = { policyOf: linkPolicyOf, resolve: resolveProductionReferenceUrls },
): Promise<Readonly<Record<string, string>> | undefined> {
  if (!input.frozen || input.references.length === 0) return undefined;
  const policy = deps.policyOf(input.providerId);
  if (!policy) return undefined;
  const references = new Map(input.references.map(ref => [spendReferenceKey(ref), ref]));
  let indexed: ReturnType<SpendReferenceAssets['list']> | undefined;
  const stale = await Promise.all(Object.entries(input.frozen).map(async ([key, url]) => {
    // Inline bytes have no link to probe. If the channel changed, re-localize the pinned asset.
    if (/^data:/i.test(url)) return !policy.isDeliverable(url);
    const verdict = await policy.probe(url);
    return referenceNeedsUpload(verdict, () => {
      const ref = references.get(key);
      if (!ref) return [];
      if (ref.kind) return policy.channels(ref.kind);
      indexed ??= projectSpendReferenceAssets.list(input.projectId);
      const mime = indexed.find(asset => asset.id === ref.assetId)?.data.contentType;
      return typeof mime === 'string' ? policy.channels(assetUploadChannelKind(mime)) : [];
    });
  }));
  if (!stale.some(Boolean)) return undefined;
  return deps.resolve({ projectId: input.projectId, providerId: input.providerId, references: input.references, assertCurrent: input.assertCurrent });
}
