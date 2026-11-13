import React from 'react'
import type { ArchetypeMode, ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import type { ModeInput } from '../../../../electron/shared/modelArchetypes/modeForInputs'
import { EDGE_MODE_SLOTS } from '../../../../electron/shared/canvas/edgeAdmission'
import { archetypeForNode, connectionCreateVerdictsForTarget } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasEdgeMode, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { collectModeInputs, effectiveArchetypeModeWithInputs, type ModeGraph } from '../nodes/controls/archetypeMeta'
import { modeDisplayKind, type ModeDisplayKind } from '../nodes/controls/modeMenuModel'
import { requestNodePromptFocus } from '../nodes/nodePromptFocus'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { addUpstreamNodes, runAsSingleUndoStep } from './nodeInputActions'

/**
 * 空节点「试试」（2026-10-08 用户拍板 ③）：用 2–3 个创作任务替换那一句操作说明。
 *
 * 每个配方**只搭结构**——建好该连的上游空图片节点（首帧 / 尾帧边说清角色）、把光标放进提示词框；
 * 不生成、不派发、不花钱（本目录不碰任何花钱入口：deriveFromNode.noMoneyDoor.test.ts 扫整个目录）。一个配方 = 一步撤销。
 *
 * **只列「点了真的会发生一件还成立的事」的配方**（2026-11-12 验收 C2）：方式按输入现算以后，「文字生图 / 文生视频」
 * 点了什么都不会变（什么都不放本来就是文生），是死按钮，删了。其余每个配方说清它会放进来什么（adds），
 * 列不列只问方式的唯一 owner：把这几件放进来之后，modeForInputs 收得下全部输入、而且算出来的方式就是按钮上写的那种
 * （视频：图生视频 / 首尾帧，名字与底栏方式格同一套）。节点已经有输入、放进去之后变成别的方式或放不下的，不列。
 * 连线判据读种类定义的 `connects`；没选模型（没有档案可问）时只在节点还什么都没放时列。
 */
export type NodeTryRecipeId = 'image.reference' | 'video.firstFrame' | 'video.firstLast'

export type NodeTryRecipe = {
  id: NodeTryRecipeId
  /** i18n 键（generationCommon.nodeTry.*）。 */
  labelKey: string
  /** 这一步要接进来的那一类（配方数据的一部分；目前的纯文字按钮不画它）。 */
  icon: GenerationNodeKind
}

type RecipeDefinition = NodeTryRecipe & {
  /** 点了之后连进来的空图片节点，每个一条边（边的角色）。 */
  adds: readonly (GenerationCanvasEdgeMode | undefined)[]
  /** 放进来之后应当按哪种方式发（按钮上写的就是它）；不给 = 只要收得下（图片节点没有方式名）。 */
  becomes?: ModeDisplayKind
}

const store = () => useGenerationCanvasStore.getState()

const takesImage = (node: GenerationCanvasNode) => connectionCreateVerdictsForTarget(node, ['image'])[0].ok

/** 这个配方放进来之后还成立吗——只问 modeForInputs（经渲染层唯一入口），不另写判断。 */
function recipeHolds(recipe: RecipeDefinition, node: GenerationCanvasNode, graph: ModeGraph): boolean {
  if (!takesImage(node)) return false
  const before = collectModeInputs(node, graph).inputs.length
  const archetype: ModelArchetype | null = archetypeForNode(node)
  if (!archetype) return before === 0
  const extra: ModeInput[] = recipe.adds.map((mode) => ({ slots: EDGE_MODE_SLOTS[mode ?? 'reference'], asset: 'image' }))
  const after = effectiveArchetypeModeWithInputs(archetype, node, graph, extra)
  if (after.status !== 'ok' || after.taken !== before + extra.length) return false
  return recipe.becomes ? modeDisplayKind(archetype, after.mode as ArchetypeMode) === recipe.becomes : after.mode.slots.length > 0
}

/**
 * 类型 → 「试试」动作列表：**唯一的一张表**，组件（NodeTryList）只读它，改某类节点的动作只改这里那一行。
 * 文本卡不在这张表里：它的「试试」是加工框那一行（扩写成提示词 · 看图写描述 · 拆成多条，2026-10-08 文本节点拍板），
 * 那三个动作要调文本模型、并且缺内容 / 缺图时得灰着说原因，属于文本节点自己的加工（TextDocumentNode + textProcessRun），不是只搭结构的配方。
 */
const RECIPES: Record<'image' | 'video', readonly RecipeDefinition[]> = {
  image: [
    { id: 'image.reference', labelKey: 'generationCommon.nodeTry.image.reference', icon: 'image', adds: [undefined] },
  ],
  video: [
    { id: 'video.firstFrame', labelKey: 'generationCommon.nodeTry.video.firstFrame', icon: 'image', adds: ['first_frame'], becomes: 'image' },
    { id: 'video.firstLast', labelKey: 'generationCommon.nodeTry.video.firstLast', icon: 'image', adds: ['first_frame', 'last_frame'], becomes: 'firstLast' },
  ],
}

function recipesFor(kind: GenerationNodeKind): readonly RecipeDefinition[] {
  return kind === 'image' || kind === 'video' ? RECIPES[kind] : []
}

const strip = ({ id, labelKey, icon }: RecipeDefinition): NodeTryRecipe => ({ id, labelKey, icon })

/** 这张空卡此刻能做的「试试」（按显示顺序）。graph = 节点所在的画布（连进来的边也是输入）。 */
export function nodeTryRecipes(node: GenerationCanvasNode, graph: ModeGraph): NodeTryRecipe[] {
  return recipesFor(node.kind).filter((recipe) => recipeHolds(recipe, node, graph)).map(strip)
}

/** 组件用：跟着画布变（连上 / 断开一条边，列表跟着变）。选出来的是 id 串，画布别处变动不重画。 */
export function useNodeTryRecipes(node: GenerationCanvasNode): NodeTryRecipe[] {
  const ids = useGenerationCanvasStore((state) => nodeTryRecipes(node, state).map((recipe) => recipe.id).join('|'))
  return React.useMemo(() => recipesFor(node.kind).filter((recipe) => ids.split('|').includes(recipe.id)).map(strip), [ids, node.kind])
}

/**
 * 跑一个配方：一步撤销；跑完选中「接下来要写提示词的那张卡」并把光标放进去
 * （往上游接东西 → 本卡；往下游生成 → 新卡）。
 */
export function runNodeTryRecipe(nodeId: string, recipeId: NodeTryRecipeId): void {
  const node = store().nodes.find((candidate) => candidate.id === nodeId)
  const recipe = node ? recipesFor(node.kind).find((candidate) => candidate.id === recipeId) : undefined
  if (!node || !recipe || !recipeHolds(recipe, node, store())) return
  runAsSingleUndoStep(`node-try-${recipe.id}-${Date.now()}`, () => addUpstreamNodes(node.id, 'image', recipe.adds))
  const focusId = node.id
  store().selectNode(focusId)
  requestNodePromptFocus(focusId)
}
