import type { ArchetypeIntent, ArchetypeMode, ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { archetypeForNode, connectionCreateVerdictsForTarget } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasEdgeMode, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { requestNodePromptFocus } from '../nodes/nodePromptFocus'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { addUpstreamNodes, runAsSingleUndoStep } from './nodeInputActions'

/**
 * 空节点「试试」（2026-10-08 用户拍板 ③）：用 2–3 个创作任务替换那一句操作说明。
 *
 * 每个配方**只搭结构**——建好该连的上游 / 下游空节点（首帧 / 尾帧边说清角色，方式在发送时按输入现算）、把光标放进提示词框；
 * 不生成、不派发、不花钱（本目录不碰任何花钱入口：deriveFromNode.noMoneyDoor.test.ts 扫整个目录）。
 * 一个配方 = 一步撤销。只列今天真有的能力：连线判据读种类定义的 `connects`（左判据 / 右判据），
 * 生成方式读模型档案的 intent / 参考槽；这张卡（或它选的模型）做不到的配方不列。
 */
export type NodeTryRecipeId =
  | 'image.text' | 'image.reference'
  | 'video.firstFrame' | 'video.firstLast' | 'video.text'

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

const takesInput = (node: GenerationCanvasNode, kind: 'image' | 'text') => connectionCreateVerdictsForTarget(node, [kind])[0].ok
/** 有模型时这个模型得有这一种生成方式；没模型 → 只看连线判据。 */
const modelAllows = (node: GenerationCanvasNode, accepts: (mode: ArchetypeMode) => boolean) => !archetypeForNode(node) || Boolean(findMode(node, accepts))

/** 接进来的空图片：按给定边语义（首帧 / 尾帧）连上。不写生成方式——方式在发送时按这些边现算。 */
function addFrames(node: GenerationCanvasNode, modes: readonly GenerationCanvasEdgeMode[]): void {
  addUpstreamNodes(node.id, 'image', modes)
}

/**
/**
 * 类型 → 「试试」动作列表：**唯一的一张表**，组件（NodeTryList）只读它，改某类节点的动作只改这里那一行。
 * 文本卡不在这张表里：它的「试试」是加工框那一行（扩写成提示词 · 看图写描述 · 拆成多条，2026-10-08 文本节点拍板），
 * 那三个动作要调文本模型、并且缺内容 / 缺图时得灰着说原因，属于文本节点自己的加工（TextDocumentNode + textProcessRun），不是只搭结构的配方。
 */
const RECIPES: Record<'image' | 'video', readonly RecipeDefinition[]> = {
  image: [
    {
      id: 'image.text', labelKey: 'generationCommon.nodeTry.image.text', icon: 'text',
      available: (node) => modelAllows(node, byIntent('text')),
      // 文字生成：什么都不放就是文字生成，不用写方式。
      run: () => undefined,
    },
    {
      id: 'image.reference', labelKey: 'generationCommon.nodeTry.image.reference', icon: 'image',
      available: (node) => takesInput(node, 'image'),
      // 参考图连进来之后，方式在发送时按输入现算（收图的方式）。
      run: (node) => addUpstreamNodes(node.id, 'image', [undefined]),
    },
  ],
  video: [
    {
      id: 'video.firstFrame', labelKey: 'generationCommon.nodeTry.video.firstFrame', icon: 'image',
      available: (node) => takesInput(node, 'image') && modelAllows(node, firstFrameMode),
      run: (node) => addFrames(node, ['first_frame']),
    },
    {
      id: 'video.firstLast', labelKey: 'generationCommon.nodeTry.video.firstLast', icon: 'image',
      available: (node) => takesInput(node, 'image') && (!archetypeForNode(node) || Boolean(firstLastMode(node))),
      run: (node) => addFrames(node, ['first_frame', 'last_frame']),
    },
    {
      id: 'video.text', labelKey: 'generationCommon.nodeTry.video.text', icon: 'text',
      available: (node) => modelAllows(node, byIntent('text')),
      // 文字生成：什么都不放就是文字生成，不用写方式。
      run: () => undefined,
    },
  ],
}

function recipesFor(kind: GenerationNodeKind): readonly RecipeDefinition[] {
  return kind === 'image' || kind === 'video' ? RECIPES[kind] : []
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
  runAsSingleUndoStep(`node-try-${recipe.id}-${Date.now()}`, () => recipe.run(node))
  const focusId = node.id
  store().selectNode(focusId)
  requestNodePromptFocus(focusId)
}
