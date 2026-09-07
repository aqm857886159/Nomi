/**
 * 「提取深度」整动作：选中一段视频 → 旁边长出一个新视频节点 → 它自己跑完把深度视频填进去。
 *
 * 它不是 React hook，是一个普通异步函数——和「抽首/尾帧」「按镜头拆」同一族
 * （extractVideoFrameToNode / extractShotCutsToNodes）。这不是风格选择，是必需的：
 * 发起动作的浮条只在**源节点被选中时**存在，用户点完随手点一下空白处它就卸载了。
 * 把运行挂在组件生命周期上，等于「点了开始别乱动鼠标」——2026-09-07 改形态前那一版
 * （useVideoDepthRun）正是这样，因为当时发起者和产物是同一个节点，卸载即取消恰好说得通。
 *
 * 状态怎么落：全部走**既有边界**，本动作不给节点新增任何字段。
 *   · 进度 → setNodeProgress（phase 用 `video-depth-*`，NodeGeneratingOverlay 据此走「活进度」那一档）
 *   · 活预览帧 → nodeLivePreviewStore（会话瞬态，不进 store 大图、不落盘 · R17）
 *   · 产物 → addNodeResult（就是一个普通视频结果，能拖进任何模型的参考槽）
 *   · 取消 → localTaskControl 的同一个登记表（遮罩上那颗取消按钮的唯一入口）
 *
 * 取消 = 把这个派生节点删掉。它从出生到取消之间没产出过任何东西，留一张空卡在画布上
 * 等于要求用户替我们打扫。
 *
 * 2026-09-07 用户拍板砍掉面板之后，这个函数**不再收参数**：输出只有一种，配方是
 * `VIDEO_DEPTH_RECIPE`（见 electron/shared/canvas/videoDepth.ts 文件头）。
 * 用户点一下「提取深度」，剩下的全在这条链上。
 */
import { getDesktopBridge } from '../../../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useNodeLivePreviewStore } from '../store/nodeLivePreviewStore'
import { clearTaskCancel, isTaskCancelRequested } from '../runner/localTaskControl'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { toast } from '../../../ui/toast'
import i18n from '../../../i18n'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { createVideoDepthWorkerChannel, runVideoDepth } from './videoDepthClient'
import { videoDepthDerivedPosition, videoDepthDerivedTitle, videoDepthSourceFromNode } from './videoDepthDerivation'
import { formatVideoDepthEta, formatVideoDepthMegabytes, videoDepthProgressView } from './videoDepthNodeModel'
import { videoDepthProgressPhase } from './videoDepthProgressPhase'
import { encodeVideoDepthPreviewUrl } from './videoDepthPreviewFrame'
import type { VideoDepthRunState } from '../../../../electron/shared/canvas/videoDepthRun'

/** 一次运行里进度文案要说的话。抽出来是因为「阶段名 + 进度 + 预计剩余」这三段在两处要一致地拼。 */
function progressMessage(state: VideoDepthRunState): string {
  const phase = i18n.t(`videoDepth.phase.${state.phase}` as 'videoDepth.phase.processing')
  const view = videoDepthProgressView(state)
  if (view.etaSeconds === undefined) return phase
  return `${phase} · ${i18n.t('videoDepth.progress.eta', { eta: formatVideoDepthEta(view.etaSeconds) })}`
}

export type VideoDepthDerivationHandle = {
  /** 派生出来的那个节点。这次运行的每一段进度都长在它身上，发起方不用再自己存一份。 */
  derivedNodeId: string
  done: Promise<void>
}

/**
 * 发起一次派生。**同步**建好节点并连线后才把耗时那段丢出去——用户点下「提取深度」的那一刻
 * 画布上就该多出一张卡（占位先到、内容后填），而不是等抽帧抽完才有反应。
 *
 * 前置条件不满足时返回 null 并 toast 说清原因，不静默什么都不做。
 */
export function startVideoDepthDerivation(sourceNode: GenerationCanvasNode): VideoDepthDerivationHandle | null {
  const source = videoDepthSourceFromNode(sourceNode)
  if (!source) return null

  const projectId = getActiveWorkbenchProjectId()
  if (!projectId) {
    toast(i18n.t('generationCommon.node.extractFrame.missingProject'), 'error')
    return null
  }
  const bridge = getDesktopBridge()?.videoDepth
  if (!bridge) {
    toast(i18n.t('videoDepth.action.desktopOnly'), 'error')
    return null
  }

  const store = useGenerationCanvasStore.getState()
  const sourceSize = resolveNodeVisualSize(sourceNode)
  const derived = store.addNode({
    // 产物就是一段视频，所以它就是一个**普通视频节点**——不是第三种节点类型。
    // 用户之后能像对待任何视频那样对它：播、下载、抽帧、再提一次深度、拖进参考槽。
    kind: 'video',
    title: videoDepthDerivedTitle(source.title, i18n.t('videoDepth.action.productSuffix')),
    position: videoDepthDerivedPosition(sourceNode.position, sourceSize),
    size: { width: sourceSize.width, height: sourceSize.height },
    categoryId: sourceNode.categoryId,
  })
  store.connectNodes(sourceNode.id, derived.id, 'reference')
  store.selectNode(derived.id)

  const nodeId = derived.id
  clearTaskCancel(nodeId)
  store.setNodeStatus(nodeId, 'running')
  store.setNodeProgress(nodeId, {
    phase: videoDepthProgressPhase('downloading'),
    message: i18n.t('videoDepth.phase.downloading'),
    updatedAt: Date.now(),
  })

  const done = runDerivation({ bridge, projectId, nodeId, source })
  return { derivedNodeId: nodeId, done }
}

async function runDerivation(input: {
  bridge: NonNullable<ReturnType<typeof getDesktopBridge>>['videoDepth']
  projectId: string
  nodeId: string
  source: { sourceUrl: string }
}): Promise<void> {
  const { bridge, projectId, nodeId, source } = input

  // 抽帧与权重下载这两段渲染层看不见（只有主进程知道），所以它们从事件通道来。
  // 走同一份 reducer 汇进同一个进度，不是第二份进度模型。
  const unsubscribe = bridge.onEvent((event) => {
    if (event.nodeId !== nodeId) return
    const percent =
      event.doneBytes !== undefined && event.totalBytes && event.totalBytes > 0
        ? Math.round((event.doneBytes / event.totalBytes) * 100)
        : undefined
    useGenerationCanvasStore.getState().setNodeProgress(nodeId, {
      phase: videoDepthProgressPhase(event.phase),
      // 首次要下约 50MB 权重。「下载模型 47 MB… 38%」比「正在下载模型权重」多说的那两个数
      // 正是用户此刻唯一想知道的：**要下多少、下到哪了**。它和推理进度共用卡顶那一条，
      // 不弹窗、不另起一段说明——用户点的是这张卡上的动作，答案就该回在这张卡上。
      message:
        event.phase === 'downloading' && event.totalBytes
          ? i18n.t('videoDepth.progress.download', {
              size: formatVideoDepthMegabytes(event.totalBytes),
              percent: percent ?? 0,
            })
          : i18n.t(`videoDepth.phase.${event.phase}` as 'videoDepth.phase.downloading'),
      ...(percent === undefined ? {} : { percent }),
      updatedAt: Date.now(),
    })
  })

  /** 上一张缩略图的 objectURL。换图与收场都要 revoke，否则整段片子的帧会一张不落地留在内存里。 */
  let previewUrl: string | null = null
  /** 编码是异步的，最后一批的图可能在收场之后才到。到了就扔，别把一张鬼图挂回已经出片的节点上。 */
  let finished = false

  try {
    const finalState = await runVideoDepth(
      { projectId, nodeId, sourceUrl: source.sourceUrl },
      {
        bridge,
        createWorker: createVideoDepthWorkerChannel,
        shouldCancel: () => isTaskCancelRequested(nodeId),
        onState: (state) => {
          const view = videoDepthProgressView(state)
          useGenerationCanvasStore.getState().setNodeProgress(nodeId, {
            phase: videoDepthProgressPhase(state.phase),
            message: progressMessage(state),
            ...(view.percent === undefined ? {} : { percent: view.percent }),
            updatedAt: Date.now(),
          })
        },
        onPreviewFrame: (frame) => {
          void encodeVideoDepthPreviewUrl(frame).then((url) => {
            if (!url) return
            if (finished) { URL.revokeObjectURL(url); return }
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            previewUrl = url
            useNodeLivePreviewStore.getState().setPreview(nodeId, url)
          })
        },
      },
    )

    const store = useGenerationCanvasStore.getState()
    if (finalState.phase === 'done' && finalState.result) {
      store.setNodeProgress(nodeId, undefined)
      store.addNodeResult(nodeId, {
        id: `video-depth-${Date.now()}`,
        type: 'video',
        url: finalState.result.url,
        ...(finalState.result.assetId ? { assetId: finalState.result.assetId } : {}),
        createdAt: Date.now(),
      })
      return
    }
    if (finalState.phase === 'cancelled') {
      // 取消 = 当没发生过：这张卡从出生到现在没产出任何东西，留着就是让用户替我们打扫。
      store.deleteNode(nodeId)
      return
    }
    store.setNodeProgress(nodeId, undefined)
    store.setNodeStatus(
      nodeId,
      'error',
      finalState.error
        ? i18n.t(`videoDepth.error.${finalState.error.code}` as 'videoDepth.error.media-failed')
        : i18n.t('videoDepth.error.inference-failed'),
    )
  } finally {
    finished = true
    unsubscribe()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    useNodeLivePreviewStore.getState().clearPreview(nodeId)
    clearTaskCancel(nodeId)
  }
}
