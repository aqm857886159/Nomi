// 一份终态任务结果 → 落到节点上的结果：出片规范化 → 落进任务所属项目 → 图层分离的那一笔再收成一张白板。
// 生成那条路（catalogTaskActions）与找回那条路（recoverTaskActions）只走这一个函数，不各写一份。
//
// 图层分离（设计卡 docs/plan/2026-11-26-layer-split.md）：主进程按线缆声明读出的 `result.layers` 与产物按下标平行；
// 有它 = 这一笔是「底图 + 各层」，落成**一个**结果：地址是合成图（节点上看到的、下游拿去当参考的都是它），
// `raw.whiteboardState` 是可编辑的白板（与「完成」存的同一个形状，readWhiteboardEditingState 读它）。
// 任何一步没成（各层没落进项目、读不出底图、合成或存盘失败）→ 挂取回阶段（可找回），不判失败、不当普通多张落、不猜比例。
import i18n from '../../../i18n'
import { tagNomiError } from '../../../../electron/shared/nomiErrorCodes'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'
import type { TaskResultDto } from '../../api/taskApi'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { persistNodeMediaFile } from '../adapters/persistNodeImage'
import { buildLayerSplitBoard, layerSplitBaseIndex, layerSplitCompositePixelRatio } from '../nodes/whiteboard/layerSplitBoard'
import { LAYER_SPLIT_RAW_KEY, loadImageSize, serializeWhiteboardState, type LayerSplitResultMark } from '../nodes/whiteboard/whiteboardState'
import { renderWhiteboardStatePreview } from '../nodes/whiteboard/whiteboardStatePreview'
import type { MediaDimensions } from '../nodes/nodeSizing'
import { normalizeCatalogTaskResults, type GenerationNodeResults } from './catalogTaskResultParse'
import { isRemoteHttpUrl, localizeRemoteResultUrl } from './resultAssetLocalization'

export type LandTaskResultsDeps = {
  /** 测试注入：合成白板（默认 renderWhiteboardStatePreview）。 */
  renderBoard?: typeof renderWhiteboardStatePreview
  /** 测试注入：读底图像素（默认 loadImageSize）。 */
  readImageSize?: typeof loadImageSize
  /** 测试注入：存合成图（默认 persistNodeMediaFile）。 */
  persist?: typeof persistNodeMediaFile
}

function landFailed(detail: string): Error {
  return new Error(tagNomiError('retrieval-download', `${i18n.t('generationCommon.error.layerSplitLandFailed')} (${detail})`))
}

async function foldLayerSplit(
  result: TaskResultDto,
  localized: readonly GenerationNodeResult[],
  node: GenerationCanvasNode,
  project: ProjectBinding,
  onMediaDimensions: ((dimensions: MediaDimensions) => void) | undefined,
  deps: LandTaskResultsDeps,
): Promise<GenerationNodeResults> {
  const layers = result.layers!
  if (layers.length !== localized.length) {
    throw new Error(tagNomiError('retrieval-parse', `${i18n.t('generationCommon.error.layerSplitLandFailed')} (${layers.length} layers, ${localized.length} images)`))
  }
  // 各层必须都已落进项目：白板里存供应商临时地址，隔天就打不开。
  if (localized.some((item) => !item.url || isRemoteHttpUrl(item.url))) throw landFailed('layer not saved locally')
  const baseIndex = layerSplitBaseIndex(layers)
  const base = localized[baseIndex]!
  const readSize = deps.readImageSize ?? loadImageSize
  const baseSize = await readSize(base.url!)
  if (!baseSize) throw landFailed('base image unreadable')
  // 各层自己的像素：判它是裁到框的小图还是整幅透明图（读不出 = 按框摆，与说明一致）。
  const sizes = await Promise.all(localized.map((item, index) => (index === baseIndex ? baseSize : readSize(item.url!))))
  const board = buildLayerSplitBoard({
    pieces: layers.map((layer, index) => ({ layer, url: localized[index]!.url!, size: sizes[index] })),
    baseSize,
    baseName: i18n.t('generationCommon.whiteboard.baseImage'),
    fallbackName: (n) => i18n.t('generationCommon.whiteboard.splitLayerName', { n }),
  })
  let persisted: Awaited<ReturnType<typeof persistNodeMediaFile>>
  try {
    const blob = await (deps.renderBoard ?? renderWhiteboardStatePreview)(board, {
      pixelRatio: layerSplitCompositePixelRatio(board.canvasDimensions!, baseSize),
    })
    const file = new File([blob], `layer-split-${node.id}.png`, { type: 'image/png' })
    // 落进任务自己的项目（与产物本地化同一个口径：切了项目也落原项目），不看此刻前台是谁。
    persisted = await (deps.persist ?? persistNodeMediaFile)(file, node.id, {
      binding: project, signal: new AbortController().signal, assertCurrent: () => {},
    })
  } catch (error) {
    throw landFailed(error instanceof Error ? error.message : String(error))
  }
  if (!persisted) throw landFailed('composite not saved')
  onMediaDimensions?.(baseSize)
  const { url: _baseUrl, thumbnailUrl: _thumb, previewState: _state, providerUrl: _provider, assetId: _asset, assetRefId: _ref, raw: _raw, ...rest } = localized[0]!
  return [{
    ...rest,
    type: 'image',
    taskKind: 'image',
    ...persisted,
    raw: { whiteboardState: serializeWhiteboardState(board), [LAYER_SPLIT_RAW_KEY]: { layers: layers.length } satisfies LayerSplitResultMark },
  }]
}

/**
 * 终态结果落地（两条路共用）。普通结果：每张一份、各自落进项目，尺寸照每张回报（行为与拆出本函数前逐项相同）。
 * 图层分离：只回报底图尺寸，收成一个结果。
 */
export async function landTaskResults(
  result: TaskResultDto,
  node: GenerationCanvasNode,
  project: ProjectBinding,
  onMediaDimensions?: (dimensions: MediaDimensions) => void,
  deps: LandTaskResultsDeps = {},
): Promise<GenerationNodeResults> {
  const layered = Boolean(result.status !== 'failed' && result.layers?.length)
  const report = layered ? undefined : onMediaDimensions
  const [first, ...rest] = normalizeCatalogTaskResults(result, node, report)
  // 结构闸：主进程漏本地化时，按任务所属项目补一次（每张都补），绝不让厂商临时 URL 落进节点。主进程已落地时零开销 no-op。
  const localize = (item: GenerationNodeResult) => localizeRemoteResultUrl(item, project.projectId, node.id, report)
  const localized = await Promise.all([localize(first), ...rest.map(localize)])
  if (layered) return foldLayerSplit(result, localized, node, project, onMediaDimensions, deps)
  return [localized[0]!, ...localized.slice(1)]
}
