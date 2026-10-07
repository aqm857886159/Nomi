/**
 * [INPUT]: 依赖 ../model/generationCanvasTypes 的 GenerationCanvasNode、../nodes/director/model/directorNodeMeta 的 meta 键
 * [OUTPUT]: 对外提供 hasPendingDirectorStagingCapture、hasPendingDirectorCameraMoveCapture（含 3D-BOX 预演渲染中）
 * [POS]: 画布壳（GenerationCanvasReactFlow）决定要不要懒加载 director/agent 两个常驻出片 Host 的门：只有存在打了自动出图标志的 director 节点才挂，
 *        平时不把 three 世界拖进画布主 chunk。判定与 Host 内部扫描同一把键（directorNodeMeta），不各自写字符串。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { CAMERA_MOVE_AUTO_CAPTURE_META_KEY, DIRECTOR_NODE_KIND, STAGING_AUTO_CAPTURE_META_KEY } from '../nodes/director/model/directorNodeMeta'
import { readDirectorPreview } from '../nodes/director/model/directorPreviewState'

function hasObjectFlag(value: unknown): boolean {
  return Boolean(value && typeof value === 'object')
}

export function hasPendingDirectorStagingCapture(nodes: readonly GenerationCanvasNode[]): boolean {
  return nodes.some((node) => node.kind === DIRECTOR_NODE_KIND && hasObjectFlag(node.meta?.[STAGING_AUTO_CAPTURE_META_KEY]))
}

/** 运镜小片与 3D-BOX 整段预演共用同一个常驻 Host（CameraMoveCaptureHost 的两种请求），挂载门同一把。 */
export function hasPendingDirectorCameraMoveCapture(nodes: readonly GenerationCanvasNode[]): boolean {
  return nodes.some((node) => node.kind === DIRECTOR_NODE_KIND
    && (hasObjectFlag(node.meta?.[CAMERA_MOVE_AUTO_CAPTURE_META_KEY]) || readDirectorPreview(node)?.status === 'rendering'))
}
