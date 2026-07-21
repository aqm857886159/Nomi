import React from 'react'
import { useTranslation } from 'react-i18next'
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
import type { Scene3DSceneTemplate } from './scene3dSceneTemplates'

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
  const { t } = useTranslation()
  const possessingCharacter = Boolean(drive.possessId)
  const possessingCamera = Boolean(drive.cameraPossessId)

  if (possessingCamera) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton title={t('scene3d.character.exitCameraControl')} active onClick={drive.exitCameraPossess}>
          <IconVideo size={15} />
          <span>{t('scene3d.character.control')}</span>
        </PanelButton>
      </div>
    )
  }
  if (possessingCharacter) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton title={t('scene3d.character.exitControl')} active onClick={drive.exitPossess}>
          <IconManFilled size={15} />
          <span>{t('scene3d.character.control')}</span>
        </PanelButton>
      </div>
    )
  }
  if (drive.selectedMannequin) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton
          title={t('scene3d.character.controlCharacterHint')}
          onClick={() => drive.selectedMannequin && drive.enterPossess(drive.selectedMannequin.id)}
        >
          <IconManFilled size={15} />
          <span>{t('scene3d.character.control')}</span>
        </PanelButton>
      </div>
    )
  }
  if (drive.selectedCamera) {
    return (
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton
          title={t('scene3d.character.controlCameraHint')}
          onClick={() => drive.selectedCamera && drive.enterCameraPossess(drive.selectedCamera.id)}
        >
          <IconVideo size={15} />
          <span>{t('scene3d.character.control')}</span>
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
const ACTION_DEFS: Array<{ labelKey: string; presetId: string; icon: typeof IconManFilled }> = [
  { labelKey: 'scene3d.character.action.standing', presetId: 'standing', icon: IconArrowBarToUp },
  { labelKey: 'scene3d.character.action.squat', presetId: 'squat', icon: IconArrowBarToDown },
  { labelKey: 'scene3d.character.action.wave', presetId: 'wave', icon: IconHandStop },
  { labelKey: 'scene3d.character.action.sit', presetId: 'sit', icon: IconArmchair },
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
  const { t } = useTranslation()
  if (recorder.isRecording) {
    return (
      <button
        className={cn(
          'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2.5 whitespace-nowrap',
          'border-0 bg-[var(--workbench-danger)] text-caption text-[var(--nomi-paper)]',
          'transition hover:opacity-90',
        )}
        type="button"
        title={t('scene3d.character.stopRecording')}
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
      title={t('scene3d.character.recordTakeHint')}
      onClick={recorder.onStart}
    >
      <IconCircleFilled size={12} className="text-[var(--workbench-danger)]" />
      <span>{t('scene3d.character.recordTake')}</span>
    </button>
  )
}

// 操控态底部动作库工具栏。点动作 → 把对应预设的 pose 应用到被操控假人。
// className 风格照搬 SceneAddToolbar 底部条。
// WASD 速度就近放在真用 WASD 的地方（接控/录制条）；视口不再常驻小球滑杆
// （2026-07-20 用户：不知道是啥、还挡 XYZ——XYZ 静态徽标也一并删了）。
function SpeedSliderChip({ value, onChange }: { value: number; onChange: (speed: number) => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <label className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink-60)]" title={t('scene3d.fullscreen.speedTitle')}>
      <span>{t('scene3d.fullscreen.speed')}</span>
      <input className="h-1.5 w-16 accent-[var(--nomi-ink)]" max={16} min={1} step={0.5} type="range" value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
    </label>
  )
}

export function CharacterActionBar({
  characterName,
  activePresetId,
  onApplyPreset,
  onExit,
  recorder,
  speed,
}: {
  characterName: string
  activePresetId?: string
  onApplyPreset: (presetId: string) => void
  onExit: () => void
  recorder?: ActionBarRecorder
  speed?: { value: number; onChange: (speed: number) => void }
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="absolute bottom-5 left-1/2 z-[8] max-w-[calc(100%-32px)] -translate-x-1/2"
      aria-label={t('scene3d.character.actionLibraryAria')}
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
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-2.5 text-caption text-[var(--nomi-paper)]" title={t('scene3d.character.controllingCharacter')}>
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
              title={t('scene3d.character.applyAction', { action: t(action.labelKey as 'scene3d.character.action.standing') })}
              onClick={() => onApplyPreset(action.presetId)}
            >
              <Icon size={15} />
              <span>{t(action.labelKey as 'scene3d.character.action.standing')}</span>
            </button>
          )
        })}
        {recorder ? (
          <>
            <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
            <TakeRecordButton recorder={recorder} />
          </>
        ) : null}
        {speed ? (
          <>
            <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
            <SpeedSliderChip value={speed.value} onChange={speed.onChange} />
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
          title={t('scene3d.character.exitControl')}
          onClick={onExit}
        >
          <IconX size={15} />
          <span>{t('scene3d.character.exitControl')}</span>
        </button>
      </div>
      <div className="mt-1.5 text-center text-micro text-[var(--nomi-ink-60)]">
        {recorder?.isRecording
          ? t('scene3d.character.characterRecordingHint')
          : t('scene3d.character.characterControlHint')}
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
  speed,
}: {
  cameraName: string
  onExit: () => void
  recorder?: ActionBarRecorder
  speed?: { value: number; onChange: (speed: number) => void }
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="absolute bottom-5 left-1/2 z-[8] max-w-[calc(100%-32px)] -translate-x-1/2"
      aria-label={t('scene3d.character.cameraToolbarAria')}
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
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-2.5 text-caption text-[var(--nomi-paper)]" title={t('scene3d.character.controllingCamera')}>
          <IconVideo size={15} />
          <span className="max-w-[120px] truncate">{cameraName}</span>
        </span>
        {recorder ? (
          <>
            <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
            <TakeRecordButton recorder={recorder} />
          </>
        ) : null}
        {speed ? (
          <>
            <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
            <SpeedSliderChip value={speed.value} onChange={speed.onChange} />
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
          title={t('scene3d.character.exitCameraControl')}
          onClick={onExit}
        >
          <IconX size={15} />
          <span>{t('scene3d.character.exitControl')}</span>
        </button>
      </div>
      <div className="mt-1.5 text-center text-micro text-[var(--nomi-ink-60)]">
        {recorder?.isRecording
          ? t('scene3d.character.cameraRecordingHint')
          : t('scene3d.character.cameraControlHint')}
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
  speed,
  onAddObject,
  onAddProp,
  onAddCrowd,
  onAddCamera,
  onApplySceneTemplate,
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
  speed?: { value: number; onChange: (speed: number) => void }
  onAddObject: (kind: Scene3DGeometry | 'mannequin' | 'light') => void
  onAddProp: (kind: Scene3DPropKind) => void
  onAddCrowd: (options: CrowdAddOptions) => void
  onAddCamera: () => void
  onApplySceneTemplate: (template: Scene3DSceneTemplate) => void
  canvasFocusMode: boolean
  onToggleCanvasFocusMode: () => void
}): JSX.Element | null {
  if (possessedObject) {
    return (
      <CharacterActionBar
        speed={speed}
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
        speed={speed}
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
      onApplySceneTemplate={onApplySceneTemplate}
      canvasFocusMode={canvasFocusMode}
      onToggleCanvasFocusMode={onToggleCanvasFocusMode}
    />
  )
}
