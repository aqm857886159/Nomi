/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 对外提供 DIRECTOR_NODE_KIND、DIRECTOR_PROJECT_META_KEY、STAGING_AUTO_CAPTURE_META_KEY、CAMERA_MOVE_AUTO_CAPTURE_META_KEY
 * [POS]: director/model 的画布节点 meta 键单一真相：节点卡片（DirectorNode）、迁移器、AI 来导的建节点 / 常驻 Host 都从这里取键名，
 *        谁也不 import 组件文件（避免 agent 路径把整个节点组件拖进来）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const DIRECTOR_NODE_KIND = 'director'
/** node.meta 里放导演台工程的键 */
export const DIRECTOR_PROJECT_META_KEY = 'directorProject'
/** AI 来导：站位参考待离屏出图的标志（{ targetNodeId? }） */
export const STAGING_AUTO_CAPTURE_META_KEY = 'stagingAutoCapture'
/** AI 来导：运镜参考待离屏出片的标志（{ targetNodeId?, fps, frameCount, move }） */
export const CAMERA_MOVE_AUTO_CAPTURE_META_KEY = 'cameraMoveAutoCapture'
