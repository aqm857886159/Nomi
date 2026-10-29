import type { Vendor } from "../catalog/types";
import { trustedRetrievalOrigin } from "../vendor/vendorOutboundGuard";
import { scheduleTechnicalReview } from "../review/reviewTrace";
import { hardenedFetchDiagnostics } from "../hardenedFetch";
import { logWarn } from "../logging/logger";
import { withResultLandingEvidence } from "../outboundDispatchEvidence";
import { retrievalStageError } from "../tasks/retrievalStageError";
import { importRemoteAsset } from "./projectAssetStore";
import { broadcastAssetLocalizationStarted } from "./assetEvents";
import { localizedTaskAssetFileName, probeLocalizedDurationSeconds } from "./localizedAsset";
import { canvasPreviewFieldsFromReceipt } from "../shared/canvas/canvasMediaPreview";

type LocalizedTaskAssetType = "image" | "video" | "audio" | "model3d";

/** 只留主机：结果地址的查询串里常带签名（拿到就能下载），路径里常带任务号——排查只需要知道是哪家的 CDN。 */
function assetHost(assetUrl: string): string {
  try {
    const parsed = new URL(assetUrl);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname : parsed.protocol.replace(/:$/, "");
  } catch {
    return "unparseable";
  }
}

/**
 * 产物取回失败留一条结构化警告（2026-09-28）：「生成完了却一直停在『正在存到你电脑上』」那次，这条路径
 * 一个字都没写，调查只能靠本地复现去猜是哪种响应触发的。记排查要的形状——主机、路由、状态码、类型、
 * 声明大小 / 已收字节、耗时——字段来自 hardenedFetch 挂在错误上的诊断；不是取回这一步失败的（字节校验、落盘）
 * 那几项就是空的，主机与耗时照记。**不记 URL**，理由见 assetHost。
 */
function warnLocalizationFailed(assetUrl: string, type: LocalizedTaskAssetType, startedAt: number, error: unknown): void {
  const diagnostics = hardenedFetchDiagnostics(error);
  logWarn("assets", "localize-retrieval-failed", {
    kind: type,
    host: diagnostics?.host ?? assetHost(assetUrl),
    route: diagnostics?.route ?? null,
    status: diagnostics?.status ?? null,
    contentType: diagnostics?.contentType ?? null,
    declaredBytes: diagnostics?.declaredBytes ?? null,
    receivedBytes: diagnostics?.receivedBytes ?? null,
    elapsedMs: diagnostics?.elapsedMs ?? Date.now() - startedAt,
  }, error);
}

/**
 * 结果落地门：把供应商回答里的结果地址落进项目（下载 / 字节与解码校验 / 写盘）。调用方只会拿供应商答复里的地址来调它，
 * 所以它失败的那一刻供应商已经答过了：统一挂取回阶段码（与异步取回同一个出口 retrievalStageError），并挂上
 * 「答过了」的正证据（`withResultLandingEvidence`，全仓只有这一扇门挂）——同步供应商在提交里就落地，提交出口靠它
 * 把「答了、本机落地失败」从「结果未知」里分出来（2026-10-28）。
 */
export async function localizeTaskAsset(
  projectId: string,
  assetUrl: string,
  type: LocalizedTaskAssetType,
  nodeId?: string, vendor?: Pick<Vendor, "key" | "baseUrlHint" | "network">,
  certificationEvidence?: import("../providerAdapter/certificationMedia").CertificationMediaEvidence,
) {
  if (nodeId) await broadcastAssetLocalizationStarted({ projectId, nodeId });
  const startedAt = Date.now();
  let imported: { id?: string; name?: string; data?: { url?: string; absolutePath?: string; thumbnailUrl?: string; previewState?: string; width?: number; height?: number; durationSeconds?: number } };
  try {
    imported = (await importRemoteAsset({
      projectId,
      url: assetUrl,
      kind: "generated",
      // 引擎 A 的任务期望：取回的字节必须就是这一类，参考图冒充视频在落盘关口被拒（V-1213）。
      expectedKind: type,
      ownerNodeId: nodeId || null,
      fileName: localizedTaskAssetFileName(type, assetUrl),
    }, {
      trustedPrivateOrigin: await trustedRetrievalOrigin(vendor, assetUrl),
      ...(certificationEvidence ? { certificationEvidence } : {}), ...(vendor?.network ? { providerNetwork: vendor.network } : {}),
    })) as typeof imported;
  } catch (error) {
    warnLocalizationFailed(assetUrl, type, startedAt, error);
    throw withResultLandingEvidence(retrievalStageError("retrieval-download", error));
  }
  const durationSeconds = imported.data?.durationSeconds ?? await probeLocalizedDurationSeconds(type, imported.data?.absolutePath);
  if (type === "image" || type === "video")
    scheduleTechnicalReview({
      projectId,
      nodeId,
      absolutePath: String(imported.data?.absolutePath || ""),
      assetUrl: String(imported.data?.url || assetUrl),
      type,
    }); // S4-2b:落地技术自检,仅图像/视频（3D 模型不送 VLM）
  const url = String(imported.data?.url || assetUrl);
  // 画布预览由落盘边界派生（assetPreview）并写在回执上：小图地址 + 预览事实（ready / source / missing）。
  // 没派生出来就是明确的 'missing'，不再把源地址填进 thumbnailUrl 冒充预览。
  const preview = canvasPreviewFieldsFromReceipt(type, imported.data, url);
  return {
    type,
    url,
    thumbnailUrl: preview.thumbnailUrl ?? null,
    ...(preview.previewState ? { previewState: preview.previewState } : {}),
    assetId: imported.id || null,
    assetName: imported.name || null,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(imported.data?.width && imported.data?.height ? { width: imported.data.width, height: imported.data.height } : {}),
    // 原始 CDN URL 留存：任何 vendor 都能直接使用，不需要再上传或转 base64。
    providerUrl: /^https?:\/\//i.test(assetUrl) ? assetUrl : null,
  };
}

