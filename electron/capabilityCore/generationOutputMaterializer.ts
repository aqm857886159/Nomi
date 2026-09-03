import crypto from "node:crypto";
import path from "node:path";

import { hardenedFetch, type HardenedFetchResult } from "../hardenedFetch";
import { writeDeterministicAsset } from "../assets/projectAssetStore";
import { parseDataUrl } from "../assets/assetBytes";
import type { GenerationProviderOutput } from "./generationRuntimeAdapter";

type StoredAsset = {
  id?: unknown;
  data?: { relativePath?: unknown; thumbnailRelativePath?: unknown; contentType?: unknown };
};

export type GenerationOutputMaterializerDependencies = {
  fetchOutput?: (url: string, options: { allowContentTypes: readonly string[]; maxBytes: number }) => Promise<HardenedFetchResult>;
  writeAsset?: typeof writeDeterministicAsset;
  maxBytes?: number;
};

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
  const maxBytes = deps.maxBytes ?? 128 * 1024 * 1024;
  const fetchOutput = deps.fetchOutput ?? ((url, options) => hardenedFetch(url, options));
  const storeAsset = deps.writeAsset ?? writeDeterministicAsset;

  async function materialize(input: { projectId: string; providerTaskId: string; output: GenerationProviderOutput }): Promise<GenerationOutputMaterializationReceipt> {
    const allowedContentTypes = allowedContentTypesFor(input.output.kind);
    let bytes: Buffer;
    let contentType = input.output.contentType || "application/octet-stream";
    if (input.output.url.startsWith("data:")) {
      const parsed = parseDataUrl(input.output.url);
      if (parsed.bytes.byteLength > maxBytes) throw new Error(`Generation output exceeds ${maxBytes} bytes`);
      bytes = parsed.bytes;
      contentType = parsed.contentType;
    } else {
      const fetched = await fetchOutput(input.output.url, { allowContentTypes: allowedContentTypes, maxBytes });
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
      const poster = await fetchOutput(input.output.thumbnailUrl, { allowContentTypes: ["image/", "application/octet-stream"], maxBytes });
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
