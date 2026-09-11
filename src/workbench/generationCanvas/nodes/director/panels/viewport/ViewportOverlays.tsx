/**
 * [INPUT]: 依赖 react、react-i18next、../../scene/LabelProjector 的 ProjectedLabel、../../scene/creation 两个 hook 的 API 类型
 * [OUTPUT]: 对外提供 ViewportLabels（角色名标签层）、PlacementHud（放置/画框模式提示条）
 * [POS]: director/panels/viewport 的叠加层（清单 §2.4 V6）：纯 DOM，绝对定位在视口之上，pointer-events 关闭不挡视口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectedLabel } from '../../scene/LabelProjector'
import type { BoxDrawApi } from '../../scene/creation/useBoxDraw'
import type { CharacterPlacementApi } from '../../scene/creation/useCharacterPlacement'
import type { PathDrawApi } from '../../scene/creation/usePathDraw'

export function ViewportLabels({ labels }: { labels: ProjectedLabel[] }): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {labels.map((label) => (
        <div
          key={label.id}
          className="absolute -translate-x-1/2 -translate-y-full select-none rounded-nomi-sm border border-nomi-line bg-nomi-paper/90 px-1.5 py-0.5 text-micro font-semibold text-nomi-ink shadow-nomi-sm backdrop-blur"
          style={{ left: label.x, top: label.y - 6 }}
        >
          {label.name}
        </div>
      ))}
    </div>
  )
}

export function PlacementHud({ placement, boxDraw }: { placement: CharacterPlacementApi; boxDraw: BoxDrawApi }): JSX.Element | null {
  const { t } = useTranslation()
  if (placement.active) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-nomi-line bg-nomi-paper/95 px-3 py-1 text-caption text-nomi-ink shadow-nomi-sm">
        <span className="text-nomi-ink-40">{t('director.hud.placementLabel')}</span>
        <span className="font-semibold">{placement.gender === 'female' ? t('director.creation.female') : t('director.creation.male')}</span>
        <span className="text-nomi-ink-40">{t('director.hud.placementHint', { heading: placement.headingDeg.toFixed(0) })}</span>
      </div>
    )
  }
  if (boxDraw.active) {
    const { width, depth, height } = boxDraw.dimensions
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-nomi-line bg-nomi-paper/95 px-3 py-1 text-caption text-nomi-ink shadow-nomi-sm">
        <span className="text-nomi-ink-40">{t('director.hud.boxSize')}</span>
        <span className="font-nomi-mono font-semibold">
          {t('director.hud.boxDims', { width: width.toFixed(2), depth: depth.toFixed(2) })}
          {boxDraw.step === 'extruding_height' ? t('director.hud.boxHeight', { height: height.toFixed(2) }) : ''}
        </span>
        <span className="text-nomi-ink-40">
          {boxDraw.step === 'extruding_height' ? t('director.hud.boxConfirmHint') : boxDraw.step === 'dragging_base' ? t('director.hud.boxExtrudeHint') : t('director.hud.boxStartHint')}
        </span>
      </div>
    )
  }
  return null
}

// 画路径模式提示条（T3/T4）：模式名 + 手势说明 + 已画点数
export function PathDrawHud({ pathDraw }: { pathDraw: PathDrawApi }): JSX.Element | null {
  const { t } = useTranslation()
  if (!pathDraw.active) return null
  const pencil = pathDraw.mode === 'pencil'
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-nomi-line bg-nomi-paper/95 px-3 py-1 text-caption text-nomi-ink shadow-nomi-sm">
      <span className="font-semibold">{pencil ? t('director.topbar.drawPencil') : t('director.topbar.waypoint')}</span>
      <span className="text-nomi-ink-40">{pencil ? t('director.trajectory.pencilHint') : t('director.trajectory.waypointHint')}</span>
      {pathDraw.pointCount > 0 ? <span className="font-nomi-mono">{t('director.trajectory.pointCount', { count: pathDraw.pointCount })}</span> : null}
    </div>
  )
}
