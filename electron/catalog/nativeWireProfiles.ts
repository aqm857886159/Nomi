import { VOLCENGINE_SEEDANCE_QUERY_OP, VOLCENGINE_SEEDANCE_STATUS_MAPPING, VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";
import { VOLCENGINE_IMAGE_MODELS } from "./volcengineImages";
import type { HttpOperation, ProfileKind } from "./types";
import type { ProbeContractEvidence } from "./nativeEndpointProbe";
import { RELAY_VIDEO_RESULT_URL_PATHS } from "./newapiTransport";

// ---------------------------------------------------------------------------
// 「认得出的模型走它的原生报文」注册表（通用中转接入用）。
//
// 为什么需要：Nomi 的 UI 参数由**模型档案**驱动，档案只认模型身份、与从哪家接入无关（同一模型
// 不管走哪个渠道，用户看到的应是同一套能力）。但真正发出去的报文由渠道模板决定——「用户自建
// 中转」走的是通用最小模板 {model, prompt, duration, size, image}。于是界面给一整套（变体/比例/
// 生成音频/首尾帧/角色图/参考视频/参考音频），线上只发得出一小截，连了边的参考素材被静默丢。
//
// 而 new-api 这类中转普遍**同时**代理厂商原生端点（用户那家的 §6.2 明确推荐 /api/v3/…）。
// 所以：接入时若模型命中内置档案，就探一下这家有没有该档案的原生端点，有就直接复用**已验证的
// 那份原生报文**（只换地址）。通用做法，不是给某一家打补丁（P4）。
//
// 单一真相源：op 一律**引用**各 vendor 模块里已有的常量，绝不在这里复制形状（P1）。
// ---------------------------------------------------------------------------

export type NativeWireProfile = {
  /** 命中哪个档案（electron/shared/modelArchetypes 的 archetype.id）。 */
  archetypeId: string;
  /** 拼进 mapping.name 的渠道名（与内置种子的中文 name 同性质，非 UI 文案）。 */
  wireName: string;
  /**
   * 探测用的**真实端点路径**（会被 nativeEndpointProbe 拿去和「查无此路由」的哨兵响应比对）。
   * 用 GET 探（不产生任务、不计费）。
   */
  probePath: string;
  /**
   * 「这条路由会按原生合同回答查询」的证据：对假任务号的回答必须长成原生合同自己的错误（#1213）。
   * 只「和查无此路由不一样」不算——503 无可用渠道 / 401 / 网关通用错误都不一样，却恰恰说明真查也会失败。
   */
  probeEvidence: ProbeContractEvidence;
  /** 按 taskKind 的 create op。 */
  create: Partial<Record<ProfileKind, HttpOperation>>;
  /** 轮询 op（异步任务）。 */
  query?: HttpOperation;
  statusMapping?: Record<string, string[]>;
};

/**
 * 方舟对「假任务号」的回答：4xx（400 参数不对 / 404 资源不存在）+ 方舟错误包络 `{error:{code,message}}`，
 * 且 code 是方舟自己的 PascalCase 错误码（实测见过的：`ModelNotOpen`、`InvalidEndpointOrModel.NotFound`、
 * `SetLimitExceeded`，docs/plan/2026-06-19 与 2026-08-26 的真 key 记录）。
 * 排除的恰是 #1213 那一类：中转网关自己的错误——new-api 的 `{error:{message,type,code:""}}` /
 * snake_case 码（`model_not_found`）、503「无可用渠道」、401 坏 key。它们都不是方舟在回答这个任务号。
 * 残余风险：方舟对**格式非法**的任务号具体回哪个码没有真 key 实测（写进根因合同 residual_risks）；
 * 判严的代价是「真代理方舟的中转被留在通用通道」（少几个参考槽，不丢钱），判松的代价是 #1213（丢钱）。
 */
const ARK_ERROR_CODE = /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)*$/;
export const ARK_TASK_NOT_FOUND_EVIDENCE: ProbeContractEvidence = ({ status, json }) => {
  if (status !== 400 && status !== 404) return false;
  const error = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === "string" && ARK_ERROR_CODE.test(code) && typeof message === "string";
};

/**
 * 中转上的方舟原生查询：方舟自己的映射（content.video_url 等）原样保留，再补上中转信封里结果地址
 * 可能在的位置（RELAY_VIDEO_RESULT_URL_PATHS，与通用 new-api 查询同一份）——中转在原生路由上回的
 * 也可能是它自己的任务信封（#1213 合同夹具）。内置方舟直连不经过这里，报文不变。
 */
function relayNativeQuery(op: HttpOperation): HttpOperation {
  const mapping = (op.response_mapping || {}) as Record<string, unknown>;
  const own = mapping.video_url;
  const ownPaths = Array.isArray(own) ? own.map(String) : typeof own === "string" ? [own] : [];
  const videoUrl = [...ownPaths, ...RELAY_VIDEO_RESULT_URL_PATHS.filter((path) => !ownPaths.includes(path))];
  return { ...op, pathFrom: "host-root", response_mapping: { ...mapping, video_url: videoUrl } };
}

/** 把一组 mapping 转成「从主机根拼」的 create 表。原生端点不在 /v1 命名空间下；
 *  中转用户常把地址填成 .../v1 → 必须从主机根拼（hostRootJoin 负责剥版本段 + 折叠重叠段）。 */
function hostRootCreateOps(mappings: ReadonlyArray<{ taskKind: ProfileKind; create: HttpOperation }>) {
  const create: Partial<Record<ProfileKind, HttpOperation>> = {};
  for (const mapping of mappings) create[mapping.taskKind] = { ...mapping.create, pathFrom: "host-root" };
  return create;
}

/** 火山方舟视频原生（Seedance 全 family）。中转代理方舟时可直接用这套：首/尾帧、角色图、参考视频、
 *  参考音频、generate_audio、ratio、resolution 全在，与用户那家中转文档 §6.2 逐字对得上。
 *
 *  **按 archetypeId 分组自动派生**，不是手写枚举：新增一个 Seedance 档案（2.5 就是这么进来的）
 *  只要进了 VOLCENGINE_VIDEO_MODELS 就自动有原生 profile。手写枚举必漂——漏一个的症状是
 *  「那个模型经中转接入后静默退回通用最小模板」，本地测不出来。 */
function volcengineSeedanceProfiles(): NativeWireProfile[] {
  const byArchetype = new Map<string, typeof VOLCENGINE_VIDEO_MODELS>();
  for (const model of VOLCENGINE_VIDEO_MODELS) {
    byArchetype.set(model.archetypeId, [...(byArchetype.get(model.archetypeId) ?? []), model]);
  }
  return [...byArchetype.entries()].map(([archetypeId, models]) => ({
    archetypeId,
    wireName: "火山方舟原生",
    probePath: "/api/v3/contents/generations/tasks",
    probeEvidence: ARK_TASK_NOT_FOUND_EVIDENCE,
    // 同一档案下各模型共用同形 op（model 字段是动态值），取任一即可。
    create: hostRootCreateOps(models[0].mappings),
    query: relayNativeQuery(VOLCENGINE_SEEDANCE_QUERY_OP),
    statusMapping: VOLCENGINE_SEEDANCE_STATUS_MAPPING,
  }));
}

/**
 * 火山方舟原生（Seedream 图像）。**同步**族：只有 create、无轮询。
 *
 * 为什么要它：通用中转的改图走 `chat/completions` 多模态（chat_image_parts）——那是给聊天模型用的路，
 * 而 Seedream 不是聊天模型。于是「中转代理了方舟、但 Nomi 仍把 Seedream 当聊天模型改图」= 改图不按原图
 * 甚至直接失败。原生形状里改图是 `image ← image_urls`（整数组），已在 volcengineImages 真实 E2E 出图验证。
 *
 * 与视频 profile 同在 `/api/v3` 命名空间——中转若代理了方舟视频，通常同时代理图像，探测会各探各的。
 * 同一档案下各模型共用同一份 op（model 字段是 `{{model.modelKey}}` 动态值），故取任一模型的 mappings 即可。
 * 同视频侧：**按 archetypeId 分组自动派生**（5.0 pro 就是这么进来的），不手写枚举。
 */
function volcengineSeedreamProfiles(): NativeWireProfile[] {
  const byArchetype = new Map<string, typeof VOLCENGINE_IMAGE_MODELS>();
  for (const model of VOLCENGINE_IMAGE_MODELS) {
    byArchetype.set(model.archetypeId, [...(byArchetype.get(model.archetypeId) ?? []), model]);
  }
  return [...byArchetype.entries()].map(([archetypeId, models]) => ({
    archetypeId,
    wireName: "火山方舟原生",
    probePath: "/api/v3/images/generations",
    probeEvidence: ARK_TASK_NOT_FOUND_EVIDENCE,
    create: hostRootCreateOps(models[0].mappings),
  }));
}

const PROFILES: NativeWireProfile[] = [...volcengineSeedanceProfiles(), ...volcengineSeedreamProfiles()];

/** 按档案 id 查原生 wire 配方；没有就返回 null（该模型没有可复用的原生形状）。 */
export function nativeWireProfileForArchetype(archetypeId: string | null | undefined): NativeWireProfile | null {
  const id = String(archetypeId || "").trim();
  if (!id) return null;
  return PROFILES.find((p) => p.archetypeId === id) ?? null;
}

/** 全部配方（探测/自愈遍历用）。 */
export function listNativeWireProfiles(): NativeWireProfile[] {
  return PROFILES;
}
