import { firstString, isJsonRecord, nowIso, trim, type JsonRecord } from "../jsonUtils";
import { humanizeModelKey } from "./modelLabel";
import { newapiImageEditProfileForModel, newapiTransportFor, type NewapiImageEditProtocol } from "./newapiTransport";
import { consumedCanonicalKeys } from "./paramTranslate";
import { nativeWireProfileForArchetype, type NativeWireProfile } from "./nativeWireProfiles";
import { guessModelKind } from "./modelKindHeuristic";
import { builtinVendorKeyForHostname } from "./builtinVendorSeeds";
import { hardenedFetchText } from "../hardenedFetch";
import type { AiSdkProviderKind, BillingModelKind, HttpOperation, Model, ProfileKind, Vendor } from "./types";
import type { TaskRequest } from "../runtime";
import {
  mutateCatalog,
  normalizeProviderKind,
  readCatalog,
} from "./catalogStore";

/**
 * 目录 kind → 它的**主** taskKind（建 create mapping 用的那个通道）。
 *
 * 单一真相源：接入落库（commitOnboardedModelToCatalog）与改类型重建通道（catalog/modelRetype.ts）
 * 必须给出同一个答案，否则「改成图片」建出来的通道和「接入时选图片」建出来的不是同一条，
 * 就成了两套并行实现（P1）。附带 kind 合法性校验：未知 kind 直接抛，不静默落进某个桶。
 *
 * 注：这里只给主通道；image_edit / image_to_video 那两条附属通道由 draftShapeForKind 产出、
 * 调用方各自按 targetKind 注册（两处逻辑一致，见各自注释）。
 */
export function primaryTaskKindForModelKind(kind: string): ProfileKind {
  if (kind === "text") return "chat";
  if (kind === "image") return "text_to_image";
  if (kind === "video") return "text_to_video";
  if (kind === "audio") return "text_to_audio";
  // model3d：中转**没有**通用 3D 调用通道（newapiTransportFor 只有 image/video/audio），所以这条
  // 通道名永不被使用——draftShapeForKind 不给 3D 任何 mappingCreate，注册那步天然跳过。留它是为了
  // 类型完整 + 诚实表达 3D 属于哪一族。为什么仍要收下 3D：不给它独立身份就只能落进 text 兜底桶，
  // 既污染文本下拉、被选中还会被当聊天模型塞进 /chat/completions。
  if (kind === "model3d") return "text_to_3d";
  throw new Error(`Unsupported model kind '${kind}'`);
}

/**
 * 把「档案声明了、但 mapping body 里没有 {{request.params.*}} 槽」的参数键补进 body
 * （档案/onboarding 字段 → 传输 body 的对账）。原属已下线的「AI 读文档」子系统，因
 * commitOnboardedModelToCatalog 仍需要它对账参数，迁来此处单源保留（P1）。
 */
function mergeMissingParamsIntoBody(body: unknown, fieldKeys: string[]): unknown {
  if (!body || typeof body !== "object") return body;
  const clone = JSON.parse(JSON.stringify(body)) as unknown;
  const PARAM_RE = /^\{\{\s*request\.params\.([A-Za-z0-9_]+)\s*\}\}$/;
  const PROMPT_RE = /^\{\{\s*request\.prompt\s*\}\}$/;
  const keySet = new Set(fieldKeys);
  const present = new Set<string>();
  const literalHolders = new Map<string, Record<string, unknown>>();
  let paramContainer: Record<string, unknown> | null = null;
  let promptContainer: Record<string, unknown> | null = null;
  const walk = (val: unknown): void => {
    if (!val || typeof val !== "object") return;
    if (Array.isArray(val)) { val.forEach(walk); return; }
    const obj = val as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") {
        const pm = PARAM_RE.exec(v);
        if (pm) { present.add(pm[1]); paramContainer = obj; }
        else if (PROMPT_RE.test(v)) { promptContainer = obj; present.add(k); }
        else if (keySet.has(k)) { literalHolders.set(k, obj); }
      }
      walk(v);
    }
  };
  walk(clone);
  const container = paramContainer || promptContainer || (clone as Record<string, unknown>);
  for (const key of fieldKeys) {
    if (present.has(key)) continue;
    const placeholder = `{{request.params.${key}}}`;
    const literalHolder = literalHolders.get(key);
    if (literalHolder) literalHolder[key] = placeholder;
    else container[key] = placeholder;
  }
  return clone;
}

/**
 * Commit a successful onboarding trial into the local catalog as a real entry:
 * vendor + encrypted apiKey + model (with evidence) + create/query mappings.
 *
 * Designed to be called from the renderer once a TrialOutcome arrives with
 * status === "success". Returns the persisted Model so the caller can light up
 * the success UI.
 */
export function commitOnboardedModelToCatalog(payload: {
  outcome: unknown;
  userApiKey: string;
  /** Optional display label override; otherwise we use draft.modelDisplayName. */
  displayLabel?: string;
  /** How this model was added. Defaults to "agent" (the doc-reader path). The
   *  manual BaseURL entry passes "manual" so the catalog records provenance honestly. */
  addedVia?: "agent" | "manual";
}): Model {
  const outcome = payload?.outcome as JsonRecord | null;
  if (!outcome || typeof outcome !== "object") throw new Error("outcome required");
  const draft = (outcome as JsonRecord).draft as JsonRecord | null;
  if (!draft) throw new Error("outcome.draft missing");

  const vendorKey = String(draft.vendorKey || "").trim();
  const vendorName = String(draft.vendorName || vendorKey).trim();
  const vendorBaseUrl = String(draft.vendorBaseUrl || "").trim();
  const modelKey = String(draft.modelKey || "").trim();
  // 显示名兜底不落裸 id（审计 A13）。
  const modelDisplayName = String(payload.displayLabel || draft.modelDisplayName || "").trim() || humanizeModelKey(modelKey);
  const targetKind = String(draft.targetKind || "").trim();
  const userApiKey = String(payload.userApiKey || "").trim();

  if (!vendorKey || !vendorBaseUrl || !modelKey) {
    throw new Error("incomplete draft: vendorKey + vendorBaseUrl + modelKey are required");
  }
  if (!userApiKey) throw new Error("userApiKey required to commit a model");

  const billingKind = targetKind as BillingModelKind;
  const taskKind = primaryTaskKindForModelKind(targetKind);

  const auth = (draft.vendorAuth || {}) as JsonRecord;
  const authType = (auth.type as Vendor["authType"]) || "bearer";

  // onboarding evidence 快照 + meta.parameters 投影（纯计算，先备好，再进事务）。
  type OnboardingField = NonNullable<Model["onboarding"]>["fields"][number];
  const onboardingFields: OnboardingField[] = Array.isArray(draft.modelFields)
    ? (draft.modelFields as JsonRecord[]).map((f) => ({
        key: String(f.key),
        displayName: String(f.displayName),
        type: f.type as OnboardingField["type"],
        ...(f.options ? { options: f.options as OnboardingField["options"] } : {}),
        ...(f.default !== undefined ? { default: String(f.default) } : {}),
        evidence: f.evidence as OnboardingField["evidence"],
      }))
    : [];

  // Project the agent-detected fields into model.meta.parameters so the node UI
  // can render them. The UI reads parameters/upload-slots exclusively from
  // model.meta (parseModelParameterControls); onboarding.fields is only an
  // evidence snapshot. Without this projection the model lands in the catalog
  // but shows zero parameters and no image-url upload slots on the node.
  // The shape parseParameterControl expects: { key, label, type, options, default }.
  const metaParameters = onboardingFields.map((f) => ({
    key: f.key,
    label: f.displayName || f.key,
    type: f.type,
    ...(f.options ? { options: f.options } : {}),
    ...(f.default !== undefined ? { default: f.default } : {}),
  }));

  // mapping: one row per (vendor, taskKind), carrying both stages.
  // Reconcile: the agent only templatizes params it saw in the curl example,
  // so spec-derived params (resolution, duration, ...) the user can now select
  // on the node have no {{request.params.*}} slot in the body and would send
  // nothing. Inject the missing field keys at the param nesting level.
  const mappingCreate = draft.mappingCreate as HttpOperation | undefined;
  const mappingEdit = draft.mappingEdit as HttpOperation | undefined;
  const mappingImageToVideo = draft.mappingImageToVideo as HttpOperation | undefined;
  const mappingQuery = draft.mappingQuery as HttpOperation | undefined;
  const mappingStatus = draft.mappingStatus as Record<string, string[]> | undefined;
  // 这个模型实际用的是哪套 wire：命中原生报文时记档案 id，否则通用 new-api 模板。诚实标注，
  // 排障与「这条路发不发得出某个参考」的护栏都读它。
  const wireProfileId = typeof draft.wireProfileId === "string" ? draft.wireProfileId : undefined;
  // 协议判定：multipart 与 xai-json 都落 /images/edits，靠 op.multipart 分辨（multipart 描述符=二进制文件上传）。
  const imageEditProtocol = targetKind === "image" && mappingEdit
    ? (mappingEdit.multipart
        ? "openai-multipart-edits"
        : /\/chat\/completions$/.test(mappingEdit.path)
          ? "chat-completions-image-url"
          : /\/images\/edits$/.test(mappingEdit.path)
            ? "xai-json-edits"
            : "custom")
    : undefined;
  // reconcile 只补「body 缺、又没被 paramMap 消费」的字段。被 paramMap 转成 wire 键的 canonical 键
  // （如 aspect_ratio/resolution → size）不该再以裸键注入 body——否则通用中转会收到无用的 aspect_ratio
  // 裸字段（严格端点可能 400）。这是 P2 根因修（不是逐 op 打补丁）。
  const consumed = new Set(consumedCanonicalKeys(mappingCreate?.paramMap));
  // 原生报文（wireProfile）是厂商契约的刻意造型：content 数组 + ratio/resolution/generate_audio，
  // **绝不能** reconcile —— 盲塞通用键会把 size/image_url 硬加进去（甚至覆盖已有槽，正是首帧位
  // 被覆盖那个 bug 的同款）。只有通用 new-api 模板才需要对账补参。
  const reconcileKeys = wireProfileId ? [] : onboardingFields.map((f) => f.key).filter((k) => !consumed.has(k));
  const reconciledCreate: HttpOperation | undefined = mappingCreate
    ? mappingCreate.body !== undefined && reconcileKeys.length > 0
      ? { ...mappingCreate, body: mergeMissingParamsIntoBody(mappingCreate.body, reconcileKeys) }
      : mappingCreate
    : undefined;

  // 单次事务（P2·根治半截接入）：vendor + apiKey + model + mapping 在一份内存 state 上攒齐，
  // 全部成功才一次性落盘；任一步抛错则整体不写，绝不留「vendor 写了 model 没写成」的不可用空壳。
  // 与 importModelCatalogPackage 同构（共用 apply* 纯函数）。
  const model = mutateCatalog((tx) => {
    // 1. vendor — carry draft.vendorMeta through so the manual-entry form's custom
    // request headers (vendorMeta.extraHeaders) persist and reach buildAiSdkModel.
    tx.upsertVendor({
      key: vendorKey,
      name: vendorName,
      baseUrlHint: vendorBaseUrl,
      authType,
      authHeader: auth.headerName || null,
      authQueryParam: auth.queryParam || null,
      providerKind: draft.vendorProviderKind || "openai-compatible",
      enabled: true,
      ...(draft.vendorMeta !== undefined ? { meta: draft.vendorMeta } : {}),
    });
    // 2. apiKey (auto-encrypted by upsert)
    tx.upsertApiKey(vendorKey, { apiKey: userApiKey, enabled: true });
    // 3. model + onboarding evidence snapshot
    const committed = tx.upsertModel({
      modelKey,
      vendorKey,
      modelAlias: modelKey,
      labelZh: modelDisplayName,
      kind: billingKind,
      enabled: true,
      // 只有真实存在 image_edit mapping 才声明参考图能力；协议随模型落库，避免 UI 展示能力却只能撞错端点。
      meta: {
        parameters: metaParameters,
        // 走原生报文 = 这个模型确实就是那个档案：标上 archetypeId，headless/MCP 缺参才有档案默认可兜
        // （UI 路本来就由档案驱动、不受影响）。wireProfile 则记「这条 wire 是哪套」，供护栏与排障读。
        ...(wireProfileId ? { wireProfile: wireProfileId, archetypeId: wireProfileId } : {}),
        ...(billingKind === "image" ? { imageOptions: {
          supportsReferenceImages: Boolean(mappingEdit),
          ...(imageEditProtocol ? { imageEditProtocol } : {}),
        } } : {}),
      },
      onboarding: {
        addedVia: payload.addedVia ?? "agent",
        trialId: String(outcome.trialId || ""),
        docsUrl: String(outcome.docsUrl || ""),
        addedAt: nowIso(),
        fields: onboardingFields,
      },
    });
    // 4. mapping（text_to_image / text_to_video / …）
    if (reconciledCreate) {
      tx.upsertMapping({
        vendorKey,
        taskKind,
        name: modelDisplayName,
        enabled: true,
        create: reconciledCreate,
        ...(mappingQuery ? { query: mappingQuery } : {}),
        ...(mappingStatus ? { statusMapping: mappingStatus } : {}),
      });
    }
    // 4b. 图生图/改图 mapping（image_edit）：按 modelKey 精确绑定，同一 vendor 内允许不同协议并存。
    // 不 reconcile：edit body 是协议刻意造型，不能把通用参数盲塞进去。
    // 4c. 图生视频 mapping（image_to_video）：与文生视频同一条 wire（new-api 视频端点带可选 image 首帧），
    // 但 runtime 按 taskKind 选通道，必须各注册一条。带上同一条轮询 query（视频是异步任务）。
    // reconcile 与文生视频一致：body 缺的标准参数要补，否则时长/尺寸发不出去。
    if (mappingImageToVideo && targetKind === "video") {
      const reconciledI2v =
        mappingImageToVideo.body !== undefined && reconcileKeys.length > 0
          ? { ...mappingImageToVideo, body: mergeMissingParamsIntoBody(mappingImageToVideo.body, reconcileKeys) }
          : mappingImageToVideo;
      tx.upsertMapping({
        vendorKey,
        taskKind: "image_to_video",
        modelKey,
        name: `${modelDisplayName} · 图生视频`,
        enabled: true,
        create: reconciledI2v,
        ...(mappingQuery ? { query: mappingQuery } : {}),
        ...(mappingStatus ? { statusMapping: mappingStatus } : {}),
      });
    }
    if (mappingEdit && targetKind === "image") {
      tx.upsertMapping({
        vendorKey,
        taskKind: "image_edit",
        // 改图协议是模型级能力：同一 vendor 可同时有 chat 多模态与 JSON /images/edits。
        // 精确绑定后 selectTaskMapping 会优先命中本模型，不再被 vendor 级 generic mapping 误投。
        modelKey,
        name: `${modelDisplayName} · 改图`,
        enabled: true,
        create: mappingEdit,
      });
    }
    return committed;
  });

  return model;
}

/**
 * Derive a stable vendorKey from a BaseURL host. Same host → same vendor (so
 * re-adding models under the same endpoint merges, per upsert semantics).
 * localhost/127.0.0.1 include the port so Ollama(11434) and ComfyUI(8188) don't
 * collide as one "localhost" vendor.
 */
export function deriveVendorKeyFromBaseUrl(baseUrl: string): string {
  let host = "";
  let port = "";
  try {
    const u = new URL(baseUrl);
    host = u.hostname;
    port = u.port;
  } catch {
    return "";
  }
  // 内置认得的 host → 直接复用内置 vendorKey，别再按 hostname 另造一个。
  // 不这么做的话，走向导接入火山方舟会造出 `ark-cn-beijing-volces-com`，与内置种子的 `volcengine`
  // 各占一个柜子：向导那半个一条内置 mapping 都拿不到，Seedream/Seedance 全退回通用最小模板
  // （用户症状 = 「接了火山但没有图生图」）。key 随本次提交一起写到内置 vendor 上，故合并后即可用。
  const builtin = builtinVendorKeyForHostname(host);
  if (builtin) return builtin;
  let seed = host;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    seed = `local-${port || "80"}`;
  }
  return seed.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * Manual provider entry — the PRIMARY model-adding path (BaseURL + key + models).
 * Deterministic: for a standard OpenAI-compatible text endpoint the whole catalog
 * shape is known, so no doc-reading AI is needed (that breaks the bootstrap
 * deadlock where the doc-reader itself required a pre-existing text model).
 *
 * Reuses the SINGLE write path (commitOnboardedModelToCatalog) — N models = one
 * vendor + N model upserts. Text/chat models run via the direct AI SDK path
 * (buildAiSdkModel → createOpenAICompatible), so we deliberately emit NO HTTP
 * mapping here: a fabricated /chat/completions mapping would be unused dead data.
 *
 * Connectivity (P3·对齐「接入即验证」纪律，记录现状取舍——不在 commit 里做**阻断式**校验)：
 * 刻意不在本同步 commit 路径里探活（对齐 opencode）。原因：本地/自定义端点容忍度差异极大
 * （Ollama / ComfyUI / 各类中转），存了再在首次调用时按真实 vendor 错误报人话（runtime 已结构化
 * VendorRequestError + describeNetworkError），比在接入时阻断更诚实，也不会把合法模型挡在门外。
 *
 * 注意覆盖边界（别误以为已有兜底）：`testModelCatalogMapping`（IPC nomi:model-catalog:mapping:test）
 * 只覆盖**带 mapping** 的 image/video/异步模型；本路径提交的 text/chat 走直连 AI SDK、刻意无 mapping，
 * 因此**不被那条测试覆盖**——这一路目前确无显式连通性入口。补一个**非阻断、用户主动触发**的
 * 「测试连接」（轻量 GET {baseUrl}/models 探活，仅提示不拦提交）是合理的后续；但它需要新增
 * main.ts IPC + desktopClient 入口（均在本次作用域外），故此处暂记缺口、不落半截 dead export。
 */
/** 标准参数控件 → onboarding field 形状（落 model.meta.parameters；标准参数无文档 evidence，标 standard）。 */
function paramsToOnboardingFields(
  params: Array<{ key: string; label: string; type: string; options: Array<{ value: string; label: string }>; defaultValue?: string | number | boolean; min?: number; max?: number }>,
): JsonRecord[] {
  return params.map((p) => ({
    key: p.key,
    displayName: p.label,
    type: p.type,
    ...(p.options.length ? { options: p.options } : {}),
    ...(p.defaultValue !== undefined ? { default: String(p.defaultValue) } : {}),
    evidence: { field: p.key, evidence: "new-api 标准参数", evidence_location: "", confidence: "high" },
  }));
}

/** 按 kind 给出 commit draft 的 targetKind + 标准参数 + 传输 mapping（图片同步无 query / 视频异步带 query；
 *  图片另带 image_edit 改图 op = 图生图）。
 *
 *  **这是「某个 kind 该配哪套调用通道」的唯一真相源。** 导出是因为改类型（catalog/modelRetype.ts）
 *  必须按新 kind 重建通道——只翻 kind 标签而不重建通道等于假修：文本模型刻意不带任何 mapping
 *  （chat 直连），所以被误判成文本的图片模型是「kind 错 + 通道没建」两个洞，只补一个下一步就撞
 *  selectTaskMapping 返回 null，换个看不懂的错继续失败。两处共用本函数 = 不造并行版（P1）。 */
export function draftShapeForKind(
  kind: "text" | "image" | "video" | "audio" | "model3d",
  modelKey = "",
  imageEditProtocol?: NewapiImageEditProtocol | null,
  /** 探测确认这家中转提供该模型档案的原生端点时传入 → 直接用那份完整报文，不用通用最小模板。 */
  nativeProfile?: NativeWireProfile | null,
): {
  targetKind: "text" | "image" | "video" | "audio" | "model3d";
  modelFields: JsonRecord[];
  mappingCreate?: HttpOperation;
  mappingEdit?: HttpOperation;
  mappingImageToVideo?: HttpOperation;
  mappingQuery?: HttpOperation;
  mappingStatus?: Record<string, string[]>;
  /** 落 model.meta：这个模型实际用的是哪套 wire（诚实标注，护栏与排障都读它）。 */
  wireProfileId?: string;
} {
  // 原生报文优先：命中档案且这家真提供该端点 → 复用已验证的完整形状（首尾帧/角色图/参考视频/
  // 参考音频/generate_audio 全在），只换地址。通用做法，不是给某一家打补丁。
  if (nativeProfile && kind === "video") {
    const create = nativeProfile.create.text_to_video;
    const i2v = nativeProfile.create.image_to_video;
    if (create) {
      return {
        targetKind: "video",
        // 不落通用标准参数：UI 本来就由档案驱动，而 headless 缺参由 archetypeWireDefaults 按档案 id
        // 兜底。落了反而会让 reconcile 把 size/image_url 塞进原生 body（诚实：这条 wire 没这些键）。
        modelFields: [],
        mappingCreate: create,
        ...(i2v ? { mappingImageToVideo: i2v } : {}),
        ...(nativeProfile.query ? { mappingQuery: nativeProfile.query } : {}),
        ...(nativeProfile.statusMapping ? { mappingStatus: nativeProfile.statusMapping } : {}),
        wireProfileId: nativeProfile.archetypeId,
      };
    }
  }
  // 图像同样吃原生报文（同步族：只有 create/edit，无轮询）。不这么做的话，中转就算代理了方舟，
  // Seedream 改图仍会被当**聊天模型**塞进 chat/completions 多模态——它不是聊天模型，改图不按原图甚至直接失败。
  if (nativeProfile && kind === "image") {
    const create = nativeProfile.create.text_to_image;
    const edit = nativeProfile.create.image_edit;
    if (create) {
      return {
        targetKind: "image",
        // 同视频分支：不落通用标准参数（这条 wire 没这些键），headless 缺参由 archetypeWireDefaults 按档案兜底。
        modelFields: [],
        mappingCreate: create,
        ...(edit ? { mappingEdit: edit } : {}),
        wireProfileId: nativeProfile.archetypeId,
      };
    }
  }
  if (kind === "image") {
    const t = newapiTransportFor("image");
    // 改图协议：探测/手动 override 优先，否则按模型族智能默认（gpt-image/dall-e → multipart edits）。
    const edit = newapiImageEditProfileForModel(modelKey, null, imageEditProtocol).operation;
    return { targetKind: "image", modelFields: paramsToOnboardingFields(t.params), mappingCreate: t.create, mappingEdit: edit };
  }
  if (kind === "video") {
    const t = newapiTransportFor("video");
    return {
      targetKind: "video",
      modelFields: paramsToOnboardingFields(t.params),
      mappingCreate: t.create,
      // 图生视频通道：不注册它，连了参考图/首帧的视频节点会被 imageEditGuardError 拒发（「没有配置
      // 图生视频通道」）——中转接入的视频模型此前一律缺这条。
      ...(t.imageToVideo ? { mappingImageToVideo: t.imageToVideo } : {}),
      ...(t.query ? { mappingQuery: t.query } : {}),
    };
  }
  if (kind === "audio") {
    // 中转配音(TTS)：OpenAI 兼容 /v1/audio/speech 同步出二进制音频（无 query）。命中 seed-tts 档案 → UI 出火山音色。
    const t = newapiTransportFor("audio");
    return { targetKind: "audio", modelFields: paramsToOnboardingFields(t.params), mappingCreate: t.create };
  }
  // 3D 与 text 一样不带 mapping，但**理由完全相反**：text 是不需要（chat 走 AI SDK 直连），
  // 3D 是没有（OpenAI 兼容面上根本没有 3D 生成端点，newapiTransportFor 也只有三种）。
  // 所以 3D 只登记身份、等有通道那天这些条目直接能用；接入向导会明着标它现在跑不了（D4 缺口明标）。
  if (kind === "model3d") return { targetKind: "model3d", modelFields: [] };
  return { targetKind: "text", modelFields: [] };
}

export function commitManualOpenAiCompatibleModels(payload: {
  vendorName: string;
  baseUrl: string;
  apiKey: string;
  /** 每个模型可带 imageEditProtocol（来自免费探测或用户手选），图片模型据此选改图 wire；缺省=智能默认。 */
  models: Array<{
    id: string;
    displayName?: string;
    kind?: "text" | "image" | "video" | "audio" | "model3d";
    imageEditProtocol?: NewapiImageEditProtocol;
    /** 探测确认这家提供该档案原生端点时由 onboardingIpc 传入 → 用原生完整报文替代通用最小模板。 */
    nativeWireArchetypeId?: string;
  }>;
  /** Endpoint shape. Defaults to "openai-compatible" (the common case). "anthropic"
   *  routes text/chat through the Messages API (createAnthropic, x-api-key). */
  providerKind?: AiSdkProviderKind;
  /** Extra request headers for relay/proxy gateways, persisted on the vendor and
   *  replayed on every model call via buildAiSdkModel. */
  headers?: Record<string, string>;
}): { vendorKey: string; committed: Array<{ modelKey: string; displayName: string }> } {
  const rawBaseUrl = String(payload?.baseUrl || "").trim();
  const apiKey = String(payload?.apiKey || "").trim();
  const providerKind = normalizeProviderKind(payload?.providerKind);
  // Anthropic offers a hosted default; an OpenAI-compatible endpoint must be told.
  // For anthropic with a blank field we fill in the canonical host so the vendor
  // always has a concrete baseUrlHint (the doc-reader + commit path require one).
  const baseUrl =
    providerKind === "anthropic" && !rawBaseUrl ? "https://api.anthropic.com" : rawBaseUrl;
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("接入地址需以 http:// 或 https:// 开头");
  if (!apiKey) throw new Error("API Key 不能为空");

  const vendorKey = deriveVendorKeyFromBaseUrl(baseUrl);
  if (!vendorKey) throw new Error("无法从接入地址解析出供应商标识");

  const vendorName = String(payload?.vendorName || "").trim() || vendorKey;

  // Clean custom headers: trim, drop blanks. Stored on vendor.meta.extraHeaders.
  const cleanHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload?.headers || {})) {
    const key = String(k || "").trim();
    const value = String(v ?? "").trim();
    if (key && value) cleanHeaders[key] = value;
  }
  const vendorMeta =
    Object.keys(cleanHeaders).length > 0 ? { extraHeaders: cleanHeaders } : undefined;

  const rawModels = Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set<string>();
  const cleanModels = rawModels
    .map((m) => {
      const k = m?.kind;
      const id = String(m?.id || "").trim();
      // kind 缺省时用启发式猜（安全网：即便 UI 没传 kind，flux→image / kling→video 也不会错落 text）。
      return {
        id,
        displayName: String(m?.displayName || "").trim(),
        kind: (k === "image" || k === "video" || k === "text" || k === "audio" || k === "model3d" ? k : guessModelKind(id)) as "text" | "image" | "video" | "audio" | "model3d",
        imageEditProtocol: m?.imageEditProtocol,
        nativeWireArchetypeId: m?.nativeWireArchetypeId,
      };
    })
    .filter((m) => {
      if (!m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  if (cleanModels.length === 0) throw new Error("至少填写一个模型 id");

  const committed: Array<{ modelKey: string; displayName: string }> = [];
  for (const m of cleanModels) {
    const displayName = m.displayName || humanizeModelKey(m.id);
    // 图片/视频走 new-api 标准传输模板（per-model kind）；文本不带 mapping（chat 直连）。
    const shape = draftShapeForKind(m.kind, m.id, m.imageEditProtocol, nativeWireProfileForArchetype(m.nativeWireArchetypeId));
    const outcome = {
      status: "success",
      trialId: "",
      docsUrl: "",
      draft: {
        vendorKey,
        vendorName,
        vendorBaseUrl: baseUrl,
        vendorAuth: { type: providerKind === "anthropic" ? ("x-api-key" as const) : ("bearer" as const) },
        vendorProviderKind: providerKind,
        ...(vendorMeta ? { vendorMeta } : {}),
        modelKey: m.id,
        modelDisplayName: displayName,
        targetKind: shape.targetKind,
        modelFields: shape.modelFields,
        ...(shape.mappingCreate ? { mappingCreate: shape.mappingCreate } : {}),
        ...(shape.mappingEdit ? { mappingEdit: shape.mappingEdit } : {}),
        ...(shape.mappingImageToVideo ? { mappingImageToVideo: shape.mappingImageToVideo } : {}),
        ...(shape.mappingQuery ? { mappingQuery: shape.mappingQuery } : {}),
        ...(shape.mappingStatus ? { mappingStatus: shape.mappingStatus } : {}),
        ...(shape.wireProfileId ? { wireProfileId: shape.wireProfileId } : {}),
      },
    };
    commitOnboardedModelToCatalog({ outcome, userApiKey: apiKey, addedVia: "manual" });
    committed.push({ modelKey: m.id, displayName });
  }

  return { vendorKey, committed };
}

export async function fetchModelCatalogDocs(payload: unknown): Promise<unknown> {
  const targetUrl = String((payload as JsonRecord)?.url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error("http/https url is required");
  // v0.7.6: hardenedFetch — 拦私网 + 超时 + 限制大小
  const fetched = await hardenedFetchText(targetUrl, {
    timeoutMs: 15_000,
    maxBytes: 5 * 1024 * 1024, // 文档抓取 5MB 上限够用
  });
  const html = fetched.text;
  const contentType = fetched.contentType;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const max = 120000;
  return {
    url: targetUrl,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType,
    title,
    text: text.slice(0, max),
    truncated: text.length > max,
    diagnostics: [],
  };
}

export async function testModelCatalogMapping(id: string, payload: unknown): Promise<unknown> {
  const {
    billingKindForTaskKind,
    buildProfileHttpRequest,
    buildProfileTaskResult,
    executeProfileOperation,
    findExecutableModelForTask,
  } = await import("../runtime");
  const mapping = readCatalog().mappings.find((item) => item.id === id);
  const raw = payload as JsonRecord | undefined;
  if (!mapping) {
    return {
      mappingId: id,
      vendorKey: "",
      taskKind: "chat",
      stage: raw?.stage || "create",
      executed: false,
      ok: false,
      diagnostics: ["Mapping not found."],
      request: null,
    };
  }
  const stage = raw?.stage === "result" || raw?.stage === "query" ? "query" : "create";
  const operation: HttpOperation | undefined = stage === "create" ? mapping.create : mapping.query;
  if (!operation) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: false,
      diagnostics: [`Mapping has no ${stage} stage.`],
      request: null,
    };
  }
  const wantedKind = billingKindForTaskKind(mapping.taskKind);
  const { vendor, model, apiKey } = findExecutableModelForTask(mapping.vendorKey, trim(raw?.modelKey), wantedKind);
  const request: TaskRequest = {
    kind: mapping.taskKind,
    prompt: firstString(raw?.prompt, "Nomi mapping smoke test"),
    extras: {
      ...(isJsonRecord(raw?.extras) ? raw?.extras : {}),
      modelKey: model.modelKey,
      modelAlias: model.modelAlias || model.modelKey,
    },
  };
  const providerMeta = {
    query_id: firstString(raw?.taskId),
    task_id: firstString(raw?.taskId),
  };
  const preview = buildProfileHttpRequest({ vendor, model, apiKey, request, operation, providerMeta }).preview;
  const upstreamResponse = raw && Object.prototype.hasOwnProperty.call(raw, "upstreamResponse") ? raw.upstreamResponse : undefined;
  if (typeof upstreamResponse !== "undefined") {
    const normalized = await buildProfileTaskResult({
      response: upstreamResponse,
      mapping,
      operation,
      request,
      taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
      wantedKind,
    });
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: normalized.result.status !== "failed",
      diagnostics: ["Mapped the provided upstream response without sending a request."],
      request: preview,
      response: normalized.result,
    };
  }
  if (!raw?.execute) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: true,
      diagnostics: ["Rendered local desktop mapping without sending a request."],
      request: preview,
    };
  }
  const executed = await executeProfileOperation({ vendor, model, apiKey, request, operation, providerMeta });
  const normalized = await buildProfileTaskResult({
    response: executed.response,
    mapping,
    operation,
    request,
    taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
    wantedKind,
  });
  return {
    mappingId: id,
    vendorKey: mapping.vendorKey,
    taskKind: mapping.taskKind,
    stage,
    executed: true,
    ok: normalized.result.status !== "failed",
    diagnostics: ["Executed mapping through the desktop runtime."],
    request: executed.request,
    response: normalized.result,
  };
}
