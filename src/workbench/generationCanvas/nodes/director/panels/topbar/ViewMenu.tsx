/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 NomiSegmented / WorkbenchIconButton、../../../../../../vendor/tablerIcons、../Popover、
 *          ../../DirectorEditorContext、../../model/directorTypes（导出画幅 / 分辨率枚举 / 显示模式）、../fields/FieldPrimitives 的 ToggleField
 * [OUTPUT]: 对外提供 ViewMenu：顶栏「视图 ▾」——几何体显示（实体 / 半透 / 白模）· 导出画幅 8 比例 + 自由 · 导出分辨率 3 档 ·
 *           三分线 / 骨骼与 IK 把手 / 角色头部标签三个视口开关 · 偏好设置与帮助入口
 * [POS]: director/panels/topbar 的视图簇。2026-09-09 收纳：画幅原住视口底栏，显示模式 + 设置 + 帮助原住视口右下角，
 *        骨骼把手原被误放在底栏（它是视口显示开关，不是角色属性）。三处都是低频项，按设计系统 §1.5.3 收进一个 ▾。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSegmented, WorkbenchIconButton } from '../../../../../../design'
import { IconAdjustments, IconContrast, IconHelp } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import {
  DIRECTOR_EXPORT_RATIOS,
  DIRECTOR_EXPORT_RESOLUTIONS,
  type DirectorExportRatio,
  type DirectorExportResolution,
  type DirectorModelDisplayMode,
} from '../../model/directorTypes'
import { ToggleField } from '../fields/FieldPrimitives'
import { Popover, PopoverItem } from '../Popover'

const MODES: DirectorModelDisplayMode[] = ['solid', 'translucent', 'clay']

function resolutionLabel(resolution: DirectorExportResolution): string {
  return resolution === '4k' ? '4K' : `${resolution}p`
}

export function ViewMenu({ onOpenSettings, onOpenHelp }: { onOpenSettings?: () => void; onOpenHelp?: () => void }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [open, setOpen] = React.useState(false)
  const mode = useDirectorStore((state) => state.activeScene().sceneConfig.modelDisplayMode)
  const exportRatio = useDirectorStore((state) => state.project.exportRatio)
  const exportResolution = useDirectorStore((state) => state.project.exportResolution)
  const showRuleOfThirds = useDirectorStore((state) => state.activeScene().sceneConfig.showRuleOfThirds)
  const showSkeleton = useDirectorStore((state) => state.activeScene().sceneConfig.showSkeleton)
  const showCharacterLabels = useDirectorStore((state) => state.activeScene().sceneConfig.showCharacterLabels)
  const patchSceneConfig = useDirectorStore((state) => state.patchSceneConfig)

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      panelClassName="w-[292px] p-3"
      trigger={
        <WorkbenchIconButton
          size="sm"
          icon={<IconContrast size={16} stroke={1.9} />}
          label={t('director.topbar.viewMenu')}
          aria-pressed={open}
          className={open ? 'bg-nomi-accent-soft text-nomi-accent' : ''}
          data-testid="director-view-menu"
          onClick={() => setOpen((value) => !value)}
        />
      }
    >
      <div className="mb-1 text-caption font-semibold text-nomi-ink-80">{t('director.viewMenu.display')}</div>
      <NomiSegmented
        ariaLabel={t('director.displayMode.aria')}
        density="compact"
        value={mode}
        options={MODES.map((value) => ({ value, label: t(`director.displayMode.${value}`), title: t(`director.displayMode.${value}Hint`) }))}
        onChange={(value) => patchSceneConfig({ modelDisplayMode: value as DirectorModelDisplayMode })}
      />

      <div className="mb-1 mt-3 text-caption font-semibold text-nomi-ink-80">{t('director.aspect.title')}</div>
      <div className="mb-1 text-micro text-nomi-ink-40">{t('director.aspect.ratio')}</div>
      <NomiSegmented
        ariaLabel={t('director.aspect.ratio')}
        density="compact"
        value={exportRatio}
        options={DIRECTOR_EXPORT_RATIOS.map((ratio) => ({ value: ratio, label: ratio === 'free' ? t('director.aspect.free') : ratio }))}
        onChange={(value) => store.getState().setExportRatio(value as DirectorExportRatio)}
      />
      <div className="mb-1 mt-2 text-micro text-nomi-ink-40">{t('director.aspect.resolution')}</div>
      <NomiSegmented
        ariaLabel={t('director.aspect.resolution')}
        density="compact"
        value={exportResolution}
        options={DIRECTOR_EXPORT_RESOLUTIONS.map((resolution) => ({ value: resolution, label: resolutionLabel(resolution) }))}
        onChange={(value) => store.getState().setExportResolution(value as DirectorExportResolution)}
      />

      <div className="mt-3 space-y-1 border-t border-nomi-line-soft pt-2">
        <ToggleField label={t('director.aspect.thirds')} hint={t('director.aspect.thirdsHint')} checked={showRuleOfThirds} onChange={(showRuleOfThirds) => patchSceneConfig({ showRuleOfThirds })} />
        <ToggleField label={t('director.bottomBar.skeleton')} hint={t('director.bottomBar.skeletonHint')} checked={showSkeleton} onChange={(showSkeleton) => patchSceneConfig({ showSkeleton })} />
        <ToggleField label={t('director.inspector.characterLabels')} checked={showCharacterLabels} onChange={(showCharacterLabels) => patchSceneConfig({ showCharacterLabels })} />
      </div>

      {onOpenSettings || onOpenHelp ? (
        <div className="mt-2 border-t border-nomi-line-soft pt-1">
          {onOpenSettings ? (
            <PopoverItem
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
            >
              <IconAdjustments size={16} stroke={1.9} />
              {t('director.viewMenu.prefs')}
            </PopoverItem>
          ) : null}
          {onOpenHelp ? (
            <PopoverItem
              onClick={() => {
                setOpen(false)
                onOpenHelp()
              }}
            >
              <IconHelp size={16} stroke={1.9} />
              {t('director.topbar.help')}
            </PopoverItem>
          ) : null}
        </div>
      ) : null}
    </Popover>
  )
}
