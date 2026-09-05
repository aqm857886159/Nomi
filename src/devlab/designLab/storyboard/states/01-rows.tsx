import React from 'react'
import type { LabState } from '../../labScreen'
import { AutoClick, RowStage } from '../storyboardLabKit'
import { LAB_VARIANTS, STILL_NEON, STILL_ROOFTOP } from '../storyboardFixtures'

/**
 * 设计实验室 · 分镜表 v6 —— **行**的形态（合同 `docs/design/2026-09-05-storyboard-table-v6-design-contract.md`）。
 *
 * 每条注册项带：稳定 id、人话名字、来源章节、coverage 档位、以及**用现役组件**渲染的夹具。
 * 顺序有意义：`labStates.mjs` 按 `states/` 目录名排序解析，注册表按同样顺序拼接，
 * 走查再拿活页面的 `window.__designLabStates` 与解析结果逐项比对——三者对不上当场红。
 * 加状态时别打乱文件名的数字前缀。
 */

export const ROW_STATES: readonly LabState[] = [
  {
    id: 'sb-row-01-draft-inherited-aspect',
    name: '行 · 待生成（画幅继承整片默认）',
    source: '合同 §2.3 行骨架 / §2.4.1 画幅作用域规则 3 / §3.1 draft',
    coverage: 'shell',
    render: () => RowStage(),
  },
  {
    id: 'sb-row-02-aspect-override-16-9',
    name: '行 · 画幅覆盖 16:9（横版第一次有身材）',
    source: '合同 §2.4 画面格几何 / §2.4.1 行级覆盖',
    coverage: 'shell',
    render: () => RowStage({ shot: { params: { aspect_ratio: '16:9' } } }),
  },
  {
    id: 'sb-row-03-aspect-override-1-1',
    name: '行 · 画幅覆盖 1:1',
    source: '合同 §2.4 画面格几何 / §2.4.1 行级覆盖',
    coverage: 'shell',
    render: () => RowStage({ shot: { params: { aspect_ratio: '1:1' } } }),
  },
  {
    id: 'sb-row-04-waiting-refs',
    name: '行 · 等参考卡出图',
    source: '合同 §3.1 waiting-refs',
    coverage: 'shell',
    render: () => RowStage({
      shot: { anchorIds: ['a-linwei'], referenceBindings: {} },
      exec: {
        status: 'waiting-refs',
        waitingRefs: [{
          anchor: { id: 'a-linwei', kind: 'character', name: '林薇', description: '', carrier: 'visual' },
          node: null,
        }],
      },
    }),
  },
  {
    id: 'sb-row-05-missing-required',
    name: '行 · 缺必填参考（红）',
    source: '合同 §3.1 missing-required / §4.2 必填槽',
    coverage: 'shell',
    render: () => RowStage({
      shot: { referenceBindings: {} },
      exec: { status: 'missing-required', missingSlots: [{ kind: 'first_frame', label: '首帧', min: 1, max: 1 }] },
    }),
  },
  {
    id: 'sb-row-06-generating',
    name: '行 · 生成中 37%',
    source: '合同 §3.1 generating',
    coverage: 'shell',
    render: () => RowStage({ exec: { status: 'generating', progressPercent: 37 } }),
  },
  {
    id: 'sb-row-07-failed',
    name: '行 · 失败（红边 + 重试）',
    source: '合同 §3.1 failed',
    coverage: 'shell',
    render: () => RowStage({ exec: { status: 'failed', errorMessage: '厂商未启用该模型' } }),
  },
  {
    id: 'sb-row-08-done',
    name: '行 · 已生成（动作条在图下方 + @tag + 变体计数）',
    source: '合同 §2.3 动作条移到图下方 / §2.9 变体入口 / §2.10 产出 @tag / §3.1 done',
    coverage: 'shell',
    render: () => RowStage({
      exec: { status: 'done', resultUrl: STILL_ROOFTOP },
      outputTag: '镜01',
      variants: LAB_VARIANTS,
      adoptedVariantId: 'v2',
    }),
  },
  {
    id: 'sb-row-09-locked',
    name: '行 · 已锁定（不进批量）',
    source: '合同 §3.1 locked / §3.3 批量参与度',
    coverage: 'shell',
    render: () => RowStage({
      exec: { status: 'locked', resultUrl: STILL_ROOFTOP, locked: true },
      outputTag: '镜01',
    }),
  },
  {
    id: 'sb-row-10-skipped',
    name: '行 · 本次跳过（60% + 标签，≠ 锁定）',
    source: '合同 §2.10 本次跳过 / §3.3 skipped 与 locked 的边界',
    coverage: 'shell',
    render: () => RowStage({ skipped: true }),
  },
  {
    id: 'sb-row-11-ref-changed',
    name: '行 · 参考已变（只报事实 + 一键补跑）',
    source: '合同 §2.3 保留 v5 语义 / §3.1 done',
    coverage: 'shell',
    render: () => RowStage({
      exec: {
        status: 'done',
        resultUrl: STILL_NEON,
        changedRefs: [{ id: 'a-linwei', kind: 'character', name: '林薇', description: '', carrier: 'visual' }],
      },
      outputTag: '镜01',
    }),
  },
  {
    id: 'sb-row-12-selected-dragover',
    name: '行 · 选中 + 拖拽落点线',
    source: '合同 §2.6 增删改查（拖拽换序）',
    coverage: 'shell',
    render: () => RowStage({ selected: true, isDragOver: true }),
  },
  {
    id: 'sb-row-13-row-menu',
    name: '行 · ⋯ 菜单（含「交给 Agent 改这一镜」「这一镜换画幅」）',
    source: '合同 §2.6 ⋯ 菜单 / §2.7 Agent 三入口之三 / §2.4.1 覆盖入口',
    coverage: 'shell',
    /** 菜单是绝对定位、比行还高，按元素截会被行的 bounding box 切掉一半（截出半张菜单的假证据）。 */
    capture: 'viewport',
    render: () => (
      <AutoClick selector="[data-storyboard-row-menu-trigger]">
        {RowStage({ clip: false })}
      </AutoClick>
    ),
  },
  {
    id: 'sb-row-14-variants-drawer',
    name: '行 · 历史变体抽屉（显式「采用」才换画面格）',
    source: '合同 §2.9 历史变体抽屉 + 显式采用',
    coverage: 'shell',
    render: () => (
      <AutoClick selector="[data-storyboard-variants]">
        {RowStage({
          clip: false,
          exec: { status: 'done', resultUrl: STILL_ROOFTOP },
          outputTag: '镜01',
          variants: LAB_VARIANTS,
          adoptedVariantId: 'v2',
        })}
      </AutoClick>
    ),
  },
  {
    id: 'sb-row-15-image-shot',
    name: '行 · 图片镜（时长语义 = 停留）',
    source: '合同 §2.3 底栏 / §5 对账 #15',
    coverage: 'shell',
    render: () => RowStage({
      shot: {
        shotKind: 'image',
        durationSec: 3,
        modelKey: 'nano-banana-2',
        modeId: 'edit',
        prompt: '近景，@林薇 侧脸，霓虹在睫毛上留下一道光',
        referenceBindings: { image_ref: [{ url: STILL_ROOFTOP, name: '林薇', anchorId: 'a-linwei' }] },
      },
    }),
  },
]
