// 3D 导演台顶部工具栏（从 Scene3DFullscreen.tsx 抽出，防巨壳 R9，JSX 逐字迁移）。
// 左：节点标题；右操作簇：变换（移动/旋转）→ 截图 → 轨迹+播放预览 → 操控 → 飞行速度
// → 出片主按钮（P0-1，旅程终点显式化）→ 重看引导（P1）→ 关闭。
import React from 'react'
import {
  IconArrowsMove, IconCube, IconHelp, IconPhoto, IconPlayerPause, IconPlayerPlay,
  IconRoute, IconRotate, IconUpload, IconWorld, IconX,
} from '@tabler/icons-react'
import { toast } from '../../../../ui/toast'
import { PanelButton } from './scene3dToolbar'
import { CharacterPossessButton } from './scene3dCharacterActionBar'
import type { Scene3DTransformMode } from './scene3dTypes'

type Scene3DFullscreenHeaderProps = {
  nodeTitle: string
  readOnly: boolean
  transformMode: Scene3DTransformMode
  onTransformModeChange: (mode: Scene3DTransformMode) => void
  onCaptureViewport: () => void
  trajectoryMode: boolean
  onToggleTrajectoryMode: () => void
  /** 运镜就绪（isCameraMoveReady）：未就绪时播放按钮只提示不播放 */
  moveReady: boolean
  isPlaying: boolean
  onRequestPlayChange: (playing: boolean) => void
  characterDrive: React.ComponentProps<typeof CharacterPossessButton>['drive']
  flySpeed: number
  onFlySpeedChange: (speed: number) => void
  onOpenExportPanel: () => void
  onReplayCoach: () => void
  onClose: () => void
}

export function Scene3DFullscreenHeader({
  nodeTitle,
  readOnly,
  transformMode,
  onTransformModeChange,
  onCaptureViewport,
  trajectoryMode,
  onToggleTrajectoryMode,
  moveReady,
  isPlaying,
  onRequestPlayChange,
  characterDrive,
  flySpeed,
  onFlySpeedChange,
  onOpenExportPanel,
  onReplayCoach,
  onClose,
}: Scene3DFullscreenHeaderProps): JSX.Element {
  return (
    <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-nomi-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconCube size={18} className="shrink-0 text-[var(--workbench-muted)]" />
        <div className="min-w-0 truncate text-body-sm font-medium text-[var(--workbench-ink)]">{nodeTitle}</div>
      </div>
      <div className="ml-auto flex min-w-0 max-w-[72vw] items-center gap-2 overflow-x-auto">
        <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
          <PanelButton title="移动" active={transformMode === 'translate'} onClick={() => onTransformModeChange('translate')}>
            <IconArrowsMove size={15} />
          </PanelButton>
          <PanelButton title="旋转" active={transformMode === 'rotate'} onClick={() => onTransformModeChange('rotate')}>
            <IconRotate size={15} />
          </PanelButton>
        </div>
        <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
          <PanelButton title="当前视口截图" onClick={onCaptureViewport}>
            <IconPhoto size={15} />
            <span>截图</span>
          </PanelButton>
        </div>
        <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
          <PanelButton title={trajectoryMode ? '退出轨迹模式' : '进入轨迹模式'} active={trajectoryMode} onClick={onToggleTrajectoryMode}>
            <IconRoute size={15} />
            <span>轨迹</span>
          </PanelButton>
          <PanelButton
            title={
              !moveReady
                ? '整运镜后才能播放预览'
                : isPlaying
                  ? '暂停轨迹播放'
                  : '播放轨迹预览'
            }
            active={isPlaying}
            onClick={() => {
              if (!moveReady) {
                toast('先整运镜（轨迹 + 绑定）才能播放预览', 'warning')
                return
              }
              onRequestPlayChange(!isPlaying)
            }}
          >
            {isPlaying ? <IconPlayerPause size={15} /> : <IconPlayerPlay size={15} />}
          </PanelButton>
        </div>
        {!readOnly ? <CharacterPossessButton drive={characterDrive} /> : null}
        <label className="inline-flex h-8 shrink-0 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--workbench-muted)]">
          <IconWorld size={14} />
          <span>速度</span>
          <input
            className="h-1.5 w-24 accent-[var(--nomi-ink)]"
            max={16}
            min={1}
            step={0.5}
            type="range"
            value={flySpeed}
            onChange={(event) => onFlySpeedChange(Number(event.currentTarget.value))}
          />
        </label>
        {/* 出片主按钮（P0-1）：顶部工具栏最右，显眼的主色调 */}
        <button
          type="button"
          data-coach="export-button"
          onClick={onOpenExportPanel}
          title="出片：导出参考视频 / 截图 / 首尾帧"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-3 text-caption font-medium text-[var(--nomi-paper)] transition-opacity hover:opacity-90"
        >
          <IconUpload size={15} />
          <span>出片</span>
        </button>
        {/* P1：重看引导按钮 */}
        <button
          type="button"
          title="重看新手引导"
          onClick={onReplayCoach}
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-[var(--workbench-muted)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--workbench-ink)]"
        >
          <IconHelp size={15} />
        </button>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
          type="button"
          title="退出 3D 场景"
          onClick={onClose}
        >
          <IconX size={16} />
        </button>
      </div>
    </header>
  )
}
