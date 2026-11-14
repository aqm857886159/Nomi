// 「这次生成到底需不需要用户打字」——单一真相源。
//
// 背景（真实卡点）：提交咽喉此前无条件 `if (!prompt) throw new Error('prompt is required')`。
// 对「去背景 / 超分 / 深度图 / 补帧」这类**处理类工作流**（ComfyUI 官方模板里 18 张、
// 用户手上更多），图里根本没有提示词槽——用户连好图点生成，收到的是一句英文 dev 报错，
// 整条路直接死掉，且没有任何办法绕（打字也没用，图里没有 {{request.prompt}} 占位）。
//
// 修法是**派生而不是硬编码**：需不需要提示词是模型自己的属性。
//  · 有内置档案 → 档案当前模式的 promptRequired（图生视频/图生 3D 早就声明成 false 了）
//  · ComfyUI 导入图 → 由**图自己**决定（图里有没有提示词绑定）。渲染层看不到图，
//    但后端渲染模板时空提示词只会渲成空串——在这里硬抛只会把整类工作流堵死。
import { sendArchetypeMode, type ArchetypeModeResolution } from '../nodes/controls/archetypeMeta'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isComfyuiVendorKey } from '../model/comfyuiVendor'
import { resolveTaskArchetype } from './catalogTaskResolve'

/** 该节点这次提交是否必须有非空提示词。 */
export function promptRequiredForNode(
  node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>,
  vendor: string,
  /** 画布路解析参考时现算过的方式；不给就按节点自己的输入现算。 */
  references?: { archetypeMode?: ArchetypeModeResolution },
): boolean {
  const meta = node.meta || {}
  const archetype = resolveTaskArchetype(meta)
  if (archetype) return sendArchetypeMode(archetype, node, references).promptRequired
  // 图定义模型：吃不吃提示词写在图里，不由这一层猜。
  if (isComfyuiVendorKey(vendor)) return false
  return true
}

/**
 * ComfyUI 导入图**是否绑了提示词**——UI 侧据此诚实说明「这条工作流不吃提示词」。
 * 真相源是导入时存下的 binding（与 buildImportedWorkflow 注入 {{request.prompt}} 的判据同一个），
 * 不另猜。非 ComfyUI 模型 / 拿不到 binding → null（= 不适用，别显示任何说明）。
 */
export function comfyWorkflowTakesPrompt(modelMeta: unknown): boolean | null {
  if (!modelMeta || typeof modelMeta !== 'object') return null
  const draft = (modelMeta as Record<string, unknown>).comfyWorkflowImport
  if (!draft || typeof draft !== 'object') return null
  const binding = (draft as Record<string, unknown>).binding
  if (!binding || typeof binding !== 'object') return null
  const b = binding as Record<string, unknown>
  return typeof b.promptNodeId === 'string' && typeof b.promptInputKey === 'string'
}
