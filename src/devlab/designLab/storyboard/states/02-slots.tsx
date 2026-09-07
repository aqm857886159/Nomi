import React from 'react'
import type { LabState } from '../../labScreen'
import { AutoClick, SlotMatrixRow } from '../storyboardLabKit'
import { STILL_NEON, STILL_PORTRAIT, STILL_PROP, STILL_ROOFTOP, STILL_WIDE } from '../storyboardFixtures'

/**
 * 设计实验室 · 分镜表 v6 —— **参考列的槽矩阵**（合同 §4）。
 *
 * 这六格是六种**真实档案**的真实声明（`modelKey` 走真 identifierPattern，槽由
 * `ArchetypeMode.slots` derive）。看的是两条硬规则有没有成立：
 *   ① 一个槽一个格——30 张图的槽也只占一格（叠放 + 计数），行高不被撑爆；
 *   ② 参考列固定 200px、单行、最多三格、永不换行。
 * 顺带验第三条：同一 mode 内必填度可以不同（Veo 帧的首帧红必填、尾帧灰可选）。
 */

const IMAGES = [STILL_ROOFTOP, STILL_NEON, STILL_PORTRAIT, STILL_PROP, STILL_WIDE]

export const SLOT_STATES: readonly LabState[] = [
  {
    id: 'sb-slot-01-no-references',
    name: '槽矩阵 · 文生视频（该模式不吃参考）',
    source: '合同 §4.2 不吃参考 / §4.3 Seedance 2.5 · t2v（主语是模式不是模型，2026-09-06 用户实测）',
    coverage: 'shell',
    render: () => SlotMatrixRow('seedance-2-5', 't2v'),
  },
  {
    id: 'sb-slot-02-first-frame-required',
    name: '槽矩阵 · 首帧（1 个红必填格）',
    source: '合同 §4.2 必填未填 / §4.3 Seedance 2.5 · 首帧',
    coverage: 'shell',
    render: () => SlotMatrixRow('seedance-2-5', 'first'),
  },
  {
    id: 'sb-slot-03-first-last-frames',
    name: '槽矩阵 · 首尾帧（2 个格，各自独立）',
    source: '合同 §4.1 一个槽一个格 / §4.3 Seedance 2.5 · 首尾帧',
    coverage: 'shell',
    render: () => SlotMatrixRow('seedance-2-5', 'firstlast', {
      referenceBindings: { first_frame: [{ url: STILL_ROOFTOP, name: '天台夜景' }] },
    }),
  },
  {
    id: 'sb-slot-04-omni-stacked',
    name: '槽矩阵 · 全能参考（图/视频/音频三格，图槽叠放 5/30）',
    source: '合同 §2.6 手抓扑克叠放 / §4.2 数组槽 / §4.3 Seedance 2.5 · 全能参考',
    coverage: 'shell',
    render: () => SlotMatrixRow('seedance-2-5', 'omni', {
      referenceBindings: {
        image_ref: IMAGES.map((url, index) => ({ url, name: `参考 ${index + 1}` })),
        video_ref: [{ url: STILL_WIDE, name: '白膜预览' }],
      },
    }),
  },
  {
    id: 'sb-slot-05-mixed-required',
    name: '槽矩阵 · 同一 mode 内必填度不同（首帧红 / 尾帧灰）',
    source: '合同 §4.3 Veo 3.1 · 帧 / §5 v6 新增第 7 条',
    coverage: 'shell',
    render: () => SlotMatrixRow('veo-3-1', 'frame'),
  },
  {
    id: 'sb-slot-06-edit-capacity',
    name: '槽矩阵 · 改图（已放 1，上限 14）',
    source: '合同 §4.2 通用 @ 加槽 · 已用/上限 / §4.3 Nano Banana 2 · 编辑',
    coverage: 'shell',
    render: () => SlotMatrixRow('nano-banana-2', 'edit', {
      shotKind: 'image',
      referenceBindings: { image_ref: [{ url: STILL_PORTRAIT, name: '林薇', anchorId: 'a-linwei' }] },
    }),
  },
  {
    id: 'sb-slot-07-slot-popover',
    name: '槽浮层 · 描述 + 「要忽略的特征」（参考列本身不变宽）',
    source: '合同 §4.4 槽引用锚点携带的三段声明',
    coverage: 'shell',
    /** 浮层走 BodyPortal + fixed 定位，所以这一格截的是**整屏**（见 labScreen 的 capture 字段）。 */
    capture: 'viewport',
    render: () => (
      <AutoClick selector="[data-storyboard-ref-slot='image_ref'] button">
        {SlotMatrixRow('nano-banana-2', 'edit', {
          shotKind: 'image',
          referenceBindings: {
            image_ref: [
              { url: STILL_PORTRAIT, name: '林薇', anchorId: 'a-linwei', ignore: '背景的霓虹招牌' },
              { url: STILL_PROP, name: '旧怀表', anchorId: 'a-watch' },
            ],
          },
        })}
      </AutoClick>
    ),
  },
]
