import { beforeEach, describe, expect, it } from 'vitest'
import { NODE_KIND_DEFAULT_SIZE } from '../../../../electron/capabilityCore/nodeKindDomain'
import { parseAspectRatioValue } from '../../../../electron/shared/aspectRatioValue'
import { SEEDREAM_5_PRO_ARCHETYPE } from '../../../../electron/shared/modelArchetypes/seedream5Pro'
import { useWorkbenchStore } from '../../workbenchStore'
import { preferredVideoAspect } from '../nodes/aspectRatio'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { GENERATION_NODE_PLUGIN_BY_KIND } from '../nodes/registry'
import { publishCanvasStageSize } from './canvasVisibleArea'
import { useGenerationCanvasStore } from './generationCanvasStore'

// 特征测试 ①②（H-born 出生即定形）：
// - ① 用字面量期望（不调用被测函数反算）钉死 1280×800（视频/图片四件全露）与 1440×960（上移 ≤20px）的落点与视口不动；
// - ② 钉死受管种类（video 按产品默认 16:9，image 按默认生图模型 Seedream 5.0 Pro 的 1:1；keyframe 不在本次范围）
//     的注册默认尺寸 === 默认比例的渲染尺寸（0px 跳变），并与 electron 镜像表逐项一致。

const VIEW_1280x800 = {
  stage: { width: 1280, height: 716 },
  free: { left: 0, top: 0, width: 1280, height: 660 },
}
const VIEW_1440x960 = {
  stage: { width: 1440, height: 876 },
  free: { left: 0, top: 0, width: 1440, height: 820 },
}

describe('new node born-in-shape contract (H-born)', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ categoryViewports: { shots: { zoom: 1, offset: { x: 0, y: 0 } } } })
    useGenerationCanvasStore.setState({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  })

  describe('① landing geometry through addNode (literal bounds, no self-reference)', () => {
    it('1280×800: new video lands born at 420×236 with title clearance above and composer bottom above the dock', () => {
      publishCanvasStageSize(VIEW_1280x800.stage, VIEW_1280x800.free)
      const viewportBefore = { ...useWorkbenchStore.getState().categoryViewports }

      const node = useGenerationCanvasStore.getState().addNode({ kind: 'video', categoryId: 'shots' })

      expect(node.size).toEqual({ width: 420, height: 236 })
      expect(resolveNodeVisualSize(node)).toEqual({ width: 420, height: 236 })
      // free.bottom(660) - pad(16) - (nodeHeight 236 + gap 14 + initialComposer 220) = 174
      expect(node.position.y).toBe(174)
      // 标题小标签 + 节点顶距空地上沿留够空间（≥ 52px），底栏下沿不越空地底减 16px 留边（644）
      expect(node.position.y).toBeGreaterThanOrEqual(52)
      expect(node.position.y + 236 + 14 + 220).toBeLessThanOrEqual(644)
      expect(useWorkbenchStore.getState().categoryViewports).toEqual(viewportBefore)
    })

    it('1280×800: new image lands born at 340×340 with title clearance above and composer bottom above the dock', () => {
      publishCanvasStageSize(VIEW_1280x800.stage, VIEW_1280x800.free)
      const viewportBefore = { ...useWorkbenchStore.getState().categoryViewports }

      const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', categoryId: 'shots' })

      expect(node.size).toEqual({ width: 340, height: 340 })
      expect(resolveNodeVisualSize(node)).toEqual({ width: 340, height: 340 })
      // free.bottom(660) - pad(16) - (nodeHeight 340 + gap 14 + initialComposer 220) = 70
      expect(node.position.y).toBe(70)
      expect(node.position.y).toBeGreaterThanOrEqual(52)
      expect(node.position.y + 340 + 14 + 220).toBeLessThanOrEqual(644)
      expect(useWorkbenchStore.getState().categoryViewports).toEqual(viewportBefore)
    })

    it('1440×960: video lifts 0px and image lifts ≤20px relative to origin/main proportional baseline (245.28)', () => {
      publishCanvasStageSize(VIEW_1440x960.stage, VIEW_1440x960.free)

      const video = useGenerationCanvasStore.getState().addNode({ kind: 'video', categoryId: 'shots' })
      expect(video.position.y).toBeCloseTo(245.28, 2)
      expect(245.28 - video.position.y).toBeLessThanOrEqual(20)

      useGenerationCanvasStore.setState({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
      const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', categoryId: 'shots' })
      // free.bottom(820) - pad(16) - (340 + 14 + 220) = 230（相对 245.28 上移 15.28px ≤ 20px）
      expect(image.position.y).toBe(230)
      expect(245.28 - image.position.y).toBeLessThanOrEqual(20)

      useGenerationCanvasStore.setState({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
      const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', categoryId: 'shots' })
      expect(text.position.y).toBeCloseTo(245.28, 2)
    })

    it('landing reads the built node visual height (no +64 footprint inflation)', () => {
      publishCanvasStageSize(VIEW_1280x800.stage, VIEW_1280x800.free)

      // 显式指定 16:9 图片时，视觉高 = round(340 / (16/9)) = 191，不按 340+64 虚算。
      const wideImage = useGenerationCanvasStore.getState().addNode({
        kind: 'image',
        categoryId: 'shots',
        meta: { aspect_ratio: '16:9' },
      })
      // 660 - 16 - (191 + 14 + 220) = 219 > proportional 200.48 → 稳落在比例落点 200.48
      expect(wideImage.position.y).toBeCloseTo(200.48, 2)
    })
  })

  describe('② registered defaultSize matches default aspect ratio (0px jump) and mirrors electron nodeKindDomain', () => {
    const seedreamDefaultRatio = String(
      SEEDREAM_5_PRO_ARCHETYPE.modes
        .find((mode) => mode.id === SEEDREAM_5_PRO_ARCHETYPE.defaultModeId)
        ?.params.find((param) => param.key === 'size')
        ?.defaultValue ?? '',
    )

    // 本次受管范围：video（产品默认 16:9）与 image（默认模型 Seedream 5.0 Pro 1:1）；keyframe 不在本次范围。
    const managedCases: Array<{ kind: 'video' | 'image'; ratioText: string; metaKey: string }> = [
      { kind: 'video', ratioText: preferredVideoAspect([]), metaKey: 'aspect_ratio' },
      { kind: 'image', ratioText: seedreamDefaultRatio, metaKey: 'size' },
    ]

    it.each(managedCases)('$kind: registered defaultSize height === round(width / $ratioText) and has 0px jump once model writes aspect', ({ kind, ratioText, metaKey }) => {
      const ratio = parseAspectRatioValue(ratioText)
      expect(ratio).not.toBeNull()

      const srcDefault = GENERATION_NODE_PLUGIN_BY_KIND[kind].defaultSize
      const electronDefault = NODE_KIND_DEFAULT_SIZE[kind]

      expect(srcDefault.height).toBe(Math.round(srcDefault.width / ratio!))
      expect(electronDefault).toEqual(srcDefault)

      const beforeAutoSelect = resolveNodeVisualSize({ kind, size: srcDefault, meta: {} })
      const afterAutoSelect = resolveNodeVisualSize({ kind, size: srcDefault, meta: { [metaKey]: ratioText } })
      expect(beforeAutoSelect).toEqual(srcDefault)
      expect(afterAutoSelect).toEqual(beforeAutoSelect)
    })
  })
})
