/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 DesignModal / NomiSegmented / WorkbenchButton / WorkbenchIconButton、
 *          ../../../../../../vendor/tablerIcons 的 IconHelp / IconRefresh、../../scene/viewSettings（DEFAULT_VIEW_SETTINGS / VIEW_SETTING_RANGES / DirectorPreferences）、
 *          ../../scene/sceneTheme 的 DirectorViewportTheme、../fields/SliderNumberField、../fields/FieldPrimitives 的 SectionHeader
 * [OUTPUT]: 对外提供 SettingsDialog：漫游速度 / 方向键转速 / 左键旋转灵敏度 / 右键平移灵敏度 / 惯性阻尼（各自恢复默认）+ 视口主题两档即时生效 + 帮助入口
 * [POS]: director/panels/dialogs 的偏好设置对话框（清单 §8 H1）：只改本机偏好（scene/viewSettings 持久），不碰工程；
 *        入口是视口右下显示模式开关旁的齿轮（一功能一个家）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DesignModal, NomiSegmented, WorkbenchButton, WorkbenchIconButton } from '../../../../../../design'
import { IconHelp, IconRefresh } from '../../../../../../vendor/tablerIcons'
import type { DirectorViewportTheme } from '../../scene/sceneTheme'
import { DEFAULT_VIEW_SETTINGS, VIEW_SETTING_RANGES, type DirectorPreferences, type ViewSettings } from '../../scene/viewSettings'
import { SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

const RAD_TO_DEG = 180 / Math.PI

// 每行：字段、文案 key、显示单位与换算（转速内部 rad/s，给用户看 °/s）
const VIEW_FIELDS: Array<{ key: keyof ViewSettings; labelKey: string; unit?: string; toDisplay?: (value: number) => number; fromDisplay?: (value: number) => number; digits: number }> = [
  { key: 'roamSpeed', labelKey: 'director.settings.roamSpeed', unit: 'm/s', digits: 1 },
  { key: 'roamRotateSpeed', labelKey: 'director.settings.roamRotateSpeed', unit: '°/s', toDisplay: (value) => value * RAD_TO_DEG, fromDisplay: (value) => value / RAD_TO_DEG, digits: 0 },
  { key: 'rotateSensitivity', labelKey: 'director.settings.rotateSensitivity', unit: '×', digits: 1 },
  { key: 'panSensitivity', labelKey: 'director.settings.panSensitivity', unit: '×', digits: 1 },
  { key: 'dampingFactor', labelKey: 'director.settings.dampingFactor', digits: 2 },
]

const THEMES: Array<{ value: DirectorViewportTheme; labelKey: string; hintKey: string }> = [
  { value: 'default', labelKey: 'director.settings.themeDefault', hintKey: 'director.settings.themeDefaultHint' },
  { value: 'neutral-gray', labelKey: 'director.settings.themeNeutral', hintKey: 'director.settings.themeNeutralHint' },
]

export type SettingsDialogProps = {
  open: boolean
  preferences: DirectorPreferences
  onChange: (next: DirectorPreferences) => void
  onClose: () => void
  onOpenHelp: () => void
}

export function SettingsDialog({ open, preferences, onChange, onClose, onOpenHelp }: SettingsDialogProps): JSX.Element {
  const { t } = useTranslation()
  const setView = (key: keyof ViewSettings, value: number) => onChange({ ...preferences, view: { ...preferences.view, [key]: value } })

  return (
    <DesignModal opened={open} onClose={onClose} title={t('director.settings.title')} size="md" centered>
      <div className="flex flex-col gap-3" data-nomi-escape-layer="director-settings" data-testid="director-settings-dialog">
        <section>
          <SectionHeader title={t('director.settings.roamTitle')} onReset={() => onChange({ ...preferences, view: DEFAULT_VIEW_SETTINGS })} />
          {VIEW_FIELDS.map((field) => {
            const range = VIEW_SETTING_RANGES[field.key]
            const toDisplay = field.toDisplay ?? ((value: number) => value)
            const fromDisplay = field.fromDisplay ?? ((value: number) => value)
            const value = preferences.view[field.key]
            const isDefault = Math.abs(value - DEFAULT_VIEW_SETTINGS[field.key]) < 1e-9
            return (
              <div key={field.key} className="flex items-center gap-1">
                <SliderNumberField
                  className="min-w-0 flex-1"
                  label={t(field.labelKey as 'director.settings.roamSpeed')}
                  value={toDisplay(value)}
                  min={toDisplay(range.min)}
                  max={toDisplay(range.max)}
                  step={toDisplay(range.step)}
                  unit={field.unit}
                  digits={field.digits}
                  onChange={(next) => setView(field.key, fromDisplay(next))}
                />
                <WorkbenchIconButton
                  size="sm"
                  icon={<IconRefresh size={13} stroke={2} />}
                  label={t('director.settings.resetField')}
                  disabled={isDefault}
                  onClick={() => setView(field.key, DEFAULT_VIEW_SETTINGS[field.key])}
                />
              </div>
            )
          })}
        </section>
        <section>
          <SectionHeader title={t('director.settings.themeTitle')} />
          <NomiSegmented
            ariaLabel={t('director.settings.themeTitle')}
            density="compact"
            fit="content"
            value={preferences.theme}
            options={THEMES.map((theme) => ({ value: theme.value, label: t(theme.labelKey as 'director.settings.themeDefault'), title: t(theme.hintKey as 'director.settings.themeDefaultHint') }))}
            onChange={(value) => onChange({ ...preferences, theme: value as DirectorViewportTheme })}
          />
        </section>
        <div className="flex items-center justify-between gap-2 border-t border-nomi-line-soft pt-2">
          <span className="text-micro text-nomi-ink-40">{t('director.settings.persisted')}</span>
          <WorkbenchButton size="sm" data-testid="director-settings-help" onClick={onOpenHelp}>
            <IconHelp size={14} stroke={1.8} />
            {t('director.settings.openHelp')}
          </WorkbenchButton>
        </div>
      </div>
    </DesignModal>
  )
}
