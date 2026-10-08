// 列表视图 / 自动引用样张的「真 store」夹具：把列表卡、可引用素材灌进现役画布 store，
// 让检查器里的 NodeGenerationComposer、提示词里的 chip 编号、参考格都从**同一份**节点和参考边推出来，
// 不在样张里另写一份「这张卡引用了谁」。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbench/workbenchStore'
import { seedModelCatalogForTests } from '../config/modelCatalogCache'
import { toCatalogModelOptions } from '../config/modelOptionMappers'
import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'
import { COMPOSER_CHUNK } from './designLab/nodeComposerBar/nodeComposerBarLabKit'
import { expandPrompt, REFS, type ListCard, type ListViewLocale, type RefId } from './storyboardListViewData'

/** 界面语言跟着样张走：现役组件读 i18n，样张的中英两轨要切同一个开关。 */
export function useLabLanguage(locale: ListViewLocale): boolean {
  const { i18n } = useTranslation()
  const want = locale === 'en' ? 'en' : 'zh-CN'
  const [applied, setApplied] = React.useState(i18n.language === want)
  React.useEffect(() => {
    if (i18n.language === want) {
      setApplied(true)
      return
    }
    setApplied(false)
    void i18n.changeLanguage(want).then(() => setApplied(true))
  }, [i18n, want])
  return applied
}

export function refNode(id: RefId, locale: ListViewLocale, position = { x: 0, y: 0 }): GenerationCanvasNode {
  const ref = REFS[id]
  return {
    id: ref.nodeId,
    kind: 'image',
    categoryId: 'shots',
    title: locale === 'en' ? ref.en : ref.zh,
    prompt: '',
    position,
    size: { width: 200, height: 200 },
    status: ref.ready ? 'success' : 'idle',
    ...(ref.ready ? { result: { id: `${ref.nodeId}-r`, type: 'image' as const, url: ref.art, createdAt: 1 } } : {}),
    meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', aspect_ratio: '1:1', resolution: '2K' },
  } as GenerationCanvasNode
}

export function cardNode(card: ListCard, locale: ListViewLocale, prompt?: string): GenerationCanvasNode {
  const video = card.media === 'video'
  return {
    id: card.id,
    kind: video ? 'video' : 'image',
    categoryId: 'shots',
    title: locale === 'en' ? card.titleEn : card.title,
    prompt: prompt ?? expandPrompt(locale === 'en' ? card.promptEn : card.prompt, locale),
    position: { x: 0, y: 0 },
    size: { width: 340, height: 192 },
    status: card.status === 'generating' ? 'running' : card.status === 'failed' ? 'error' : card.art ? 'success' : 'idle',
    ...(card.art ? { result: { id: `${card.id}-r`, type: 'image' as const, url: card.art, createdAt: 1 } } : {}),
    meta: video ? VIDEO_META(card.ratio) : IMAGE_META(card.ratio),
  } as GenerationCanvasNode
}

/** 带参考槽的那一档模式（Seedance 2 全能参考 / GPT Image 2 图生图）：参考边才落得进槽、chip 才有编号。 */
export const VIDEO_META = (ratio: string): Record<string, unknown> => ({
  modelKey: 'seedance-2',
  modelVendor: 'apimart',
  archetype: { id: 'seedance-2', modeId: 'omni' },
  aspect_ratio: ratio,
  duration: 5,
  resolution: '1080p',
})
export const IMAGE_META = (ratio: string): Record<string, unknown> => ({
  modelKey: 'gpt-image-2',
  modelVendor: 'apimart',
  archetype: { id: 'gpt-image-2', modeId: 'i2i' },
  aspect_ratio: ratio,
  resolution: '2K',
})

/** 参考边：提示词里每一个已绑定的引用 = 一条从素材节点连过来的真边（chip 编号按边序）。 */
export function referenceEdges(targetId: string, refs: readonly RefId[]): GenerationCanvasEdge[] {
  return refs
    .filter((id) => REFS[id].ready)
    .map((id, order) => ({ id: `edge-${REFS[id].nodeId}-${targetId}`, source: REFS[id].nodeId, target: targetId, mode: 'reference', order }))
}

/** 两个真实档案认得的模型（目录行形状 = 主进程投影过的样子，带 availability）。批量条与生成框共用。 */
export const LAB_MODEL_ROWS = [
  { modelKey: 'seedance-2', modelAlias: 'bytedance/seedance-2', vendorKey: 'apimart', labelZh: 'Seedance 2', kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: { usable: true }, createdAt: '2026-10-08', updatedAt: '2026-10-08' },
  { modelKey: 'gpt-image-2', vendorKey: 'apimart', labelZh: 'GPT Image 2', kind: 'image', enabled: true, published: true, publishedModes: ['text_to_image', 'image_edit'], availability: { usable: true }, createdAt: '2026-10-08', updatedAt: '2026-10-08' },
] as unknown as ModelCatalogModelDto[]

const LAB_HEALTH = {
  ok: true,
  counts: { vendors: 1, enabledVendors: 1, models: 2, enabledModels: 2, mappings: 2, enabledMappings: 2, enabledApiKeys: 1 },
  byKind: [
    { kind: 'video' as const, enabledModels: 1, executableModels: 1 },
    { kind: 'image' as const, enabledModels: 1, executableModels: 1 },
  ],
  issues: [],
}

/**
 * 现役目录链在实验室里的入口（`seedModelCatalogForTests`，v4 付费卡那几格同一手法）：
 * 只种最外面那次取数，认档案 / 算参数 / 渲染全部照常走。
 */
function seedLabCatalog(): void {
  const options = toCatalogModelOptions(LAB_MODEL_ROWS)
  const video = options.filter((option) => option.kind === 'video')
  const image = options.filter((option) => option.kind !== 'video')
  seedModelCatalogForTests(LAB_HEALTH as never, [
    { kind: 'video', requiredMode: 'text_to_video', options: video },
    { kind: 'video', requiredMode: 'image_to_video', options: video },
    { kind: 'image', requiredMode: 'text_to_image', options: image },
    { kind: 'image', requiredMode: 'image_edit', options: image },
  ])
}

/** 灌 store + 种模型目录 + 等 composer 的 lazy chunk；全部就绪才返回 true。 */
export function useSeededCanvas(nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[], selectedIds: string[] = []): boolean {
  React.useMemo(() => seedLabCatalog(), [])
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => {
    // 字体也算前置条件：参数条按文字实测宽度贴边（hugWidth），字体没到就量，chip 会挤在一起。
    void Promise.all([COMPOSER_CHUNK, document.fonts?.ready]).then(() => setChunkReady(true))
  }, [])
  const [seeded, setSeeded] = React.useState(false)
  const key = JSON.stringify([nodes.map((node) => [node.id, node.title, node.prompt]), edges.map((edge) => edge.id), selectedIds])
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useWorkbenchStore.getState().rememberCategoryViewport('shots', { zoom: 1, offset: { x: 0, y: 0 } })
    useGenerationCanvasStore.setState({ nodes, edges, selectedNodeIds: selectedIds })
    setSeeded(true)
    // key 是这一格的身份
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return seeded && chunkReady
}
