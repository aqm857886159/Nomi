import type { BuiltinCanvasCategoryId, GenerationCanvasEdgeMode } from '../model/generationCanvasTypes'
import { DEFAULT_IMAGE_SECONDS } from '../model/buildClipFromGenerationNode'
import i18n from '../../../i18n'
import {
  anchorCarriesOwnMaterial,
  buildAnchorSheetPrompt,
  compileShotOutbound,
  isVisualAnchor,
} from './storyboardPromptCompiler'
import { resolveKeyframeParams, resolveShotParams } from './storyboardShotScope'

import type { PlanAnchorKind, PlanAnchor, PlanShot, StoryboardPlan } from '../../../../electron/shared/storyboard/storyboardPlan'
import { stableShotId } from '../../../../electron/shared/storyboard/storyboardSubjectIdentity'
export type { PlanAnchorKind, PlanAnchorCarrier, StoryboardPromptSkeletonSegment, StoryboardProfile, PromptSegmentRange, PlanAnchor, PlanReferenceBinding, PlanShot, StoryboardPlan } from '../../../../electron/shared/storyboard/storyboardPlan'

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
 * （B：行状态/结果/重跑全从「designId × shotId」的节点 derive）。定义住分镜主体身份的唯一 owner。
 */
export { stableShotId }

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
  // 没选模型 = 用默认模型 → 只能用默认模型那一家。锚上残留的 modelVendor 是给**别的**模型记的，
  // 拿它配默认模型就是「A 模型 × B 家」的混搭（2026-09-21 同类扫描）。
  return anchor.modelKey ? anchor.modelVendor : options.defaultImageModelVendor
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
  /** 已建过的首帧图节点（图片+视频镜）：真实节点 id，复用不重建。 */
  existingKeyframeNodeId?: string
}

/**
 * 一镜 → 节点+边（不含锚卡节点本身）。整方案转换与单行 materialize（B）共用的唯一构造器：
 * - 图片镜头 → image 节点（无 duration、绑图片模型）；视频镜头 → video 节点（带 duration、绑视频模型）。
 *   缺省 shotKind 按 video 兜底（旧草稿兼容）；参考图只来自行上的 referenceBindings（由 projectShotNode 投影进 meta），这里不连任何锚边。
 * - 图片+视频模式派生首帧图节点，再用 first_frame 边喂视频。
 * - 模型：用户为该镜选的 modelKey/modeId 优先，没选 → 按种类取默认兜底。
 * - **不连 shot→shot 链**：视频→视频会落到尚未实现的「首帧接力抽帧」必裸跑；镜头连贯靠共享锚参考。
 */
function buildShotRowNodes(
  plan: StoryboardPlan,
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
  // 图片镜头绑图片模型默认、视频镜头绑视频模型默认；用户在编辑器为该镜选的 modelKey 永远优先。
  const defaultModelKey = isImageShot ? options.defaultImageModelKey : options.defaultVideoModelKey
  const defaultModeId = isImageShot ? options.defaultImageModeId : options.defaultVideoModeId
  const modelKey = shot.modelKey || defaultModelKey
  // vendor 与 modelKey 成对流动：用户选了具体模型就用它自己的 vendor；用默认模型时用默认的 vendor。
  // 二者不许混搭——混搭正是「选 A 家发去 B 家」的成因。
  // 默认模型那一半也按镜种取：图片镜配图片默认的家、视频镜配视频默认的家。这里曾经对所有镜种都用
  // defaultVideoModelVendor，并且优先用镜头上残留的 modelVendor——两种都是「A 模型 × B 家」（2026-09-21 同类扫描）。
  const defaultModelVendor = isImageShot ? options.defaultImageModelVendor : options.defaultVideoModelVendor
  const modelVendor = shot.modelKey ? shot.modelVendor : defaultModelVendor
  const imageDefaultVendor = options.defaultImageModelVendor
  // 用户为该镜选了具体模型 → 不套默认模型的 modeId（会张冠李戴）；留空让 buildPlannedNodeMeta
  // 按所选模型自己取默认模式。只有用默认模型时才用默认 modeId。
  const modeId = shot.modeId || (shot.modelKey ? undefined : defaultModeId)
  if (hasKeyframe && !options.existingKeyframeNodeId) {
    const keyframeModelKey = shot.keyframe?.modelKey || options.defaultImageModelKey
    const keyframeVendor = shot.keyframe?.modelKey ? shot.keyframe.modelVendor : imageDefaultVendor
    const keyframeModeId = shot.keyframe?.modeId || (shot.keyframe?.modelKey ? undefined : options.defaultImageModeId)
    nodes.push({
      clientId: keyframeTargetId,
      kind: 'image',
      title: i18n.t('generationCommon.agentRuntime.shotKeyframeTitle', { index: shot.index }),
      prompt: compileShotOutbound(shot, 'keyframe').prompt,
      storyboardKeyframe: true,
      ...(keyframeModelKey ? { modelKey: keyframeModelKey } : {}),
      ...(keyframeVendor ? { modelVendor: keyframeVendor } : {}),
      ...(keyframeModeId ? { modeId: keyframeModeId } : {}),
      // 整片默认（画幅…）经唯一 resolver 合进首帧图——首帧与它喂的视频必须同画幅。
      params: resolveKeyframeParams(plan, shot),
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
    prompt: compileShotOutbound(shot, 'shot').prompt,
    ...(modelKey ? { modelKey } : {}),
    ...(modelVendor ? { modelVendor } : {}),
    ...(modeId ? { modeId } : {}),
    // duration 仅视频镜头写（由卡的「时长」选择器管）；图片镜头不写。
    // 其余模型参数（比例/清晰度/负向…）一律经 resolveShotParams —— 它是「行覆盖 ?? 整片默认 ?? 缺席」
    // 的唯一判定口。**不要**在这里直接铺 `shot.params`：那正是整片默认到不了画布的成因
    // （2026-09-12 根因合同 storyboard-plan-defaults-passthrough）。
    params: {
      ...resolveShotParams(plan, shot),
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
    },
  })
  if (hasKeyframe) {
    edges.push({ sourceClientId: keyframeTargetId, targetClientId: id, mode: 'first_frame' })
  }
  return { nodes, edges }
}

/** 该镜落到节点上的最终提示词（文本锚拼接后）——行编辑写回节点（B sync）与建节点同一渲染。 */
export function renderShotNodePrompt(plan: StoryboardPlan, shot: PlanShot): string {
  return compileShotOutbound(shot, 'shot').prompt
}

/** 该镜首帧图节点的最终提示词（keyframe.prompt > ffDesc > shot.prompt，文本锚拼接后）。 */
export function renderShotKeyframePrompt(plan: StoryboardPlan, shot: PlanShot): string {
  return compileShotOutbound(shot, 'keyframe').prompt
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
  const nodes: PlanCreatedNode[] = []
  const edges: PlanCreatedEdge[] = []

  // 视觉锚 → 定妆卡/场景卡节点。prompt 用「卡片大图」构造器：多视图+多变体集中一张图、整张喂参考（用户拍板）。
  for (const anchor of plan.anchors) {
    if (!isVisualAnchor(anchor) || anchorCarriesOwnMaterial(anchor)) continue
    nodes.push(buildAnchorCardNode(anchor, options))
  }

  // 锚已全部 push 完，此刻节点数 = 参考卡数（镜头随后 push）→ 落画布布局的角色边界。
  const anchorCount = nodes.length

  // 镜头 → image/video 节点 + 定妆卡参考边。按 shot.index 排序后再建节点（审计 A5 防御）：
  // 布局按数组顺序排格子，若 LLM 把镜头乱序吐出来，画布空间顺序就会与镜头编号错位。钉死「数组序=镜序」。
  const orderedShots = [...plan.shots].sort((a, b) => a.index - b.index)
  for (const shot of orderedShots) {
    const row = buildShotRowNodes(plan, shot, options)
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
 * 单行 materialize（分镜表 v5 B）：把**一镜**转成 create_canvas_nodes 参数——只建这一镜自己（图片+视频镜
 * 按需带首帧图节点）。**不再顺手建它引用的定妆卡**：定妆卡不再喂给任何镜，没有理由因为生成一镜而多出一张卡。
 * 与整方案转换共用同一构造器（buildShotRowNodes）。
 */
export function storyboardShotToCreateNodesArgs(
  plan: StoryboardPlan,
  shot: PlanShot,
  options: StoryboardShotRowArgsOptions = {},
): PlanCreateNodesArgs {
  const row = buildShotRowNodes(plan, shot, options)
  return {
    summary: `${plan.title.trim() || '分镜方案'} · shot-${shot.index}`,
    nodes: row.nodes,
    edges: row.edges,
    anchorCount: 0,
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
