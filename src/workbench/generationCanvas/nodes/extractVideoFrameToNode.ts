// 「从视频截一帧（当前帧 / 首帧 / 尾帧）→ 旁边落一张图片卡并连线」整动作（不碰 UI，浮条与失败卡的「重试」调用它）。
// 复用抽帧 IPC（window.nomiDesktop.video.extractFrame，which:'first'|'last'|秒数）——纯基建，主进程早就认任意秒数。
// 抽出的是真实图片 URL（nomi-local://），建一张**已带结果**的图片卡，用户可直接拿去当任何参考/首尾帧。
//
// 落卡的规矩：
//   · 卡 + 出处边是一个原子 store 动作（addDerivedOutput，规则表 'video-frame'），不自己写边；
//   · 卡、边、结果在**一个撤销步**里落下（runAsSingleUndoStep）——Ctrl+Z 一次撤干净；落卡发生在抽帧**之后**，
//     所以事务里没有 await，没有「半截卡」；
//   · 抽帧失败：新卡变一张错误卡（本机处理失败，只留「重试」，原视频不动），不留空壳；失败卡自带重试所需的全部事实
//     （meta.sourceVideoNodeId / sourceFrame / sourceTime），重试 = 对同一张卡再抽一次。
import { FOCUS_GENERATION_NODE_EVENT, resolveNodeVisualSize } from './nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { runAsSingleUndoStep } from '../quickActions/nodeInputActions'
import { isProjectImportCancellation, withProjectAction } from '../../project/projectCanvasReadSurface'
import { getDesktopBridge } from '../../../desktop/bridge'
import { localProcessingError } from '../../observability/localProcessingError'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { frameTimecode, roundFrameSeconds } from './frameTimecode'
import i18n from '../../../i18n'

/** 取哪一帧：首帧、尾帧，或播放头停的那一秒（已按 0.1 秒取整，和菜单上显示的是同一个数）。 */
export type VideoFrameRequest = 'first' | 'last' | { atSeconds: number }

type FrameKind = 'first' | 'last' | 'time'

const frameKindOf = (request: VideoFrameRequest): FrameKind => (typeof request === 'string' ? request : 'time')

function frameLabel(request: VideoFrameRequest): string {
  if (typeof request === 'string') return i18n.t(`generationCommon.node.extractFrame.${request}`)
  return i18n.t('generationCommon.node.extractFrame.current', { time: frameTimecode(request.atSeconds) })
}

/** 抽帧 IPC 的 which：数字就是秒数。 */
const ipcWhich = (request: VideoFrameRequest): 'first' | 'last' | number => (typeof request === 'string' ? request : request.atSeconds)

function knownDurationOf(node: GenerationCanvasNode): number | undefined {
  const candidates = [node.result?.durationSeconds, node.meta?.videoDuration, node.meta?.durationSeconds]
  return candidates.find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
}

/** 新卡上记下的来源事实（失败卡的重试、以及「这张图来自哪一秒」都读它）。 */
function sourceMeta(source: GenerationCanvasNode, request: VideoFrameRequest): Record<string, unknown> {
  const kind = frameKindOf(request)
  const duration = knownDurationOf(source)
  const time = typeof request !== 'string'
    ? request.atSeconds
    : request === 'first'
      ? 0
      : duration !== undefined ? Math.max(0, roundFrameSeconds(duration - 0.1)) : undefined
  return { sourceVideoNodeId: source.id, sourceFrame: kind, ...(time !== undefined ? { sourceTime: time } : {}) }
}

/**
 * 失败文案 = 第一行人话（标题）+ 其后的技术细节（只进失败卡的「技术详情」）。
 * 带本机处理码：这一步在本机，失败卡只留「重试」。
 */
function failureMessage(human: string, error?: unknown): { human: string; stored: string } {
  // 技术细节原样留给「技术详情」（IPC 外壳不在这里剥：分类器只在展示用的首行剥它，raw 保留原样）。
  const detail = error === undefined ? '' : error instanceof Error ? error.message : String(error)
  return { human, stored: localProcessingError(detail ? `${human}\n${detail}` : human) }
}

let txnSeq = 0

export async function extractVideoFrameToNode(node: GenerationCanvasNode, request: VideoFrameRequest, reportFeedback: (message: string) => void): Promise<void> {
  const videoUrl = node.result?.url
  if (node.result?.type !== 'video' || !videoUrl) return
  const label = frameLabel(request)

  // 动作起点签发原项目：抽帧落盘、落节点都只认这一份，换项目即取消（不在新项目落节点、不报迟到的错）。
  const project = withProjectAction((issued) => issued)
  if (!project) {
    reportFeedback(i18n.t('generationCommon.node.extractFrame.missingProject'))
    return
  }
  const extractFrame = getDesktopBridge()?.video?.extractFrame
  if (!extractFrame) {
    reportFeedback(i18n.t('generationCommon.node.extractFrame.desktopOnly'))
    return
  }

  let url = ''
  let failure: { human: string; stored: string } | null = null
  try {
    const result = await extractFrame({ videoUrl, which: ipcWhich(request), projectId: project.binding.projectId, projectBinding: project.binding })
    project.assertCurrent()
    url = result?.url || ''
    if (!url) failure = failureMessage(i18n.t('generationCommon.node.extractFrame.empty'))
  } catch (error) {
    if (project.signal.aborted || isProjectImportCancellation(error)) return
    failure = failureMessage(i18n.t('generationCommon.node.extractFrame.failed'), error)
  }

  const size = resolveNodeVisualSize(node)
  const createdAt = Date.now()
  const meta = sourceMeta(node, request)
  const created = runAsSingleUndoStep(`video-frame-${createdAt}-${(txnSeq += 1)}`, () => {
    const store = useGenerationCanvasStore.getState()
    const card = store.addDerivedOutput({
      sourceNodeId: node.id,
      kind: 'video-frame',
      mode: 'reference',
      node: {
        kind: 'image',
        title: i18n.t('generationCommon.node.extractFrame.nodeTitle', {
          title: (node.title || i18n.t('generationCommon.node.extractFrame.defaultVideoTitle')).trim(),
          frame: label,
        }),
        position: { x: node.position.x + size.width + 64, y: node.position.y + (request === 'last' ? size.height / 2 + 24 : 0) },
        categoryId: node.categoryId,
      },
    })
    if (!card) return null
    store.updateNode(card.id, failure === null
      // 抽出的帧本身就是成品图 → 直接落 result，新节点立即可见、可当参考，无需再生成。
      ? { result: { id: `frame-${frameKindOf(request)}-${createdAt}`, type: 'image', url, createdAt }, status: 'success', meta: { ...(card.meta || {}), ...meta } }
      // 失败：这张新卡就是错误卡（本机处理失败，只留重试）；原视频没动。
      : { status: 'error', error: failure.stored, meta: { ...(card.meta || {}), ...meta, retryableFrame: true } })
    store.selectNode(card.id)
    return card
  })
  if (!created) {
    reportFeedback(failure?.human ?? i18n.t('generationCommon.node.extractFrame.failed'))
    return
  }
  // 失败时那张新的错误卡自己就是回执（标题 = 失败原因），不再往原视频卡下面补一条重复的提示。
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: created.id } }))
  }
}

/** 失败卡上的「重试」：对同一张卡再抽一次（来源视频 / 取哪一帧都读卡上记着的事实；来源视频没了就如实报，不冒充）。 */
export async function retryVideoFrameCapture(cardId: string, reportFeedback: (message: string) => void): Promise<void> {
  const store = useGenerationCanvasStore.getState()
  const card = store.nodes.find((candidate) => candidate.id === cardId)
  const sourceId = typeof card?.meta?.sourceVideoNodeId === 'string' ? card.meta.sourceVideoNodeId : ''
  const frame = card?.meta?.sourceFrame
  const source = store.nodes.find((candidate) => candidate.id === sourceId)
  const videoUrl = source?.result?.type === 'video' ? source.result.url : ''
  if (!card || !videoUrl || (frame !== 'first' && frame !== 'last' && frame !== 'time')) {
    reportFeedback(i18n.t('generationCommon.node.extractFrame.retrySourceGone'))
    return
  }
  const time = card.meta?.sourceTime
  const request: VideoFrameRequest = frame === 'time' ? { atSeconds: typeof time === 'number' ? time : 0 } : frame
  const project = withProjectAction((issued) => issued)
  const extractFrame = getDesktopBridge()?.video?.extractFrame
  if (!project || !extractFrame) {
    reportFeedback(i18n.t(project ? 'generationCommon.node.extractFrame.desktopOnly' : 'generationCommon.node.extractFrame.missingProject'))
    return
  }
  store.updateNode(cardId, { status: 'idle', error: undefined })
  try {
    const result = await extractFrame({ videoUrl, which: ipcWhich(request), projectId: project.binding.projectId, projectBinding: project.binding })
    project.assertCurrent()
    if (!result?.url) throw new Error(i18n.t('generationCommon.node.extractFrame.empty'))
    const createdAt = Date.now()
    useGenerationCanvasStore.getState().updateNode(cardId, {
      result: { id: `frame-${frame}-${createdAt}`, type: 'image', url: result.url, createdAt },
      status: 'success',
      error: undefined,
      meta: { ...(card.meta || {}), retryableFrame: false },
    })
  } catch (error) {
    if (project.signal.aborted || isProjectImportCancellation(error)) return
    const message = failureMessage(i18n.t('generationCommon.node.extractFrame.failed'), error)
    // 失败卡自己就是回执，不重复提示。
    useGenerationCanvasStore.getState().updateNode(cardId, { status: 'error', error: message.stored })
  }
}
