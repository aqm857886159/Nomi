/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchIconButton、../../../../../../vendor/tablerIcons、../../model/hotkeys、creation/storyboard/shotRow/useElementWidth（量外框宽）、
 *          ../../OutputsContext、../outputs/OutputsPopover、../viewport/ViewportToolbar、./AddObjectMenu、./SceneMenu、./ViewMenu、./shellChrome
 * [OUTPUT]: 对外提供 RefineTopBar：精修「选中才出」布局的顶栏 ——
 *           左：[← 退出 | ▤ 图层名 ▾（大纲 + 场景设置）] [选择 移动 旋转 缩放 | ＋（含资产库）]
 *           中：[导演 | 精修]（3D-BOX 开关开时；与导演视图同一枚、同居中）
 *           右：[视图 ▾（首项重置视角）| 撤销 重做 | 截图 产出（含录制 MP4）]；顶栏窄于 760 时图层名收成只剩 ▤
 *        画线 / 逐点不在顶栏：它们住选中角色 / 机位的属性卡头（ContextCard），顶栏宽度不随选中变
 * [POS]: director/panels/topbar 的精修顶栏（2026-10-04 用户拍板方向 A，设计卡 docs/plan/2026-10-04-director-refine-select-to-show.md）。
 *        旧顶栏六簇在 858 宽里自然宽约 880，④⑤ 两簇互相压住；这里收成四簇（含居中的模式切换）、工具格收窄、能图形化的都图形化（＋、退出）。
 *        **两侧列用 minmax(max-content, 1fr)**：放得下时中列正好居中（和导演视图同一位置，切模式钮不跳）；
 *        放不下时（窄窗 / 英文）中列往一侧让，簇与簇永不重叠——旧网格的两侧列是 minmax(0,1fr)，内容一宽就压到中列上。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../../../../design'
import { IconCamera } from '../../../../../../vendor/tablerIcons'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'
import { useOutputs } from '../../OutputsContext'
import { useElementWidth } from '../../../../../creation/storyboard/shotRow/useElementWidth'
import { OutputsPopover } from '../outputs/OutputsPopover'
import { ViewportToolbar } from '../viewport/ViewportToolbar'
import { AddObjectMenu } from './AddObjectMenu'
import { SceneMenu } from './SceneMenu'
import { ViewMenu } from './ViewMenu'
import { Cluster, ClusterDivider, ExitButton, HistoryButtons, ViewModeSwitch, type ViewModeValue } from './shellChrome'

/** 顶栏比这窄（壳 ≈ 最小窗 1100 × 默认 Agent 时的 728）就收起图层名、只留 ▤ 图标，全名在悬停里（2026-10-04 拍板）。
 *  量的是顶栏外框（宽度由壳给，不被内容撑），所以收名字不会反过来改宽度、没有测量回环。 */
const COMPACT_BELOW_PX = 760

// 布局关键的网格模板走 inline style，不用任意值类：dev 的 tailwind 生成产物可能还没有新类，网格会静默塌成一列一行（NomiSegmented 栽过两次）
const GRID_STYLE: React.CSSProperties = { gridTemplateColumns: 'minmax(max-content, 1fr) auto minmax(max-content, 1fr)' }

export type RefineTopBarProps = {
  onExit: () => void
  onResetView: () => void
  onCancelCreation: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onOpenSceneSettings: () => void
  onOpenAssets: () => void
  /** 3D-BOX 开关开时给：中列出现「导演 | 精修」；开关关（旧导演台）没有导演视图，中列空着 */
  viewMode?: { value: ViewModeValue; onChange: (mode: ViewModeValue) => void }
}

export function RefineTopBar({ onExit, onResetView, onCancelCreation, onOpenSettings, onOpenHelp, onOpenSceneSettings, onOpenAssets, viewMode }: RefineTopBarProps): JSX.Element {
  const { t } = useTranslation()
  const outputs = useOutputs()
  const barRef = React.useRef<HTMLDivElement | null>(null)
  const barWidth = useElementWidth(barRef)
  const compact = barWidth !== null && barWidth < COMPACT_BELOW_PX
  return (
    <div
      ref={barRef}
      className="pointer-events-none absolute inset-x-3 top-3 z-10 grid items-start gap-3"
      style={GRID_STYLE}
      data-testid="director-topbar"
      data-refine-layout="select-to-show"
    >
      <div className="flex items-start gap-3 justify-self-start">
        <Cluster label={t('director.topbar.sceneAria')} testId="director-scene-cluster">
          <ExitButton onExit={onExit} />
          <SceneMenu onOpenSceneSettings={onOpenSceneSettings} compact={compact} />
        </Cluster>
        <Cluster label={t('director.topbar.toolsAria')} testId="director-tools-cluster">
          <ViewportToolbar onCancelCreation={onCancelCreation} />
          <ClusterDivider />
          <AddObjectMenu onOpenAssets={onOpenAssets} />
        </Cluster>
      </div>

      {viewMode ? <ViewModeSwitch mode={viewMode.value} onChange={viewMode.onChange} testId="director-view-mode" /> : <span aria-hidden />}

      <div className="flex items-start gap-3 justify-self-end">
        <Cluster label={t('director.topbar.viewHistoryAria')} testId="director-view-cluster">
          <ViewMenu onResetView={onResetView} onOpenSettings={onOpenSettings} onOpenHelp={onOpenHelp} />
          <ClusterDivider />
          <HistoryButtons />
          <ClusterDivider />
          <WorkbenchIconButton
            size="sm"
            icon={<IconCamera size={16} stroke={1.9} />}
            label={`${t('director.bottomBar.screenshot')} (${formatHotkey(DIRECTOR_HOTKEYS.screenshot)})`}
            data-testid="director-screenshot"
            onClick={() => void outputs.takeScreenshot()}
          />
          <OutputsPopover />
        </Cluster>
      </div>
    </div>
  )
}
