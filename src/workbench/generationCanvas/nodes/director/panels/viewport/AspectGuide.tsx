/**
 * [INPUT]: 依赖 react、../../DirectorEditorContext 的 useDirectorStore、../../model/cameraLens（exportAspectRatio / frameGuideSize）、../../model/exportSize 的 exportDimensions、../../scene/pipCamera 的 PipRect
 * [OUTPUT]: 对外提供 AspectGuide：机位视角 + 画幅非 free 时的导出取景框（四周 80px 内边距装框、框外压暗、四角圆角括号、
 *           三分线、右上画幅徽标、右下导出像素徽标）
 * [POS]: director/panels/viewport 的画幅引导层：纯 DOM 叠加，自己量视口尺寸；框内所见即成片（FOV 补偿在 ViewCamera，与这里同一份 frameGuideSize）。
 *        压暗层用 SVG mask 给画中画挖洞：画中画的画面是同一张 canvas 透过外壳看到的，DOM 压暗层压在中间会把它一起压黑。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStore } from '../../DirectorEditorContext'
import { exportAspectRatio, frameGuideSize } from '../../model/cameraLens'
import { exportDimensions } from '../../model/exportSize'
import type { PipRect } from '../../scene/pipCamera'

const CORNER = 'absolute size-8 border-nomi-paper'

export function AspectGuide({ pipRectRef }: { pipRectRef: React.MutableRefObject<PipRect> }): JSX.Element | null {
  const inPov = useDirectorStore((state) => state.activeCameraId !== 'free')
  const exportRatio = useDirectorStore((state) => state.project.exportRatio)
  const exportResolution = useDirectorStore((state) => state.project.exportResolution)
  const showThirds = useDirectorStore((state) => state.activeScene().sceneConfig.showRuleOfThirds)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState({ width: 0, height: 0 })
  const [pipRect, setPipRect] = React.useState<PipRect>(null)
  // 画中画矩形住 ref（拖动 / 折叠时改）：POV 期间每帧对一下，变了才 setState
  React.useEffect(() => {
    if (!inPov) return undefined
    let frame = 0
    const tick = () => {
      const next = pipRectRef.current
      setPipRect((prev) => (prev === next || (prev && next && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height) ? prev : next))
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [inPov, pipRectRef])

  React.useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const update = () => setBox({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [inPov])

  const aspect = exportAspectRatio(exportRatio)
  if (!inPov || !aspect) return null
  const guide = frameGuideSize(box.width, box.height, aspect)
  if (guide.width <= 0 || guide.height <= 0) return <div ref={rootRef} className="pointer-events-none absolute inset-0" data-testid="director-aspect-guide" />
  const left = (box.width - guide.width) / 2
  const top = (box.height - guide.height) / 2
  const pixels = exportDimensions(exportRatio, exportResolution, box.width / Math.max(1, box.height))

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="director-aspect-guide">
      {/* 框外压暗：mask 挖掉取景框与画中画两块 */}
      <svg className="absolute inset-0 size-full" width={box.width} height={box.height} aria-hidden>
        <defs>
          <mask id="director-aspect-guide-mask">
            <rect x={0} y={0} width={box.width} height={box.height} fill="white" />
            <rect x={left} y={top} width={guide.width} height={guide.height} fill="black" />
            {pipRect ? <rect x={pipRect.x} y={pipRect.y} width={pipRect.width} height={pipRect.height} fill="black" /> : null}
          </mask>
        </defs>
        <rect x={0} y={0} width={box.width} height={box.height} className="fill-nomi-media-veil" mask="url(#director-aspect-guide-mask)" />
      </svg>
      <div className="absolute" style={{ left, top, width: guide.width, height: guide.height }}>
        <div className={`${CORNER} -left-px -top-px rounded-tl-2xl border-l-[3px] border-t-[3px]`} />
        <div className={`${CORNER} -right-px -top-px rounded-tr-2xl border-r-[3px] border-t-[3px]`} />
        <div className={`${CORNER} -bottom-px -left-px rounded-bl-2xl border-b-[3px] border-l-[3px]`} />
        <div className={`${CORNER} -bottom-px -right-px rounded-br-2xl border-b-[3px] border-r-[3px]`} />
        {showThirds ? (
          <>
            <div className="absolute inset-x-0 top-1/3 border-t border-nomi-paper/20" />
            <div className="absolute inset-x-0 top-2/3 border-t border-nomi-paper/20" />
            <div className="absolute inset-y-0 left-1/3 border-l border-nomi-paper/20" />
            <div className="absolute inset-y-0 left-2/3 border-l border-nomi-paper/20" />
          </>
        ) : null}
        <div className="absolute right-3 top-3 rounded-nomi-sm bg-nomi-paper px-2 py-0.5 text-caption font-bold text-nomi-ink shadow-nomi">{exportRatio}</div>
        <div className="absolute bottom-3 right-3 rounded-nomi-sm bg-nomi-ink/70 px-2 py-0.5 text-caption font-medium text-nomi-paper/90 backdrop-blur-sm">{`${pixels.width}×${pixels.height}`}</div>
      </div>
    </div>
  )
}
