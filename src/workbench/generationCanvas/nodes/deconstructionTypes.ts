// 拆解视频的**结果驱动、调用者无关**状态模型（方案 R-C-5/R-C-7 的落点）。
//
// 关键设计：拆解结果按**源视频节点身份（nodeId）**建槽，而不是按「面板 open 布尔」。
// 这样同一条视频无论从哪个入口拆——v1 的节点浮条、M 线后的 Agent 工具——都写回**同一个槽**、
// 渲染进**同一张卡**（R-C-7 双入口汇聚同一张卡）。现在把这个接缝留对，M 线接线不返工。

/** 引擎回来的单镜结构（镜像 electron/video/deconstructVideo.ts 的 DeconstructShot，桥的投影形状）。 */
export type DeconstructionShot = {
  index: number
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  /** 原片帧（该镜中点那张）：只读对照缩略图。 */
  sourceFrameUrl: string
  shotSize: string
  mood: string
  visual: string
  onScreenText: string
  dialogue: string
  /** 上一镜的话说到了这一镜 → UI 标「承接上镜」。 */
  carriedOver: boolean
  imagePrompt: string
  motionPrompt: string
  custom: Record<string, string>
  /** 这一镜画面分析没成功（其余字段仍可用）。诚实标出，不假装成功。 */
  visionFailed?: boolean
}

/** 引擎整批结果（镜像 DeconstructVideoResult）。 */
export type DeconstructionResult = {
  shots: DeconstructionShot[]
  durationSeconds: number
  hasAudio: boolean
  /** 画面分析失败的镜号（诚实回报，UI 据此提示可单独重试）。 */
  failedShotIndexes: number[]
}

/** 存进 GenerationCanvasNode.meta 的键：拆解结果随节点走（图片/运镜提示词随节点走，方案 §3.1）。 */
export const NODE_DECONSTRUCTION_META_KEY = 'videoDeconstruction'

/** 从节点 meta 读回拆解结果（供收起态角标 / 重开面板复用，绝不重复拆）。 */
export function readNodeDeconstruction(meta: Record<string, unknown> | undefined): DeconstructionResult | null {
  if (!meta) return null
  const raw = meta[NODE_DECONSTRUCTION_META_KEY]
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as { shots?: unknown }
  return Array.isArray(candidate.shots) ? (raw as DeconstructionResult) : null
}
