import crypto from "node:crypto";
import path from "node:path";

import type { HardenedFetchResult } from "../hardenedFetch";
import { writeDeterministicAsset } from "../assets/projectAssetStore";
import { exceedsProviderMediaCap, fetchProviderMedia, type ProviderMediaFetchOptions } from "../assets/providerMediaFetch";
import type { ProviderNetworkConfig } from "../providerNetwork";
import { readCatalog } from "../catalog/catalogStore";
import { parseDataUrl } from "../assets/assetBytes";
import type { GenerationProviderOutput } from "./generationRuntimeAdapter";

type StoredAsset = {
  id?: unknown;
  data?: { relativePath?: unknown; thumbnailRelativePath?: unknown; contentType?: unknown };
};

export type GenerationOutputMaterializerDependencies = {
  /**
   * 取回产物字节。缺省就是普通生成本地化用的那一条（`fetchProviderMedia`：同一组超时 / 上限 /
   * 供应商线路）。**这里不再自带任何数字**——2026-09-25 之前它只给了 maxBytes，超时落回 hardenedFetch
   * 的缺省 20 秒，于是一段 15 秒的成片普通生成落得下来、付费卡这条路永远下载超时，节点一直转圈。
   */
  fetchOutput?: (url: string, options: ProviderMediaFetchOptions) => Promise<HardenedFetchResult>;
  writeAsset?: typeof writeDeterministicAsset;
  /** 仅 E2E 回环夹具：主进程装配点给的精确 origin（`fetchProviderMedia` 的 trustedPrivateOrigin）。 */
  trustedPrivateOrigin?: string;
  /** 这家供应商自己的线路（`Vendor.network`）。缺省读当前目录——与普通生成 localizeTaskAsset 读的是同一份。 */
  resolveProviderNetwork?: (providerId: string) => ProviderNetworkConfig | undefined;
};

function catalogProviderNetwork(providerId: string): ProviderNetworkConfig | undefined {
  return readCatalog().vendors.find((vendor) => vendor.key === providerId)?.network;
}

export type GenerationOutputMaterializationReceipt = {
  artifactId: string;
  kind: GenerationProviderOutput["kind"];
  contentHash: string;
  projectRelativePath: string;
  thumbnailRelativePath?: string;
};

function extensionFor(kind: GenerationProviderOutput["kind"]): string {
  return kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : kind === "model3d" ? ".glb" : ".png";
}

function allowedContentTypesFor(kind: GenerationProviderOutput["kind"]): readonly string[] {
  return kind === "model3d" ? ["model/gltf-binary", "application/octet-stream"] : [`${kind}/`, "application/octet-stream"];
}

function contentTypeMatchesKind(kind: GenerationProviderOutput["kind"], contentType: string): boolean {
  if (contentType === "application/octet-stream") return true;
  return kind === "model3d" ? contentType === "model/gltf-binary" : contentType.startsWith(`${kind}/`);
}

function fileNameFor(output: GenerationProviderOutput): string {
  if (output.fileName?.trim()) return output.fileName.trim();
  try {
    const candidate = path.basename(new URL(output.url).pathname);
    if (candidate && candidate !== ".") return candidate;
  } catch {
    // The data URL path has no useful filename; use a safe media extension below.
  }
  return `generation-output${extensionFor(output.kind)}`;
}

function contentHash(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function createGenerationOutputMaterializer(deps: GenerationOutputMaterializerDependencies = {}) {
  const fetchOutput = deps.fetchOutput ?? fetchProviderMedia;
  const storeAsset = deps.writeAsset ?? writeDeterministicAsset;

  async function materialize(input: {
    projectId: string;
    providerTaskId: string;
    output: GenerationProviderOutput;
    /** 产出这条 URL 的那家供应商。取回走它自己的线路（与普通生成的 localizeTaskAsset 同一条：谁产的 URL 就用谁的路）。 */
    providerId?: string;
  }): Promise<GenerationOutputMaterializationReceipt> {
    const allowedContentTypes = allowedContentTypesFor(input.output.kind);
    const providerNetwork = input.providerId ? (deps.resolveProviderNetwork ?? catalogProviderNetwork)(input.providerId) : undefined;
    const route: ProviderMediaFetchOptions = {
      ...(deps.trustedPrivateOrigin ? { trustedPrivateOrigin: deps.trustedPrivateOrigin } : {}),
      ...(providerNetwork ? { providerNetwork } : {}),
    };
    let bytes: Buffer;
    let contentType = input.output.contentType || "application/octet-stream";
    if (input.output.url.startsWith("data:")) {
      const parsed = parseDataUrl(input.output.url);
      if (exceedsProviderMediaCap(parsed.bytes.byteLength)) throw new Error(`Generation output is too large (${parsed.bytes.byteLength} bytes)`);
      bytes = parsed.bytes;
      contentType = parsed.contentType;
    } else {
      const fetched = await fetchOutput(input.output.url, { ...route, allowContentTypes: allowedContentTypes });
      bytes = fetched.bytes;
      contentType = fetched.contentType || contentType;
    }
    const normalizedType = contentType.toLowerCase().split(";")[0]?.trim() || "application/octet-stream";
    if (!contentTypeMatchesKind(input.output.kind, normalizedType)) {
      throw new Error(`Generation output content type does not match ${input.output.kind}`);
    }
    const materializationKey = `${input.providerTaskId}:${input.output.providerOutputId || input.output.url}`;
    const stored = storeAsset(input.projectId, bytes, fileNameFor(input.output), normalizedType, {
      kind: "generated",
      source: "external-mcp",
      providerTaskId: input.providerTaskId,
      ...(input.output.providerOutputId ? { providerOutputId: input.output.providerOutputId } : {}),
    }, materializationKey) as StoredAsset;
    const artifactId = typeof stored.id === "string" ? stored.id.trim() : "";
    const projectRelativePath = typeof stored.data?.relativePath === "string" ? stored.data.relativePath.trim() : "";
    const thumbnailRelativePath = typeof stored.data?.thumbnailRelativePath === "string" ? stored.data.thumbnailRelativePath.trim() : "";
    if (!artifactId || !projectRelativePath) throw new Error("Asset store returned an incomplete generation receipt");
    let posterPath = thumbnailRelativePath;
    if (!posterPath && input.output.kind === "video" && input.output.thumbnailUrl) {
      const poster = await fetchOutput(input.output.thumbnailUrl, { ...route, allowContentTypes: ["image/", "application/octet-stream"] });
      const posterType = (poster.contentType || "image/png").toLowerCase().split(";")[0]?.trim() || "image/png";
      if (!posterType.startsWith("image/")) throw new Error("Generation poster content type does not match image");
      const posterStored = storeAsset(input.projectId, poster.bytes, `${path.parse(fileNameFor(input.output)).name}-poster.png`, posterType, {
        kind: "generated", source: "external-mcp", providerTaskId: input.providerTaskId,
        providerOutputId: `${input.output.providerOutputId || input.output.url}:poster`,
      }, `${materializationKey}:poster`) as StoredAsset;
      posterPath = typeof posterStored.data?.relativePath === "string" ? posterStored.data.relativePath.trim() : "";
    }
    return {
      artifactId,
      kind: input.output.kind,
      contentHash: contentHash(bytes),
      projectRelativePath,
      ...(posterPath ? { thumbnailRelativePath: posterPath } : {}),
    };
  }

  return { materialize };
}

export type GenerationOutputMaterializer = ReturnType<typeof createGenerationOutputMaterializer>;
