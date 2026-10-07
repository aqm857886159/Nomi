/**
 * [INPUT]: 依赖 ../model/directorStore 的 DirectorStoreState、../model/programCamera 的 programCameraIdAt
 * [OUTPUT]: 对外提供 PipRect 类型、pipCameraIdOf
 * [POS]: director/scene 的画中画选台规则：播放 / 录制中 / 导演视图（followProgram）= 节目机位（无覆盖 → null 黑场）；
 *        停止时 = 手动指定（previewCameraId，store.select 选中机位 / 新建 / 下拉都会写它；选中角色 / 灯 / 物体不写）→ 播放头处的节目机位 → 正在 POV 的机位 → 选中机位 → 第一台。
 *        PipRenderer 与 DOM 侧 PipViewport 共用，保证画面与外壳看的是同一台。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorStoreState } from '../model/directorStore'
import { programCameraIdAt } from '../model/programCamera'

// 相对画布左上角的 CSS 像素矩形
export type PipRect = { x: number; y: number; width: number; height: number } | null

export function pipCameraIdOf(state: DirectorStoreState, options: { followProgram?: boolean } = {}): string | null {
  const scene = state.activeScene()
  // 导演视图的小窗只说一件事：播放头此刻在播哪一镜 → 永远是节目机位，不吃手动指定（那是精修里的下拉）
  if (options.followProgram || state.timeline.isPlaying || state.recording) return programCameraIdAt(state.timeline.currentTime, scene.cameras, scene.timelineTrackOrder)
  const has = (id: string | null | undefined): id is string => Boolean(id) && scene.cameras.some((camera) => camera.id === id)
  if (has(state.previewCameraId)) return state.previewCameraId
  const program = programCameraIdAt(state.timeline.currentTime, scene.cameras, scene.timelineTrackOrder)
  if (program) return program
  if (state.activeCameraId !== 'free' && has(state.activeCameraId)) return state.activeCameraId
  if (has(state.selection.cameraId)) return state.selection.cameraId
  return scene.cameras[0]?.id ?? null
}
