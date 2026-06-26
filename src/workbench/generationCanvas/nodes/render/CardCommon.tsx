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
import { cn } from '../../../../utils/cn'
import { NomiLoadingMark } from '../../../../design'

export const STRIPED_BG_CLASS =
  'bg-[repeating-linear-gradient(45deg,var(--nomi-ink-05)_0_23px,var(--nomi-ink-20)_23px_24px)]'

/** 空态统一文案常量（措辞单源，避免「等待生成/待生成」各处不一）。 */
export const PENDING_HINT_LABEL = '等待生成'

/**
 * 节点 body 左上角标题行（统一规格：可选「镜头 N」徽标 + text-body-sm font-semibold 标题）。
 * 收口占位卡 / 画板 / 音频等非图片 body 的标题——此前各写一套字号字重，扫节点找标题没稳定落点。
 * 图片卡（角色/场景/道具）的标题压在图上/图下是刻意沉浸式，不走这里（仅字号字重经 EditableNodeTitle 对齐）。
 */
export function NodeBodyHeader({ title, shotIndex }: { title?: string; shotIndex?: number | null }): JSX.Element | null {
  if (shotIndex == null && !title) return null
  return (
    <div className="flex flex-col gap-1 min-w-0">
      {shotIndex != null ? (
        <span className="self-start inline-flex items-center h-[18px] px-2 rounded-full bg-nomi-ink text-nomi-paper text-micro font-bold tabular-nums">
          镜头 {shotIndex}
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
  const cluster = (
    <>
      <span className="grid size-12 place-items-center rounded-full bg-nomi-ink text-nomi-paper">{icon}</span>
      {label ? <span className="text-body-sm font-semibold text-nomi-ink-80">{label}</span> : null}
      {hint ? <span className="text-caption text-nomi-ink-60">{hint}</span> : null}
    </>
  )
  if (!onActivate) {
    return <div className="flex flex-col items-center justify-center gap-2 text-center">{cluster}</div>
  }
  return (
    <button
      type="button"
      aria-label={activateAriaLabel || label || '打开'}
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center rounded-nomi px-4 py-3 bg-transparent border-0 cursor-pointer',
        'transition-[background] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05',
        'focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
      )}
      onClick={(event) => { event.stopPropagation(); onActivate() }}
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
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full',
        'bg-nomi-ink-05 text-nomi-ink-60',
        'text-micro px-2 py-[1px] tabular-nums',
      )}
    >
      ⊕{count}变体
    </span>
  )
}

export function PlaceholderCenter({ label }: { label: string }): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center w-full h-full gap-1 pointer-events-none')}>
      <span className="text-body-sm font-medium text-nomi-ink-60 tabular-nums">{label}</span>
      <span className="text-micro text-nomi-ink-40">{PENDING_HINT_LABEL}</span>
    </div>
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
}: {
  selected: boolean
  needsFirstFrame: boolean
  /** 审计 A15：已连首帧/参考边、只是上游还没生成出画面——提示等待而非再喊拖图。 */
  waitingUpstream?: boolean
  shotIndex: number | null
  title?: string
  prompt?: string
}): JSX.Element | null {
  if (selected) return null
  if (needsFirstFrame) {
    return (
      <div className="flex w-full h-full items-center justify-center pointer-events-none px-4 text-center">
        <span className="text-micro text-nomi-ink-40 leading-relaxed">
          {waitingUpstream ? (
            <>
              已连接上游画面
              <br />
              等待其生成完成
            </>
          ) : (
            <>
              把图片节点拖过来
              <br />
              作为首帧
            </>
          )}
        </span>
      </div>
    )
  }
  return (
    <div className="flex w-full h-full flex-col pointer-events-none p-2.5 gap-1 overflow-hidden">
      <NodeBodyHeader title={title} shotIndex={shotIndex} />
      {prompt ? (
        // 提示词是用户最常想复制的内容：穿透容器的 pointer-events-none + 覆盖 stage 的
        // user-select:none（select-text），并 stopPropagation 防节点拖拽吃掉划选手势。
        <span
          className="text-caption text-nomi-ink-60 leading-snug overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] select-text cursor-text pointer-events-auto"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {prompt}
        </span>
      ) : null}
      <span className="mt-auto text-micro text-nomi-ink-40">{PENDING_HINT_LABEL}</span>
    </div>
  )
}

/**
 * 生成中（queued/running）的统一品牌转圈遮罩（pending 规范 #1）。
 * 挂在节点根容器、对分镜/卡片/文本所有节点类型一致生效；z-[1] 盖住正文但低于
 * header 的状态文字徽标（z-[2]，仍显「生成中」），pointer-events-none 不挡交互。
 */
export function GeneratingOverlay(): JSX.Element {
  return (
    <div
      className={cn(
        'generation-canvas-v2-node__generating-overlay',
        'absolute inset-0 z-[1] grid place-items-center rounded-nomi',
        'bg-nomi-paper/[0.55] backdrop-blur-[2px] pointer-events-none',
      )}
      aria-hidden="true"
    >
      <NomiLoadingMark size={32} label="生成中" />
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
}: {
  accept: string
  label: string
  onUpload: (dataUrl: string, file: File) => void
}): JSX.Element {
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
  // drag threshold (2px) 保证短按弹文件框、长按拖动不冲突。
  // 但要拦 click 防止点 label 立刻弹文件框时也触发 selectNode 之外的副作用。
  return (
    <label
      className={cn(
        'flex flex-col items-center justify-center w-full h-full gap-1 cursor-pointer',
        'text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05/50 transition-colors',
      )}
    >
      <span className="text-body-sm font-medium tabular-nums pointer-events-none">+ 上传{label}</span>
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
  return categoryName || title || '节点'
}

/** Scene3DEditor 懒加载期间的占位（React.Suspense fallback）。 */
export function Scene3DEditorLoading(): JSX.Element {
  return (
    <div className={cn('flex w-full h-full items-center justify-center bg-nomi-ink-05 text-caption text-nomi-ink-40')}>
      3D 编辑器加载中
    </div>
  )
}
