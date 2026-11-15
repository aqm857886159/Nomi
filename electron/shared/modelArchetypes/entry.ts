// 档案入口：给模型和档，拿到已按档收窄的档案。index.ts 原样转出；videoCapabilities 里的读者直接从这里拿，
// 免得经 index.ts 转出的 ../videoCapabilities 绕成环（check:boundaries）。
import { anchorsConsumedBy } from './anchorPolicy';
import { modelNameSourceFor, scopeArchetypeModelNames, type ModelNameSource } from "./modelNameSource";
import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype, ModelArchetypeVariant } from "./types";
// 档案表本身不从这里导出：生产代码拿档案只走 resolveModelArchetype（结构测试 archetypeSingleEntry.structure.test.ts 守）。
import { getArchetypeById, MODEL_ARCHETYPES } from "./builtInCatalog";
import { customCapabilityArchetypeForModel } from "./customCapabilityContract";
import { headlessDefaultsOf, identityPatternsOf, modeManifestOf, sizeRatioTaskKindsOf } from "./catalogFacts";
import { resolveArchetypeVariant } from "./variantResolution";


/** 归一模型标识：去掉 "models/" 前缀、trim、小写。 */
function normalizeIdentifier(value: unknown): string {
  return rawIdentifier(value).toLowerCase();
}

/** 去掉 models/ 前缀但保留原始大小写；APIMart/KIE 的同名模型靠大小写区分官方 key。 */
function rawIdentifier(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

/** 取标识的末段（去掉 vendor 前缀，如 "bytedance/seedance-2" → "seedance-2"）。 */
function lastSegment(identifier: string): string {
  const idx = identifier.lastIndexOf("/");
  return idx >= 0 ? identifier.slice(idx + 1) : identifier;
}

/**
 * 匹配分两档，**精确整串永远优先于末段**（见 resolveBaseArchetype 的两趟解析）。
 * 只认相等、不认前缀：故 seedance-2 不会误命中 seedance-2-fast。
 * 主进程只凭模型名认档案（archetypeIdForModel）也用这同一组函数。
 */
function matchesExact(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && id === pat;
}

function matchesCaseExact(identifier: string, pattern: string): boolean {
  const id = rawIdentifier(identifier);
  const pat = rawIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && id === pat;
}

/** 去掉 vendor 前缀后末段相等（"bytedance/seedance-2" ↔ "seedance-2"）。 */
function matchesLastSegment(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && lastSegment(id) === lastSegment(pat);
}

export type ArchetypeModelLike = {
  modelKey?: string | null;
  modelAlias?: string | null;
  /**
   * 模型所属供应商 —— **必传**（值可为 null=未知）。B 档案分层按它特化 params
   * （见 specializeArchetypeForVendor）。必传是结构保证：曾有 5 个调用点漏传 →
   * 发送路拿到的是未特化档案、与 UI 侧（传了 vendor）分裂；类型层逼所有调用点显式表态。
   * 注意：vendor **不改变**解析结果（供应商无关识别是设计特性——seed-tts/中转 Seedance
   * 等档案就是给任意中转用的）；中转与内置家的传输差异由「标准参考面永远在场」不变量吸收
   * （见 catalogTaskActions.buildReferenceExtras / electron referenceInputParams，2026-07-24）。
   */
  vendorKey: string | null | undefined;
  meta?: unknown;
  /**
   * 这一行接不接受档案的型号名（目录层按供应商映射算好的结果，见 modelNameSource.ts）。缺省 = 问本进程的查询口。
   */
  modelNameSource?: ModelNameSource;
};

function readArchetypeIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const record = meta as { archetypeId?: unknown; archetype?: unknown };
  // catalog 模型行使用 meta.archetypeId；画布节点持久化使用 meta.archetype.id。
  // 两者必须由同一个解析入口识别，否则会出现「连线侧已切改图，发送侧却认不出档案」的分裂。
  const direct = record.archetypeId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = record.archetype;
  if (nested && typeof nested === "object") {
    const id = (nested as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

/**
 * 「全部档」记号：问的是这个模型**任一档**的事（剥掉别的档留下的旧键、画档位轴、名单层一行一模型……），
 * 不是某一档的参数。名字上看得出是有意的；用到它的生产文件是一张只减不增的名单（archetypeSingleEntry.structure.test.ts）。
 */
export const EVERY_VARIANT: unique symbol = Symbol("archetype.every-variant");

/** 具体的一档：两个键都要写（值可以空）——空 / 认不出按唯一 owner resolveArchetypeVariant 的规则落档。 */
export type ArchetypeVariantRequest = Readonly<{ variantId: unknown; modelId: unknown }>;

/**
 * 这次要哪一档。**没有缺省值**（先例同文件 vendorKey：漏传 = 拿到没收窄的档案，类型层逼每个调用点表态）：
 * - 具体的一档（`{ variantId, modelId }`）；
 * - 按解析出的档案再定的一档（函数形）：存档里记的 variantId 只在「记的就是这个档案」时才算，这个判断要先认出档案；
 * - `EVERY_VARIANT`：全部档的并集。
 */
export type ArchetypeVariantPick =
  | ArchetypeVariantRequest
  | ((archetype: ModelArchetype) => ArchetypeVariantRequest)
  | typeof EVERY_VARIANT;

/** 每份基础档案按（供应商, 型号名来源）作用域后的结果；同一组输入同一个对象（渲染层靠引用相等省重渲染）。 */
const scopedCache = new WeakMap<ModelArchetype, Map<string, ModelArchetype>>();
/** 作用域后的档案按档收窄的结果；记着收窄时那份 paramOverrides（测试夹具会临时装卸），换了就重算。 */
const narrowedCache = new WeakMap<ModelArchetype, Map<string, { overrides: ModelArchetypeVariant["paramOverrides"]; value: ModelArchetype }>>();
/** 收窄结果 → 它的全部档版本（换档 / 并集问题从这里回到同一份全集，不在收窄过的上面再收一遍）。 */
const everyVariantOf = new WeakMap<ModelArchetype, ModelArchetype>();

function scopedArchetype(base: ModelArchetype, model: ArchetypeModelLike): ModelArchetype {
  const source = modelNameSourceFor(model);
  const key = `${typeof model.vendorKey === "string" ? model.vendorKey.trim() : ""}\u0000${source ?? ""}`;
  let byKey = scopedCache.get(base);
  const hit = byKey?.get(key);
  if (hit) return hit;
  // 型号名按供应商作用域解析：这家这一行不接受档案的型号名 → 档案只给参数（modelNameSource.ts，唯一一处）。
  const resolved = scopeArchetypeModelNames(specializeArchetypeForVendor(base, model.vendorKey), source);
  const value: ModelArchetype = { ...resolved, modes: resolved.modes.map((mode) => ({ ...mode, consumesAnchors: anchorsConsumedBy(mode) })) };
  if (!byKey) scopedCache.set(base, (byKey = new Map()));
  byKey.set(key, value);
  everyVariantOf.set(value, value);
  return value;
}

/**
 * 按档收窄——**唯一一份写法**：各方式的 params 叠上这一档的 paramOverrides（如 Seedance fast 的清晰度只 480/720）。
 * 身份 / 方式 / 参考槽不变（这一刀只收参数；「这一档能用哪些方式」是下一刀）。没有档、这一档没有改写 → 原样返回全集那个对象。
 */
function narrowToVariant(every: ModelArchetype, pick: ArchetypeVariantPick): ModelArchetype {
  if (pick === EVERY_VARIANT) return every;
  const request = typeof pick === "function" ? pick(every) : pick;
  const variant = resolveArchetypeVariant(every, { variantId: request.variantId, modelId: request.modelId });
  const overrides = variant?.paramOverrides;
  if (!variant || !overrides) return every;
  let byVariant = narrowedCache.get(every);
  const hit = byVariant?.get(variant.id);
  if (hit && hit.overrides === overrides) return hit.value;
  const value: ModelArchetype = {
    ...every,
    modes: every.modes.map((mode) => {
      const fn = overrides[mode.id];
      return fn ? { ...mode, params: fn(mode.params) } : mode;
    }),
  };
  if (!byVariant) narrowedCache.set(every, (byVariant = new Map()));
  byVariant.set(variant.id, { overrides, value });
  everyVariantOf.set(value, every);
  return value;
}

/**
 * **给模型和档，拿到已经按档收窄好的档案**——生产代码拿模型档案的唯一入口（设计卡 docs/plan/2026-11-15-archetype-single-entry.md）。
 * 顺序固定：基础档案（自写能力合同 → 显式 id + legacyIds 迁移 → 三趟身份匹配）→ 供应商 → 型号名作用域 → 方式的锚点消费 → 档。
 * 认不出 → null（渲染层走「通用」回退，按接入文档原样展示，不藏能力）。供应商无关识别、标准参考面不被档案独占的前提
 * 同以前（2026-07-24：档案投影叠加在标准参考面之上，buildReferenceExtras + referenceInputParams 两处测试锁死）。
 * 同一组输入返回同一个对象；自写能力合同的档案每次现解析（没有可以拿来当键的稳定对象），不在此列。
 */
export function resolveModelArchetype(
  model: ArchetypeModelLike | null | undefined,
  options: Readonly<{ variant: ArchetypeVariantPick }>,
): ModelArchetype | null {
  if (!model) return null;
  const base = resolveBaseArchetype(model);
  if (!base) return null;
  return narrowToVariant(scopedArchetype(base, model), options.variant);
}

/**
 * 节点 / 分镜镜头上存着的那一档（函数形的档）：`meta.archetype.variantId` 只在记的就是这个档案时才算（换过模型留下的旧档不算），
 * 连同模型名交给唯一 owner resolveArchetypeVariant——渲染层 currentArchetypeVariant 的同一组输入。
 */
export function variantRecordedInMeta(meta: unknown, modelId: unknown): (archetype: ModelArchetype) => ArchetypeVariantRequest {
  const stored = meta && typeof meta === "object" ? (meta as { archetype?: unknown }).archetype : undefined;
  const record = stored && typeof stored === "object" ? stored as { id?: unknown; variantId?: unknown } : {};
  const id = typeof record.id === "string" ? record.id : "";
  const variantId = typeof record.variantId === "string" ? record.variantId : "";
  return (archetype) => ({ variantId: id && id === archetype.id ? variantId : undefined, modelId });
}

/**
 * 手上已经有入口给的档案、要换一档（切档时把越界下拉夹回、方式参数 owner 按请求里记的档出键）：
 * 从它的全部档版本重新收窄，不在已收窄的上面再叠一遍。不是入口给的档案（自写合同、测试手搓的）按它自己就是全集处理。
 */
export function rescopeArchetypeVariant(archetype: ModelArchetype, variant: ArchetypeVariantPick): ModelArchetype {
  return narrowToVariant(everyVariantOf.get(archetype) ?? archetype, variant);
}

/**
 * 全目录的内置档案（全部档、未作用域）——只回答「全目录有没有哪个档案……」这类问题（参考键普查、全目录登记过的参数键）。
 * 生产里的使用点是一张只减不增的名单（archetypeSingleEntry.structure.test.ts）；拿某个模型的档案一律走 resolveModelArchetype。
 */
export function everyBuiltInArchetype(): readonly ModelArchetype[] {
  return MODEL_ARCHETYPES;
}

/**
 * 无界面 / Agent / MCP 发送缺参兜底：这个内置档案 × 任务种类 × 供应商的主方式声明了哪些默认值（推法见 catalogFacts.headlessDefaultsOf）。
 * 按目录行记着的 archetypeId 找（与以前那张生成表同一个键）；认不出 / 没有默认值 → undefined。
 */
export function builtInHeadlessDefaults(archetypeId: string | null | undefined, taskKind: string, vendorKey: string | null | undefined): Readonly<Record<string, unknown>> | undefined {
  const archetype = getArchetypeById(archetypeId);
  const perKind = archetype ? headlessDefaultsOf(archetype)[taskKind] : undefined;
  if (!perKind) return undefined;
  return (typeof vendorKey === "string" ? perKind[vendorKey] : undefined) ?? perKind["*"];
}

/** 这个内置档案这种任务的 `size` 键是不是比例语义（推法见 catalogFacts.sizeRatioTaskKindsOf）；认不出档案或不是 → undefined（调用方回退按默认值猜）。 */
export function builtInSizeIsRatioSemantic(archetypeId: string | null | undefined, taskKind: string): true | undefined {
  const archetype = getArchetypeById(archetypeId);
  return archetype && sizeRatioTaskKindsOf(archetype).has(taskKind) ? true : undefined;
}

/**
 * 方式菜单：这个内置档案的主方式 + 每个方式走哪种任务（推法见 catalogFacts.modeManifestOf，用到哪个档案才算、算完记住）。
 * 认不出档案 → undefined。
 */
export function builtInModeManifest(archetypeId: string | null | undefined): Readonly<{ defaultModeId: string; modes: Readonly<Record<string, string>> }> | undefined {
  const archetype = getArchetypeById(archetypeId);
  return archetype ? modeManifestOf(archetype) : undefined;
}

/**
 * 只凭 modelKey / modelAlias 认内置档案 id（主进程：中转接入选原生报文、自写调用草稿、方式清单）；认不出 → null。
 * 身份 = identifierPatterns + 各档 modelKey（catalogFacts.identityPatternsOf）；三趟匹配规则与 resolveBaseArchetype 同一组函数。
 * 与 resolveModelArchetype 的差别：不读 meta（显式 id / 自写能力合同由调用方自己先看），认得各档 modelKey。
 */
export function archetypeIdForModel(modelKey?: string | null, modelAlias?: string | null): string | null {
  const identities = [modelKey, modelAlias].filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (identities.length === 0) return null;
  for (const match of [matchesCaseExact, matchesExact, matchesLastSegment]) {
    for (const archetype of MODEL_ARCHETYPES) {
      if (identityPatternsOf(archetype).some((pattern) => identities.some((identity) => match(identity, pattern)))) return archetype.id;
    }
  }
  return null;
}

/** 解析「基础」档案（供应商无关，未特化）：显式 archetypeId 优先，否则按身份匹配 pattern。 */
function resolveBaseArchetype(model: ArchetypeModelLike): ModelArchetype | null {
  // A valid user-authored capability contract is the most explicit source of truth. It is
  // deliberately parsed before curated identity matching; invalid/unknown versions are inert
  // and fall through to the existing curated resolution path.
  const custom = customCapabilityArchetypeForModel(model);
  if (custom) return custom;
  const explicit = getArchetypeById(readArchetypeIdFromMeta(model.meta));
  const identifiers = [model.modelKey, model.modelAlias].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (explicit) {
    // A formerly shared profile may split by model version. Migrate only a declared
    // legacy ID with matching model identity; other explicit/user profiles keep priority.
    const migrated = MODEL_ARCHETYPES.find((candidate) => candidate.legacyIds?.includes(explicit.id)
      && identifiers.some((identifier) => candidate.identifierPatterns.some((pattern) => matchesLastSegment(identifier, pattern))));
    return migrated ?? explicit;
  }
  // **三趟**：先保留官方 key 的大小写做精确命中，再做大小写不敏感的整串命中，最后才找末段。
  // APIMart 的 `MiniMax-H3` 与 KIE 的 `minimax-h3` 归一后同名，但实际是两条不同线缆；
  // 先看原始 key 才不会让一个供应商的档案抢走另一个供应商的报文契约。单趟会让结果取决于档案声明顺序
  // （实测「Tongyi-MAI/Z-Image-Turbo」被排在前面的 z-image-turbo 档案靠末段抢走 = 认错模型、参数全错）。
  for (const match of [matchesCaseExact, matchesExact, matchesLastSegment]) {
    for (const archetype of MODEL_ARCHETYPES) {
      for (const identifier of identifiers) {
        if (archetype.identifierPatterns.some((pattern) => match(identifier, pattern))) return archetype;
      }
    }
  }
  return null;
}

/**
 * B 档案分层（用户拍板 2026-06-07）：把档案的 modes.params 替换成该供应商的覆盖版（mode.vendorParams[vendorKey]）。
 * 身份/能力形状（id/family/label/modes/槽种）不变；通道可以收紧单槽容量。
 * 无 vendorKey、或没有为该供应商声明参数/容量覆盖 → 原样返回（绝大多数情况，零开销）。
 */
export function specializeArchetypeForVendor(archetype: ModelArchetype, vendorKey: string | null | undefined): ModelArchetype {
  const key = typeof vendorKey === "string" ? vendorKey.trim() : "";
  if (!key) return archetype;
  if (!archetype.modes.some((mode) => mode.vendorParams?.[key] || mode.slots.some((slot) => slot.vendorMax?.[key] !== undefined))) return archetype;
  return {
    ...archetype,
    modes: archetype.modes.map((m) => {
      const vp = m.vendorParams?.[key];
      const slots = m.slots.map((slot) => {
        const max = slot.vendorMax?.[key];
        return max === undefined ? slot : { ...slot, max };
      });
      return { ...m, slots, params: vp ?? m.params };
    }),
  };
}

/**
 * 认得的模型 → 该档案默认档、默认模式的参数控件（ModelParameterControl[]，复用现有控件类型）；
 * 认不出 → null（调用方走现有 flat 解析）。供 model-options 适配层把它注入到 option.meta，
 * 让现有渲染路径不变就能渲染档案控件。**供应商无关**（入口只看模型身份）。
 */
export function archetypeParameterControls(model: ArchetypeModelLike | null | undefined): ModelParameterControl[] | null {
  // 默认档（variants 档案的默认档可能收窄某 mode 的参数，如 Seedance 标准档不收窄、fast 收窄）：只按档案默认、不按模型名反推。
  const archetype = resolveModelArchetype(model, { variant: (every) => ({ variantId: every.defaultVariantId, modelId: undefined }) });
  if (!archetype) return null;
  const mode = archetype.modes.find((m) => m.id === archetype.defaultModeId) ?? archetype.modes[0];
  return mode ? mode.params : null;
}
