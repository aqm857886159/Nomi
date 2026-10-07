import crypto from "node:crypto";
import path from "node:path";

import { hardenedFetchDiagnostics, type HardenedFetchResult } from "../hardenedFetch";
import { isOutboundDestinationRefusedError } from "../networkOutboundPolicy";
import { logWarn } from "../logging/logger";
import { OUTPUT_RETRIEVAL_FAILED } from "../productionRun/productionRunTypes";
import { GeneratedMediaValidationError } from "../assets/generatedMediaDecode";
import { stripNomiErrorCode } from "../shared/nomiErrorCodes";
import { writeDeterministicAsset } from "../assets/projectAssetStore";
import { exceedsProviderMediaCap, fetchProviderMedia, type ProviderMediaFetchOptions } from "../assets/providerMediaFetch";
import type { Vendor } from "../catalog/types";
import { readCatalog } from "../catalog/catalogStore";
import { trustedRetrievalOrigin } from "../vendor/vendorOutboundGuard";
import { parseDataUrl } from "../assets/assetBytes";
import type { GenerationProviderOutput } from "./generationRuntimeAdapter";

type StoredAsset = {
  id?: unknown;
  data?: { relativePath?: unknown; thumbnailRelativePath?: unknown; contentType?: unknown; width?: unknown; height?: unknown };
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
  /**
   * 产出这条 URL 的那家连接（地址 + 自有线路）。缺省读当前目录——与普通生成 localizeTaskAsset 读的是同一份：
   * 线路用它的 `network`，私网例外只问 `trustedRetrievalOrigin(它, 产物 URL)`（与画布那条同一句判据）。
   */
  resolveVendor?: (providerId: string) => Pick<Vendor, "baseUrlHint" | "network"> | undefined;
};

function catalogVendor(providerId: string): Pick<Vendor, "baseUrlHint" | "network"> | undefined {
  return readCatalog().vendors.find((vendor) => vendor.key === providerId);
}

/**
 * 取回产物这一步没成（#975 A2，2026-10-04）。`deterministic` 回答「同一个地址再取一次会不会不一样」：
 *   · 是（true）：出站策略拒了、对方答了却答的是我们收不下的东西（4xx、跳转、类型不对、超上限）——
 *     再取一万次都是同一堵墙，上层必须停下来如实告诉用户，不许当成「还在处理」一轮轮重查重下；
 *   · 否（false）：超时、断流、5xx / 408 / 429、连接没建起来——等一等可能就好，上层照旧下一轮再试。
 * 判据只看结构化事实（策略错误类型、hardenedFetch 挂在错误上的诊断），不读人话。
 * `message` 只放这次的事实，不放产物 URL（结果地址的查询串常带签名）。
 */
export class GenerationOutputRetrievalError extends Error {
  readonly code = OUTPUT_RETRIEVAL_FAILED;
  readonly deterministic: boolean;

  constructor(message: string, deterministic: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GenerationOutputRetrievalError";
    this.deterministic = deterministic;
  }
}

function isAbort(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return Boolean(cause && typeof cause === "object" && (cause as { name?: unknown }).name === "AbortError");
}

/** 这次取回失败，换个时间再取会不会不一样（见 GenerationOutputRetrievalError）。 */
function retrievalFailureIsDeterministic(error: unknown): boolean {
  if (isOutboundDestinationRefusedError(error)) return true;
  // 落盘前的字节 / 解码校验没过：同一份字节再校验也是同一个结论（V-975：坏 MP4 每 15 秒整段重下一次）。
  if (error instanceof GeneratedMediaValidationError) return true;
  if (isAbort(error)) return false;
  const status = hardenedFetchDiagnostics(error)?.status ?? null;
  if (status === null) return false;
  if (status >= 500 || status === 408 || status === 429) return false;
  return true;
}

function retrievalError(error: unknown): GenerationOutputRetrievalError {
  // 内层错误自带的机器码（如 output-unreadable）剥掉，只留事实：外层只有一个码，渲染层按它说话。
  const detail = stripNomiErrorCode(error instanceof Error ? error.message : String(error));
  return new GenerationOutputRetrievalError(detail, retrievalFailureIsDeterministic(error), { cause: error });
}

export type GenerationOutputMaterializationReceipt = {
  artifactId: string;
  kind: GenerationProviderOutput["kind"];
  contentHash: string;
  projectRelativePath: string;
  thumbnailRelativePath?: string;
  width?: number;
  height?: number;
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
  // data: URL 没有文件名。`new URL(dataUrl).pathname` 能解析成功，它的 basename 是 base64 正文里最后一个 `/`
  // 之后的那一截（或整段 `png;base64,…`）——以前这里拿它当文件名。长度与扩展名交给落盘边界
  // （projectAssetStore.storedAssetFileParts：扩展名按字节定、只截主干），这里只负责别拿正文当名字。
  if (!output.url.startsWith("data:")) {
    try {
      const candidate = path.basename(new URL(output.url).pathname);
      if (candidate && candidate !== ".") return candidate;
    } catch {
      // Unparseable URL: fall through to the generic media name.
    }
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
    const vendor = input.providerId ? (deps.resolveVendor ?? catalogVendor)(input.providerId) : undefined;
    const providerNetwork = vendor?.network;
    const routeFor = async (url: string): Promise<ProviderMediaFetchOptions> => {
      const trustedPrivateOrigin = deps.trustedPrivateOrigin ?? await trustedRetrievalOrigin(vendor, url);
      return {
        ...(trustedPrivateOrigin ? { trustedPrivateOrigin } : {}),
        ...(providerNetwork ? { providerNetwork } : {}),
      };
    };
    let bytes: Buffer;
    let contentType = input.output.contentType || "application/octet-stream";
    if (input.output.url.startsWith("data:")) {
      const parsed = parseDataUrl(input.output.url);
      if (exceedsProviderMediaCap(parsed.bytes.byteLength)) throw new GenerationOutputRetrievalError(`Generation output is too large (${parsed.bytes.byteLength} bytes)`, true);
      bytes = parsed.bytes;
      contentType = parsed.contentType;
    } else {
      let fetched: HardenedFetchResult;
      try {
        fetched = await fetchOutput(input.output.url, { ...(await routeFor(input.output.url)), allowContentTypes: allowedContentTypes });
      } catch (error) {
        throw retrievalError(error);
      }
      bytes = fetched.bytes;
      contentType = fetched.contentType || contentType;
    }
    const normalizedType = contentType.toLowerCase().split(";")[0]?.trim() || "application/octet-stream";
    if (!contentTypeMatchesKind(input.output.kind, normalizedType)) {
      throw new GenerationOutputRetrievalError(`Generation output content type does not match ${input.output.kind}`, true);
    }
    const materializationKey = `${input.providerTaskId}:${input.output.providerOutputId || input.output.url}`;
    let stored: StoredAsset;
    try {
      stored = storeAsset(input.projectId, bytes, fileNameFor(input.output), normalizedType, {
        kind: "generated",
        source: "external-mcp",
        providerTaskId: input.providerTaskId,
        ...(input.output.providerOutputId ? { providerOutputId: input.output.providerOutputId } : {}),
      }, materializationKey) as StoredAsset;
    } catch (error) {
      // 落盘校验（字节认不出、解码不了、类型对不上）也是取回这一步的确定性失败；别的落盘错误（磁盘满等）原样抛。
      if (error instanceof GeneratedMediaValidationError) throw retrievalError(error);
      throw error;
    }
    const artifactId = typeof stored.id === "string" ? stored.id.trim() : "";
    const projectRelativePath = typeof stored.data?.relativePath === "string" ? stored.data.relativePath.trim() : "";
    const thumbnailRelativePath = typeof stored.data?.thumbnailRelativePath === "string" ? stored.data.thumbnailRelativePath.trim() : "";
    const width = typeof stored.data?.width === "number" && Number.isFinite(stored.data.width) ? stored.data.width : undefined;
    const height = typeof stored.data?.height === "number" && Number.isFinite(stored.data.height) ? stored.data.height : undefined;
    if (!artifactId || !projectRelativePath) throw new Error("Asset store returned an incomplete generation receipt");
    let posterPath = thumbnailRelativePath;
    if (!posterPath && input.output.kind === "video" && input.output.thumbnailUrl) {
      // 海报是供应商顺手给的一张图，成片已经落盘了：它取不回来（另一个地址、类型不对、断网）不许把这一镜判成
      // 「取回失败」——那会让用户对着一段已经在项目里的视频反复点「重新取回」（#975 A2）。取不到就不要海报。
      try {
        const poster = await fetchOutput(input.output.thumbnailUrl, { ...(await routeFor(input.output.thumbnailUrl)), allowContentTypes: ["image/", "application/octet-stream"] });
        const posterType = (poster.contentType || "image/png").toLowerCase().split(";")[0]?.trim() || "image/png";
        if (!posterType.startsWith("image/")) throw new Error("Generation poster content type does not match image");
        const posterStored = storeAsset(input.projectId, poster.bytes, `${path.parse(fileNameFor(input.output)).name}-poster.png`, posterType, {
          kind: "generated", source: "external-mcp", providerTaskId: input.providerTaskId,
          providerOutputId: `${input.output.providerOutputId || input.output.url}:poster`,
        }, `${materializationKey}:poster`) as StoredAsset;
        posterPath = typeof posterStored.data?.relativePath === "string" ? posterStored.data.relativePath.trim() : "";
      } catch (error) {
        logWarn("production-run", "generation-poster-retrieval-failed", { providerTaskId: input.providerTaskId }, error);
      }
    }
    return {
      artifactId,
      kind: input.output.kind,
      contentHash: contentHash(bytes),
      projectRelativePath,
      ...(posterPath ? { thumbnailRelativePath: posterPath } : {}),
      ...(width && height ? { width, height } : {}),
    };
  }

  return { materialize };
}

export type GenerationOutputMaterializer = ReturnType<typeof createGenerationOutputMaterializer>;
