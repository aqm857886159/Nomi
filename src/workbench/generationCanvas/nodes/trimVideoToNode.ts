// 「直接剪辑」整动作（不碰 UI，剪辑面板的「确认」与失败卡的「重试」调用它）：
// 在原视频旁边**先**建一张新视频卡并连线（卡顶显示「剪辑中 · 62% [取消]」），本机 ffmpeg 把入点—出点精确切出来，成功后卡变成新视频。
//
// 规矩（与截帧同源，见 extractVideoFrameToNode.ts）：
//   · 卡 + 出处边是一个原子 store 动作（addDerivedOutput，规则表 'video-trim'），不自己写边；建卡一个撤销步（runAsSingleUndoStep）；
//   · 进度 / 结果 / 失败都回到**发起它的项目**（deliverRunOutcome：正打开就进画布，切走了就写那个项目的盘上副本）；
//   · 取消 = 当没发生过：杀 ffmpeg、删掉这张还没出片的新卡（与提取深度一致）；
//   · 失败 = 同一张卡变错误卡（本机处理失败，只留「重试」），卡上记着重试要用的全部事实；原视频不动；
//   · 本机处理，不扣费、不碰任何服务商。
import { resolveNodeVisualSize, readMediaDimensions } from './nodeSizing'
import { FOCUS_GENERATION_NODE_EVENT } from './nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { runAsSingleUndoStep } from '../quickActions/nodeInputActions'
import { deliverRunOutcome, whenRunTargetLoaded, type RunProjectTarget } from '../runner/runProjectDelivery'
import { clearTaskCancel, isTaskCancelRequested, onTaskCancelRequested } from '../runner/localTaskControl'
import { isProjectImportCancellation, withProjectAction } from '../../project/projectCanvasReadSurface'
import { getDesktopBridge } from '../../../desktop/bridge'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import { nodeRunOutcomePatch } from '../store/nodeRunOutcome'
import { localProcessingError } from '../../observability/localProcessingError'
import { videoTrimProgressPhase } from '../model/localProcessingPhase'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { frameTimecode, roundFrameSeconds } from './frameTimecode'
import i18n from '../../../i18n'

/** 剪辑区间（秒，已按 0.1 秒取整——和面板读数是同一个数）。 */
export type VideoTrimRange = { startSeconds: number; endSeconds: number }

export const MIN_TRIM_SECONDS = 0.1

export function normalizeTrimRange(range: VideoTrimRange): VideoTrimRange | null {
  const startSeconds = roundFrameSeconds(range.startSeconds)
  const endSeconds = roundFrameSeconds(range.endSeconds)
  return endSeconds - startSeconds >= MIN_TRIM_SECONDS - 1e-9 ? { startSeconds, endSeconds } : null
}

let jobSeq = 0

/** 正在跑的剪辑（卡 id → 叫停它的函数）：关窗 / 切走项目时一起叫停，不让 ffmpeg 白跑到收工。 */
const runningTrims = new Map<string, () => void>()
if (typeof window !== 'undefined') {
  // 窗口关掉：进程会随主进程一起没，但状态先收口（叫停 → 杀 ffmpeg）；存盘里留下的 running 由载入收口兜底（store/canvasSnapshotNormalizer）。
  window.addEventListener('pagehide', () => { for (const cancel of [...runningTrims.values()]) cancel() })
}
let txnSeq = 0

function progressMessage(percent: number | undefined): string {
  return percent === undefined ? i18n.t('generationCommon.videoTrim.starting') : i18n.t('generationCommon.videoTrim.running', { percent })
}

/** 开始一次剪辑。成功发起返回新卡 id；前置条件不满足（没项目 / 非桌面端 / 区间太短）toast 说清并返回 null。 */
export function startVideoTrim(source: GenerationCanvasNode, input: VideoTrimRange, reportFeedback: (message: string) => void): string | null {
  const videoUrl = source.result?.type === 'video' ? source.result.url : ''
  if (!videoUrl) return null
  const range = normalizeTrimRange(input)
  if (!range) {
    reportFeedback(i18n.t('generationCommon.videoTrim.tooShort'))
    return null
  }
  const project = withProjectAction((issued) => issued)
  if (!project) {
    reportFeedback(i18n.t('generationCommon.videoTrim.missingProject'))
    return null
  }
  if (!getDesktopBridge()?.video?.trim) {
    reportFeedback(i18n.t('generationCommon.videoTrim.desktopOnly'))
    return null
  }
  const size = resolveNodeVisualSize(source)
  const undoTxn = `video-trim-${Date.now()}-${(txnSeq += 1)}`
  const card = runAsSingleUndoStep(undoTxn, () => {
    const store = useGenerationCanvasStore.getState()
    const created = store.addDerivedOutput({
      sourceNodeId: source.id,
      kind: 'video-trim',
      mode: 'reference',
      node: {
        kind: 'video',
        title: i18n.t('generationCommon.videoTrim.cardTitle', {
          title: (source.title || i18n.t('generationCommon.node.extractFrame.defaultVideoTitle')).trim(),
          from: frameTimecode(range.startSeconds),
          to: frameTimecode(range.endSeconds),
        }),
        position: { x: source.position.x + size.width + 64, y: source.position.y },
        size: { width: size.width, height: size.height },
        categoryId: source.categoryId,
      },
    })
    if (!created) return null
    clearTaskCancel(created.id)
    store.updateNode(created.id, {
      status: 'running',
      meta: { ...(created.meta || {}), sourceVideoNodeId: source.id, trimStart: range.startSeconds, trimEnd: range.endSeconds },
    })
    store.setNodeProgress(created.id, { phase: videoTrimProgressPhase('running'), message: progressMessage(undefined), updatedAt: Date.now() })
    store.selectNode(created.id)
    return created
  })
  if (!card) return null
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: card.id } }))
  void runTrimOnCard({ cardId: card.id, videoUrl, range, target: project.binding, signalOf: project.signal, undoTxn, mediaDimensions: readMediaDimensions(source.meta?.videoWidth, source.meta?.videoHeight) ?? undefined })
  return card.id
}

/** 失败卡上的「重试」：同一张卡、同一段区间再剪一次（来源视频没了就如实报，不冒充）。 */
export function retryVideoTrim(cardId: string, reportFeedback: (message: string) => void): void {
  const store = useGenerationCanvasStore.getState()
  const card = store.nodes.find((candidate) => candidate.id === cardId)
  const sourceId = typeof card?.meta?.sourceVideoNodeId === 'string' ? card.meta.sourceVideoNodeId : ''
  const source = store.nodes.find((candidate) => candidate.id === sourceId)
  const videoUrl = source?.result?.type === 'video' ? source.result.url : ''
  const start = card?.meta?.trimStart
  const end = card?.meta?.trimEnd
  if (!card || !source || !videoUrl || typeof start !== 'number' || typeof end !== 'number') {
    reportFeedback(i18n.t('generationCommon.videoTrim.retrySourceGone'))
    return
  }
  const project = withProjectAction((issued) => issued)
  if (!project) {
    reportFeedback(i18n.t('generationCommon.videoTrim.missingProject'))
    return
  }
  clearTaskCancel(cardId)
  store.updateNode(cardId, { status: 'running', error: undefined })
  store.setNodeProgress(cardId, { phase: videoTrimProgressPhase('running'), message: progressMessage(undefined), updatedAt: Date.now() })
  void runTrimOnCard({ cardId, videoUrl, range: { startSeconds: start, endSeconds: end }, target: project.binding, signalOf: project.signal, mediaDimensions: readMediaDimensions(source.meta?.videoWidth, source.meta?.videoHeight) ?? undefined })
}

async function runTrimOnCard(input: {
  cardId: string
  videoUrl: string
  range: VideoTrimRange
  target: RunProjectTarget
  signalOf: AbortSignal
  /** 首次剪辑才有：成片落到卡上并进建卡那一个撤销步（见下）；重试没有。 */
  undoTxn?: string
  mediaDimensions?: { width: number; height: number }
}): Promise<void> {
  const { cardId, videoUrl, range, target, signalOf } = input
  const bridge = getDesktopBridge()?.video
  if (!bridge?.trim) return
  const jobId = `trim-${cardId}-${Date.now()}-${(jobSeq += 1)}`
  // 进度是给前台看的瞬态：原项目不在画布上时不写（那是别的项目的 store）。
  const whenVisible = (apply: () => void): void => { whenRunTargetLoaded(target, apply) }
  const unsubscribeProgress = bridge.onTrimProgress((event) => {
    if (event.jobId !== jobId) return
    const percent = Math.round(Math.max(0, Math.min(1, event.ratio)) * 100)
    whenVisible(() => useGenerationCanvasStore.getState().setNodeProgress(cardId, {
      phase: videoTrimProgressPhase('running'),
      message: progressMessage(percent),
      percent,
      updatedAt: Date.now(),
    }))
  })
  // 遮罩上的「取消」只在这张卡上登记一笔（localTaskControl），真正杀 ffmpeg 的是这里：登记一到立刻叫停主进程那一个任务。
  const cancelJob = (): void => { void bridge.cancelTrim({ jobId }).catch(() => undefined) }
  const unsubscribeCancel = onTaskCancelRequested(cardId, cancelJob)
  // 切走项目（原项目的签发信号中止）：旧任务立刻叫停——主进程发布前本来就会拒绝，但没必要让 ffmpeg 白跑完。
  signalOf.addEventListener('abort', cancelJob, { once: true })
  runningTrims.set(cardId, cancelJob)
  try {
    const result = await bridge.trim({ videoUrl, startSeconds: range.startSeconds, endSeconds: range.endSeconds, projectId: target.projectId, projectBinding: target, jobId })
    if (isTaskCancelRequested(cardId)) {
      // 取消按下时 ffmpeg 已经收尾：结果作废，当没发生过。
      whenVisible(() => useGenerationCanvasStore.getState().deleteNode(cardId))
      return
    }
    const createdAt = Date.now()
    const outcome = {
      kind: 'result' as const,
      result: { id: `video-trim-${createdAt}`, type: 'video' as const, url: result.url, ...(result.assetId ? { assetId: result.assetId } : {}), createdAt },
      ...(input.mediaDimensions ? { mediaDimensions: input.mediaDimensions } : {}),
    }
    // 正打开的原项目 + 首次剪辑：成片作为建卡那一步的一部分落下（updateNode 进建卡的撤销步），Ctrl+Z 一次连卡带线撤干净。
    // 不走 deliverRunOutcome 的 addNodeResult：那是「钱已花、撤销不许撤掉」的落地语义（撤销会把带结果的卡叠回来），
    // 而剪辑是本机免费处理，撤销就该整张卡都没有。切走了项目 / 重试：照旧走投递（盘上副本 / 已存在的卡）。
    const landedInTxn = input.undoTxn ? whenRunTargetLoaded(target, () => {
      const store = useGenerationCanvasStore.getState()
      const card = store.nodes.find((candidate) => candidate.id === cardId)
      if (card) withCanvasGestureContext({ source: 'user', txnId: input.undoTxn!, suppressUndoBarriers: true }, () => store.updateNode(cardId, nodeRunOutcomePatch(card, outcome)))
    }) : false
    if (!landedInTxn) await deliverRunOutcome(target, cardId, outcome)
    // 成功后不再补写任何 meta：那是一笔独立的可撤销写入，会把「卡 + 线」的撤销拆成两步（Ctrl+Z 只撤掉这笔）。
    // 「失败卡能不能重试」由卡上的事实推出（有区间、没有结果），不靠一个要事后清掉的旗。
  } catch (error) {
    if (isTaskCancelRequested(cardId)) {
      // 取消 = 当没发生过：这张卡从出生到现在没产出过任何东西，留着就是让用户替我们打扫。
      whenVisible(() => useGenerationCanvasStore.getState().deleteNode(cardId))
      return
    }
    if (signalOf.aborted || isProjectImportCancellation(error)) return
    const human = i18n.t('generationCommon.videoTrim.failed')
    const detail = error instanceof Error ? error.message : String(error)
    await deliverRunOutcome(target, cardId, { kind: 'status', status: 'error', error: localProcessingError(`${human}\n${detail}`) })
  } finally {
    unsubscribeProgress()
    unsubscribeCancel()
    signalOf.removeEventListener('abort', cancelJob)
    runningTrims.delete(cardId)
    clearTaskCancel(cardId)
  }
}
