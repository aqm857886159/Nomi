import { contentTypeFromMagicBytes } from "../assets/mediaTypes";
import { assertLocalAssetMediaBytes } from "../catalog/assetLocalization";
import { resolveAssetIngestionForKind } from "../catalog/assetIngestionRegistry";
import { inlineAssetByteLength, parseInlineDataAsset } from "../catalog/assetValueScheme";
import type { AssetMediaKind, Vendor } from "../catalog/types";
import { MEDIA_IMPORT_SURFACES } from "../shared/contracts/mediaImportPolicy";

type ReferenceVendor = Pick<Vendor, "key" | "assetIngestion" | "baseUrlHint">;

export type ProviderReferenceValueValidator = (value: unknown) => value is string;

const INLINE_REFERENCE_CAP = MEDIA_IMPORT_SURFACES["model-image-input"].hardCapBytes!;
const INLINE_HEADER = /^data:(image|video|audio)\/[a-z0-9.+-]+;base64,/i;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/;

function validInlineReference(value: string, vendor: ReferenceVendor | undefined): boolean {
  const header = INLINE_HEADER.exec(value);
  if (!header) return false;
  const kind = header[1]!.toLowerCase() as AssetMediaKind;
  if (resolveAssetIngestionForKind(vendor, kind)?.strategy !== "inline-base64") return false;
  const size = inlineAssetByteLength(value);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (size - padding > INLINE_REFERENCE_CAP) return false;
  const payload = value.slice(header[0].length);
  if (payload.length % 4 !== 0 || !BASE64_PAYLOAD.test(payload)) return false;
  const asset = parseInlineDataAsset(value);
  if (!asset || !asset.contentType.startsWith(`${kind}/`)) return false;
  if (asset.contentType !== "image/svg+xml") {
    return contentTypeFromMagicBytes(asset.bytes)?.startsWith(`${kind}/`) === true;
  }
  try {
    assertLocalAssetMediaBytes(asset, kind);
    return true;
  } catch {
    return false;
  }
}

/** The seal and provider body accept the same bounded media values for a declared channel. */
export function providerReferenceValueValidator(vendor?: ReferenceVendor): ProviderReferenceValueValidator {
  const inlineResults = new Map<string, boolean>();
  return (value): value is string => {
    if (typeof value !== "string" || !value || value.trim() !== value) return false;
    if (/^data:/i.test(value)) {
      const cached = inlineResults.get(value);
      if (cached !== undefined) return cached;
      const valid = validInlineReference(value, vendor);
      if (valid) inlineResults.set(value, valid);
      return valid;
    }
    if (!/^https?:\/\//i.test(value)) return false;
    return URL.canParse(value);
  };
}
