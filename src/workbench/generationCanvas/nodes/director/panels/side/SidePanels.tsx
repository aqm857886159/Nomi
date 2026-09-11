/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../utils/cn、./SceneObjectsTab、./AssetsTab、../inspector/ContextInspector、../EditorSplit、../topbar/topChrome
 * [OUTPUT]: 对外提供 SidePanels：视口右侧的浮起双卡 —— 上卡（场景对象 / 资产库 标签页）+ 下卡（属性检查器），中间可拖分栏，整列可拖宽
 * [POS]: director/panels/side 的右栏装配。2026-09-09 由「带左边框的实心列」改为浮起的双卡（方案第 2 期）：卡片有圆角 / 描边 / 阴影，
 *        与顶栏五簇同一套浮层语言，卡间留空让壳底色透出来。
 *        **浮窗（绝对定位压在视口上）**：3D 画面在卡片下连贯铺满，这是获批样张的形态。
 *        暗区靠**指针穿透**消掉，不是靠退回分栏：容器 pointer-events-none，只有两张卡和拖宽把手 auto，
 *        所以卡间空隙、上下留白、卡片右侧边距全都点得到视口。整块列都挡指针那版把「往右边画方块」直接堵死过（真机 j1 当场红）。
 *        列宽自持久 nomi:director:sideWidth；上下两卡之间仍用 EditorSplit，比例键 director.side 不变，老用户的分栏记忆不丢。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand } from '../../../../../../vendor/tablerIcons'
import { cn } from '../../../../../../utils/cn'
import { EditorSplit } from '../EditorSplit'
import { ContextInspector } from '../inspector/ContextInspector'
import { DIRECTOR_TOP_CHROME_PX } from '../topbar/topChrome'
import { AssetsTab } from './AssetsTab'
import { SceneObjectsTab } from './SceneObjectsTab'

const WIDTH_KEY = 'nomi:director:sideWidth'
const COLLAPSED_KEY = 'nomi:director:sideCollapsed'
const MIN_WIDTH = 260
const MAX_WIDTH = 520
const DEFAULT_WIDTH = 420
const EDGE = 12
const WIDTH_STEP = 16

function readWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WIDTH
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw))
  } catch {
    return DEFAULT_WIDTH
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // 无本地存储时静默：收起与否只是每台机器的便利偏好
  }
}

function writeWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
  } catch {
    // 无本地存储（隐私模式等）时静默：列宽只是每台机器的便利偏好
  }
}

/**
 * 卡片外壳：圆角 + 描边 + 阴影，和顶栏五簇同一套（浮起来的东西长一样）。
 * **刻意不用 backdrop-blur**：加在装着可拖拽列表的容器上会让真实鼠标事件送不到行的 onDoubleClick —— 
 * 2026-09-09 资产走查实测，「双击资产入场」当场失效，而 JS 派发的 dblclick 照常生效（所以单测和合成事件都发现不了）。
 * 这里的卡片压的是壳底色不是 3D 画面，模糊本来也换不来什么。顶栏五簇没有可拖拽行，保留 backdrop-blur 不受影响。
 */
function Card({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn('pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg', className)}>
      {children}
    </div>
  )
}

export function SidePanels(): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<'objects' | 'assets'>('objects')
  const [width, setWidth] = React.useState(readWidth)
  const [collapsed, setCollapsed] = React.useState(readCollapsed)
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      writeCollapsed(!prev)
      return !prev
    })
  }

  // 左缘拖宽。指针捕获 + 方向键微调 + Home/End 极值，与 EditorSplit 同手感。
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const origin = width
    const onMove = (move: PointerEvent) => {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, origin - (move.clientX - startX))))
    }
    const onUp = (up: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, origin - (up.clientX - startX)))
      setWidth(next)
      writeWidth(next)
      handle.releasePointerCapture(up.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  // 把真实列宽告诉全局 toast 容器：导演台的「交付」簇也住右上角，toast 不让开就会盖住
  // 截图 / 产出 / 退出（真机走查实测点不动）。宽度随拖动变，所以是 derive 不是写死。
  React.useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--nomi-director-side-width', collapsed ? '0px' : `${Math.round(width)}px`)
    return () => {
      root.style.removeProperty('--nomi-director-side-width')
    }
  }, [collapsed, width])

  const nudge = (delta: number) => {
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + delta))
    setWidth(next)
    writeWidth(next)
  }

  if (collapsed) {
    // 收起后必须留一个回得来的地方，否则就是把面板做丢了（控件契约：入口不能没有家）
    return (
      <div className="pointer-events-none absolute z-[5]" style={{ right: EDGE, top: DIRECTOR_TOP_CHROME_PX }} data-testid="director-side-panels">
        <button
          type="button"
          className="pointer-events-auto flex size-8 items-center justify-center rounded-nomi-lg border border-nomi-line bg-nomi-paper text-nomi-ink-60 shadow-nomi-lg transition-colors hover:text-nomi-ink"
          title={t('director.regions.expandSide')}
          aria-label={t('director.regions.expandSide')}
          aria-expanded={false}
          data-testid="director-side-expand"
          onClick={toggleCollapsed}
        >
          <IconLayoutSidebarRightExpand size={16} stroke={1.9} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="pointer-events-none absolute z-[5] flex"
      style={{ right: EDGE, top: DIRECTOR_TOP_CHROME_PX, bottom: EDGE, width }}
      data-testid="director-side-panels"
      data-nomi-right-panel="director"
    >
      <div
        role="separator"
        aria-label={t('director.regions.resizeHandle')}
        aria-orientation="vertical"
        tabIndex={0}
        className="pointer-events-auto -ml-1.5 w-3 shrink-0 cursor-col-resize rounded-full transition-colors hover:bg-nomi-accent/40 focus-visible:bg-nomi-accent"
        onPointerDown={onPointerDown}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); nudge(WIDTH_STEP) }
          if (event.key === 'ArrowRight') { event.preventDefault(); nudge(-WIDTH_STEP) }
          if (event.key === 'Home') { event.preventDefault(); nudge(MAX_WIDTH) }
          if (event.key === 'End') { event.preventDefault(); nudge(-MAX_WIDTH) }
        }}
      />
      <div className="min-w-0 flex-1">
        <EditorSplit direction="vertical" storageKey="director.side" defaultRatio={0.5} minRatio={0.2} maxRatio={0.8} className="gap-2">
          <Card>
            {/* 分段胶囊（对齐获批样张）。语义仍是 tablist / tab —— 它切换的是面板，不是单选值，
                所以不套 NomiSegmented（那是 radiogroup）：只借它的外观，不借它的语义。 */}
            <div className="flex shrink-0 items-center gap-2 p-2">
              <div className="grid flex-1 grid-cols-2 gap-1 rounded-nomi bg-nomi-ink-05 p-1 text-body-sm" role="tablist">
                {(['objects', 'assets'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    className={cn(
                      'rounded-nomi-sm px-2 py-1 transition-colors',
                      // 选中态不能用 bg-nomi-paper：那正是卡片底色，等于在卡上挖个看不见的洞（真机实测「场景对象」四个字消失）
                      tab === value ? 'bg-nomi-accent-soft font-medium text-nomi-accent' : 'text-nomi-ink-60 hover:text-nomi-ink',
                    )}
                    onClick={() => setTab(value)}
                  >
                    {value === 'objects' ? t('director.regions.sceneObjects') : t('director.regions.assets')}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="flex size-7 shrink-0 items-center justify-center rounded-nomi-sm text-nomi-ink-40 transition-colors hover:bg-workbench-hover hover:text-nomi-ink"
                title={t('director.regions.collapseSide')}
                aria-label={t('director.regions.collapseSide')}
                aria-expanded
                data-testid="director-side-collapse"
                onClick={toggleCollapsed}
              >
                <IconLayoutSidebarRightCollapse size={16} stroke={1.9} />
              </button>
            </div>
            {/* 页签内容自己是 h-full：必须给它一个由 flex 算准的盒子，否则它按整张卡的高撑满、
                再被卡片的 overflow-hidden 从底部裁掉 —— 列表末尾的条目会「渲染了但点不到」。 */}
            <div className="min-h-0 flex-1">{tab === 'objects' ? <SceneObjectsTab /> : <AssetsTab />}</div>
          </Card>
          <Card>
            <div className="min-h-0 flex-1">
              <ContextInspector />
            </div>
          </Card>
        </EditorSplit>
      </div>
    </div>
  )
}
