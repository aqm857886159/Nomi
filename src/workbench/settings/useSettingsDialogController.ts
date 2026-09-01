import React from 'react'
import type { ProductionPolicyRequirement } from '../production/productionPolicyRecovery'
import type { SettingsInitialSection, SettingsTab } from './SettingsDialog'

type SettingsOpenDetail = {
  tab?: string
  section?: string
  productionPolicy?: ProductionPolicyRequirement
}

export function normalizeSettingsInitialTab(tab: string | undefined): SettingsTab {
  return tab === 'models'
    || tab === 'ai'
    || tab === 'automation'
    || tab === 'general'
    || tab === 'about'
    ? tab
    : 'file'
}

function normalizeInitialSection(section: string | undefined): SettingsInitialSection {
  return section === 'cursor-host'
    || section === 'automation'
    || section === 'ai-models'
    || section === 'production-policy'
    || section === 'tikhub-connector'
    ? section
    : null
}

export function useSettingsDialogController() {
  const [opened, setOpened] = React.useState(false)
  const [initialTab, setInitialTab] = React.useState<SettingsTab>('file')
  const [initialSection, setInitialSection] = React.useState<SettingsInitialSection>(null)
  const [productionPolicyRequirement, setProductionPolicyRequirement] = React.useState<ProductionPolicyRequirement | null>(null)

  const openSettings = React.useCallback((detail?: SettingsOpenDetail) => {
    const section = normalizeInitialSection(detail?.section)
    setInitialTab(normalizeSettingsInitialTab(detail?.tab))
    setInitialSection(section)
    setProductionPolicyRequirement(section === 'production-policy' ? detail?.productionPolicy ?? null : null)
    setOpened(true)
  }, [])

  const openDefaultSettings = React.useCallback(() => openSettings(), [openSettings])
  const openModelSettings = React.useCallback(() => openSettings({ tab: 'models' }), [openSettings])

  const closeSettings = React.useCallback(() => setOpened(false), [])

  React.useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const detail = (event as CustomEvent<SettingsOpenDetail>).detail
      openSettings(detail)
    }
    // 兼容既有几十个调用点：旧事件名继续有效，但唯一宿主已经是设置里的「模型」。
    const handleOpenModelCatalog = () => openModelSettings()
    window.addEventListener('nomi-open-settings', handleOpenSettings)
    window.addEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
    return () => {
      window.removeEventListener('nomi-open-settings', handleOpenSettings)
      window.removeEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
    }
  }, [openModelSettings, openSettings])

  return {
    closeSettings,
    initialSection,
    initialTab,
    openDefaultSettings,
    openModelSettings,
    opened,
    productionPolicyRequirement,
  }
}
