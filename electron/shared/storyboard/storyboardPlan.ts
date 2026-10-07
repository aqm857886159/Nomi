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
  /**
   * 自动引用补过的锚 id（`insertAutoMentions` 的账本）。参考卡出图后在提示词里它名字后面补一枚 @
   * 并绑进参考框；补过一次就记在这里——用户手动删掉那枚 @，同一张参考卡不会再被补回来。
   * 只由自动引用写，Agent 不写（不进起草 schema）。
   */
  autoReferenced?: string[]
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
   * 覆盖它。读写一律走 `storyboardShotScope.ts`（单一 owner），缺省时那层从全镜共同值 derive，
   * 旧 plan 因此不需要迁移脚本。
   */
  aspectRatio?: string
  /** 片种模板 key（如 'genre.short-drama'）；缺省 = 自由格式。骨架段/画幅默认按它 derive（C 阶段接管）。 */
  profileKey?: string
  /** 片种 profile 快照（来自 storyboardProfiles.ts 的模板表）；缺省时按 profileKey/自由文本 derive。 */
  storyboardProfile?: StoryboardProfile
  /** The exact approved script this plan was derived from. */
  sourceScriptArtifactId?: string
  sourceScriptVersion?: number
  sourceScriptHash?: string
}
