import React from 'react'
import {
  IconHandStop,
  IconManFilled,
  IconVideo,
  IconArmchair,
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconCircleFilled,
  IconPlayerStopFilled,
  IconX,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { PanelButton, SceneAddToolbar } from './scene3dToolbar'
import { MANNEQUIN_POSE_PRESETS, type CrowdAddOptions } from './scene3dConstants'
import type { Scene3DCamera, Scene3DGeometry, Scene3DObject, Scene3DPropKind } from './scene3dTypes'

type CharacterDriveApi = {
  possessId: string | null
  selectedMannequin: Scene3DObject | undefined
  enterPossess: (objectId: string) => void
  exitPossess: () => void
  // 相机操控（运镜）：与角色操控一视同仁（P4 通用第一），同一个「操控」动词。
  cameraPossessId: string | null
  selectedCamera: Scene3DCamera | undefined
  enterCameraPossess: (cameraId: string) => void
  exitCameraPossess: () => void
}

// 头部工具栏「操控」入口：选中单个假人 → 操控走位；选中单个相机 → 操控运镜。进入/退出操控态。
// 一个动词对角色和相机一视同仁（P4）。整块逻辑+可见性自闭合，让 Scene3DFullscreen 壳只写一行接线（R9）。
export function CharacterPossessButton({ drive }: { drive: CharacterDriveApi }): JSX.Element | null {
  const possessingCharacter = Boolean(drive.possessId)
  const possessingCamera = Boolean(drive.cameraPossessId)

  if (possessingCamera) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton title="退出操控镜头" active onClick={drive.exitCameraPossess}>
          <IconVideo size={15} />
          <span>操控</span>
        </PanelButton>
      </div>
    )
  }
  if (possessingCharacter) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton title="退出操控" active onClick={drive.exitPossess}>
          <IconManFilled size={15} />
          <span>操控</span>
        </PanelButton>
      </div>
    )
  }
  if (drive.selectedMannequin) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton
          title="操控该角色（WASD 走位 + 动作库）"
          onClick={() => drive.selectedMannequin && drive.enterPossess(drive.selectedMannequin.id)}
        >
          <IconManFilled size={15} />
          <span>操控</span>
        </PanelButton>
      </div>
    )
  }
  if (drive.selectedCamera) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton
          title="操控该镜头（WASD 飞 + 鼠标转朝向 + 滚轮推拉 → 录运镜）"
          onClick={() => drive.selectedCamera && drive.enterCameraPossess(drive.selectedCamera.id)}
        >
          <IconVideo size={15} />
          <span>操控</span>
        </PanelButton>
      </div>
    )
  }
  return null
}

// 动作库：动作名 → 现有静态姿势预设 key 的映射（不造新预设）。
// 某动作没有对应预设就不会进列表（诚实，见 ACTION_LIBRARY 过滤）。
// 注意：待机/行走/奔跑（idle/walk/run）已改由「移动自动播迈腿动画」驱动（possess 态按 WASD 速度自动切 clip），
// 不再放进静态动作库——否则一个「行走」会有「静态摆腿姿势」和「真迈腿动画」两套心智、互相打架（P1）。
// 这里只留 locomotion 之外的静态摆姿（下蹲/挥手/坐下/站立）。
// 「站立」= #B 修复：此前点了挥手/坐下没有任何按钮能回站姿(除非重新走动触发 locomotion 接管，站着不动就
// 永久卡住)。复用现成 standing 预设(pose 缺省=rest)，不新造姿势数据。另外——再点一次已激活的那个动作按钮
// 也会自动顶成站立（toggle，见 useScene3DCharacterDrive.applyActionPreset），点它=顶它，不用特地找这个按钮。
const ACTION_DEFS: Array<{ label: string; presetId: string; icon: typeof IconManFilled }> = [
  { label: '站立', presetId: 'standing', icon: IconArrowBarToUp },
  { label: '下蹲', presetId: 'squat', icon: IconArrowBarToDown },
  { label: '挥手', presetId: 'wave', icon: IconHandStop },
  { label: '坐下', presetId: 'sit', icon: IconArmchair },
]

const ACTION_LIBRARY = ACTION_DEFS.filter((action) =>
  MANNEQUIN_POSE_PRESETS.some((preset) => preset.id === action.presetId),
)

export type ActionBarRecorder = {
  isRecording: boolean
  elapsedSeconds: number
  onStart: () => void
  onStop: () => void
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// 录制按钮（REC / 停止 + 计时）。录制态下用强调色点 + 秒数；非录制态是「录 take」。
// 录制中其它动作仍可点（中途切动作=切姿势,S2 不录 pose 随时间,见缺口）。
function TakeRecordButton({ recorder }: { recorder: ActionBarRecorder }): JSX.Element {
  if (recorder.isRecording) {
    return (
      <button
        className={cn(
          'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2.5 whitespace-nowrap',
          'border-0 bg-[var(--workbench-danger)] text-caption text-[var(--nomi-paper)]',
          'transition hover:opacity-90',
        )}
        type="button"
        title="停止录制并生成参考视频"
        onClick={recorder.onStop}
      >
        <IconPlayerStopFilled size={14} />
        <span className="tabular-nums">{formatElapsed(recorder.elapsedSeconds)}</span>
      </button>
    )
  }
  return (
    <button
      className={cn(
        'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2 whitespace-nowrap',
        'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
        'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
      )}
      type="button"
      title="录 take：把这段走位 + 机位录成参考视频喂给镜头"
      onClick={recorder.onStart}
    >
      <IconCircleFilled size={12} className="text-[var(--workbench-danger)]" />
      <span>录 take</span>
    </button>
  )
}

// 操控态底部动作库工具栏。点动作 → 把对应预设的 pose 应用到被操控假人。
// className 风格照搬 SceneAddToolbar 底部条。
export function CharacterActionBar({
  characterName,
  activePresetId,
  onApplyPreset,
  onExit,
  recorder,
}: {
  characterName: string
  activePresetId?: string
  onApplyPreset: (presetId: string) => void
  onExit: () => void
  recorder?: ActionBarRecorder
}): JSX.Element {
  return (
    <div
      className="absolute bottom-5 left-1/2 z-[5] max-w-[calc(100%-32px)] -translate-x-1/2"
      aria-label="角色操控动作库"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          'inline-flex max-w-full items-center gap-1 overflow-x-auto p-[6px]',
          'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
        )}
        role="toolbar"
      >
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-2.5 text-caption text-[var(--nomi-paper)]" title="正在操控的角色">
          <IconManFilled size={15} />
          <span className="max-w-[120px] truncate">{characterName}</span>
        </span>
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        {ACTION_LIBRARY.map((action) => {
          const Icon = action.icon
          const active = activePresetId === action.presetId
          return (
            <button
              key={action.presetId}
              className={cn(
                'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2 whitespace-nowrap',
                'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
                'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                active && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
              )}
              type="button"
              title={`应用动作：${action.label}`}
              onClick={() => onApplyPreset(action.presetId)}
            >
              <Icon size={15} />
              <span>{action.label}</span>
            </button>
          )
        })}
        {recorder ? (
          <>
            <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
            <TakeRecordButton recorder={recorder} />
          </>
        ) : null}
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        <button
          className={cn(
            'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2 whitespace-nowrap',
            'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
          )}
          type="button"
          title="退出操控"
          onClick={onExit}
        >
          <IconX size={15} />
          <span>退出操控</span>
        </button>
      </div>
      <div className="mt-1.5 text-center text-micro text-[var(--nomi-ink-60)]">
        {recorder?.isRecording
          ? '录制中 · WASD 走位、绕看摆机位都会录进参考视频 · 点停止出片'
          : 'WASD 走位 · Shift 加速 · Space 跳 · C 蹲 · 自动面向 · 点动作切换姿势 · 点「录 take」录成参考视频'}
      </div>
    </div>
  )
}

// 相机操控（运镜）底部条：被操控相机名 + 录 take + 退出。无动作库（运镜没有「动作」概念），
// 只录飞行 + 转朝向。与 CharacterActionBar 同款式，复用 TakeRecordButton。
export function CameraPossessActionBar({
  cameraName,
  onExit,
  recorder,
}: {
  cameraName: string
  onExit: () => void
  recorder?: ActionBarRecorder
}): JSX.Element {
  return (
    <div
      className="absolute bottom-5 left-1/2 z-[5] max-w-[calc(100%-32px)] -translate-x-1/2"
      aria-label="镜头操控工具栏"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          'inline-flex max-w-full items-center gap-1 overflow-x-auto p-[6px]',
          'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
        )}
        role="toolbar"
      >
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-2.5 text-caption text-[var(--nomi-paper)]" title="正在操控的镜头">
          <IconVideo size={15} />
          <span className="max-w-[120px] truncate">{cameraName}</span>
        </span>
        {recorder ? (
          <>
            <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
            <TakeRecordButton recorder={recorder} />
          </>
        ) : null}
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        <button
          className={cn(
            'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2 whitespace-nowrap',
            'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
          )}
          type="button"
          title="退出操控镜头"
          onClick={onExit}
        >
          <IconX size={15} />
          <span>退出操控</span>
        </button>
      </div>
      <div className="mt-1.5 text-center text-micro text-[var(--nomi-ink-60)]">
        {recorder?.isRecording
          ? '录制中 · WASD 飞镜头、鼠标转朝向、滚轮推拉都会录进运镜参考视频 · 点停止出片'
          : 'WASD 飞镜头 · Shift 加速 · 鼠标转朝向 · 滚轮推拉 · 点「录 take」录成运镜参考视频'}
      </div>
    </div>
  )
}

// 画布底部条：角色操控显示动作库、相机操控显示运镜条，否则显示原添加工具栏。把这层「显示哪个条」的判断从
// Scene3DFullscreen 壳里抽出（R9 防巨壳），壳只传 possessedObject/possessedCamera + 各套回调。
export function Scene3DBottomBar({
  readOnly,
  possessedObject,
  possessedCamera,
  activePresetId,
  recorder,
  onApplyPreset,
  onExitPossess,
  onExitCameraPossess,
  onAddObject,
  onAddProp,
  onAddCrowd,
  onAddCamera,
  trajectoryMode,
  onToggleTrajectoryMode,
  canvasFocusMode,
  onToggleCanvasFocusMode,
}: {
  readOnly: boolean
  possessedObject?: Scene3DObject
  possessedCamera?: Scene3DCamera
  activePresetId?: string
  recorder?: ActionBarRecorder
  onApplyPreset: (presetId: string) => void
  onExitPossess: () => void
  onExitCameraPossess: () => void
  onAddObject: (kind: Scene3DGeometry | 'mannequin' | 'light') => void
  onAddProp: (kind: Scene3DPropKind) => void
  onAddCrowd: (options: CrowdAddOptions) => void
  onAddCamera: () => void
  trajectoryMode: boolean
  onToggleTrajectoryMode: () => void
  canvasFocusMode: boolean
  onToggleCanvasFocusMode: () => void
}): JSX.Element | null {
  if (possessedObject) {
    return (
      <CharacterActionBar
        characterName={possessedObject.name}
        activePresetId={activePresetId}
        onApplyPreset={onApplyPreset}
        onExit={onExitPossess}
        recorder={recorder}
      />
    )
  }
  if (possessedCamera) {
    return (
      <CameraPossessActionBar
        cameraName={possessedCamera.name}
        onExit={onExitCameraPossess}
        recorder={recorder}
      />
    )
  }
  if (readOnly) return null
  return (
    <SceneAddToolbar
      onAddObject={onAddObject}
      onAddProp={onAddProp}
      onAddCrowd={onAddCrowd}
      onAddCamera={onAddCamera}
      trajectoryMode={trajectoryMode}
      onToggleTrajectoryMode={onToggleTrajectoryMode}
      canvasFocusMode={canvasFocusMode}
      onToggleCanvasFocusMode={onToggleCanvasFocusMode}
    />
  )
}
