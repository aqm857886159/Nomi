// 画布节点工厂 · 渲染层与 electron 能力核**共用的唯一建节点纯函数**（P1：杀掉平行简化版）。
//
// 为什么住 electron/ 而非 src/：electron tsconfig 是 rootDir:"."，production 反向 import 不了 src
// （实测 TS6059）；渲染层则本就 import 得到 electron（bridge.ts / archetypeMeta→referenceReachability 已在做）。
// 与 electron/catalog/referenceReachability.ts 同一 house pattern：共享纯域码落 electron、src 反向引。
//
// 铁律（P1，无第二真相源）：本模块**不 copy** 任何 registry / i18n / shotNumbering 逻辑，
// per-kind 的尺寸/默认标题/分类/是否占镜号全走**注入依赖**（NodeFactoryDeps）——
// 渲染层注入 src 真函数（单一真相源留在 src registry），electron 注入 nodeKindDomain 里的纯表
// （该表由 equivalence 测试钉死 === registry 值，防漂移）。故两路产出**字段级等价**（除 id/落点）。
//
// 纯净约束：本文件零 import（不碰 React / zustand / electron runtime / node builtins），可在纯 Node 单测。

/** 建节点入参——语义字段 + 可选落点/覆盖。缺省几何/标题/分类由注入依赖补。 */
export type CanvasNodeFactorySpec = {
  kind: string
  title?: string
  prompt?: string
  /** 显式落点（调用方已算好）；缺则由布局层给（不在本函数兜底为 0）。 */
  x?: number
  y?: number
  references?: string[]
  /** 已备好的 meta（如 UI 从目录组装的完整模型绑定）——原样并入，优先于 vendor/modelKey 派生。 */
  meta?: Record<string, unknown>
  /** 显式尺寸覆盖（切图瓦片等）；缺则用注入的 per-kind 默认尺寸。 */
  size?: { width: number; height: number }
  /** 显式分类覆盖（整批强制同分类等）；缺则由 kind 推。 */
  categoryId?: string
  /** 外部调用方（MCP）给的模型身份——绑进 meta 的解析器可见四件（与 UI 身份部分一致）。 */
  vendor?: string
  modelKey?: string
}

/** 工厂注入依赖：把「与 registry/i18n 绑定」的一切外置，本函数只做组装。 */
export type NodeFactoryDeps = {
  /** 生成稳定唯一 id（渲染层 createNodeId / electron crypto）。 */
  createId: (kind: string) => string
  /** per-kind 默认尺寸（registry.defaultSize 单一真相源）。 */
  resolveSize: (kind: string) => { width: number; height: number }
  /**
   * per-kind 默认标题（locale 相关）。渲染层注入 src i18n 真函数给本地化默认名；
   * electron（headless 无 i18n）**注入回空串**——省略 title 时存空、由渲染时 `node.title || t(...)` 兜底补
   * 当前 locale 默认名，避免把英文标题烘进 project.json 让 zh-CN 用户看到英文卡名（见 canvasGraph.ts 注入点注释）。
   */
  resolveDefaultTitle: (kind: string) => string
  /** kind→默认分类（getDefaultCategoryForNodeKind 单一真相源）。 */
  resolveCategory: (kind: string) => string
  /** 该节点是否占镜号（isShotNumberedNode：仅 shots 分类里的 image/video/shot/keyframe，排除参考/首帧标记）。 */
  isShotNumbered: (node: { kind: string; categoryId?: string; meta?: Record<string, unknown> }) => boolean
  /** 下一个可用镜号（max+1）。传入「本次落地前的既有节点集」。 */
  nextShotIndex: (existing: readonly { shotIndex?: number }[]) => number
  /**
   * 校验调用方给的模型身份（`spec.vendor` / `spec.modelKey`），不合法就**抛**。
   *
   * 为什么是注入而不是本文件自己判：本文件零 import（可在纯 Node 单测），目录在 electron 那边；
   * 而「校验留在 UI」那句旧注释对 MCP 这条路根本不成立——UI 路压根不传 vendor/modelKey
   * （它传已组装好的 meta），所以那层校验对这条路等于不存在。
   * 缺省不传 = 不校验（渲染层那条路没有外来身份可校）。
   */
  assertModelIdentity?: (identity: { vendor?: string; modelKey?: string; kind: string }) => void
}

/** 工厂产出的规范节点记录（= generationCanvasNodeSchema 的可写子集，渲染层载入照 zod 归一）。 */
export type CanvasNodeRecord = {
  id: string
  kind: string
  title: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  prompt: string
  references: string[]
  history: unknown[]
  status: string
  meta: Record<string, unknown>
  categoryId: string
  shotIndex?: number
}

/**
 * 把外部给的 vendor/modelKey 绑成解析器可见的**身份四件**（runner/catalogTaskResolve 读
 * meta.modelVendor||meta.vendor + meta.modelKey||meta.modelAlias）。二者都缺 → 返回原 meta
 * （保持空 → 触发渲染层 auto-select）。
 *
 * 2026-09-21：给了就**校验**（`deps.assertModelIdentity`）。旧注释说「非法/未知值原样存——校验留在
 * UI」，但走这条路的是 MCP，UI 那层校验在这条路上根本不存在：外部宿主写错一个 modelKey，
 * 节点照样建出来、看起来一切正常，直到点生成才发现这个模型不存在；而 `canvasRead` 又不返回
 * 模型字段，连读都读不回来，错误因此完全不可观测。
 */
function bindModelIdentity(
  meta: Record<string, unknown>,
  kind: string,
  deps: NodeFactoryDeps,
  vendor?: string,
  modelKey?: string,
): Record<string, unknown> {
  const v = typeof vendor === 'string' ? vendor.trim() : ''
  const k = typeof modelKey === 'string' ? modelKey.trim() : ''
  if (!v && !k) return meta
  deps.assertModelIdentity?.({ ...(v ? { vendor: v } : {}), ...(k ? { modelKey: k } : {}), kind })
  return {
    ...meta,
    ...(k ? { modelKey: k, modelAlias: k } : {}),
    ...(v ? { modelVendor: v, vendor: v } : {}),
  }
}

/**
 * 建一个规范节点记录。与渲染层 store.addNode 的 nextNode 构造**逐字段等价**（除 id/落点）：
 * - createGenerationNode 那套：title(缺省注入)/size(缺省注入)/prompt('')/references([])/history([])/status('idle')/meta({})
 * - addNode 覆盖：meta（有则并入，否则 {})/size（有则覆盖）/categoryId（缺省 kind 推）/shotIndex（占镜号才有）
 * - renderKind **不写**：UI 路径也不写，渲染时 resolveNodeRenderKind 从 kind+categoryId 现推（写了反而分叉）。
 *
 * 镜号需知道「落地前的既有节点」→ 由 existing 传入（工厂纯函数，不自己维护画布状态）。
 */
export function buildCanvasNode(
  spec: CanvasNodeFactorySpec,
  existing: readonly { shotIndex?: number }[],
  deps: NodeFactoryDeps,
): CanvasNodeRecord {
  const kind = (spec.kind && spec.kind.trim()) || 'text'
  const categoryId = (spec.categoryId && spec.categoryId.trim()) || deps.resolveCategory(kind)
  const title = (spec.title && spec.title.trim()) || deps.resolveDefaultTitle(kind)
  const size = spec.size ? { ...spec.size } : deps.resolveSize(kind)
  const baseMeta = spec.meta ? { ...spec.meta } : {}
  const meta = bindModelIdentity(baseMeta, kind, deps, spec.vendor, spec.modelKey)

  const record: CanvasNodeRecord = {
    id: deps.createId(kind),
    kind,
    title,
    position: {
      x: typeof spec.x === 'number' ? spec.x : 0,
      y: typeof spec.y === 'number' ? spec.y : 0,
    },
    size,
    prompt: spec.prompt || '',
    references: spec.references && spec.references.length ? [...spec.references] : [],
    history: [],
    status: 'idle',
    meta,
    categoryId,
  }

  // 镜号 = 出生即分配的存储身份（max+1），只对「shots 分类里的镜头内容节点」分配（见 isShotNumbered）。
  if (deps.isShotNumbered({ kind, categoryId, meta })) {
    record.shotIndex = deps.nextShotIndex(existing)
  }
  return record
}

/**
 * 批量建节点（工厂编排）：布局由调用方先算好（batch 走分层布局 / 单个走碰撞避让），
 * 位置按 index 对齐塞回每个 spec。镜号在批内**累进**——每建一个就把它并进 existing 供下一个算 max+1
 * （否则同批 N 个镜头会领到同一个号）。返回记录数组，与入参同序等长。
 */
export function buildCanvasNodes(
  specs: readonly CanvasNodeFactorySpec[],
  positions: ReadonlyArray<{ x: number; y: number }>,
  existing: readonly { shotIndex?: number }[],
  deps: NodeFactoryDeps,
): CanvasNodeRecord[] {
  const running: Array<{ shotIndex?: number }> = [...existing]
  const built: CanvasNodeRecord[] = []
  specs.forEach((spec, index) => {
    const pos = positions[index]
    const withPos: CanvasNodeFactorySpec = {
      ...spec,
      x: typeof spec.x === 'number' ? spec.x : pos?.x,
      y: typeof spec.y === 'number' ? spec.y : pos?.y,
    }
    const node = buildCanvasNode(withPos, running, deps)
    built.push(node)
    running.push(node)
  })
  return built
}
