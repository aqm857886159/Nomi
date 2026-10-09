// 拉环按「这一侧接不接得上」出现（拍板 1）+ 点一下「+」出菜单（bug ①）+ 左「+」=「给它加输入」（拍板 2）+ 在画布上点选。全部是生产组件。
import React from 'react'
import type { LabState } from '../../labScreen'
import { FIXTURES, HandlesStage } from '../canvasHandlesLabKit'

const SOURCE = '用户 10-08 拍板 ①②（Design 画布）；设计卡 docs/plan/2026-10-08-canvas-handles.md'
const MIRRORS = 'src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowVisualContract.ts:35'
const MENU_MIRRORS = 'src/workbench/generationCanvas/quickActions/connectionMenuModel.ts:23'
const PICK_MIRRORS = 'src/workbench/generationCanvas/components/CanvasPickModeLayer.tsx:12'

export const HANDLE_STATES: readonly LabState[] = [
  {
    id: 'ch-01-gen-selected-zh',
    name: '选中生成类图片卡：左右都有「+」；旁边没选中的上传素材卡只有右侧小圆点',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" />,
  },
  {
    id: 'ch-01-gen-selected-en',
    name: '选中生成类图片卡：左右都有「+」；旁边没选中的上传素材卡只有右侧小圆点（英文）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" />,
  },
  {
    id: 'ch-01-gen-selected-zh-dark',
    name: '选中生成类图片卡：左右都有「+」；旁边没选中的上传素材卡只有右侧小圆点（暗色）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" />,
  },
  {
    id: 'ch-02-asset-selected-zh',
    name: '选中上传素材卡：只有右「+」（它不收任何输入）；没选中的生成卡两侧小圆点',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-02-asset-selected-en',
    name: '选中上传素材卡：只有右「+」（它不收任何输入）；没选中的生成卡两侧小圆点（英文）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-02-asset-selected-zh-dark',
    name: '选中上传素材卡：只有右「+」（它不收任何输入）；没选中的生成卡两侧小圆点（暗色）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-03-right-menu-zh',
    name: '点一下右「+」→「用这个节点生成」（现役菜单本体，锚在圈旁）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="right" />,
  },
  {
    id: 'ch-03-right-menu-en',
    name: '点一下右「+」→「用这个节点生成」（现役菜单本体，锚在圈旁）（英文）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="right" />,
  },
  {
    id: 'ch-04-left-menu-zh',
    name: '点一下左「+」→「给它加输入」：以本卡为目标判，接不进来的灰掉写原因；从素材库添加 / 在画布上点选',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="left" />,
  },
  {
    id: 'ch-04-left-menu-en',
    name: '点一下左「+」→「给它加输入」：以本卡为目标判，接不进来的灰掉写原因；从素材库添加 / 在画布上点选（英文）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="left" />,
  },
  {
    id: 'ch-04-left-menu-zh-dark',
    name: '点一下左「+」→「给它加输入」：以本卡为目标判，接不进来的灰掉写原因；从素材库添加 / 在画布上点选（暗色）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="left" />,
  },
  {
    id: 'ch-11-pick-mode-zh',
    name: '在画布上点选（给视频卡加输入）：变暗、可点的卡描边、本卡变灰、顶部「选择要引用的节点 · Esc」',
    source: SOURCE,
    mirrors: PICK_MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(150, 60), FIXTURES.asset(640, 60), FIXTURES.emptyVideo(380, 330)]} pickFor="h-empty-video" />,
  },
  {
    id: 'ch-11-pick-mode-en',
    name: '在画布上点选（英文）',
    source: SOURCE,
    mirrors: PICK_MIRRORS,
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(150, 60), FIXTURES.asset(640, 60), FIXTURES.emptyVideo(380, 330)]} pickFor="h-empty-video" />,
  },
  {
    id: 'ch-11-pick-mode-zh-dark',
    name: '在画布上点选（暗色）',
    source: SOURCE,
    mirrors: PICK_MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(150, 60), FIXTURES.asset(640, 60), FIXTURES.emptyVideo(380, 330)]} pickFor="h-empty-video" />,
  },
]
