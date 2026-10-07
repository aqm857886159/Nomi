/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（NomiSelect / WorkbenchButton / WorkbenchIconButton）、../../../../../../vendor/tablerIcons、../../../../../../utils/cn、
 *          ../../DirectorEditorContext、../../scene/pipCamera（PipRect / pipCameraIdOf）、../../model/cameraLens 的 exportAspectRatio
 * [OUTPUT]: 对外提供 PipViewport：画中画节目小窗的 DOM 外壳（默认左下，与导演视图同位，头部 机位下拉 · mm · 画幅 chip / LIVE / 折叠、透明画面区、进入·退出机位 + FOV 读数、拖标题移动、拖角缩放 280–520px）；
 *           导演视图（presentation）时同一个组件钉在视口左下（同一个角）、只有一行「▷ 镜头 N · 景别 · 运镜 · 画幅」，不给机位下拉 / 焦距 / FOV / 进入视角
 * [POS]: director/panels/viewport 的画中画（清单 §2.5 V7）：画面本身由 scene/PipRenderer 在主画布同一位置剪裁渲染，这里只量矩形写进 ref、
 *        没有机位或节目黑场时盖黑底「无信号」；位置/宽度/折叠持久到 localStorage。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../../../../../design'
import { IconChevronDown, IconChevronUp, IconPlayerPlayFilled, IconVideo } from '../../../../../../vendor/tablerIcons'
import { cn } from '../../../../../../utils/cn'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { exportAspectRatio } from '../../model/cameraLens'
import { pipCameraIdOf, type PipRect } from '../../scene/pipCamera'
import { DIRECTOR_TOP_CHROME_PX } from '../topbar/topChrome'
import type { DirectorViewportPresentation } from './DirectorViewport'

// v3（2026-10-04）：精修小窗改成贴左下（和导演视图同一个位置），布局按「左 + 底」记；v2 存的是「左 + 顶」，旧值不读，老用户回到左下默认
const STORAGE_KEY = 'nomi:director:pip:v3'
const MIN_WIDTH = 160
const MAX_WIDTH = 520
const EDGE = 8
/** 左下边距 = 导演视图小窗的 bottom-3 / left-3（12px）：两个模式切换时小窗不跳 */
const CORNER = 12

type PipLayout = { left: number; bottom: number; width: number; collapsed: boolean }
const DEFAULT_LAYOUT: PipLayout = { left: CORNER, bottom: CORNER, width: 280, collapsed: false }

function readLayout(): PipLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<PipLayout>
    return {
      left: Number.isFinite(parsed.left) ? Number(parsed.left) : DEFAULT_LAYOUT.left,
      bottom: Number.isFinite(parsed.bottom) ? Math.max(EDGE, Number(parsed.bottom)) : DEFAULT_LAYOUT.bottom,
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(parsed.width) || DEFAULT_LAYOUT.width)),
      collapsed: Boolean(parsed.collapsed),
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function writeLayout(layout: PipLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // 无本地存储时静默：小窗位置只是本机便利偏好
  }
}

export function PipViewport({ rectRef, canvasHostRef, presentation }: { rectRef: React.MutableRefObject<PipRect>; canvasHostRef: React.RefObject<HTMLDivElement | null>; presentation?: DirectorViewportPresentation }): JSX.Element | null {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const cameras = useDirectorStore((state) => state.activeScene().cameras)
  const exportRatio = useDirectorStore((state) => state.project.exportRatio)
  const activeCameraId = useDirectorStore((state) => state.activeCameraId)
  // 导演视图只回答「正在播哪一镜」：小窗跟播放头的节目机位，和 PipRenderer 用同一条选台规则
  const directorMode = presentation?.kind === 'director'
  const shownCameraId = useDirectorStore((state) => pipCameraIdOf(state, { followProgram: directorMode }))
  const isLive = useDirectorStore((state) => state.timeline.isPlaying || Boolean(state.recording))
  const recording = useDirectorStore((state) => Boolean(state.recording))
  const closeupBlocked = useDirectorStore((state) => (shownCameraId ? state.isCameraInCloseupAt(shownCameraId) : false))
  const showPreview = useDirectorStore((state) => state.showCameraPreview)
  const [layout, setLayout] = React.useState<PipLayout>(readLayout)
  const screenRef = React.useRef<HTMLDivElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const commitLayout = React.useCallback((next: PipLayout) => {
    setLayout(next)
    writeLayout(next)
  }, [])

  // 父宿主 ref 在子 layout effect 之后挂载，整次提交后再量；隐藏 / 折叠 / 无机位时清空。
  React.useEffect(() => {
    const screen = screenRef.current
    const host = canvasHostRef.current
    if (!showPreview || !screen || !host || (layout.collapsed && !directorMode) || !shownCameraId) {
      rectRef.current = null
      return undefined
    }
    const measure = () => {
      const hostRect = host.getBoundingClientRect()
      const box = screen.getBoundingClientRect()
      rectRef.current = { x: box.left - hostRect.left, y: box.top - hostRect.top, width: box.width, height: box.height }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(screen)
    observer.observe(host)
    return () => {
      observer.disconnect()
      rectRef.current = null
    }
  }, [canvasHostRef, directorMode, layout, rectRef, shownCameraId, showPreview])

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const origin = layout
    const host = canvasHostRef.current
    // 按「左 + 底」挪：往下拖 = 底边距变小；上限让开悬浮顶栏（DIRECTOR_TOP_CHROME_PX），下限贴视口底
    const place = (clientX: number, clientY: number): PipLayout => {
      const width = host?.clientWidth ?? 0
      const height = host?.clientHeight ?? 0
      const rootWidth = rootRef.current?.offsetWidth ?? origin.width
      const rootHeight = rootRef.current?.offsetHeight ?? 0
      return {
        ...origin,
        left: Math.max(EDGE, Math.min(width - rootWidth - EDGE, origin.left + (clientX - startX))),
        bottom: Math.max(EDGE, Math.min(height - rootHeight - DIRECTOR_TOP_CHROME_PX, origin.bottom - (clientY - startY))),
      }
    }
    const onMove = (move: PointerEvent) => setLayout(place(move.clientX, move.clientY))
    const onUp = (up: PointerEvent) => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      commitLayout(place(up.clientX, up.clientY))
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  const beginResize = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const origin = layout
    const onMove = (move: PointerEvent) => setLayout({ ...origin, width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, origin.width + (move.clientX - startX))) })
    const onUp = (up: PointerEvent) => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      commitLayout({ ...origin, width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, origin.width + (up.clientX - startX))) })
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  if (!showPreview) return null
  const aspect = exportAspectRatio(exportRatio) ?? 16 / 9
  const shown = cameras.find((camera) => camera.id === shownCameraId) ?? null
  const inPovOfShown = shown !== null && activeCameraId === shown.id
  const enterBlockedReason = recording ? t('director.camera.pipRecordingBlocked') : closeupBlocked ? t('director.camera.pipEnterBlocked') : null
  const ratioLabel = exportRatio === 'free' ? t('director.aspect.free') : exportRatio
  const screen = (
    <div ref={screenRef} className={cn('relative z-30 w-full', shown ? '' : 'bg-nomi-media-veil')} style={{ aspectRatio: String(aspect) }}>
      {!shown ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-nomi-media-veil text-caption text-nomi-media-ink/70">
          {cameras.length === 0 ? t('director.camera.pipNoCamera') : t('director.camera.pipNoSignal')}
        </div>
      ) : null}
      <div className="absolute bottom-0 right-0 size-3 cursor-nwse-resize" title={t('director.camera.pipResize')} onPointerDown={beginResize} />
    </div>
  )

  if (directorMode) {
    // 导演视图：钉在视口左下（样张位置），不可拖也不可折叠——它是这一面唯一的「成片在播什么」读数，折起来就没处看了
    return (
      <div
        ref={rootRef}
        className="pointer-events-auto absolute bottom-3 left-3 z-30 flex flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-transparent shadow-nomi-lg"
        style={{ width: layout.width }}
        data-testid="director-pip"
        data-pip-presentation="director"
      >
        {screen}
        <div className="flex items-center gap-1.5 bg-nomi-paper px-2 py-1 text-caption text-nomi-ink-60" data-testid="director-pip-now-playing">
          <IconPlayerPlayFilled size={12} stroke={2} className={cn('shrink-0', isLive ? 'text-nomi-accent' : 'text-nomi-ink-60')} aria-label={t('director.view.nowPlaying')} />
          <span className="min-w-0 flex-1 truncate font-medium text-nomi-ink">{presentation.nowPlaying ?? t('director.camera.pipTitle')}</span>
          <span className="shrink-0 font-nomi-mono text-micro">{ratioLabel}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      // 画面区必须透明：画中画的像素是 PipRenderer 直接画在主画布同一位置的，外壳只给标题栏 / 页脚上底色
      className="pointer-events-auto absolute z-30 flex flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-transparent shadow-nomi-lg"
      style={{ left: layout.left, bottom: layout.bottom, width: layout.width }}
      data-testid="director-pip"
    >
      <div className="flex cursor-grab items-center gap-1 border-b border-nomi-line-soft bg-nomi-paper px-2 py-1 text-caption text-nomi-ink-80 active:cursor-grabbing" title={t('director.camera.pipDrag')} onPointerDown={beginDrag}>
        <IconVideo size={14} stroke={1.9} className="shrink-0 text-nomi-ink-60" />
        {cameras.length === 0 ? <span className="font-semibold">{t('director.camera.pipTitle')}</span> : null}
        {shown ? (
          <>
            <span className="rounded-nomi-sm bg-nomi-ink-10 px-1 font-nomi-mono text-micro text-nomi-ink-60">{t('director.camera.pipMm', { mm: shown.focalLengthMm })}</span>
            <span className="rounded-nomi-sm bg-nomi-ink-10 px-1 font-nomi-mono text-micro text-nomi-ink-60">{ratioLabel}</span>
          </>
        ) : null}
        {isLive ? <span className="rounded-nomi-sm bg-nomi-danger px-1 text-micro font-semibold text-nomi-paper">{t('director.camera.pipLive')}</span> : null}
        <div className="flex-1" />
        {cameras.length > 0 ? (
          <span onPointerDown={(event) => event.stopPropagation()}>
            <NomiSelect
              size="xs"
              ariaLabel={t('director.camera.pipCameraAria')}
              value={shown?.id ?? ''}
              disabled={recording}
              title={recording ? t('director.camera.pipRecordingBlocked') : undefined}
              options={cameras.map((camera) => ({ value: camera.id, label: camera.name }))}
              onChange={(value) => store.getState().setPreviewCamera(value)}
            />
          </span>
        ) : null}
        <span onPointerDown={(event) => event.stopPropagation()}>
          <WorkbenchIconButton
            size="sm"
            icon={layout.collapsed ? <IconChevronUp size={14} stroke={2} /> : <IconChevronDown size={14} stroke={2} />}
            label={layout.collapsed ? t('director.camera.pipExpand') : t('director.camera.pipCollapse')}
            onClick={() => commitLayout({ ...layout, collapsed: !layout.collapsed })}
          />
        </span>
      </div>
      {layout.collapsed ? null : (
        <>
          {screen}
          <div className="flex items-center justify-between gap-2 bg-nomi-paper px-2 py-1 font-nomi-mono text-micro text-nomi-ink-40">
            <span>{shown ? t('director.camera.pipFov', { fov: shown.fov.toFixed(1), mm: shown.focalLengthMm }) : '—'}</span>
            {shown ? (
              <span title={enterBlockedReason ?? undefined}>
                <WorkbenchButton
                  size="sm"
                  disabled={Boolean(enterBlockedReason) && !inPovOfShown}
                  onClick={() => {
                    const state = store.getState()
                    if (inPovOfShown) {
                      state.exitCameraPOV()
                      return
                    }
                    state.enterCameraPOV(shown.id)
                  }}
                >
                  {inPovOfShown ? t('director.camera.exitPov') : t('director.camera.enterPov')}
                </WorkbenchButton>
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
