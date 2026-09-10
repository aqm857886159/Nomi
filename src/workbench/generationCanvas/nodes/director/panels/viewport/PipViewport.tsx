/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（NomiSelect / WorkbenchButton / WorkbenchIconButton）、../../../../../../vendor/tablerIcons、../../../../../../utils/cn、
 *          ../../DirectorEditorContext、../../scene/pipCamera（PipRect / pipCameraIdOf）、../../model/cameraLens 的 exportAspectRatio
 * [OUTPUT]: 对外提供 PipViewport：画中画节目小窗的 DOM 外壳（默认左上，头部 机位下拉 · mm · 画幅 chip / LIVE / 折叠、透明画面区、进入·退出机位 + FOV 读数、拖标题移动、拖角缩放 280–520px）
 * [POS]: director/panels/viewport 的画中画（清单 §2.5 V7）：画面本身由 scene/PipRenderer 在主画布同一位置剪裁渲染，这里只量矩形写进 ref、
 *        没有机位或节目黑场时盖黑底「无信号」；位置/宽度/折叠持久到 localStorage。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../../../../../design'
import { IconChevronDown, IconChevronUp, IconVideo } from '../../../../../../vendor/tablerIcons'
import { cn } from '../../../../../../utils/cn'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { exportAspectRatio } from '../../model/cameraLens'
import { pipCameraIdOf, type PipRect } from '../../scene/pipCamera'
import { DIRECTOR_TOP_CHROME_PX } from '../topbar/topChrome'

const STORAGE_KEY = 'nomi:director:pip:v2'
const MIN_WIDTH = 160
const MAX_WIDTH = 520
const EDGE = 8

type PipLayout = { left: number; top: number; width: number; collapsed: boolean }
// 顶是悬浮顶栏之下（DIRECTOR_TOP_CHROME_PX），不是视口边缘：顶栏不占布局流，谁让开它由那个常量说了算
const DEFAULT_LAYOUT: PipLayout = { left: 14, top: DIRECTOR_TOP_CHROME_PX, width: 280, collapsed: false }

function readLayout(): PipLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<PipLayout>
    return {
      left: Number.isFinite(parsed.left) ? Number(parsed.left) : DEFAULT_LAYOUT.left,
      // 旧布局可能存着 14（顶栏改悬浮之前的边距），读回来夹到顶栏之下，老用户自愈
      top: Math.max(DIRECTOR_TOP_CHROME_PX, Number.isFinite(parsed.top) ? Number(parsed.top) : DEFAULT_LAYOUT.top),
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

export function PipViewport({ rectRef, canvasHostRef }: { rectRef: React.MutableRefObject<PipRect>; canvasHostRef: React.RefObject<HTMLDivElement> }): JSX.Element | null {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const cameras = useDirectorStore((state) => state.activeScene().cameras)
  const exportRatio = useDirectorStore((state) => state.project.exportRatio)
  const activeCameraId = useDirectorStore((state) => state.activeCameraId)
  const shownCameraId = useDirectorStore((state) => pipCameraIdOf(state))
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
    if (!showPreview || !screen || !host || layout.collapsed || !shownCameraId) {
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
  }, [canvasHostRef, layout, rectRef, shownCameraId, showPreview])

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const origin = layout
    const host = canvasHostRef.current
    const onMove = (move: PointerEvent) => {
      const width = host?.clientWidth ?? 0
      const height = host?.clientHeight ?? 0
      const rootWidth = rootRef.current?.offsetWidth ?? origin.width
      const rootHeight = rootRef.current?.offsetHeight ?? 0
      const left = Math.max(EDGE, Math.min(width - rootWidth - EDGE, origin.left + (move.clientX - startX)))
      const top = Math.max(EDGE, Math.min(height - rootHeight - EDGE, origin.top + (move.clientY - startY)))
      setLayout({ ...origin, left, top })
    }
    const onUp = (up: PointerEvent) => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      const width = host?.clientWidth ?? 0
      const height = host?.clientHeight ?? 0
      const rootWidth = rootRef.current?.offsetWidth ?? origin.width
      const rootHeight = rootRef.current?.offsetHeight ?? 0
      commitLayout({
        ...origin,
        left: Math.max(EDGE, Math.min(width - rootWidth - EDGE, origin.left + (up.clientX - startX))),
        top: Math.max(DIRECTOR_TOP_CHROME_PX, Math.min(height - rootHeight - EDGE, origin.top + (up.clientY - startY))),
      })
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

  return (
    <div
      ref={rootRef}
      // 画面区必须透明：画中画的像素是 PipRenderer 直接画在主画布同一位置的，外壳只给标题栏 / 页脚上底色
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-transparent shadow-nomi-lg"
      style={{ left: layout.left, top: layout.top, width: layout.width }}
      data-testid="director-pip"
    >
      <div className="flex cursor-grab items-center gap-1 border-b border-nomi-line-soft bg-nomi-paper px-2 py-1 text-caption text-nomi-ink-80 active:cursor-grabbing" title={t('director.camera.pipDrag')} onPointerDown={beginDrag}>
        <IconVideo size={14} stroke={1.9} className="shrink-0 text-nomi-ink-60" />
        {cameras.length === 0 ? <span className="font-semibold">{t('director.camera.pipTitle')}</span> : null}
        {shown ? (
          <>
            <span className="rounded-nomi-sm bg-nomi-ink-10 px-1 font-nomi-mono text-micro text-nomi-ink-60">{t('director.camera.pipMm', { mm: shown.focalLengthMm })}</span>
            <span className="rounded-nomi-sm bg-nomi-ink-10 px-1 font-nomi-mono text-micro text-nomi-ink-60">{exportRatio === 'free' ? t('director.aspect.free') : exportRatio}</span>
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
          <div ref={screenRef} className={cn('relative w-full', shown ? '' : 'bg-nomi-ink')} style={{ aspectRatio: String(aspect) }}>
            {!shown ? (
              <div className="absolute inset-0 flex items-center justify-center text-caption text-nomi-paper/70">
                {cameras.length === 0 ? t('director.camera.pipNoCamera') : t('director.camera.pipNoSignal')}
              </div>
            ) : null}
            <div className="absolute bottom-0 right-0 size-3 cursor-nwse-resize" title={t('director.camera.pipResize')} onPointerDown={beginResize} />
          </div>
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
