/**
 * 卡片渲染共用 helpers + 子组件。
 *
 * 4 张卡片（角色/场景/道具/声音）共享：
 * - 占位斜条纹背景
 * - 关联计数 dot
 * - 变体 chip
 * - 数据缺失时隐藏对应行（spec §3.4 Level 0）
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconBox, IconMusic, IconPhoto, IconPlayerStop, IconUpload, IconUser, IconVideo, IconMap } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiLoadingMark } from '../../../../design'
import i18n from '../../../../i18n'
import { NodeEmptyState } from './NodeEmptyState'

export const STRIPED_BG_CLASS =
  'bg-[repeating-linear-gradient(45deg,var(--nomi-ink-05)_0_23px,var(--nomi-ink-20)_23px_24px)]'

/**
 * 节点 body 左上角标题行（统一规格：可选「镜头 N」徽标 + text-body-sm font-semibold 标题）。
 * 收口占位卡 / 画板 / 音频等非图片 body 的标题——此前各写一套字号字重，扫节点找标题没稳定落点。
 * 图片卡（角色/场景/道具）的标题压在图上/图下是刻意沉浸式，不走这里（仅字号字重经 EditableNodeTitle 对齐）。
 */
export function NodeBodyHeader({
  title,
  shotIndex,
}: {
  title?: string
  shotIndex?: number | null
}): JSX.Element | null {
  const { t } = useTranslation()
  if (shotIndex == null && !title) return null
  return (
    <div className="flex flex-col gap-1 min-w-0">
      {shotIndex != null ? (
        <span className="self-start inline-flex items-center h-[18px] px-2 rounded-full bg-nomi-ink text-nomi-paper text-micro font-bold tabular-nums">
          {t('generationCommon.card.shot', { index: shotIndex })}
        </span>
      ) : null}
      {title ? <span className="text-body-sm font-semibold text-nomi-ink-80 truncate">{title}</span> : null}
    </div>
  )
}

/**
 * 空态启动器（统一：size-12 圆形实心墨图标 + 主文案 + 副提示）。收口画板「点击打开」/ 3D「点击进入」
 * 此前圆⇄方、实心⇄描边的分叉。
 *
 * 点击：给 onActivate 即渲染成**可点按钮**（onPointerDown stopPropagation 不触发节点拖拽，卡片其余可拖；
 * 收口「文案说『点击进入』但 body 没挂 handler」的真坑）。不给 onActivate 则纯视觉。onPreload 在 hover/focus
 * 触发（如 3D 预拉编辑器 chunk）。点击/拖拽手势与外壳一致（外壳 setPointerCapture 在 article，故走显式按钮）。
 */
export function EmptyStateLauncher({
  icon,
  label,
  hint,
  onActivate,
  onPreload,
  activateAriaLabel,
}: {
  icon: React.ReactNode
  label?: string
  hint?: string
  onActivate?: () => void
  onPreload?: () => void
  activateAriaLabel?: string
}): JSX.Element {
  const { t } = useTranslation()
  const cluster = <NodeEmptyState icon={icon} title={label || ''} description={hint || ''} />
  if (!onActivate) {
    return <div className="flex flex-col items-center justify-center gap-2 text-center">{cluster}</div>
  }
  return (
    <button
      type="button"
      aria-label={activateAriaLabel || label || t('generationCommon.card.open')}
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center rounded-nomi px-4 py-3 bg-transparent border-0 cursor-pointer',
        'transition-[background] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05',
        'focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onActivate()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={onPreload}
      onFocus={onPreload}
    >
      {cluster}
    </button>
  )
}

export function UsageDot({ count }: { count: number }): JSX.Element | null {
  if (count <= 0) return null
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-nomi-accent" aria-hidden />
      <span className="text-micro text-nomi-ink-60 tabular-nums">{count}</span>
    </span>
  )
}

export function VariantChip({ count }: { count: number }): JSX.Element | null {
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full',
        'bg-nomi-ink-05 text-nomi-ink-60',
        'text-micro px-2 py-[1px] tabular-nums',
      )}
    >
      {t('generationCommon.card.variants', { count })}
    </span>
  )
}

/**
 * L3: 生成节点的"待生成"占位卡。未选中时不再只显斜纹 + "等待生成"，而是给
 * 镜头序号徽标 + 标题 + 提示词首行预览，让用户一眼分清哪个镜头（J3 走查）。
 * - selected：参数面板会盖上来，这里不渲染
 * - needsFirstFrame：video 节点缺首帧 → 提示拖图进来
 * - shotIndex：仅 shots 分类有，非 shots 传 null（不显徽标）
 */
export function PendingGenerationPlaceholder({
  selected,
  needsFirstFrame,
  waitingUpstream = false,
  shotIndex,
  title,
  prompt,
  kind,
}: {
  selected: boolean
  needsFirstFrame: boolean
  waitingUpstream?: boolean
  shotIndex: number | null
  title?: string
  prompt?: string
  kind: string
}): JSX.Element {
  const { t } = useTranslation()
  const isVideo = kind === 'video'
  const titleText = title || (isVideo ? t('generationCommon.nodeEmpty.video.title') : t('generationCommon.nodeEmpty.image.title'))
  const description = waitingUpstream
    ? t('generationCommon.nodeEmpty.waiting')
    : needsFirstFrame
      ? t('generationCommon.nodeEmpty.firstFrame')
      : isVideo
        ? t('generationCommon.nodeEmpty.video.description')
        : t('generationCommon.nodeEmpty.image.description')
  return (
    <div data-selected-placeholder={selected ? 'true' : 'false'} className="h-full w-full">
      <NodeEmptyState
        icon={isVideo ? <IconVideo size={20} stroke={1.6} /> : <IconPhoto size={20} stroke={1.6} />}
        title={shotIndex != null ? `${t('generationCommon.card.shot', { index: shotIndex })} · ${titleText}` : titleText}
        description={prompt ? `${description} ${prompt}` : description}
      />
    </div>
  )
}

function clampProgressPercent(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

function RemoveBackgroundProgressMark({ progress }: { progress?: number }): JSX.Element {
  const percent = clampProgressPercent(progress)
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const isDeterminate = percent !== null && percent > 0
  return (
    <div
      className={cn(
        'grid size-14 place-items-center rounded-full',
        'bg-nomi-paper/[0.92] text-nomi-ink shadow-nomi-md backdrop-blur-[8px]',
      )}
      aria-hidden="true"
    >
      <svg className="size-10" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={radius} fill="none" stroke="currentColor" strokeWidth="4" opacity="0.16" />
        <circle
          className={isDeterminate ? undefined : 'origin-center animate-spin motion-reduce:animate-none'}
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="4"
          strokeDasharray={isDeterminate ? circumference : '28 85'}
          strokeDashoffset={isDeterminate ? circumference * (1 - percent / 100) : 0}
          transform={isDeterminate ? 'rotate(-90 22 22)' : undefined}
        />
      </svg>
    </div>
  )
}

function RemoveBackgroundPendingStatus({
  title,
  message,
  progress,
}: {
  title?: string
  message?: string
  progress?: number
}): JSX.Element {
  const { t } = useTranslation()
  const percent = clampProgressPercent(progress)
  const statusMessage = message || t('generationCommon.card.removingBackground')
  const statusTitle = title || t('generationCommon.card.removeBackgroundNode')
  return (
    <div
      className="grid place-items-center gap-2"
      role="status"
      aria-label={t('generationCommon.card.removingBackground')}
      aria-busy="true"
    >
      <RemoveBackgroundProgressMark progress={progress} />
      <span className="rounded-full bg-nomi-paper/[0.88] px-2.5 py-1 text-micro font-medium text-nomi-ink-80 shadow-nomi-sm backdrop-blur-[8px]">
        {percent !== null && percent > 0 ? `${statusMessage} ${percent}%` : statusMessage}
      </span>
      <span className="sr-only">{t('generationCommon.card.generatingTransparentPng', { title: statusTitle })}</span>
    </div>
  )
}

export function RemoveBackgroundPendingPlaceholder({
  title,
  progress,
}: {
  title?: string
  progress?: number
}): JSX.Element {
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden bg-nomi-ink-05 p-4">
      <RemoveBackgroundPendingStatus title={title} progress={progress} />
    </div>
  )
}

/** 本地图片操作（抠图 / 切图 / 裁剪）进行中的读屏播报。视觉那一层是图本身的模糊呼吸。 */
export function LocalImageOpPendingStatus({
  message,
  progress,
}: {
  message?: string
  progress?: number
}): JSX.Element {
  const { t } = useTranslation()
  const percent = clampProgressPercent(progress)
  const statusMessage = message || t('generationCommon.card.removingBackground')
  return (
    <span className="sr-only" role="status" aria-label={statusMessage} aria-busy="true">
      {percent !== null && percent > 0 ? `${statusMessage} ${percent}%` : statusMessage}
    </span>
  )
}

/**
 * 生成中（queued/running）的统一品牌转圈遮罩（pending 规范 #1）。
 * 挂在节点根容器、对分镜/卡片/文本所有节点类型一致生效；z-[1] 盖住正文但低于
 * header 的状态文字徽标（z-[2]，仍显「生成中」），pointer-events-none 不挡交互。
 */
export function GeneratingOverlay({
  percent,
  message,
  previewUrl,
  onCancel,
}: {
  /** 0-100 真实进度（P 轨 ws 逐节点）。缺省 = 品牌转圈（No fake progress）。 */
  percent?: number
  /** 人话进度（narrate 产出，如「KSampler · 第 3/17 个节点」）。 */
  message?: string
  /** 活预览帧 data URL（ComfyUI 采样中间图，会话瞬态、不落盘）。 */
  previewUrl?: string
  /** 提供即显示遮罩内取消按钮（2026-08-01 拍板 A 位；仅本地 ComfyUI 任务可取消）。 */
  onCancel?: () => void
} = {}): JSX.Element {
  const { t } = useTranslation()
  const determinate = typeof percent === 'number' && Number.isFinite(percent)
  return (
    <div
      className={cn(
        'generation-canvas-v2-node__generating-overlay',
        'absolute inset-0 z-[1] grid place-items-center rounded-nomi overflow-hidden',
        'bg-nomi-paper/[0.55] backdrop-blur-[2px] pointer-events-none',
      )}
      aria-hidden={onCancel ? undefined : true}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={t('generationCommon.card.comfyPreviewAlt')}
          className="absolute inset-0 h-full w-full object-cover opacity-90"
          draggable={false}
        />
      ) : null}
      <div className="relative z-[1] grid place-items-center gap-2">
        {determinate ? (
          <RemoveBackgroundProgressMark progress={percent} />
        ) : (
          <NomiLoadingMark size={32} label={t('generationCommon.card.generating')} />
        )}
        {message ? (
          <span className="rounded-full bg-nomi-paper/[0.88] px-2.5 py-1 text-micro font-medium text-nomi-ink-80 shadow-nomi-sm backdrop-blur-[8px]">
            {message}
          </span>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            aria-label={t('generationCommon.card.generationCancelAria')}
            onClick={(event) => {
              event.stopPropagation()
              onCancel()
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1 rounded-full px-3.5 py-1 text-micro font-medium',
              'text-workbench-danger bg-[var(--workbench-danger-soft)] hover:opacity-85',
            )}
          >
            <IconPlayerStop size={13} stroke={1.8} />
            {t('generationCommon.card.generationCancel')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * v0.7.1: 卡片上传 CTA — 占位态时显示 + 上传按钮。
 * - image 卡（character/scene/prop）：accept=image/*
 * - audio 卡：accept=audio/*
 * 上传后通过 onUpload(dataUrl, file) 回调写到 node.result。
 */
export function UploadFallback({
  accept,
  label,
  onUpload,
  kind = 'image',
}: {
  accept: string
  label: string
  onUpload: (dataUrl: string, file: File) => void
  kind?: 'image' | 'video' | 'audio' | 'character' | 'scene' | 'prop'
}): JSX.Element {
  const { t } = useTranslation()
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = (loadEvent) => {
        const dataUrl = loadEvent.target?.result
        if (typeof dataUrl === 'string') onUpload(dataUrl, file)
      }
      reader.readAsDataURL(file)
    },
    [onUpload],
  )
  // v0.7.3 fix: 不 stopPropagation onPointerDown — 否则空卡片没法拖动。
  // 「短按弹文件框、长按拖动」由外壳 useNodeDragResize 保证：pointer capture 推迟到拖拽
  // 阈值(2px)跨过才抢——按下就抢会把 click 重定向到外壳，label 弹文件框整类失效（2026-08-03 群反馈）。
  const isAudio = accept.startsWith('audio')
  const isVideo = accept.startsWith('video')
  const icon = isAudio ? <IconMusic size={20} stroke={1.6} /> : isVideo ? <IconVideo size={20} stroke={1.6} /> : kind === 'character' ? <IconUser size={20} stroke={1.6} /> : kind === 'scene' ? <IconMap size={20} stroke={1.6} /> : kind === 'prop' ? <IconBox size={20} stroke={1.6} /> : <IconPhoto size={20} stroke={1.6} />
  const action = t('generationCommon.card.upload', { label })
  const nodeCopy = kind === 'character'
    ? { title: t('generationCommon.nodeEmpty.character.title'), description: t('generationCommon.nodeEmpty.character.description') }
    : kind === 'scene'
      ? { title: t('generationCommon.nodeEmpty.scene.title'), description: t('generationCommon.nodeEmpty.scene.description') }
      : kind === 'prop'
        ? { title: t('generationCommon.nodeEmpty.prop.title'), description: t('generationCommon.nodeEmpty.prop.description') }
        : isAudio
          ? { title: t('generationCommon.nodeEmpty.audio.title'), description: t('generationCommon.nodeEmpty.audio.description') }
          : isVideo
            ? { title: t('generationCommon.nodeEmpty.video.title'), description: t('generationCommon.nodeEmpty.video.description') }
            : { title: t('generationCommon.nodeEmpty.image.title'), description: t('generationCommon.nodeEmpty.image.description') }
  return (
    <label className="block h-full w-full cursor-pointer text-nomi-ink-60 transition-colors hover:text-nomi-ink hover:bg-nomi-ink-05/50">
      <NodeEmptyState
        icon={icon}
        title={nodeCopy.title}
        description={nodeCopy.description}
        action={<span className="inline-flex items-center gap-1.5 rounded-nomi-sm bg-nomi-ink px-3 py-1.5 text-caption font-medium text-nomi-paper"><IconUpload size={14} stroke={1.8} />{action}</span>}
      />
      <input className="hidden" type="file" accept={accept} onChange={handleChange} />
    </label>
  )
}

/**
 * 取节点的"placeholder 标签"
 * shots → "分镜 NN"（由 BaseGenerationNode 接管，不走这里）
 * 其它 → 分类名 / fallback title
 */
export function placeholderLabel(categoryName: string | undefined, title: string | undefined): string {
  return categoryName || title || i18n.t('generationCommon.card.node')
}

/** Scene3DEditor 懒加载期间的占位（React.Suspense fallback）。 */
export function Scene3DEditorLoading(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn('flex w-full h-full items-center justify-center bg-nomi-ink-05 text-caption text-nomi-ink-40')}>
      {t('generationCommon.card.scene3dLoading')}
    </div>
  )
}
