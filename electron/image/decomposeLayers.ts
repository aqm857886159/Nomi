// 「元素拆解」主进程业务（IPC nomi:image:decompose-layers 的实现）。
// 一张图 → Replicate qwen-image-layered → N 张 RGBA 图层（落地进项目，不依赖会过期的 replicate.delivery 直链）。
// 复用现有原语：catalog 读 key / 付费令牌消费 / 本地素材吞入 / vendor HTTP / 图层落地。不污染单结果 runtime。
import { readCatalog } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { assertAndConsumeSpendGrant } from "../spendGrant";
import { resolveLocalAsset } from "../catalog/assetLocalization";
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload, putBinaryForAssetUpload } from "../assets/localAssetFile";
import { requestJson } from "../vendor/vendorHttp";
import { importRemoteAsset } from "../runtime";
import { desktopT } from "../i18n";
import {
  REPLICATE_VENDOR_SEED,
  REPLICATE_DECOMPOSE_PREDICTIONS_PATH,
  buildDecomposeInput,
  parseDecomposeOutput,
} from "../catalog/replicate";

export type DecomposeLayersPayload = {
  nodeId?: string;
  imageUrl?: string;
  numLayers?: number;
  grantId?: string;
  projectId?: string;
};

// 图层在主进程就地落盘成 nomi-local（hardenedFetch 下载 replicate.delivery 临时直链 → 写进项目资产），
// 渲染层拿到即可直接用、秒开白板，不再逐张走代理 fetch+落盘（那条慢到分钟级、无进度）。
// 无 projectId 时兜底返回远端直链（渲染层自行落地，旧路径）。
export type DecomposeLayersResult = { layers: string[] };

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 轮询预测直到终态（Prefer:wait 通常已 succeeded；超窗时兜底轮询）。 */
async function pollPrediction(vendor: { baseUrlHint?: string | null } & Record<string, unknown>, apiKey: string, getUrl: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i += 1) {
    const res = (await requestJson(vendor as never, apiKey, "GET", getUrl, { Authorization: `Bearer ${apiKey}` }, {}, undefined)) as Record<string, unknown>;
    const status = asString(res.status);
    if (status === "succeeded" || status === "failed" || status === "canceled") return res;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(desktopT("decompose.timeout"));
}

export async function decomposeLayers(payload: DecomposeLayersPayload): Promise<DecomposeLayersResult> {
  const imageUrl = asString(payload?.imageUrl);
  const nodeId = asString(payload?.nodeId) || undefined;
  if (!imageUrl) throw new Error(desktopT("decompose.missingImage"));

  const catalog = readCatalog();
  const vendor = catalog.vendors.find((v) => v.key === REPLICATE_VENDOR_SEED.key && v.enabled);
  if (!vendor) throw new Error(desktopT("decompose.notConnected"));
  const apiKey = decryptApiKeyRecord(catalog.apiKeysByVendor[REPLICATE_VENDOR_SEED.key]);
  if (!apiKey) throw new Error(desktopT("decompose.missingToken"));

  // 付费令牌：必须在真发 vendor 之前同步消费（与现有 task 路径同铁律，spendGrant.ts）。
  assertAndConsumeSpendGrant(payload?.grantId, nodeId);

  // 本地素材（nomi-local://）→ 传 Replicate 文件 API 拿可达 URL；http/data 已可达直接用。
  let reachableUrl = imageUrl;
  if (imageUrl.startsWith("nomi-local://")) {
    reachableUrl = await resolveLocalAsset(
      imageUrl,
      REPLICATE_VENDOR_SEED.assetIngestion,
      apiKey,
      readNomiLocalAsset,
      postJsonForAssetUpload,
      postMultipartForAssetUpload,
      putBinaryForAssetUpload,
    );
  }

  const baseUrl = `${vendor.baseUrlHint || REPLICATE_VENDOR_SEED.baseUrl}${REPLICATE_DECOMPOSE_PREDICTIONS_PATH}`;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Prefer: "wait" };
  const body = buildDecomposeInput(reachableUrl, payload?.numLayers);
  let res = (await requestJson(vendor as never, apiKey, "POST", baseUrl, headers, {}, body)) as Record<string, unknown>;

  if (asString(res.status) !== "succeeded") {
    const getUrl = asString((res.urls as Record<string, unknown> | undefined)?.get);
    if (!getUrl) throw new Error(asString(res.error) || desktopT("decompose.submitFailed"));
    res = await pollPrediction(vendor, apiKey, getUrl);
  }
  if (asString(res.status) !== "succeeded") throw new Error(asString(res.error) || desktopT("decompose.failed"));

  const remoteLayers = parseDecomposeOutput(res.output);
  if (remoteLayers.length === 0) throw new Error(desktopT("decompose.noLayers"));

  // 主进程就地落地：把临时直链下载进项目，返回 nomi-local（持久、同源、白板合成不污染画布）。
  const projectId = asString(payload?.projectId);
  if (!projectId) return { layers: remoteLayers };
  const localized = await Promise.all(
    remoteLayers.map(async (url, index) => {
      try {
        const asset = (await importRemoteAsset({
          projectId,
          url,
          kind: "generated",
          ownerNodeId: nodeId || null,
          fileName: `decompose-${nodeId || "layer"}-${index}.png`,
        })) as { data?: { url?: string } } | null;
        return asString(asset?.data?.url) || url;
      } catch {
        return url; // 单张落地失败兜底用远端直链，不拖垮整体
      }
    }),
  );
  return { layers: localized };
}
