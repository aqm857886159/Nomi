// 设计实验室 · 「生成框 B3」取景台（2026-10-19，I-b1a）。
//
// 每一格都是**现役** `BaseGenerationNode` + `NodeGenerationComposer` 本体：节点、连线、上传参考全部灌进两个真 store，
// 模型目录用 `seedModelCatalogForTests` 种最外面那一次取数（认档案 / 算参数 / 渲染照常走）。
// 这里不画任何一个像素：形态长什么样由生产组件决定，改了真身，这一屏跟着变。
//
// 参考图是仓库里的小 SVG（tests/ux/fixtures/b3-refs/），文件名就是素材名——提示词里的小块和悬停提示读的就是它。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { LabCanvasViewport } from '../labCanvasViewport'
import { holdDesignLabReady } from '../labReadyHold'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { seedModelCatalogForTests } from '../../../config/modelCatalogCache'
import type { ModelOption } from '../../../config/models'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'

export const B3_CELL_WIDTH = 900
export const B3_CELL_HEIGHT = 640
const NODE_LEFT = 150
const NODE_TOP = 40
const NODE_WIDTH = 340
const NODE_HEIGHT = 130

/** 仓库里的小图。文件名 = 素材名。 */
const REF_DIR = '/tests/ux/fixtures/b3-refs'
// 名字后面带 #k 的同一张图是「另一条引用」（URL 加 ?i=k 区分）：参考槽按 URL 去重，要摆出 30 张得有 30 个不同的 URL。
const refUrl = (name: string): string => {
  const [base = name, salt] = name.split('#')
  return `${window.location.origin}${REF_DIR}/${encodeURIComponent(base)}.svg${salt ? `?i=${salt}` : ''}`
}

export type B3Model = 'seedance' | 'seedance25' | 'seedance25Apimart' | 'kling4' | 'wan' | 'gpt-image' | 'imagen' | 'soul'

const MODELS: Record<B3Model, { option: ModelOption; archetype: string; variantId?: string }> = {
  seedance: {
    option: { value: 'bytedance/seedance-2', modelKey: 'seedance-2', modelAlias: 'bytedance/seedance-2', vendor: 'apimart', vendorName: '渠道 A', label: 'Seedance 2.0', kind: 'video' },
    archetype: 'seedance-2',
    variantId: 'fast',
  },
  // 参考上限最大的视频档案（30 图 / 10 视频 / 10 音频）：参考行最坏规模。
  seedance25: {
    option: { value: 'seedance-2.5', modelKey: 'seedance-2.5', vendor: 'apimart', vendorName: '渠道 A', label: 'Seedance 2.5', kind: 'video' },
    archetype: 'seedance-2.5',
  },
  // 同一个模型走 APIMart 的档案（首尾帧的尾帧可以不放；方式格样张 A–J 画的就是它）。渠道是 APIMart 就配 APIMart 的档案，
  // 不借 kie 那份（kie 的首尾帧尾帧必填，放 1 张时首尾帧那行会灰——和拍板稿 B 对不上）。
  seedance25Apimart: {
    option: { value: 'doubao-seedance-2.5', modelKey: 'doubao-seedance-2.5', vendor: 'apimart', vendorName: '渠道 A', label: 'Seedance 2.5', kind: 'video' },
    archetype: 'seedance-2.5-apimart',
  },
  // 只收首帧 + 可选尾帧、没有参考数组的视频档案：放 3 张时第 3 张不会发（样张 J）。
  kling4: {
    option: { value: 'kling-v4', modelKey: 'kling-v4', vendor: 'apimart', vendorName: '渠道 A', label: '可灵 4.0', kind: 'video' },
    archetype: 'kling-v4',
  },
  wan: {
    option: { value: 'wan2.7', modelKey: 'wan2.7', vendor: 'apimart', vendorName: '渠道 A', label: 'Wan 2.7', kind: 'video' },
    archetype: 'wan-2.7',
  },
  'gpt-image': {
    option: { value: 'gpt-image-2', modelKey: 'gpt-image-2', vendor: 'apimart', vendorName: '渠道 A', label: 'GPT Image 2', kind: 'image' },
    archetype: 'gpt-image-2',
  },
  // 声明了「出图张数」的模型：数量钮只在这种模型上出现。
  soul: {
    option: { value: 'higgsfield-soul-2', modelKey: 'higgsfield-soul-2', vendor: 'apimart', vendorName: '渠道 A', label: 'Soul 2', kind: 'image' },
    archetype: 'higgsfield-soul-2',
  },
  imagen: {
    option: { value: 'imagen-4', modelKey: 'imagen-4', vendor: 'apimart', vendorName: '渠道 A', label: 'Imagen 4', kind: 'image' },
    archetype: 'imagen-4',
  },
}

/** 目录里另有的行：模型菜单里「只列模型」、同模型多渠道的小签（B3o）。 */
const EXTRA_VIDEO_OPTIONS: readonly ModelOption[] = [
  { value: 'wan2.7', modelKey: 'wan2.7', vendor: 'apimart', vendorName: '渠道 B', label: 'Wan 2.7', kind: 'video' },
  { value: 'veo3.1', modelKey: 'veo3.1', vendor: 'apimart', vendorName: '渠道 A', label: 'Veo 3.1', kind: 'video' },
  { value: 'veo3.1', modelKey: 'veo3.1', vendor: 'kie', vendorName: '渠道 B', label: 'Veo 3.1', kind: 'video' },
]
const SECOND_CHANNEL: ModelOption = { value: 'bytedance/seedance-2', modelKey: 'seedance-2', modelAlias: 'bytedance/seedance-2', vendor: 'kie', vendorName: '渠道 B', label: 'Seedance 2.0', kind: 'video' }

/** 渠道 mapping 只给「当前渠道」配了文生 + 参考；首帧 / 首尾帧没有线缆（桶已知、方式没有 → 判为这家发不出）。 */
const BODY_REFERENCE_ONLY = { prompt: '{{request.params.prompt}}', reference_image_urls: '{{request.params.reference_image_urls}}' }
const BODY_RICH = { prompt: '{{request.params.prompt}}', first_frame_url: '{{request.params.first_frame_url}}', last_frame_url: '{{request.params.last_frame_url}}', reference_image_urls: '{{request.params.reference_image_urls}}' }
const mappingRow = (vendorKey: string, taskKind: string, body: Record<string, string>, modeId?: string) => ({
  id: `b3-${vendorKey}-${taskKind}-${modeId ?? 'any'}`, vendorKey, taskKind, ...(modeId ? { modeId } : {}), name: 'lab', enabled: true,
  create: { method: 'POST', url: 'https://lab.invalid/v1/video', body }, createdAt: '2026-10-19', updatedAt: '2026-10-19',
})
function channelMappings(gap: 'switch' | 'none'): unknown[] {
  return [
    mappingRow('apimart', 'text_to_video', { prompt: '{{request.params.prompt}}' }),
    mappingRow('apimart', 'image_to_video', BODY_REFERENCE_ONLY, 'omni'),
    ...(gap === 'switch' ? [mappingRow('kie', 'text_to_video', { prompt: '{{request.params.prompt}}' }), mappingRow('kie', 'image_to_video', BODY_RICH)] : []),
  ]
}

const HEALTH = {
  ok: true,
  counts: { vendors: 2, enabledVendors: 2, models: 8, enabledModels: 8, mappings: 0, enabledMappings: 0, enabledApiKeys: 2 },
  byKind: [{ kind: 'video' as const, enabledModels: 5, executableModels: 5 }, { kind: 'image' as const, enabledModels: 2, executableModels: 2 }],
  issues: [],
}

export type B3Scenario = {
  kind: 'video' | 'image'
  model: B3Model
  /** 档案里的方式 id（seedance-2：t2v / first / firstlast / omni）。缺省 = 档案默认。 */
  modeId?: string
  prompt?: string
  /** 连线进来的参考：画布上另有一张图节点，标题 = 素材名。 */
  edgeRefs?: readonly { name: string; mode?: GenerationCanvasEdgeMode }[]
  /** 上传 / 素材库放进来的参考（进参考数组）。 */
  arrayRefs?: readonly string[]
  /** 首尾帧里上传放进去的图。 */
  frames?: { first?: string; last?: string }
  /** 连进来的文字节点。 */
  textChip?: string
  /** 连进来的视频 / 音频节点个数（边界：全能参考放满 10 段视频 + 10 段音频）。 */
  edgeMedia?: { video?: number; audio?: number }
  /** 另有一家渠道提供同一个模型（B3o）。 */
  secondChannel?: boolean
  /** 渠道缺方式（B3p）：当前渠道只配了「参考」，发不出首帧 / 首尾帧。switch = 别家渠道能做（出换渠道的文字链接）；none = 谁都做不了。 */
  channelGap?: 'switch' | 'none'
  /** 打开后自动点一下的东西：参数面板 / 模型菜单 / 底栏方式菜单。 */
  open?: 'params' | 'model' | 'mode'
  /** 参数值覆盖（边界 K4：21:9 · 1080p · 15s 这种最长的一串）。 */
  params?: Record<string, unknown>
  /** 节点上留着的「放了 N 张，已改成 X」（输入变多、手选的方式放不下时 store 写的那条）。 */
  modeSwitchNotice?: { modeId: string; count: number }
  /** 失败态：整张错误卡盖住节点正文（E1d）。 */
  error?: string
  locale?: 'zh-CN' | 'en'
  /** 节点宽高（视觉大小）。 */
  size?: { width: number; height: number }
}

function buildNodes(scenario: B3Scenario): { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[]; targetId: string } {
  const spec = MODELS[scenario.model]
  const targetId = 'b3-target'
  const meta: Record<string, unknown> = {
    modelKey: spec.option.modelKey,
    modelAlias: spec.option.value,
    modelVendor: spec.option.vendor,
    vendor: spec.option.vendor,
    modelLabel: spec.option.label,
    ...(scenario.kind === 'video' ? { videoModel: spec.option.value, videoModelVendor: spec.option.vendor } : {}),
    archetype: { id: spec.archetype, ...(scenario.modeId ? { modeId: scenario.modeId } : {}), ...(spec.variantId ? { variantId: spec.variantId } : {}) },
    aspect_ratio: scenario.kind === 'video' ? '16:9' : '1:1',
    ...(scenario.kind === 'video' ? { duration: 5, resolution: '720p', generate_audio: true } : { resolution: '2K' }),
    ...(scenario.arrayRefs?.length ? { referenceImageUrls: scenario.arrayRefs.map(refUrl) } : {}),
    ...(scenario.frames?.first ? { firstFrameUrl: refUrl(scenario.frames.first) } : {}),
    ...(scenario.frames?.last ? { lastFrameUrl: refUrl(scenario.frames.last) } : {}),
    ...(scenario.modeSwitchNotice ? { modeSwitchNotice: scenario.modeSwitchNotice } : {}),
    ...scenario.params,
  }
  const target = {
    id: targetId,
    kind: scenario.kind,
    categoryId: 'shots',
    title: scenario.kind === 'video' ? '海边清晨' : '雨夜街口',
    prompt: scenario.prompt ?? '',
    position: { x: 0, y: 0 },
    size: scenario.size ?? { width: NODE_WIDTH, height: NODE_HEIGHT },
    status: scenario.error ? 'error' : 'idle',
    ...(scenario.error ? { error: scenario.error } : {}),
    meta,
  } as GenerationCanvasNode
  const sources: GenerationCanvasNode[] = (scenario.edgeRefs ?? []).map((ref, index) => ({
    id: `b3-src-${index}`,
    kind: 'image',
    categoryId: 'cast',
    title: ref.name,
    prompt: '',
    position: { x: -400, y: index * 140 },
    size: { width: 120, height: 90 },
    status: 'success',
    result: { id: `b3-src-${index}-r`, type: 'image', url: refUrl(ref.name), createdAt: 1 },
  } as GenerationCanvasNode))
  const textNodes: GenerationCanvasNode[] = scenario.textChip
    ? [{ id: 'b3-text', kind: 'text', categoryId: 'shots', title: scenario.textChip, prompt: '', position: { x: -400, y: 500 }, size: { width: 120, height: 90 }, status: 'success', result: { id: 'b3-text-r', type: 'text', text: scenario.textChip, createdAt: 1 } } as GenerationCanvasNode]
    : []
  const media: GenerationCanvasNode[] = (['video', 'audio'] as const).flatMap((kind) => Array.from({ length: scenario.edgeMedia?.[kind] ?? 0 }, (_, index) => ({
    id: `b3-${kind}-${index}`,
    kind,
    categoryId: 'shots',
    title: `${kind === 'video' ? '镜头' : '配乐'} ${index + 1}`,
    prompt: '',
    position: { x: -700, y: index * 140 },
    size: { width: 120, height: 90 },
    status: 'success',
    result: { id: `b3-${kind}-${index}-r`, type: kind, url: `${window.location.origin}/lab-media/${kind}-${index}.${kind === 'video' ? 'mp4' : 'mp3'}`, ...(kind === 'video' ? { thumbnailUrl: refUrl(`海边傍晚#v${index}`) } : {}), createdAt: 1 },
  } as GenerationCanvasNode)))
  const edges: GenerationCanvasEdge[] = [
    ...media.map((node, index): GenerationCanvasEdge => ({ id: `b3-edge-${node.id}`, source: node.id, target: targetId, mode: 'reference', order: 50 + index })),
    ...(scenario.edgeRefs ?? []).map((ref, index): GenerationCanvasEdge => ({ id: `b3-edge-${index}`, source: `b3-src-${index}`, target: targetId, mode: ref.mode ?? 'reference', order: index })),
    ...textNodes.map((node): GenerationCanvasEdge => ({ id: 'b3-edge-text', source: node.id, target: targetId, order: 99 })),
  ]
  return { nodes: [target, ...sources, ...media, ...textNodes], edges, targetId }
}

/** 提示词里的引用：`@[asset:url]`，名字由生产的 ReferenceNamesContext 现算。 */
export const mention = (name: string): string => `@[asset:${encodeURIComponent(refUrl(name))}]`

function useLabLocale(locale: B3Scenario['locale']): boolean {
  const { i18n } = useTranslation()
  // 证据脚本用 ?lang=en 把同一格再截一遍英文（格子本身只登记中文一份）。
  const override = new URL(window.location.href).searchParams.get('lang')
  const want = override === 'en' ? 'en' : locale ?? 'zh-CN'
  const [applied, setApplied] = React.useState(i18n.language === want)
  React.useLayoutEffect(() => {
    if (i18n.language === want) { setApplied(true); return undefined }
    setApplied(false)
    const release = holdDesignLabReady(`b3:locale:${want}`)
    void i18n.changeLanguage(want).then(() => { setApplied(true); release() })
    return release
  }, [i18n, want])
  return applied
}

export function ComposerB3Stage({ scenario }: { scenario: B3Scenario }): JSX.Element {
  const localeApplied = useLabLocale(scenario.locale)
  const { t } = useTranslation()
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => {
    void import('../../../workbench/generationCanvas/nodes/NodeGenerationComposer').then(() => setChunkReady(true))
  }, [])
  const built = React.useMemo(() => buildNodes(scenario), [scenario])
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    const videoOptions = [MODELS.seedance.option, (scenario.model === 'seedance25Apimart' ? MODELS.seedance25Apimart : MODELS.seedance25).option, MODELS.kling4.option, MODELS.wan.option, ...EXTRA_VIDEO_OPTIONS, ...(scenario.secondChannel || scenario.channelGap === 'switch' ? [SECOND_CHANNEL] : [])]
    const imageOptions = [MODELS.imagen.option, MODELS['gpt-image'].option, MODELS.soul.option]
    seedModelCatalogForTests(HEALTH, [
      { kind: 'video', requiredMode: 'text_to_video', options: videoOptions },
      { kind: 'video', requiredMode: 'image_to_video', options: videoOptions },
      { kind: 'image', requiredMode: 'text_to_image', options: imageOptions },
      { kind: 'image', requiredMode: 'image_edit', options: imageOptions },
    ])
    if (scenario.channelGap) {
      // 渠道 mapping 全表走桌面桥的 listMappings（和生产同一条取数口）；实验室只给这一个方法。
      ;(window as unknown as { nomiDesktop: unknown }).nomiDesktop = { modelCatalog: { listMappings: () => channelMappings(scenario.channelGap!) } }
    }
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({ nodes: built.nodes, edges: built.edges, selectedNodeIds: [built.targetId] })
    setReady(true)
  }, [built, scenario.secondChannel])
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === built.targetId))
  const stageRef = React.useRef<HTMLDivElement>(null)

  // 就绪旗等生成框真的长出来（懒加载的 chunk、模型目录、语言都到位）：不等的话截到的是只有节点卡的半成品。
  React.useEffect(() => {
    const release = holdDesignLabReady('b3:mounted')
    let frame = 0
    const tick = (): void => {
      const root = stageRef.current
      const done = Boolean(root?.querySelector('[data-node-composer-footer] [data-bar-segment="generate"], [data-node-composer-footer] [data-bar-segment="model-params"] button'))
      if (done || frame > 600) { release(); return }
      frame += 1
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return release
  }, [])

  // 展开态由取景台**真的点一下**得到（不是另画一份）：等那颗钮真的在了再点。悬停态由走查脚本用真鼠标停上去。
  const wanted = Boolean(scenario.open)
  const [acted, setActed] = React.useState(!wanted)
  // StrictMode 会把 effect 跑两遍：点两下 = 又收起来。只点一次。
  const clicked = React.useRef(false)
  React.useEffect(() => {
    if (acted || !ready || !chunkReady || !localeApplied || !node) return undefined
    const release = holdDesignLabReady('b3:act')
    let frame = 0
    const tick = (): void => {
      const root = stageRef.current
      if (!root) return
      if (scenario.open) {
        const selector = scenario.open === 'params' ? '[data-parameter-summary]' : 'button[role="combobox"][aria-label]:not([data-parameter-chip])'
        const modeLabel = t('generationCommon.modeMenu.heading')
        const trigger = scenario.open === 'params'
          ? root.querySelector<HTMLButtonElement>(selector)
          : scenario.open === 'mode'
            ? [...root.querySelectorAll<HTMLButtonElement>('[data-bar-segment="model-params"] button[aria-label]')].find((button) => button.getAttribute('aria-label') === modeLabel) ?? null
            : root.querySelector<HTMLButtonElement>('[data-bar-segment="model-params"] button')
        if (trigger) { if (!clicked.current) { clicked.current = true; trigger.click() } setActed(true); release(); return }
      }
      frame += 1
      if (frame < 240) requestAnimationFrame(tick)
      else release()
    }
    requestAnimationFrame(tick)
    return release
  }, [acted, ready, chunkReady, localeApplied, node, scenario, t])

  return (
    <div
      data-design-lab-stage="node-composer-b3"
      ref={stageRef}
      className="workbench-generation__canvas relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: B3_CELL_WIDTH, height: B3_CELL_HEIGHT }}
    >
      <LabCanvasViewport>
        {node && ready && chunkReady && localeApplied ? (
          <div className="absolute" style={{ left: NODE_LEFT, top: NODE_TOP }}>
            <BaseGenerationNode node={node} selected />
          </div>
        ) : null}
      </LabCanvasViewport>
    </div>
  )
}
