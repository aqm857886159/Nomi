// 拉环按「这一侧接不接得上」出现（拍板 1）+ 点一下「+」出菜单（修第 0 步实测的 bug ①）+ 左「+」=「给它加输入」（拍板 2）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { FIXTURES, HandlesStage } from '../canvasHandlesLabKit'

const SOURCE = 'brief D-handles 推荐方案 1–3（协调会话 10-08；用户原话：左边加上下文、右边引用输出、成品只有一侧）'
const MIRRORS = 'src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowVisualContract.ts:41'
const MENU_MIRRORS = 'src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowMenus.ts:42'

export const HANDLE_STATES: readonly LabState[] = [
  {
    id: 'ch-01-gen-selected-zh',
    name: '选中生成类图片卡：左右都有「+」；旁边没选中的上传素材卡只有右侧小圆点',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" />,
  },
  {
    id: 'ch-01-gen-selected-en',
    name: '选中生成类图片卡：左右都有「+」；旁边没选中的上传素材卡只有右侧小圆点（英文）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" />,
  },
  {
    id: 'ch-01-gen-selected-zh-dark',
    name: '选中生成类图片卡：左右都有「+」；旁边没选中的上传素材卡只有右侧小圆点（暗色）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" />,
  },
  {
    id: 'ch-02-asset-selected-zh',
    name: '选中上传素材卡：只有右「+」（它不收任何输入）；没选中的生成卡两侧小圆点',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-02-asset-selected-en',
    name: '选中上传素材卡：只有右「+」（它不收任何输入）；没选中的生成卡两侧小圆点（英文）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-02-asset-selected-zh-dark',
    name: '选中上传素材卡：只有右「+」（它不收任何输入）；没选中的生成卡两侧小圆点（暗色）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-03-right-menu-zh',
    name: '点一下右「+」→「用这个节点生成」（现役菜单本体，锚在圈旁）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="right" />,
  },
  {
    id: 'ch-03-right-menu-en',
    name: '点一下右「+」→「用这个节点生成」（现役菜单本体，锚在圈旁）（英文）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="right" />,
  },
  {
    id: 'ch-04-left-menu-zh',
    name: '点一下左「+」→「给它加输入」：以本卡为目标判，接不进来的灰掉写原因；从素材库添加 / 在画布上点选（同自动引用的点选模式）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="left" />,
  },
  {
    id: 'ch-04-left-menu-en',
    name: '点一下左「+」→「给它加输入」：以本卡为目标判，接不进来的灰掉写原因；从素材库添加 / 在画布上点选（同自动引用的点选模式）（英文）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'component-only',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="left" />,
  },
  {
    id: 'ch-04-left-menu-zh-dark',
    name: '点一下左「+」→「给它加输入」：以本卡为目标判，接不进来的灰掉写原因；从素材库添加 / 在画布上点选（同自动引用的点选模式）（暗色）',
    source: SOURCE,
    mirrors: MENU_MIRRORS,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" menu="left" />,
  },
]
