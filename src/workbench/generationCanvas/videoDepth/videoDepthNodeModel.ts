/**
 * 「提取深度」—— 进度的纯模型层（无 React、无 store、无 IPC）。
 *
 * 界面要回答的问题只剩一个，而它是纯函数能答的：这次运行该在派生卡上显示成什么样。
 * 放在这里而不是组件里，是为了让它能被单测钉住——界面本身只剩「把答案画出来」。
 *
 * ── 这里曾经还有什么、为什么没了 ────────────────────────────────────────────────
 * · `collectVideoDepthSourceCandidates`（「画布上有哪些视频能当源」）随「深度不是一种节点、
 *   是视频节点上的一个动作」一起删了——源就是用户选中的那一个，不再需要挑。
 * · `readVideoDepthSettings` / `videoDepthSettingsPatch` / `VIDEO_DEPTH_META_KEY`
 *   （节点身上那份参数 meta）随 2026-09-07 的第二次砍一起删了：它唯一的读者是小面板的
 *   「上次选了什么」回填，面板没了，这份 meta 就只剩写没有读。写而没人读的状态比没有更糟——
 *   下一个人会以为界面上某处在显示它（P1）。这次跑用什么档，答案在 `VIDEO_DEPTH_RECIPE`。
 * · `isVideoDepthBusy` 同理：它是给「面板上的参数要不要禁用」用的，面板没了就没有调用方。
 *
 * 「进度 phase 怎么拼」搬去了 videoDepthProgressPhase.ts（那条环的说明见该文件）。
 */
import type { VideoDepthPhase, VideoDepthRunState } from '../../../../electron/shared/canvas/videoDepthRun'

/**
 * 这次运行在派生卡上显示成什么样。百分比缺失时返回 undefined——**不画一根假的进度条**。
 *
 * 只留 phase / percent / etaSeconds 三样：卡顶那一条报的是「阶段名 · 预计还要 m:ss」
 * 加一根确定进度，逐帧/逐字节的分子分母没有消费方了。
 */
export type VideoDepthProgressView = {
  phase: VideoDepthPhase
  percent?: number
  etaSeconds?: number
}

export function videoDepthProgressView(state: VideoDepthRunState): VideoDepthProgressView {
  const progress = state.progress
  if (!progress) return { phase: state.phase }
  if (progress.kind === 'bytes') {
    return {
      phase: state.phase,
      percent: progress.totalBytes > 0 ? Math.round((progress.doneBytes / progress.totalBytes) * 100) : undefined,
    }
  }
  return {
    phase: state.phase,
    percent: progress.totalFrames > 0 ? Math.round((progress.doneFrames / progress.totalFrames) * 100) : undefined,
    etaSeconds: progress.etaSeconds ?? undefined,
  }
}

/** 秒数格式化成 `m:ss`，给「预计还要多久」用。 */
export function formatVideoDepthEta(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`
}

/** 下载权重那一段的「已下 / 共多少」。整数 MB——小数点后一位在 28px 高的进度条里只是噪声。 */
export function formatVideoDepthMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
