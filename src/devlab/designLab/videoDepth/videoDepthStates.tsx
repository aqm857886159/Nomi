// 设计实验室 · 屏「画布 · 提取深度」的状态注册表（汇总口）。
//
// 真身按主题拆在 `states/`（R9 分层 · R12 巨壳门岗：单文件 ≤800 行）。
// 这里只做一件事：**按固定顺序**拼成一条清单，顺序必须与
// `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
//
// 八格（四态 × 光暗）里，改形态后的样子用户**还没看过**，所以这屏显式登记在
// calibration.json 的 pendingApprovalScreens 里，本轮不录基线——给一个没人看过的屏录基线，
// 等于把「今天碰巧长这样」钉成「应该长这样」。拍板后跑 design-lab:update，并删掉那条登记。
import { DEPTH_ACTION_STATES } from './states/01-depth-action'
import type { LabState } from '../labScreen'

export const VIDEO_DEPTH_STATES: readonly LabState[] = [...DEPTH_ACTION_STATES]
