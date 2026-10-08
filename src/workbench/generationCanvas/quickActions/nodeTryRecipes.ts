import type { ArchetypeIntent, ArchetypeMode, ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { archetypeForNode, connectionCreateVerdictsForSource, connectionCreateVerdictsForTarget } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasEdgeMode, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { applyArchetypeModeSwitch, currentArchetypeMode } from '../nodes/controls/archetypeMeta'
import { requestNodePromptFocus } from '../nodes/nodePromptFocus'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { addDownstreamNode, addUpstreamNodes, runAsSingleUndoStep } from './nodeInputActions'

/**
 * 空节点「试试」（2026-10-08 用户拍板 ③）：用 2–3 个创作任务替换那一句操作说明。
 *
 * 每个配方**只搭结构**——建好该连的上游 / 下游空节点、切到对应的生成方式、把光标放进提示词框；
 * 不生成、不派发、不花钱（本目录不碰任何花钱入口：deriveFromNode.noMoneyDoor.test.ts 扫整个目录）。
 * 一个配方 = 一步撤销。只列今天真有的能力：连线判据读种类定义的 `connects`（左判据 / 右判据），
 * 生成方式读模型档案的 intent / 参考槽；这张卡（或它选的模型）做不到的配方不列。
 */
export type NodeTryRecipeId =
  | 'image.text' | 'image.reference'
  | 'video.firstFrame' | 'video.firstLast' | 'video.text'
  | 'text.toImage' | 'text.toVideo'

export type NodeTryRecipe = {
  id: NodeTryRecipeId
  /** i18n 键（generationCommon.nodeTry.*）。 */
  labelKey: string
  /** 这一步要接进来 / 生成出的那一类（配方数据的一部分；目前的纯文字按钮不画它）。 */
  icon: GenerationNodeKind
}

type RecipeDefinition = NodeTryRecipe & {
  available: (node: GenerationCanvasNode) => boolean
  run: (node: GenerationCanvasNode) => void
}

const store = () => useGenerationCanvasStore.getState()

/** 档案里第一个满足条件的生成方式；没选模型 → null（新建节点稍后选模型时，按活边自动对上模式）。 */
function findMode(node: GenerationCanvasNode, accepts: (mode: ArchetypeMode) => boolean): { archetype: ModelArchetype; mode: ArchetypeMode } | null {
  const archetype = archetypeForNode(node)
  const mode = archetype?.modes.find(accepts)
  return archetype && mode ? { archetype, mode } : null
}

const hasSlots = (mode: ArchetypeMode, ...kinds: string[]) => kinds.every((kind) => mode.slots.some((slot) => slot.kind === kind))
const byIntent = (intent: ArchetypeIntent) => (mode: ArchetypeMode) => mode.intent === intent
/** 首帧工作流：intent 是 single 且收图（首帧槽或 i2v 的图槽）。 */
const firstFrameMode = (mode: ArchetypeMode) => mode.intent === 'single' && (hasSlots(mode, 'first_frame') || hasSlots(mode, 'image_ref'))
/** 首尾帧工作流：优先 intent=firstlast，其次任何同时有首帧和尾帧槽的模式。 */
const firstLastMode = (node: GenerationCanvasNode) => findMode(node, (mode) => mode.intent === 'firstlast' && hasSlots(mode, 'first_frame', 'last_frame'))
  ?? findMode(node, (mode) => hasSlots(mode, 'first_frame', 'last_frame'))

/** 切到这个生成方式（已经是就不动）。 */
function switchMode(nodeId: string, found: { archetype: ModelArchetype; mode: ArchetypeMode } | null): void {
  if (!found) return
  const node = store().nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const meta = (node.meta || {}) as Record<string, unknown>
  if (currentArchetypeMode(found.archetype, meta).id === found.mode.id) return
  store().updateNode(nodeId, { meta: applyArchetypeModeSwitch(meta, found.archetype, found.mode.id) })
}

const takesInput = (node: GenerationCanvasNode, kind: 'image' | 'text') => connectionCreateVerdictsForTarget(node, [kind])[0].ok
const feeds = (node: GenerationCanvasNode, kind: 'image' | 'video') => connectionCreateVerdictsForSource(node, [kind])[0].ok
/** 有模型时这个模型得有这一种生成方式；没模型 → 只看连线判据。 */
const modelAllows = (node: GenerationCanvasNode, accepts: (mode: ArchetypeMode) => boolean) => !archetypeForNode(node) || Boolean(findMode(node, accepts))

/** 接进来的空图片：按给定边语义；有模型时先切到对应生成方式，让边语义由那个方式自然挑出（首帧 / 参考）。 */
function addFrames(node: GenerationCanvasNode, found: { archetype: ModelArchetype; mode: ArchetypeMode } | null, modes: readonly (GenerationCanvasEdgeMode | undefined)[]): void {
  switchMode(node.id, found)
  addUpstreamNodes(node.id, 'image', modes)
}

/**
 * 类型 → 「试试」动作列表：**唯一的一张表**，组件（NodeTryList）只读它，改某类节点的动作只改这里那一行。
 * 文本这一行是**过渡态**（用户 10-08 23:00Z）：先只放现在就能用的「拿它生图 · 拿它生视频」；剧本归创作页，不放跳转链接；
 * 文本节点线第 2 步（左环 + 加工框）落地时，由它把这一行换成「扩写成提示词 · 看图写描述 · 拆成多条」。
 */
const RECIPES: Record<'image' | 'video' | 'text', readonly RecipeDefinition[]> = {
  image: [
    {
      id: 'image.text', labelKey: 'generationCommon.nodeTry.image.text', icon: 'text',
      available: (node) => modelAllows(node, byIntent('text')),
      run: (node) => switchMode(node.id, findMode(node, byIntent('text'))),
    },
    {
      id: 'image.reference', labelKey: 'generationCommon.nodeTry.image.reference', icon: 'image',
      available: (node) => takesInput(node, 'image'),
      // 参考图连进来时，连线那一侧（autoPromoteTargetModeForEdge）把文生图切到收图的方式。
      run: (node) => addUpstreamNodes(node.id, 'image', [undefined]),
    },
  ],
  video: [
    {
      id: 'video.firstFrame', labelKey: 'generationCommon.nodeTry.video.firstFrame', icon: 'image',
      available: (node) => takesInput(node, 'image') && modelAllows(node, firstFrameMode),
      run: (node) => {
        const found = findMode(node, firstFrameMode)
        addFrames(node, found, [found ? undefined : 'first_frame'])
      },
    },
    {
      id: 'video.firstLast', labelKey: 'generationCommon.nodeTry.video.firstLast', icon: 'image',
      available: (node) => takesInput(node, 'image') && (!archetypeForNode(node) || Boolean(firstLastMode(node))),
      run: (node) => addFrames(node, firstLastMode(node), ['first_frame', 'last_frame']),
    },
    {
      id: 'video.text', labelKey: 'generationCommon.nodeTry.video.text', icon: 'text',
      available: (node) => modelAllows(node, byIntent('text')),
      run: (node) => switchMode(node.id, findMode(node, byIntent('text'))),
    },
  ],
  text: [
    {
      id: 'text.toImage', labelKey: 'generationCommon.nodeTry.text.toImage', icon: 'image',
      available: (node) => feeds(node, 'image'),
      run: (node) => { addDownstreamNode(node.id, 'image') },
    },
    {
      id: 'text.toVideo', labelKey: 'generationCommon.nodeTry.text.toVideo', icon: 'video',
      available: (node) => feeds(node, 'video'),
      run: (node) => { addDownstreamNode(node.id, 'video') },
    },
  ],
}

function recipesFor(kind: GenerationNodeKind): readonly RecipeDefinition[] {
  return kind === 'image' || kind === 'video' || kind === 'text' ? RECIPES[kind] : []
}

/** 这张空卡此刻能做的「试试」（按显示顺序）。 */
export function nodeTryRecipes(node: GenerationCanvasNode): NodeTryRecipe[] {
  return recipesFor(node.kind).filter((recipe) => recipe.available(node)).map(({ id, labelKey, icon }) => ({ id, labelKey, icon }))
}

/**
 * 跑一个配方：一步撤销；跑完选中「接下来要写提示词的那张卡」并把光标放进去
 * （往上游接东西 → 本卡；往下游生成 → 新卡）。
 */
export function runNodeTryRecipe(nodeId: string, recipeId: NodeTryRecipeId): void {
  const node = store().nodes.find((candidate) => candidate.id === nodeId)
  const recipe = node ? recipesFor(node.kind).find((candidate) => candidate.id === recipeId) : undefined
  if (!node || !recipe || !recipe.available(node)) return
  const before = new Set(store().nodes.map((candidate) => candidate.id))
  runAsSingleUndoStep(`node-try-${recipe.id}-${Date.now()}`, () => recipe.run(node))
  const downstream = node.kind === 'text' ? store().nodes.find((candidate) => !before.has(candidate.id)) : undefined
  const focusId = downstream?.id ?? node.id
  store().selectNode(focusId)
  requestNodePromptFocus(focusId)
}
