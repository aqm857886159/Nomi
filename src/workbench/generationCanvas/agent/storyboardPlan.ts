import type { BuiltinCanvasCategoryId, GenerationCanvasEdgeMode } from '../model/generationCanvasTypes'
import { DEFAULT_IMAGE_SECONDS } from '../model/buildClipFromGenerationNode'
import i18n from '../../../i18n'
import {
  buildAnchorSheetPrompt,
  buildKeyframePrompt,
  buildShotPrompt,
  isVisualAnchor,
  referenceOrderForShot,
} from './storyboardPromptCompiler'

/**
 * 「分镜方案」中间表示（IR）—— 剧本→方案文档→确认→落画布 主链路的中枢。
 * 方案：`docs/plan/2026-06-13-storyboard-plan-document-flow.md`（§1.1 字段、决策 B=结构化字段视图）。
 *
 * planner 第一手产出这个**结构化对象**（不是自由文本），创作区把它渲染成可改的字段卡
 * （字段直接绑这个对象，改字段即改对象，无「文字→结构」解析），用户确认后
 * `storyboardPlanToCreateNodesArgs` 把它转成 create_canvas_nodes 参数落画布。
 */

/** 锚类型：跨镜头要一致的东西。character/scene/prop 默认视觉锚；style 默认文本锚（每镜常驻）。 */
export type PlanAnchorKind = 'character' | 'scene' | 'prop' | 'style'

/** 载体：视觉锚=生成参考图挂参考槽；文本锚=描述拼进引用它的镜头 prompt（prompt 能说清的就别生成图）。 */
export type PlanAnchorCarrier = 'visual' | 'text'

export type StoryboardPromptSkeletonSegment = {
  key: string
  label: string
  kind: 'enum'
  options: string[]
}

export type StoryboardProfile = {
  aspect: string
  dialogue: boolean
  promptSkeleton: StoryboardPromptSkeletonSegment[]
}

/** 可丢失的文本 range 标注；prompt 本身永远是唯一真相。 */
export type PromptSegmentRange = { key: string; start: number; end: number }

export type PlanAnchor = {
  /** 稳定 id；落画布时直接当 create_canvas_nodes 的 clientId。 */
  id: string
  kind: PlanAnchorKind
  /** 「林夏」「天台」「红书包」「全片风格」——镜头按名引用、也是卡片标题。 */
  name: string
  /** 标准描述：视觉锚 → 卡片/定妆 prompt；文本锚 → 拼进引用镜头的 prompt。 */
  description: string
  /**
   * 身份 DNA（脸型/发色/骨相/标志物）——跨镜必须一致、是身份轴对照的基准（W2 圣经 static 层）。
   * 由分镜规划师从全资产大师 V3.0 资产卡的「基础面容锚点」填。落画布写进 node.meta.staticFeatures；
   * 与 description 并存时 `buildAnchorSheetPrompt` 优先用 static+dynamic 分区（description 保留向后兼容）。
   */
  staticFeatures?: string
  /**
   * 服装/配饰/状态（允许跨镜变，不进身份匹配）——W2 圣经 dynamic 层（ViMax：身份只看 static、服装 dynamic 可换）。
   * 由规划师从 V3.0 资产卡的「服装层次/特殊状态」填。落画布写进 node.meta.dynamicFeatures。
   */
  dynamicFeatures?: string
  carrier: PlanAnchorCarrier
  /** all=每镜常驻（风格/品牌）；selective=被点名才用（角色/场景/道具）。缺省按 kind 推。 */
  scope?: 'all' | 'selective'
  /**
   * 同一锚要在「一张定妆卡/场景卡」里并列呈现的变体/状态（用户拍板：AI 猜 + 手改）。
   * 角色：如「成年」「童年」「战损」；场景：如「白天远景」「夜晚近景」。
   * 落画布时拼进卡片提示词的「变体行」，让多视图+多变体集中在一张图里、整张喂参考。
   */
  variants?: string[]
  /** @ 引用绑定的来源事实；关系本身仍只存在于 PlanShot.anchorIds。 */
  referenceUrl?: string
  referenceKind?: 'image' | 'video' | 'audio'
  /** 某镜结果已是画布节点时直接复用该节点，不复制成新的参考卡。 */
  referenceSourceNodeId?: string
  /** Image model used to render this visual anchor; explicit selection survives materialization. */
  modelKey?: string
  /** 该锚所选模型的供应商 key（与 modelKey 成对构成身份唯一键；同 PlanShot.modelVendor）。 */
  modelVendor?: string
  modeId?: string
  params?: Record<string, unknown>
  /**
   * 这张锚**自己生成时**要吃的参考（v6 §2.2：锚展开态与镜头行同一套解剖，参考列自然也同一套）。
   * 键与 `PlanShot.referenceBindings` 同为 `ArchetypeReferenceSlotKind`。
   * ⚠️ 本轮（实验室优先）只到形态与编辑；落画布时的 meta 投影是下一刀（见合同 §9.3 的债）。
   */
  referenceBindings?: Record<string, PlanReferenceBinding[]>
}

/** 一条参考绑定：url 是发送真相，其余是来源事实（供 tile 显示与「从哪来的」溯源）。 */
export type PlanReferenceBinding = {
  url: string
  /** 素材名（tile 的 caption / 缩略图加载失败时的兜底）。 */
  name?: string
  /** 引用某镜结果 / 某张参考卡时的来源节点（结果 hash 变了要能查回去）。参考卡本身也是画布节点。 */
  sourceNodeId?: string
  /** 这条绑定来自哪张锚（有则槽 caption 用锚名，浮层里能看到锚的描述）。 */
  anchorId?: string
  /**
   * **这一次引用**要模型忽略的特征（v6 §4.4，如"这镜别跟那件风衣"）。
   * 锚自己的「描述 / 要忽略的特征」住锚上（同一张锚被 5 镜引用只写一次）；这里只存**行内临时**的那份，
   * 不回写锚。参考图永远"多带了东西"——没有显式的忽略通道，用户唯一能做的是去 P 图或重拍一张更干净的参考，
   * 那是把工具的缺口转嫁成用户的活。
   */
  ignore?: string
}

export type PlanShot = {
  index: number
  /** Stable story-order identifier. Legacy plans may omit it; the converter derives `shot-${index}`. */
  shotId?: string
  /**
   * 所属场 id（分镜表 v5 场分组）。同场镜头在 shots[] 里应连续；缺省（旧 plan/无场故事）=
   * 单一隐式场（表不显组头，行为等同没有分场）。场的标题/顺序在 `StoryboardPlan.scenes`；
   * 引用了 scenes 里不存在的 id 时表层按出现顺序补隐式组头，不丢镜头。
   */
  sceneId?: string
  /**
   * 该镜种类：'image'=图片分镜（落 image 节点、无时长、绑图片模型）；'video'=视频分镜（落 video 节点、带时长）。
   * 缺省（旧草稿无此字段）按 'video' 兜底以保持既有行为；新计划由拆镜头开关/planner 显式标注
   * （用户拍板：拆镜头默认出图片分镜）。图片镜头满意后可经「转视频」升成视频镜头（S2）。
   */
  shotKind?: 'image' | 'video'
  /**
   * 该镜时长(秒)。视频镜头 = 生成时长——落画布写进视频节点 duration 参数，按所选模型控件钳值。
   * 图片镜头 = **停留时长**（分镜 v5：进时间轴/顺播时这张图停几秒）——默认 3 = `DEFAULT_IMAGE_SECONDS`
   * 单一真相源（buildClipFromGenerationNode.ts）；≤0（旧 planner 对图片镜吐 0）经
   * `effectiveShotDurationSec` 回落到默认，别在展示/合计处再写字面量 3。
   */
  durationSec: number
  /** 这镜用到哪些锚（按 anchor.id 引用）→ 视觉锚连参考边、文本锚拼 prompt。 */
  anchorIds: string[]
  /**
   * **按槽的参考绑定**（键 = `ArchetypeReferenceSlotKind`，值 = 有序素材列表）。
   * 分镜行的具名槽（首帧/尾帧/源视频）与数组槽（图/视频/音频参考）各自独立成桶——`anchorIds`
   * 是「引用了哪几张参考卡」的无类型关系，表达不了「这张放首帧、那段放参考视频」。
   * 落画布时经 `referenceSlotStorage` 映射进节点 meta，请求体仍由档案的 `inputKey`/`asArray`
   * 单源构造（`buildArchetypeInputParams`），**不为任何供应商写分支**。
   * 切模式**不删**绑定：未被当前 mode 声明的键原样保留（前向兼容 + 切回来还在）。
   */
  referenceBindings?: Record<string, PlanReferenceBinding[]>
  /** 可直接生成的提示词（运镜+动作演进，不复述锚的静态描述）。 */
  prompt: string
  /** 片种骨架在 prompt 中的轻量标注；失效/丢失时不影响纯文本。 */
  promptSegments?: PromptSegmentRange[]
  /** 用户在分镜编辑器为该镜选的视频模型 catalog key；没选 → 落画布用默认视频模型兜底。 */
  modelKey?: string
  /**
   * 该镜所选模型的**供应商** key。身份唯一键是 `(vendor, modelKey)`——同名模型来自不同供应商是两个模型；
   * 缺它时落画布只能按 key 反查、命中目录里第一家（2026-09-03 真实付费走查实测：选 APIMart 却发去 code-newcli-com）。
   */
  modelVendor?: string
  /** 用户为该镜选的模型模式 id（随 modelKey 一起）；没选 → 默认模式。 */
  modeId?: string
  /** 用户为该镜调的模型参数（archetype 控件键 → 值，如 aspect_ratio/resolution）；落画布铺进节点 meta。留空=用模型默认。 */
  params?: Record<string, unknown>
  /**
   * **静态首帧快照**描述（W2 §4.1，对齐 ViMax 的 ff_desc）：景别/角度/构图/光/人物位置，**不写运动**
   * （运动在 shot.prompt）。有它时首帧图按它生成——「先定住一帧、再让它动」比让模型边想边动稳。
   * 与 keyframe.prompt 的关系：keyframe.prompt 是用户在编辑器手改过的首帧提示词，**优先级更高**；
   * ffDesc 是 planner 产出的语义分解。两者都没有 → 退回 shot.prompt（今天的行为）。
   */
  ffDesc?: string
  /** Explicit motion description (kept separate from the rendered prompt for downstream QA/binding). */
  motionDesc?: string
  /**
   * 镜头内变化幅度（ViMax variation_type，W4）：**审片与生成策略的路由键**——
   * large=构图与焦点剧变（重点审转场/几何崩塌）；medium=有人进出场或转身面向镜头；
   * small=微变（表情/走坐站/中等运镜，重点审身份细节）。缺省不填 → 按 small 保守处理。
   */
  variationType?: 'large' | 'medium' | 'small'
  /**
   * 机位索引（ViMax cam_idx，W4）：同机位的镜头可复用同一组参考与构图 —— 低成本一致性抓手。
   * 同一 camIdx 的镜头在生成时应尽量共享参考图与构图描述。缺省=各自独立机位。
   */
  camIdx?: number
  /** Continuity instruction/evidence carried with the shot (kept opaque so playbooks can extend it). */
  continuity?: string | number | Record<string, unknown>
  /**
   * **静态尾帧快照**描述（ViMax lf_desc）：须与首帧 + 运动逻辑自洽。
   *
   * 已接：headless/MCP 路的两跳会据它多出一张尾帧图 → `last_frame_url`（**仅当该模型 body 真有尾帧槽**，
   * derive 自目录不 hardcode；没有槽或没给它就不多花那张图）。首尾都给，运动落点被两端夹住。
   * **未接**：相邻镜续接（上一镜尾帧当下一镜首帧的抽帧链）——那条要等批次闸的波次编排，见文件末尾遗留说明。
   */
  lfDesc?: string
  /**
   * 图片+视频模式：逻辑上仍是一条 video shot，但落画布时先建一张首帧 image 节点，再用 first_frame
   * 边喂给视频节点。这样 shots[] 仍按真实镜头数计数，不用把「首帧图」伪装成另一条镜头。
   */
  keyframe?: {
    enabled?: boolean
    prompt?: string
    modelKey?: string
    /** 首帧图模型的供应商 key（与 modelKey 成对，身份唯一键）。 */
    modelVendor?: string
    modeId?: string
    params?: Record<string, unknown>
  }
}

export type StoryboardPlan = {
  title: string
  anchors: PlanAnchor[]
  shots: PlanShot[]
  /**
   * 场清单（v5 场分组）：id 被 `PlanShot.sceneId` 引用，title 是组头显示名，数组序=场序。
   * 缺省 = 无分场（表按单一隐式场渲染，不显组头）。
   */
  scenes?: { id: string; title: string }[]
  /**
   * **整片默认画幅**（v6 §2.4.1，2026-09-05 用户拍板）。一部片子 95% 的镜头共享同一个画幅，
   * 所以它住在方案上、不住在每一行；行级只在"这一镜真的不一样"时写 `PlanShot.params.aspect_ratio`
   * 覆盖它。读写一律走 `storyboardAspectScope.ts`（单一 owner），缺省时那层从全镜共同值 derive，
   * 旧 plan 因此不需要迁移脚本。
   */
  aspectRatio?: string
  /** 片种模板 key（如 'genre.short-drama'）；缺省 = 自由格式。骨架段/画幅默认按它 derive（C 阶段接管）。 */
  profileKey?: string
  /** skill.json 声明的片种 profile 快照；缺省时按 profileKey/自由文本 derive。 */
  storyboardProfile?: StoryboardProfile
  /** The exact approved script this plan was derived from. */
  sourceScriptArtifactId?: string
  sourceScriptVersion?: number
  sourceScriptHash?: string
}

/**
 * Blank starter rows for a newly-created project. These rows carry no authored
 * story content; they only make the first storyboard editing surface reachable
 * before the user (or Agent) supplies the actual prompts.
 */
export function createEmptyStoryboardPlan(): StoryboardPlan {
  return {
    title: '',
    anchors: [],
    shots: [1, 2].map((index) => ({
      index,
      shotId: `shot-${index}`,
      shotKind: 'video' as const,
      durationSec: 5,
      anchorIds: [],
      prompt: '',
    })),
  }
}

export function isEmptyStoryboardPlan(plan: StoryboardPlan): boolean {
  return plan.title.trim() === ''
    && plan.anchors.length === 0
    && plan.shots.length === 2
    && plan.shots.every((shot, index) => (
      shot.index === index + 1
      && shot.prompt.trim() === ''
      && shot.anchorIds.length === 0
    ))
}

/**
 * 该镜计入合计/顺播/时间轴的**有效时长**（秒）——图片镜的停留语义唯一换算点。
 * 图片镜：durationSec>0 用它，否则回落 `DEFAULT_IMAGE_SECONDS`（旧 planner 对图片镜吐 0 的向后兼容）；
 * 视频镜：durationSec 原值。方案卡合计、场组头小结、行角标全走这里（P1 单一真相源）。
 */
export function effectiveShotDurationSec(shot: PlanShot): number {
  if (shot.shotKind === 'image') {
    return Number.isFinite(shot.durationSec) && shot.durationSec > 0 ? shot.durationSec : DEFAULT_IMAGE_SECONDS
  }
  return Number.isFinite(shot.durationSec) && shot.durationSec > 0 ? shot.durationSec : 0
}

// ── 落画布转换器：StoryboardPlan → create_canvas_nodes 参数（纯函数，可单测）──

/** create_canvas_nodes 节点参数（镜像 canvasTools.plannedNodeSchema 的渲染层用子集）。 */
export type PlanCreatedNode = {
  clientId: string
  kind: string
  title: string
  prompt: string
  modelKey?: string
  /** 供应商 key；与 modelKey 成对构成模型身份唯一键，避免落地时反查命中别家。 */
  modelVendor?: string
  modeId?: string
  params?: Record<string, unknown>
  /** Structured provenance/shot-language metadata. applyCanvasToolCall maps this to node.meta. */
  metadata?: Record<string, unknown>
  /** 参考卡身份（角色/场景/道具锚）：落画布写进 node.meta.referenceSheet → 永不占镜头编号（shotNumbering）。 */
  referenceSheet?: true
  /** 身份 DNA（W2 圣经 static 层）：落画布写进 node.meta.staticFeatures → 身份轴对照基准、冻结门可显示。 */
  staticFeatures?: string
  /** 服装/配饰/状态（W2 圣经 dynamic 层）：落画布写进 node.meta.dynamicFeatures → 允许跨镜变、不进身份匹配。 */
  dynamicFeatures?: string
  /**
   * 图片+视频分镜的首帧图身份：落画布写进 node.meta.storyboardKeyframe → 创建时不自动领号
   * （shotNumbering 跳过），随后由落地层把所属视频的镜号写回（与手动「转视频」桥共号同语义）。
   * 否则 18 镜落出 1..36 交错编号，角标与「镜头 N」标题对不上（A2 类编号错位）。
   */
  storyboardKeyframe?: true
}

export type PlanCreatedEdge = {
  sourceClientId: string
  targetClientId: string
  mode?: GenerationCanvasEdgeMode
  /** @ token 在提示词中的首次出现序，投影到画布边的唯一参考顺序。 */
  order?: number
}

export type PlanCreateNodesArgs = {
  summary: string
  nodes: PlanCreatedNode[]
  edges: PlanCreatedEdge[]
  /**
   * 前 anchorCount 个 node 是参考卡（角色/场景/道具，按构造序先 push），其余是镜头。
   * 落画布时交给 layoutStoryboardNodes 做「参考行在上 + 镜头折行网格」布局——道具锚 kind=image
   * 与镜头 image 无法靠 kind 区分，故由域层用计数显式给出角色边界。
   */
  anchorCount: number
  /**
   * 整批强制落进同一分类（用户拍板：一个分镜方案的角色/场景/镜头落在一起）。
   * 不设则按 kind 各归各类（cast/scene/shots）——agent 直接建卡仍走 kind 默认。
   * 设 'shots'：角色/场景与镜头同处「分镜」视图，参考边同屏可见可连、谁没生成一眼看到，
   * 且不破坏编号（character/scene kind 不参与 shotIndex，见 model/shotNumbering.ts）。
   */
  groupCategoryId?: BuiltinCanvasCategoryId
  /** Script provenance copied into the storyboard artifact and attach binding. */
  sourceScriptArtifactId?: string
  sourceScriptVersion?: number
  sourceScriptHash?: string
}

export type StoryboardPlanToArgsOptions = {
  /** 定妆卡/场景卡默认图片模型（偏好 GPT Image 2，通用解析）；调用方传入，不在此硬编码目录。 */
  defaultImageModelKey?: string
  /** 默认图片模型的供应商 key（与 key 成对，构成身份唯一键）。 */
  defaultImageModelVendor?: string
  /** 定妆卡（纯文生）默认模式 id；调用方传入。 */
  defaultImageModeId?: string
  /** （图片）图生图模式 id：保留给定妆卡变体等场景；调用方传入。 */
  defaultImageRefModeId?: string
  /** 镜头默认视频模型（用户没在编辑器为该镜选模型时兜底，通用解析偏好 Seedance）；调用方传入。 */
  defaultVideoModelKey?: string
  /** 默认视频模型的供应商 key（与 key 成对，构成身份唯一键）。 */
  defaultVideoModelVendor?: string
  /** 镜头默认视频模式 id（优先带 image_ref/first_frame 槽的 i2v，定妆卡参考才喂得进）；调用方传入。 */
  defaultVideoModeId?: string
  /** Stable id used to make a production materialization retry converge on existing nodes. */
  materializationOperationId?: string
  /** Creation resource provenance used to trace canvas nodes back to their source. */
  creationDocumentId?: string
  storyboardDesignId?: string
}

/** 锚类型 → 该锚连到镜头的参考边语义。 */
function edgeModeForAnchor(kind: PlanAnchorKind): GenerationCanvasEdgeMode {
  if (kind === 'character') return 'character_ref'
  if (kind === 'scene' || kind === 'style') return 'style_ref'
  return 'reference' // prop 走通用参考槽（无道具专用 mode）
}

/**
 * 锚类型 → 画布节点种类。角色/场景有专用卡；**道具无专用节点种类 → 用 image（通用参考图节点）**
 * ——直接用 'prop' 当 kind 会让画布 registry 查不到定义而崩（defaultSize undefined，R13 真机抓出）。
 * 道具落进哪个分类是 S4 的精修（补道具锚），这里先保证落得下、不崩。
 */
function anchorKindToNodeKind(kind: PlanAnchorKind): string {
  if (kind === 'character') return 'character'
  if (kind === 'scene') return 'scene'
  return 'image' // prop（style 是文本锚，不走到这）
}

/**
 * 该镜的稳定绑定 id（落画布写进 node.meta.shotId）——分镜表按它把行绑回画布节点
 * （B：行状态/结果/重跑全从「designId × shotId」的节点 derive），导出供绑定层用。
 */
export function stableShotId(shot: PlanShot): string {
  const candidate = typeof shot.shotId === 'string' ? shot.shotId.trim() : ''
  return /^[A-Za-z0-9._-]{1,160}$/.test(candidate) ? candidate : `shot-${shot.index}`
}

function shotClientId(shot: PlanShot): string {
  return stableShotId(shot)
}

function shotKeyframeClientId(shot: PlanShot): string {
  return `${stableShotId(shot)}-keyframe`
}

function storyboardShotMetadata(
  plan: StoryboardPlan,
  shot: PlanShot,
  materializationOperationId?: string,
  materializationClientId?: string,
  creationDocumentId?: string,
  storyboardDesignId?: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { shotId: stableShotId(shot) }
  if (creationDocumentId) metadata.creationDocumentId = creationDocumentId
  if (storyboardDesignId) metadata.storyboardDesignId = storyboardDesignId
  if (materializationOperationId && materializationClientId) {
    metadata.materializationOperationId = materializationOperationId
    metadata.materializationClientId = materializationClientId
  }
  if (typeof plan.sourceScriptArtifactId === 'string' && plan.sourceScriptArtifactId.trim()) {
    metadata.sourceScriptArtifactId = plan.sourceScriptArtifactId.trim()
  }
  if (typeof plan.sourceScriptVersion === 'number' && Number.isInteger(plan.sourceScriptVersion) && plan.sourceScriptVersion > 0) {
    metadata.sourceScriptVersion = plan.sourceScriptVersion
  }
  if (typeof plan.sourceScriptHash === 'string' && plan.sourceScriptHash.trim()) {
    metadata.sourceScriptHash = plan.sourceScriptHash.trim()
  }
  if (typeof shot.ffDesc === 'string' && shot.ffDesc.trim()) metadata.ffDesc = shot.ffDesc.trim()
  if (typeof shot.motionDesc === 'string' && shot.motionDesc.trim()) metadata.motionDesc = shot.motionDesc.trim()
  if (typeof shot.lfDesc === 'string' && shot.lfDesc.trim()) metadata.lfDesc = shot.lfDesc.trim()
  if (shot.variationType) metadata.variationType = shot.variationType
  if (typeof shot.camIdx === 'number' && Number.isInteger(shot.camIdx) && shot.camIdx >= 0) metadata.camIdx = shot.camIdx
  if (shot.continuity !== undefined) metadata.continuity = shot.continuity
  return metadata
}

/** 视觉锚 → 定妆卡/场景卡节点（clientId = anchor.id）。整方案落画布与单锚按需 materialize（B）共用。 */
/** 锚自己选了模型就用它自己的 vendor；没选才回落默认图片模型的 vendor。 */
function anchorVendor(anchor: PlanAnchor, options: StoryboardPlanToArgsOptions): string | undefined {
  return anchor.modelKey ? anchor.modelVendor : (anchor.modelVendor || options.defaultImageModelVendor)
}

function buildAnchorCardNode(anchor: PlanAnchor, options: StoryboardPlanToArgsOptions): PlanCreatedNode {
  return {
    clientId: anchor.id,
    kind: anchorKindToNodeKind(anchor.kind),
    title: anchor.name,
    prompt: buildAnchorSheetPrompt(anchor),
    // 参考卡永不占镜号（道具锚 kind=image 落 shots 分类，不标记会吃掉「镜头 1/2」，R13 抓出）。
    referenceSheet: true,
    // W2 圣经：static/dynamic 落画布写进 node.meta（passthrough 自动持久化）→ 身份轴基准 + 冻结门可显示。
    // description 仍拼进 prompt（buildAnchorSheetPrompt），二者并存不矛盾（static/dynamic 是 description 的结构化细化）。
    ...(anchor.staticFeatures && anchor.staticFeatures.trim() ? { staticFeatures: anchor.staticFeatures.trim() } : {}),
    ...(anchor.dynamicFeatures && anchor.dynamicFeatures.trim() ? { dynamicFeatures: anchor.dynamicFeatures.trim() } : {}),
    metadata: {
      // 锚绑定 id（B）：分镜表按「designId × anchorId」把参考卡绑回画布节点（重生成/锁定/反查都靠它）。
      anchorId: anchor.id,
      ...(options.materializationOperationId ? {
        materializationOperationId: options.materializationOperationId,
        materializationClientId: anchor.id,
      } : {}),
      ...(options.creationDocumentId ? { creationDocumentId: options.creationDocumentId } : {}),
      ...(options.storyboardDesignId ? { storyboardDesignId: options.storyboardDesignId } : {}),
    },
    ...((anchor.modelKey || options.defaultImageModelKey) ? { modelKey: anchor.modelKey || options.defaultImageModelKey } : {}),
    // vendor 与 key 成对流动，绝不混搭（混搭正是「选 A 家发去 B 家」的成因；同 buildShotRowNodes）。
    ...(anchorVendor(anchor, options) ? { modelVendor: anchorVendor(anchor, options) } : {}),
    ...((anchor.modeId || (!anchor.modelKey && options.defaultImageModeId)) ? { modeId: anchor.modeId || options.defaultImageModeId } : {}),
    ...(anchor.params ? { params: anchor.params } : {}),
  }
}

/** 单镜建行选项（B 单行 materialize）：已建过的依赖节点传真实 id 复用，不重建。 */
export type StoryboardShotRowArgsOptions = StoryboardPlanToArgsOptions & {
  /** 已建过的锚节点：anchor.id → 画布真实节点 id（normalizePlannedEdges 认真实 id，直接当 sourceClientId）。 */
  existingAnchorNodeIdByAnchorId?: Record<string, string>
  /** 已建过的首帧图节点（图片+视频镜）：真实节点 id，复用不重建。 */
  existingKeyframeNodeId?: string
  /**
   * 该行解析后的模式**不吃任何参考**（mode.slots 为空，如 t2v/t2i）时置 true：不连锚边。
   * 连了也会在投影层被静默丢（正是「静默丢参考裸跑」一族），且会让批量波次替一条吃不进的边
   * 空等定妆——诚实跳过。文本锚照旧拼 prompt，不受影响。
   */
  omitAnchorReferenceEdges?: boolean
}

/**
 * 一镜 → 节点+边（不含锚卡节点本身）。整方案转换与单行 materialize（B）共用的唯一构造器：
 * - 图片镜头 → image 节点（无 duration、绑图片模型）；视频镜头 → video 节点（带 duration、绑视频模型）。
 *   缺省 shotKind 按 video 兜底（旧草稿兼容）；引用的视觉锚 → 参考边（图片/视频镜头都连，锁身份）。
 * - 图片+视频模式派生首帧图节点，再用 first_frame 边喂视频。
 * - 模型：用户为该镜选的 modelKey/modeId 优先，没选 → 按种类取默认兜底。
 * - **不连 shot→shot 链**：视频→视频会落到尚未实现的「首帧接力抽帧」必裸跑；镜头连贯靠共享锚参考。
 */
function buildShotRowNodes(
  plan: StoryboardPlan,
  anchorById: Map<string, PlanAnchor>,
  shot: PlanShot,
  options: StoryboardShotRowArgsOptions,
): { nodes: PlanCreatedNode[]; edges: PlanCreatedEdge[] } {
  const nodes: PlanCreatedNode[] = []
  const edges: PlanCreatedEdge[] = []
  const id = shotClientId(shot)
  // 镜头种类分支（用户拍板：拆镜头默认图片分镜）。缺省无 shotKind → 按 video 兜底（旧草稿兼容）。
  const isImageShot = shot.shotKind === 'image'
  const hasKeyframe = !isImageShot && shot.keyframe?.enabled === true
  const keyframeTargetId = hasKeyframe ? (options.existingKeyframeNodeId || shotKeyframeClientId(shot)) : id
  // 该镜引用的视觉锚（定妆卡）——连 character_ref/style_ref/reference 参考边。
  // 视频镜头：图→视频 i2v 参考；图片镜头：图→图 参考（同样锁角色/场景身份，图片模型的参考槽）。
  const visualAnchorIds = shot.anchorIds.filter((anchorId) => {
    const anchor = anchorById.get(anchorId)
    return Boolean(anchor) && isVisualAnchor(anchor!)
  })
  const referenceOrder = referenceOrderForShot(shot, anchorById)
  const externalReferences = visualAnchorIds
    .map((anchorId) => anchorById.get(anchorId))
    .filter((anchor): anchor is PlanAnchor => Boolean(anchor && anchor.referenceUrl && !anchor.referenceSourceNodeId))
    .sort((a, b) => (referenceOrder.get(a.id) ?? 0) - (referenceOrder.get(b.id) ?? 0))
  const externalImageUrls = externalReferences.filter((anchor) => (anchor.referenceKind ?? 'image') === 'image').map((anchor) => anchor.referenceUrl!)
  const externalVideoUrls = externalReferences.filter((anchor) => anchor.referenceKind === 'video').map((anchor) => anchor.referenceUrl!)
  const externalAudioUrls = externalReferences.filter((anchor) => anchor.referenceKind === 'audio').map((anchor) => anchor.referenceUrl!)
  // 图片镜头绑图片模型默认、视频镜头绑视频模型默认；用户在编辑器为该镜选的 modelKey 永远优先。
  const defaultModelKey = isImageShot ? options.defaultImageModelKey : options.defaultVideoModelKey
  const defaultModeId = isImageShot ? options.defaultImageModeId : options.defaultVideoModeId
  const modelKey = shot.modelKey || defaultModelKey
  // vendor 与 modelKey 成对流动：用户选了具体模型就用它自己的 vendor；用默认模型时用默认的 vendor。
  // 二者不许混搭——混搭正是「选 A 家发去 B 家」的成因。
  const modelVendor = shot.modelKey ? shot.modelVendor : (shot.modelVendor || options.defaultVideoModelVendor)
  const imageDefaultVendor = options.defaultImageModelVendor
  // 用户为该镜选了具体模型 → 不套默认模型的 modeId（会张冠李戴）；留空让 buildPlannedNodeMeta
  // 按所选模型自己取默认模式。只有用默认模型时才用默认 modeId。
  const modeId = shot.modeId || (shot.modelKey ? undefined : defaultModeId)
  if (hasKeyframe && !options.existingKeyframeNodeId) {
    const keyframeModelKey = shot.keyframe?.modelKey || options.defaultImageModelKey
    const keyframeVendor = shot.keyframe?.modelKey ? shot.keyframe.modelVendor : imageDefaultVendor
    const keyframeModeId = shot.keyframe?.modeId || (shot.keyframe?.modelKey ? undefined : (visualAnchorIds.length > 0 ? options.defaultImageRefModeId || options.defaultImageModeId : options.defaultImageModeId))
    nodes.push({
      clientId: keyframeTargetId,
      kind: 'image',
      title: i18n.t('generationCommon.agentRuntime.shotKeyframeTitle', { index: shot.index }),
      prompt: buildKeyframePrompt(shot, anchorById),
      storyboardKeyframe: true,
      ...(keyframeModelKey ? { modelKey: keyframeModelKey } : {}),
      ...(keyframeVendor ? { modelVendor: keyframeVendor } : {}),
      ...(keyframeModeId ? { modeId: keyframeModeId } : {}),
      ...(shot.keyframe?.params ? { params: shot.keyframe.params } : {}),
      metadata: storyboardShotMetadata(
        plan,
        shot,
        options.materializationOperationId,
        keyframeTargetId,
        options.creationDocumentId,
        options.storyboardDesignId,
      ),
    })
  }
  nodes.push({
    clientId: id,
    // 图片镜头 → image 节点（纯图生图静态画面，无 duration）；视频镜头 → video 节点（带 duration）。
    kind: isImageShot ? 'image' : 'video',
    title: i18n.t('generationCommon.agentRuntime.shotTitle', { index: shot.index }),
    prompt: buildShotPrompt(shot, anchorById),
    ...(modelKey ? { modelKey } : {}),
    ...(modelVendor ? { modelVendor } : {}),
    ...(modeId ? { modeId } : {}),
    // duration 仅视频镜头写（由卡的「时长」选择器管）；图片镜头不写。其余模型参数（比例/清晰度/负向…）来自 shot.params。
    params: {
      ...(shot.params || {}),
      ...(!isImageShot && Number.isFinite(shot.durationSec) ? { duration: shot.durationSec } : {}),
    },
    metadata: {
      ...storyboardShotMetadata(
        plan,
        shot,
        options.materializationOperationId,
        id,
        options.creationDocumentId,
        options.storyboardDesignId,
      ),
      // 图片镜停留时长（v5）：写进节点 meta，buildClipFromGenerationNode/顺播读取（默认值同源 DEFAULT_IMAGE_SECONDS）。
      ...(isImageShot ? { imageDurationSec: effectiveShotDurationSec(shot) } : {}),
      ...(externalImageUrls.length ? { referenceImageUrls: externalImageUrls } : {}),
      ...(externalVideoUrls.length ? { referenceVideoUrls: externalVideoUrls } : {}),
      ...(externalAudioUrls.length ? { referenceAudioUrls: externalAudioUrls } : {}),
    },
  })
  // 定妆卡 → 这一镜参考边（角色 character_ref / 场景·风格 style_ref / 道具 reference）。图片/视频镜头都连；
  // 已建过的锚用真实节点 id 连（复用）；该行模式吃不进参考时按 omitAnchorReferenceEdges 跳过。
  if (!options.omitAnchorReferenceEdges) {
    const referenceTargetId = hasKeyframe ? keyframeTargetId : id
    for (const anchorId of visualAnchorIds) {
      const anchor = anchorById.get(anchorId)!
      const sourceId = options.existingAnchorNodeIdByAnchorId?.[anchorId] || anchorId
      if (anchor.referenceUrl && !anchor.referenceSourceNodeId) continue
      edges.push({ sourceClientId: anchor.referenceSourceNodeId || sourceId, targetClientId: referenceTargetId, mode: edgeModeForAnchor(anchor.kind), order: referenceOrder.get(anchorId) })
    }
  }
  if (hasKeyframe) {
    edges.push({ sourceClientId: keyframeTargetId, targetClientId: id, mode: 'first_frame' })
  }
  return { nodes, edges }
}

/** 该镜落到节点上的最终提示词（文本锚拼接后）——行编辑写回节点（B sync）与建节点同一渲染。 */
export function renderShotNodePrompt(plan: StoryboardPlan, shot: PlanShot): string {
  return buildShotPrompt(shot, new Map(plan.anchors.map((anchor) => [anchor.id, anchor])))
}

/** 该镜首帧图节点的最终提示词（keyframe.prompt > ffDesc > shot.prompt，文本锚拼接后）。 */
export function renderShotKeyframePrompt(plan: StoryboardPlan, shot: PlanShot): string {
  return buildKeyframePrompt(shot, new Map(plan.anchors.map((anchor) => [anchor.id, anchor])))
}

/**
 * 确认后：把方案转成 create_canvas_nodes 参数，照常走 applyCanvasToolCall 落画布
 * （复用现有建节点+连边+依赖波次「参考层先生成」，零重写）。
 * - 视觉锚（character/scene/prop）→ 卡片节点；文本锚（style 等）不建节点、描述拼进镜头 prompt。
 * - 每镜经 buildShotRowNodes（与单行 materialize 同一构造器，P1 无并行版）。
 * 现役调用方：MCP production.materialize-storyboard（整方案落画布）与引导 tour；
 * 分镜表的行内/批量生成走 storyboardShotToCreateNodesArgs 按需建行。
 */
export function storyboardPlanToCreateNodesArgs(
  plan: StoryboardPlan,
  options: StoryboardPlanToArgsOptions = {},
): PlanCreateNodesArgs {
  const anchorById = new Map(plan.anchors.map((anchor) => [anchor.id, anchor]))
  const nodes: PlanCreatedNode[] = []
  const edges: PlanCreatedEdge[] = []

  // 视觉锚 → 定妆卡/场景卡节点。prompt 用「卡片大图」构造器：多视图+多变体集中一张图、整张喂参考（用户拍板）。
  for (const anchor of plan.anchors) {
    if (!isVisualAnchor(anchor) || anchor.referenceUrl || anchor.referenceSourceNodeId) continue
    nodes.push(buildAnchorCardNode(anchor, options))
  }

  // 锚已全部 push 完，此刻节点数 = 参考卡数（镜头随后 push）→ 落画布布局的角色边界。
  const anchorCount = nodes.length

  // 镜头 → image/video 节点 + 定妆卡参考边。按 shot.index 排序后再建节点（审计 A5 防御）：
  // 布局按数组顺序排格子，若 LLM 把镜头乱序吐出来，画布空间顺序就会与镜头编号错位。钉死「数组序=镜序」。
  const orderedShots = [...plan.shots].sort((a, b) => a.index - b.index)
  for (const shot of orderedShots) {
    const row = buildShotRowNodes(plan, anchorById, shot, options)
    nodes.push(...row.nodes)
    edges.push(...row.edges)
  }

  // 整批落「分镜」分类：角色/场景与镜头同处一个视图，参考边同屏可见可连（用户拍板 A）。
  const candidateSourceScriptVersion = plan.sourceScriptVersion
  const sourceScriptVersion = typeof candidateSourceScriptVersion === 'number'
    && Number.isInteger(candidateSourceScriptVersion)
    && candidateSourceScriptVersion > 0
    ? candidateSourceScriptVersion
    : undefined
  return {
    summary: plan.title.trim() || '分镜方案',
    nodes,
    edges,
    anchorCount,
    groupCategoryId: 'shots',
    ...(plan.sourceScriptArtifactId?.trim() ? { sourceScriptArtifactId: plan.sourceScriptArtifactId.trim() } : {}),
    ...(sourceScriptVersion !== undefined ? { sourceScriptVersion } : {}),
    ...(plan.sourceScriptHash?.trim() ? { sourceScriptHash: plan.sourceScriptHash.trim() } : {}),
  }
}

/**
 * 单行 materialize（分镜表 v5 B）：把**一镜**转成 create_canvas_nodes 参数——该行引用的视觉锚
 * 里还没建节点的一并按需建立（已建过的经 existingAnchorNodeIdByAnchorId 用真实 id 连边复用），
 * 图片+视频镜按需建首帧图节点。与整方案转换共用同一构造器（buildAnchorCardNode/buildShotRowNodes）。
 */
export function storyboardShotToCreateNodesArgs(
  plan: StoryboardPlan,
  shot: PlanShot,
  options: StoryboardShotRowArgsOptions = {},
): PlanCreateNodesArgs {
  const anchorById = new Map(plan.anchors.map((anchor) => [anchor.id, anchor]))
  const existing = options.existingAnchorNodeIdByAnchorId ?? {}
  const nodes: PlanCreatedNode[] = []
  // 该行引用、且还没建过节点的视觉锚 → 一并建卡（吃不进参考的行不建：锚卡只为连边而生）。
  if (!options.omitAnchorReferenceEdges) {
    for (const anchorId of shot.anchorIds) {
      const anchor = anchorById.get(anchorId)
      if (!anchor || !isVisualAnchor(anchor) || anchor.referenceUrl || anchor.referenceSourceNodeId) continue
      if (existing[anchorId]) continue
      nodes.push(buildAnchorCardNode(anchor, options))
    }
  }
  const anchorCount = nodes.length
  const row = buildShotRowNodes(plan, anchorById, shot, options)
  nodes.push(...row.nodes)
  return {
    summary: `${plan.title.trim() || '分镜方案'} · shot-${shot.index}`,
    nodes,
    edges: row.edges,
    anchorCount,
    groupCategoryId: 'shots',
  }
}

/**
 * 单锚 materialize（B3 参考卡就地生成）：把一张视觉锚转成 create_canvas_nodes 参数。
 * 文本锚（仅提示词）不建节点 → null（调用方按钮态就不该出现，这里兜底防误调）。
 */
export function storyboardAnchorToCreateNodesArgs(
  plan: StoryboardPlan,
  anchor: PlanAnchor,
  options: StoryboardPlanToArgsOptions = {},
): PlanCreateNodesArgs | null {
  if (!isVisualAnchor(anchor)) return null
  return {
    summary: `${plan.title.trim() || '分镜方案'} · ${anchor.name || anchor.id}`,
    nodes: [buildAnchorCardNode(anchor, options)],
    edges: [],
    anchorCount: 1,
    groupCategoryId: 'shots',
  }
}
