import React from 'react'
import type { ProductionPolicyRequirement } from '../production/productionPolicyRecovery'
import type { SettingsInitialSection } from './SettingsDialog'

type SettingsInitialTab = 'file' | 'ai' | 'automation' | 'general' | 'about'

type SettingsOpenDetail = {
  tab?: string
  section?: string
  productionPolicy?: ProductionPolicyRequirement
}

function normalizeInitialTab(tab: string | undefined): SettingsInitialTab {
  return tab === 'automation' || tab === 'ai' ? tab : 'file'
}

function normalizeInitialSection(section: string | undefined): SettingsInitialSection {
  return section === 'cursor-host'
    || section === 'automation'
    || section === 'ai-models'
    || section === 'production-policy'
    ? section
    : null
}

export function useSettingsDialogController() {
  const [opened, setOpened] = React.useState(false)
  const [initialTab, setInitialTab] = React.useState<SettingsInitialTab>('file')
  const [initialSection, setInitialSection] = React.useState<SettingsInitialSection>(null)
  const [productionPolicyRequirement, setProductionPolicyRequirement] = React.useState<ProductionPolicyRequirement | null>(null)

  const openDefaultSettings = React.useCallback(() => {
    setInitialTab('file')
    setInitialSection(null)
    setProductionPolicyRequirement(null)
    setOpened(true)
  }, [])

  const closeSettings = React.useCallback(() => setOpened(false), [])

  React.useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const detail = (event as CustomEvent<SettingsOpenDetail>).detail
      const section = normalizeInitialSection(detail?.section)
      setInitialTab(normalizeInitialTab(detail?.tab))
      setInitialSection(section)
      setProductionPolicyRequirement(section === 'production-policy' ? detail?.productionPolicy ?? null : null)
      setOpened(true)
    }
    window.addEventListener('nomi-open-settings', handleOpenSettings)
    return () => window.removeEventListener('nomi-open-settings', handleOpenSettings)
  }, [])

  return {
    closeSettings,
    initialSection,
    initialTab,
    openDefaultSettings,
    opened,
    productionPolicyRequirement,
  }
}
