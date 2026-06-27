// 「改字」节点规格构建（纯函数，仿 fixation/buildFixationNode —— 规则 9/12：别喂巨壳）。
// 对标 Lovart「Text Edit」：基于一张有字的图，派生一个**预填「把旧字改成新字、保留字体/风格」改图提示词**的
// 新节点，走改图模型（nano-banana 改字实测最佳，见 docs/research/2026-06-27-lovart-element-decomposition-research.md §3.7）。
// 不碰 store；调用方拿到 spec 后 addNode + updateNode + selectNode（不自动生成，不偷花额度）。

import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getNodeSize } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { toast } from '../../../ui/toast'

export type TextEditNodeSpec = {
  title: string
  prompt: string
  references: string[]
  meta: Record<string, unknown>
  position: { x: number; y: number }
}

// 改字提示词模板：留两个占位让用户填「原文→新文」。逐字约束「只改字、其余像素不变」是 nano-banana
// 实测保住字体/光影/材质的关键（RONIN→SHOGUN 实测，§3.7 T7）。不钉供应商，nano-banana 档案身份由
// 已连接供应商填（P4 通用第一，同 fixation 回退注释）。
export function buildTextEditPrompt(): string {
  return [
    '把图中的文字「（填原文）」改成「（填新文字）」。',
    '严格保留原字体、字号、颜色、材质与光影、位置和排版，画面其余部分逐像素不变。',
  ].join('\n')
}

// nano-banana 改图身份（实测改字最佳）。源节点自带改图模型时优先复用源模型；否则回退到 nano-banana 改图。
// modelKey 命中 nanoBanana 档案 identifierPatterns，vendor 由 resolveExecutableNodeFromCatalog 按已连接供应商填。
const NANO_BANANA_EDIT_FALLBACK_META: Record<string, unknown> = {
  modelKey: 'nano-banana',
  modelAlias: 'nano-banana',
  modelLabel: 'Nano Banana · 改图',
  imageModel: 'nano-banana',
  archetype: { id: 'nano-banana', modeId: 'i2i' },
}

/** 算出改字新节点的规格；源节点无图则返回 null。 */
export function buildTextEditNodeSpec(node: GenerationCanvasNode): TextEditNodeSpec | null {
  const srcUrl = node.result?.url
  if (!srcUrl) return null
  const name = (node.title || '').trim() || '图片'
  const srcMeta = (node.meta || {}) as Record<string, unknown>
  const modelMeta = typeof srcMeta.modelKey === 'string' && srcMeta.modelKey
    ? {
        modelKey: srcMeta.modelKey,
        modelAlias: srcMeta.modelAlias,
        modelVendor: srcMeta.modelVendor,
        vendor: srcMeta.vendor,
        modelLabel: srcMeta.modelLabel,
        imageModel: srcMeta.imageModel,
        imageModelVendor: srcMeta.imageModelVendor,
      }
    : NANO_BANANA_EDIT_FALLBACK_META
  return {
    title: `${name}·改字`,
    prompt: buildTextEditPrompt(),
    references: [srcUrl],
    meta: { ...modelMeta, referenceImages: [srcUrl], referenceImageUrls: [srcUrl] },
    position: { x: node.position.x + getNodeSize(node).width + 64, y: node.position.y },
  }
}

/** 「改字」整动作：建预填好的改字节点 + 选中 + 提示，不自动生成。源无图则 no-op。 */
export function applyTextEdit(node: GenerationCanvasNode): void {
  const spec = buildTextEditNodeSpec(node)
  if (!spec) return
  const store = useGenerationCanvasStore.getState()
  const created = store.addNode({ kind: 'image', title: spec.title, position: spec.position, categoryId: node.categoryId })
  store.updateNode(created.id, { prompt: spec.prompt, references: spec.references, meta: spec.meta })
  store.selectNode(created.id)
  toast('填入原文与新文字后点生成', 'info')
}
