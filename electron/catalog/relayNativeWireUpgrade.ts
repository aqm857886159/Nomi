import { archetypeIdForModel } from "./archetypeIdentity";
import { nativeWireProfileForArchetype, type NativeWireProfile } from "./nativeWireProfiles";
import { probeNativeEndpoint, type NativeEndpointProbeResult } from "./nativeEndpointProbe";
import { isLegacyNewapiVideoQuery, newapiTransportFor, NEWAPI_VIDEO_QUERY_OP } from "./newapiTransport";
import type { Mapping, Model, ProfileKind } from "./types";
import { isBuiltinRelayVendorKey } from "./relayImageEditMigration";
import { decryptApiKeyRecord } from "./secrets";
import {
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  readCatalog,
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
} from "./catalogStore";
import { logInfo, logWarn } from "../logging/logger";
import { VendorRequestError } from "../vendor/vendorHttp";

// ---------------------------------------------------------------------------
// 自建中转视频通道的启动体检（单一 owner：「这个中转视频模型走哪套报文」只在这里改）。
//
// 为什么在启动后而不在 catalog 版本迁移：迁移是同步纯函数（读盘那一刻跑完），**发不了网络请求**，
// 而「这家到底能不能按原生合同回答查询」只能探。所以走启动后的异步一次性体检：幂等、不阻塞启动。
//
// 三件事：
//  1. 升级：命中档案原生报文、且探测拿到**原生合同证据**（nativeEndpointProbe）→ 切原生报文（首尾帧/
//     角色图/参考视频/参考音频全在）。
//  2. 降级（#1213）：旧判据是「对假任务号的回答和查无此路由不一样」就切——503 无可用渠道、401、网关
//     通用错误都算了进去。被这样切过去的模型，提交照扣钱、查询永远失败（节点停在「可找回」，重新
//     拉取也拉不回）。新判据下拿不到合同证据的已切模型，降回通用 new-api 通道并留一条日志。
//     探不到（网络失败）不是「没有」——不动它。
//  3. 刷新：存量通用视频查询如果还是我们自己旧版的形状（只认 data[*].url，读不到官方 new-api 的
//     任务信封），刷成当前 canonical op（isLegacyNewapiVideoQuery 只认我们发过的原样，手改的不碰）。
// ---------------------------------------------------------------------------

let ranThisProcess = false;

type UpgradeOutcome = {
  vendorKey: string;
  modelKey: string;
  archetypeId: string;
  upgraded: boolean;
  downgraded?: boolean;
  detail: string;
};

/** 这个模型现在用的是不是已经是该档案的原生形状（判据：text_to_video create.path 已是原生 path）。 */
function alreadyNative(vendorKey: string, modelKey: string, profile: NativeWireProfile): boolean {
  const nativePath = profile.create.text_to_video?.path;
  if (!nativePath) return false;
  return listModelCatalogMappings().some(
    (m) =>
      m.vendorKey === vendorKey &&
      m.taskKind === "text_to_video" &&
      (!m.modelKey || m.modelKey === modelKey) &&
      m.create?.path === nativePath,
  );
}

function metaRecord(model: Model): Record<string, unknown> {
  return model.meta && typeof model.meta === "object" ? (model.meta as Record<string, unknown>) : {};
}

function applyNativeWire(model: Model, profile: NativeWireProfile): void {
  for (const [taskKind, create] of Object.entries(profile.create)) {
    if (!create) continue;
    upsertModelCatalogMapping({
      vendorKey: model.vendorKey,
      taskKind: taskKind as ProfileKind,
      modelKey: model.modelKey,
      name: `${model.labelZh || model.modelKey} · ${profile.wireName}`,
      enabled: true,
      create,
      ...(profile.query ? { query: profile.query } : {}),
      ...(profile.statusMapping ? { statusMapping: profile.statusMapping } : {}),
    });
  }
  // 诚实标注：这个模型现在走的是哪套 wire（排障与护栏都读它）。
  // archetypeId 同时标上：headless/MCP 缺参靠它兜档案默认（generate_audio 等），UI 路不受影响。
  upsertModelCatalogModel({
    modelKey: model.modelKey,
    vendorKey: model.vendorKey,
    meta: { ...metaRecord(model), wireProfile: profile.archetypeId, archetypeId: profile.archetypeId },
  });
}

/**
 * 降回通用 new-api 视频通道：create / 图生视频 / query / statusMapping 全部取 canonical（与接入时
 * draftShapeForKind 的通用分支同源），并撤掉升级时打的 wireProfile / archetypeId——不撤的话，
 * modelRetype 读 meta.archetypeId 还会不经探测把原生报文装回来（那是第二扇门）。
 */
function applyGenericWire(model: Model): void {
  const generic = newapiTransportFor("video");
  const modes: Array<{ taskKind: ProfileKind; create: Mapping["create"] }> = [
    { taskKind: "text_to_video", create: generic.create },
    ...(generic.imageToVideo ? [{ taskKind: "image_to_video" as ProfileKind, create: generic.imageToVideo.create }] : []),
  ];
  for (const mode of modes) {
    upsertModelCatalogMapping({
      vendorKey: model.vendorKey,
      taskKind: mode.taskKind,
      modelKey: model.modelKey,
      name: `${model.labelZh || model.modelKey} · new-api`,
      enabled: true,
      create: mode.create,
      query: generic.query,
      statusMapping: generic.statusMapping,
    });
  }
  const meta = { ...metaRecord(model) };
  delete meta.wireProfile;
  delete meta.archetypeId;
  upsertModelCatalogModel({ modelKey: model.modelKey, vendorKey: model.vendorKey, meta });
}

/** 原生通道上的模型：落盘的 query 与 canonical 不同就刷新（只动 query，create 不碰）。返回是否改了。 */
function syncNativeQuery(model: Model, profile: NativeWireProfile): boolean {
  if (!profile.query) return false;
  const canonical = JSON.stringify(profile.query);
  let changed = false;
  for (const mapping of listModelCatalogMappings()) {
    if (mapping.vendorKey !== model.vendorKey || (mapping.modelKey && mapping.modelKey !== model.modelKey)) continue;
    if (!profile.create[mapping.taskKind] || mapping.create?.path !== profile.create[mapping.taskKind]?.path) continue;
    if (JSON.stringify(mapping.query) === canonical) continue;
    upsertModelCatalogMapping({ ...mapping, query: profile.query });
    changed = true;
  }
  return changed;
}

/** 把存量里我们自己旧版的通用视频查询刷成 canonical（只认原样，见 isLegacyNewapiVideoQuery）。 */
function refreshLegacyGenericVideoQueries(): number {
  let refreshed = 0;
  for (const mapping of listModelCatalogMappings()) {
    if (isBuiltinRelayVendorKey(mapping.vendorKey)) continue;
    if (mapping.taskKind !== "text_to_video" && mapping.taskKind !== "image_to_video") continue;
    if (!isLegacyNewapiVideoQuery(mapping.query)) continue;
    upsertModelCatalogMapping({ ...mapping, query: NEWAPI_VIDEO_QUERY_OP });
    refreshed += 1;
  }
  return refreshed;
}

/**
 * 跑一轮体检。返回每个候选模型的结论（给日志/测试看）。
 * 只碰非内置 vendor（内置由 seedBuiltins 管自己的报文）。
 */
export async function upgradeRelayModelsToNativeWire(): Promise<UpgradeOutcome[]> {
  const out: UpgradeOutcome[] = [];
  const refreshed = refreshLegacyGenericVideoQueries();
  if (refreshed > 0) logInfo("catalog", "relay-video-query-contract-refreshed", { count: refreshed });
  const vendors = new Map(listModelCatalogVendors().map((v) => [v.key, v]));
  // 每个 (vendor, probePath) 只探一次。
  const probeCache = new Map<string, Promise<NativeEndpointProbeResult>>();
  for (const model of listModelCatalogModels()) {
    if (model.kind !== "video" || isBuiltinRelayVendorKey(model.vendorKey)) continue;
    const archetypeId = archetypeIdForModel(model.modelKey, model.modelAlias);
    const profile = nativeWireProfileForArchetype(archetypeId);
    if (!profile) continue;
    const vendor = vendors.get(model.vendorKey);
    const baseUrl = String(vendor?.baseUrlHint || "").trim();
    if (!/^https?:\/\//i.test(baseUrl)) continue;
    const cacheKey = `${model.vendorKey}\0${profile.probePath}`;
    let pending = probeCache.get(cacheKey);
    if (!pending) {
      const apiKey = decryptApiKeyRecord(readCatalog().apiKeysByVendor[model.vendorKey]) || undefined;
      pending = probeNativeEndpoint(baseUrl, profile.probePath, profile.probeEvidence, apiKey).catch(
        (): NativeEndpointProbeResult => ({ exists: false, verdict: "unreachable", detail: "probe threw" }),
      );
      probeCache.set(cacheKey, pending);
    }
    const probe = await pending;
    const native = alreadyNative(model.vendorKey, model.modelKey, profile);
    const base = { vendorKey: model.vendorKey, modelKey: model.modelKey, archetypeId: profile.archetypeId };
    if (probe.verdict === "unreachable") {
      out.push({ ...base, upgraded: false, detail: `probe inconclusive, wire unchanged: ${probe.detail}` });
      continue;
    }
    if (probe.verdict === "contract") {
      if (native) {
        // 已在原生通道：查询 op 跟着 canonical 走（落盘的是当时的副本，结果地址的位置表后来补过）。
        const synced = syncNativeQuery(model, profile);
        out.push({ ...base, upgraded: false, detail: `already on native wire with contract evidence${synced ? ", query refreshed" : ""}` });
        continue;
      }
      applyNativeWire(model, profile);
      out.push({ ...base, upgraded: true, detail: `升级到${profile.wireName}报文` });
      continue;
    }
    if (!native) {
      out.push({ ...base, upgraded: false, detail: "这家没有该原生端点，保持通用模板" });
      continue;
    }
    applyGenericWire(model);
    logWarn("catalog", "relay-native-wire-downgraded", {
      vendorKey: model.vendorKey,
      modelKey: model.modelKey,
      archetypeId: profile.archetypeId,
      oldCriterion: "answer to a bogus task id differed from the sibling no-route sentinel",
      newCriterion: "answer to a bogus task id must be the native contract's own task-not-found error",
      probe: probe.detail,
    });
    out.push({ ...base, upgraded: false, downgraded: true, detail: `downgraded to new-api wire: ${probe.detail}` });
  }
  return out;
}

/** 启动时调一次（不 await，失败静默）。同一进程内只跑一轮。 */
export function scheduleRelayNativeWireUpgrade(): void {
  if (ranThisProcess) return;
  ranThisProcess = true;
  void upgradeRelayModelsToNativeWire()
    .then((results) => {
      const upgraded = results.filter((r) => r.upgraded);
      if (upgraded.length) {
        logInfo("catalog", "relay-models-upgraded-to-native-wire", {
          count: upgraded.length,
          models: upgraded.map((r) => r.modelKey).join(","),
        });
      }
    })
    .catch(() => { /* 体检失败不影响使用，保持现有通道 */ });
}

// ── 运行中退回（#1213 原则 2）────────────────────────────────────────────────────────────
// 开机体检只看得到「对假任务号怎么回答」；真任务的查询在原生通道上持续失败，只有轮询看得见。
// 只数**按合同认出的非瞬时失败**：路由不存在（404 Invalid URL）、任务号无效 / 不存在（400 / 404）、
// 中转的「无可用渠道」（new-api：「当前分组 X 下对于模型 Y 无可用渠道」/ model_not_found）。
// 普通 5xx、429、网络抖动、超时不算——那些下一轮可能就好了，退回通道反而是乱改。
// 同一模型连续 RUNTIME_FALLBACK_THRESHOLD 次 → 单向退回通用通道（applyGenericWire，与开机降级同一出口），
// logWarn 留痕；本次查询由调用方免费用通用查询再试一次。退回之后不会自己再升回去（那要开机体检拿到合同证据）。

export const RUNTIME_FALLBACK_THRESHOLD = 3;
const nativeQueryFailureStreak = new Map<string, number>();

const NON_TRANSIENT_UPSTREAM = /无可用渠道|no available channel|model_not_found|invalid url|task_not_exist|task not exist|not found|does not exist|invalid task/i;

/** 这次查询失败是不是「换个时间再查也一样」的那一类（只认合同里写得出的几种）。 */
export function isContractNonTransientQueryFailure(error: unknown): boolean {
  if (!(error instanceof VendorRequestError)) return false;
  const { httpStatus, upstreamMsg, upstreamCode } = error.structured;
  if (httpStatus === 429 || httpStatus === undefined) return false;
  const said = `${upstreamCode || ""} ${upstreamMsg || ""}`;
  if (httpStatus === 404 || httpStatus === 400) return true;
  return NON_TRANSIENT_UPSTREAM.test(said);
}

/** 这条 mapping 是不是「中转上的原生报文」（只有它们才有可退回的通用通道）。 */
function nativeRelayProfileFor(vendorKey: string, model: Pick<Model, "modelKey" | "modelAlias">, mapping: Pick<Mapping, "query"> | undefined): NativeWireProfile | null {
  if (isBuiltinRelayVendorKey(vendorKey)) return null;
  const profile = nativeWireProfileForArchetype(archetypeIdForModel(model.modelKey, model.modelAlias));
  if (!profile?.query || mapping?.query?.path !== profile.query.path) return null;
  return profile;
}

/**
 * 轮询每次查完都报一声（成功传 error=null）。返回非 null = 刚刚退回了通用通道（调用方用新 mapping 再查一次）。
 */
export function noteRelayQueryOutcome(input: {
  vendorKey: string;
  model: Pick<Model, "modelKey" | "modelAlias" | "vendorKey">;
  mapping: Pick<Mapping, "query"> | undefined;
  error: unknown;
}): { from: string; to: string; count: number } | null {
  const profile = nativeRelayProfileFor(input.vendorKey, input.model, input.mapping);
  if (!profile) return null;
  const key = `${input.vendorKey}\0${input.model.modelKey}`;
  if (input.error === null || !isContractNonTransientQueryFailure(input.error)) {
    // 成功清零；瞬时失败既不累计也不清零（抖动夹在中间不该把真问题的连击打断）。
    if (input.error === null) nativeQueryFailureStreak.delete(key);
    return null;
  }
  const count = (nativeQueryFailureStreak.get(key) || 0) + 1;
  nativeQueryFailureStreak.set(key, count);
  if (count < RUNTIME_FALLBACK_THRESHOLD) return null;
  nativeQueryFailureStreak.delete(key);
  const model = listModelCatalogModels().find((candidate) => candidate.vendorKey === input.vendorKey && candidate.modelKey === input.model.modelKey);
  if (!model) return null;
  applyGenericWire(model);
  const structured = input.error instanceof VendorRequestError ? input.error.structured : undefined;
  logWarn("catalog", "relay-native-wire-fell-back-at-runtime", {
    vendorKey: input.vendorKey,
    modelKey: input.model.modelKey,
    archetypeId: profile.archetypeId,
    consecutiveFailures: count,
    lastHttpStatus: structured?.httpStatus ?? null,
    lastUpstreamCode: structured?.upstreamCode ?? null,
  });
  return { from: profile.wireName, to: "new-api", count };
}

/** 测试用：清掉连击计数（进程内状态）。 */
export function resetRelayQueryFallbackStateForTests(): void {
  nativeQueryFailureStreak.clear();
}
