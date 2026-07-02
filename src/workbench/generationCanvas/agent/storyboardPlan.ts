import { z } from 'zod'
import type { BuiltinCanvasCategoryId, GenerationCanvasEdgeMode } from '../model/generationCanvasTypes'

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

export type PlanAnchor = {
  /** 稳定 id；落画布时直接当 create_canvas_nodes 的 clientId。 */
  id: string
  kind: PlanAnchorKind
  /** 「林夏」「天台」「红书包」「全片风格」——镜头按名引用、也是卡片标题。 */
  name: string
  /** 标准描述：视觉锚 → 卡片/定妆 prompt；文本锚 → 拼进引用镜头的 prompt。 */
  description: string
  carrier: PlanAnchorCarrier
  /** all=每镜常驻（风格/品牌）；selective=被点名才用（角色/场景/道具）。缺省按 kind 推。 */
  scope?: 'all' | 'selective'
  /**
   * 同一锚要在「一张定妆卡/场景卡」里并列呈现的变体/状态（用户拍板：AI 猜 + 手改）。
   * 角色：如「成年」「童年」「战损」；场景：如「白天远景」「夜晚近景」。
   * 落画布时拼进卡片提示词的「变体行」，让多视图+多变体集中在一张图里、整张喂参考。
   */
  variants?: string[]
}

export type PlanShot = {
  index: number
  /**
   * 该镜种类：'image'=图片分镜（落 image 节点、无时长、绑图片模型）；'video'=视频分镜（落 video 节点、带时长）。
   * 缺省（旧草稿无此字段）按 'video' 兜底以保持既有行为；新计划由拆镜头开关/planner 显式标注
   * （用户拍板：拆镜头默认出图片分镜）。图片镜头满意后可经「转视频」升成视频镜头（S2）。
   */
  shotKind?: 'image' | 'video'
  /** 该镜时长(秒)；仅视频镜头用——落画布写进视频节点 duration 参数，按所选模型控件钳值。图片镜头忽略。 */
  durationSec: number
  /** 这镜用到哪些锚（按 anchor.id 引用）→ 视觉锚连参考边、文本锚拼 prompt。 */
  anchorIds: string[]
  /** 可直接生成的提示词（运镜+动作演进，不复述锚的静态描述）。 */
  prompt: string
  /** 用户在分镜编辑器为该镜选的视频模型 catalog key；没选 → 落画布用默认视频模型兜底。 */
  modelKey?: string
  /** 用户为该镜选的模型模式 id（随 modelKey 一起）；没选 → 默认模式。 */
  modeId?: string
  /** 用户为该镜调的模型参数（archetype 控件键 → 值，如 aspect_ratio/resolution）；落画布铺进节点 meta。留空=用模型默认。 */
  params?: Record<string, unknown>
}

export type StoryboardPlan = {
  title: string
  anchors: PlanAnchor[]
  shots: PlanShot[]
}

// ── 校验 schema：planner 产出/落库前的运行时守卫（也是 S3 激活时交给 LLM 的工具参数 schema）──
//
// 与上方手写类型同形：手写类型带字段级 JSDoc（语义文档，z.infer 会丢），故两者并存；
// 下方编译期守卫保证二者互相赋值兼容，防 schema 与类型漂移（P1 单一真相源的轻量落地）。

export const planAnchorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['character', 'scene', 'prop', 'style']),
  name: z.string().min(1),
  description: z.string(),
  carrier: z.enum(['visual', 'text']),
  scope: z.enum(['all', 'selective']).optional(),
  variants: z
    .array(z.string())
    .optional()
    .describe(
      '同一锚需要并列在一张定妆卡/场景卡里的变体/状态。仅当剧情里该角色/场景有明显形态差异时填，' +
        '如角色「成年」「童年」，场景「白天远景」「夜晚近景」；没有就省略。',
    ),
})

export const planShotSchema = z.object({
  index: z.number().int(),
  shotKind: z
    .enum(['image', 'video'])
    .optional()
    .describe("镜头种类:'image'=图片分镜(图生图静态画面,无时长),'video'=视频分镜(带时长运镜)。默认 image。"),
  durationSec: z.number(),
  anchorIds: z.array(z.string()),
  prompt: z.string(),
  modelKey: z.string().optional(),
  modeId: z.string().optional(),
  params: z.record(z.unknown()).optional(),
})

export const storyboardPlanSchema = z.object({
  title: z.string(),
  anchors: z.array(planAnchorSchema),
  shots: z.array(planShotSchema),
})

// 编译期漂移守卫：仅当 zod 推断类型 ⟺ 手写类型互相可赋值时才编译通过（零运行时）。
const _planSchemaToType = (p: z.infer<typeof storyboardPlanSchema>): StoryboardPlan => p
const _planTypeToSchema = (p: StoryboardPlan): z.infer<typeof storyboardPlanSchema> => p
void _planSchemaToType
void _planTypeToSchema

/**
 * 落库前校验方案对象。planner 产出经 backend zod 已过一道，渲染层再守一道——
 * 防直接调用 / 未来别的入口绕过 backend 时灌入畸形对象（throw，调用方映射成 tool error）。
 */
export function parseStoryboardPlan(raw: unknown): StoryboardPlan {
  return storyboardPlanSchema.parse(raw)
}

// ── 落画布转换器：StoryboardPlan → create_canvas_nodes 参数（纯函数，可单测）──

/** create_canvas_nodes 节点参数（镜像 canvasTools.plannedNodeSchema 的渲染层用子集）。 */
export type PlanCreatedNode = {
  clientId: string
  kind: string
  title: string
  prompt: string
  modelKey?: string
  modeId?: string
  params?: Record<string, string | number | boolean>
  /** 参考卡身份（角色/场景/道具锚）：落画布写进 node.meta.referenceSheet → 永不占镜头编号（shotNumbering）。 */
  referenceSheet?: true
}

export type PlanCreatedEdge = {
  sourceClientId: string
  targetClientId: string
  mode?: GenerationCanvasEdgeMode
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
}

export type StoryboardPlanToArgsOptions = {
  /** 定妆卡/场景卡默认图片模型（偏好 GPT Image 2，通用解析）；调用方传入，不在此硬编码目录。 */
  defaultImageModelKey?: string
  /** 定妆卡（纯文生）默认模式 id；调用方传入。 */
  defaultImageModeId?: string
  /** （图片）图生图模式 id：保留给定妆卡变体等场景；调用方传入。 */
  defaultImageRefModeId?: string
  /** 镜头默认视频模型（用户没在编辑器为该镜选模型时兜底，通用解析偏好 Seedance）；调用方传入。 */
  defaultVideoModelKey?: string
  /** 镜头默认视频模式 id（优先带 image_ref/first_frame 槽的 i2v，定妆卡参考才喂得进）；调用方传入。 */
  defaultVideoModeId?: string
}

const VISUAL_KINDS: ReadonlySet<PlanAnchorKind> = new Set(['character', 'scene', 'prop'])

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

function shotClientId(shot: PlanShot): string {
  return `shot-${shot.index}`
}

/**
 * 定妆卡/场景卡提示词构造（R6 调研落地：把图当「版面/网格」描述，先锁身份再列视图，
 * 中性背景+平光+小标签，多视图+多变体集中一张图，整张喂参考视频）。GPT Image 2 尤擅此类多面板版面。
 * 视觉锚（character/scene/prop）→ 卡片大图；变体（成年/童年、白天/夜晚…）拼进「变体行」。
 */
export function buildAnchorSheetPrompt(anchor: PlanAnchor): string {
  const name = anchor.name.trim()
  const desc = anchor.description.trim()
  const variantLine =
    anchor.variants && anchor.variants.length
      ? `\n变体行：${anchor.variants.map((v) => v.trim()).filter(Boolean).join('、')}（每个变体各占一格并在格下标注）。`
      : ''
  if (anchor.kind === 'scene') {
    return [
      '场景参考卡（environment reference sheet）。横向版面、分格清晰、每格下方小标签，统一色调与光源。',
      `同一地点「${name}」：${desc}`,
      '角度：①远景 establishing ②近景细节 ③俯视 overhead ④四分之三视。' + variantLine,
      '要求：跨格保持同一地点与风格一致；避免人物入镜、避免风格漂移、避免格子合并。',
    ].join('\n')
  }
  if (anchor.kind === 'prop') {
    return [
      '道具参考卡。白色中性背景、平光、分格清晰、每格下方小标签。',
      `同一物件「${name}」：${desc}`,
      '视图：①正面 ②侧面 ③细节特写。' + variantLine,
      '要求：跨格保持同一物件一致；避免场景化背景、避免风格漂移、避免格子合并。',
    ].join('\n')
  }
  // character（默认）
  return [
    '角色定妆参考卡（character reference sheet）。白色中性背景、平光、横向版面、分格清晰、每格下方小标签。',
    `同一角色「${name}」，跨所有格保持脸型、发型、服装、标志物完全一致：${desc}`,
    '视图：①正面全身 A-Pose ②侧面 ③背面 ④四分之三侧 ⑤表情行（中性 / 微笑 / 愤怒）。' + variantLine,
    '要求：跨格五官与服装一致；避免格子合并、避免跨格漂移、避免场景化背景。',
  ].join('\n')
}

/** 文本锚的描述拼进引用它的镜头 prompt（「能 prompt 说清的就别生成图」的落地：文本锚 = 写进 prompt）。 */
function buildShotPrompt(shot: PlanShot, anchorById: Map<string, PlanAnchor>): string {
  const textBits = shot.anchorIds
    .map((id) => anchorById.get(id))
    .filter((anchor): anchor is PlanAnchor => Boolean(anchor) && anchor!.carrier === 'text')
    .map((anchor) => `${anchor.name}：${anchor.description}`.trim())
    .filter(Boolean)
  const base = shot.prompt.trim()
  return textBits.length ? [base, ...textBits].filter(Boolean).join('\n') : base
}

/**
 * 确认后：把方案转成 create_canvas_nodes 参数，照常走 applyCanvasToolCall 落画布
 * （复用现有建节点+连边+依赖波次「参考层先生成」，零重写）。
 * - 视觉锚（character/scene/prop）→ 卡片节点（image）；文本锚（style 等）不建节点、描述拼进镜头 prompt。
 * - 每镜按 shotKind 分支：图片镜头 → image 节点（无时长、绑图片模型）；视频镜头 → video 节点（带时长、绑视频模型）。
 *   缺省 shotKind 按 video 兜底（旧草稿兼容）；引用的视觉锚 → 参考边（图片/视频镜头都连，锁身份）。
 *   模型：用户在编辑器为该镜选的 modelKey/modeId 优先，没选 → 按种类取默认图片/视频模型兜底。
 * - **不连 shot→shot 链**：视频→视频会落到尚未实现的「首帧接力抽帧」必裸跑；镜头连贯靠共享定妆卡/场景卡参考。
 */
export function storyboardPlanToCreateNodesArgs(
  plan: StoryboardPlan,
  options: StoryboardPlanToArgsOptions = {},
): PlanCreateNodesArgs {
  const anchorById = new Map(plan.anchors.map((anchor) => [anchor.id, anchor]))
  const nodes: PlanCreatedNode[] = []
  const edges: PlanCreatedEdge[] = []

  // 视觉锚 → 定妆卡/场景卡节点（clientId = anchor.id）。prompt 用「卡片大图」构造器：
  // 多视图+多变体集中一张图、整张喂参考（用户拍板）。图片模型锁 GPT Image 2（调用方传入）。
  for (const anchor of plan.anchors) {
    if (anchor.carrier !== 'visual' || !VISUAL_KINDS.has(anchor.kind)) continue
    nodes.push({
      clientId: anchor.id,
      kind: anchorKindToNodeKind(anchor.kind),
      title: anchor.name,
      prompt: buildAnchorSheetPrompt(anchor),
      // 参考卡永不占镜号（道具锚 kind=image 落 shots 分类，不标记会吃掉「镜头 1/2」，R13 抓出）。
      referenceSheet: true,
      ...(options.defaultImageModelKey ? { modelKey: options.defaultImageModelKey } : {}),
      ...(options.defaultImageModeId ? { modeId: options.defaultImageModeId } : {}),
    })
  }

  // 锚已全部 push 完，此刻节点数 = 参考卡数（镜头随后 push）→ 落画布布局的角色边界。
  const anchorCount = nodes.length

  // 镜头 → video 节点（用户拍板 B-clean）+ 定妆卡参考边。时长写进 duration 参数。
  // 按 shot.index 排序后再建节点（审计 A5 防御）：布局按数组顺序排格子，若 LLM 把镜头
  // 乱序吐出来，画布空间顺序就会与镜头编号错位（镜6 排在镜5 前）。这里钉死「数组序=镜序」。
  const orderedShots = [...plan.shots].sort((a, b) => a.index - b.index)
  for (const shot of orderedShots) {
    const id = shotClientId(shot)
    // 镜头种类分支（用户拍板：拆镜头默认图片分镜）。缺省无 shotKind → 按 video 兜底（旧草稿兼容）。
    const isImageShot = shot.shotKind === 'image'
    // 该镜引用的视觉锚（定妆卡）——连 character_ref/style_ref/reference 参考边。
    // 视频镜头：图→视频 i2v 参考；图片镜头：图→图 参考（同样锁角色/场景身份，图片模型的参考槽）。
    const visualAnchorIds = shot.anchorIds.filter((anchorId) => {
      const anchor = anchorById.get(anchorId)
      return Boolean(anchor) && anchor!.carrier === 'visual' && VISUAL_KINDS.has(anchor!.kind)
    })
    // 图片镜头绑图片模型默认、视频镜头绑视频模型默认；用户在编辑器为该镜选的 modelKey 永远优先。
    const defaultModelKey = isImageShot ? options.defaultImageModelKey : options.defaultVideoModelKey
    const defaultModeId = isImageShot ? options.defaultImageModeId : options.defaultVideoModeId
    const modelKey = shot.modelKey || defaultModelKey
    // 用户为该镜选了具体模型 → 不套默认模型的 modeId（会张冠李戴）；留空让 buildPlannedNodeMeta
    // 按所选模型自己取默认模式。只有用默认模型时才用默认 modeId。
    const modeId = shot.modeId || (shot.modelKey ? undefined : defaultModeId)
    nodes.push({
      clientId: id,
      // 图片镜头 → image 节点（纯图生图静态画面，无 duration）；视频镜头 → video 节点（带 duration）。
      kind: isImageShot ? 'image' : 'video',
      title: `镜头 ${shot.index}`,
      prompt: buildShotPrompt(shot, anchorById),
      ...(modelKey ? { modelKey } : {}),
      ...(modeId ? { modeId } : {}),
      // duration 仅视频镜头写（由卡的「时长」选择器管）；图片镜头不写。其余模型参数（比例/清晰度/负向…）来自 shot.params。
      params: {
        ...(shot.params || {}),
        ...(!isImageShot && Number.isFinite(shot.durationSec) ? { duration: shot.durationSec } : {}),
      },
    })
    // 定妆卡 → 这一镜参考边（角色 character_ref / 场景·风格 style_ref / 道具 reference）。图片/视频镜头都连。
    for (const anchorId of visualAnchorIds) {
      const anchor = anchorById.get(anchorId)!
      edges.push({ sourceClientId: anchorId, targetClientId: id, mode: edgeModeForAnchor(anchor.kind) })
    }
    // B-clean：不连 shot→shot 链（视频→视频参考会落到尚未实现的首帧接力抽帧 → 必裸跑）。
    // 镜头连贯靠共享的定妆卡/场景卡参考（同一批镜头引用同一组锚 → 视觉一致）。
  }

  // 整批落「分镜」分类：角色/场景与镜头同处一个视图，参考边同屏可见可连（用户拍板 A）。
  return { summary: plan.title.trim() || '分镜方案', nodes, edges, anchorCount, groupCategoryId: 'shots' }
}
