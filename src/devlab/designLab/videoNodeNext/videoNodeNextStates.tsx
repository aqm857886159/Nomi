// 设计实验室 · 屏「视频节点的下一步（截帧 / 剪辑 / 按镜头拆成视频片段）」的状态注册表（汇总口）。
//
// 真身按主题拆在 `states/`（四轨展开生成：中浅 / 英浅 / 中暗 / 英暗）；顺序必须与
// `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
// 这屏是拍板样张：基线还没录，登记在 calibration.json 的 pendingApprovalScreens，等用户拍板。
import { VN_TOOLBAR_STATES } from './states/01-toolbar'
import { VN_FRAME_STATES } from './states/02-frame'
import { VN_CLIP_STATES } from './states/03-clip'
import { VN_SPLIT_STATES } from './states/04-split'
import { VN_FAILURE_ZOOM_STATES } from './states/05-failure-zoom'
import type { LabState } from '../labScreen'

export const VIDEO_NODE_NEXT_STATES: readonly LabState[] = [
  ...VN_TOOLBAR_STATES,
  ...VN_FRAME_STATES,
  ...VN_CLIP_STATES,
  ...VN_SPLIT_STATES,
  ...VN_FAILURE_ZOOM_STATES,
]
