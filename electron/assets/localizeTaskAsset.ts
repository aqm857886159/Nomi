import type { Vendor } from "../catalog/types";
import { trustedRetrievalOrigin } from "../vendor/vendorOutboundGuard";
import { scheduleTechnicalReview } from "../review/reviewTrace";
import { hardenedFetchDiagnostics } from "../hardenedFetch";
import { logWarn } from "../logging/logger";
import { importRemoteAsset } from "./projectAssetStore";
import { broadcastAssetLocalizationStarted } from "./assetEvents";
import { localizedTaskAssetFileName, probeLocalizedDurationSeconds } from "./localizedAsset";

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

export async function localizeTaskAsset(
  projectId: string,
  assetUrl: string,
  type: LocalizedTaskAssetType,
  nodeId?: string, vendor?: Pick<Vendor, "key" | "baseUrlHint" | "network">,
  certificationEvidence?: import("../providerAdapter/certificationMedia").CertificationMediaEvidence,
) {
  if (nodeId) await broadcastAssetLocalizationStarted({ projectId, nodeId });
  const startedAt = Date.now();
  let imported: { id?: string; name?: string; data?: { url?: string; absolutePath?: string; thumbnailUrl?: string; width?: number; height?: number; durationSeconds?: number } };
  try {
    imported = (await importRemoteAsset({
      projectId,
      url: assetUrl,
      kind: "generated",
      ownerNodeId: nodeId || null,
      fileName: localizedTaskAssetFileName(type, assetUrl),
    }, {
      trustedPrivateOrigin: await trustedRetrievalOrigin(vendor, assetUrl),
      ...(certificationEvidence ? { certificationEvidence } : {}), ...(vendor?.network ? { providerNetwork: vendor.network } : {}),
    })) as typeof imported;
  } catch (error) {
    warnLocalizationFailed(assetUrl, type, startedAt, error);
    throw error;
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
  return {
    type,
    url,
    // 画布缩略图由落盘边界派生（assetPreview）：图片长边 >1024 出 `.preview.*`，视频出首帧 poster。
    // 没派生出来（小图 / 探测失败）时图片回落到源（源即预览）；视频没有 poster 就照旧交互前挂 video。
    thumbnailUrl: imported.data?.thumbnailUrl || (type === "image" ? url : null),
    assetId: imported.id || null,
    assetName: imported.name || null,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(imported.data?.width && imported.data?.height ? { width: imported.data.width, height: imported.data.height } : {}),
    // 原始 CDN URL 留存：任何 vendor 都能直接使用，不需要再上传或转 base64。
    providerUrl: /^https?:\/\//i.test(assetUrl) ? assetUrl : null,
  };
}

