import React from 'react'
import type { SettingsInitialSection, SettingsTab } from './SettingsDialog'
import type { ModelPageRequest } from '../../ui/onboarding/useModelPageRequest'

type SettingsOpenDetail = {
  tab?: string
  section?: string
  /** 模型 tab 直接落到这一家的接入页（画布「高清 → 去接入」这类一步可走的路）。 */
  vendorKey?: string
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
  return section === 'automation'
    || section === 'ai-models'
    || section === 'tikhub-connector'
    ? section
    : null
}

export function useSettingsDialogController() {
  const [opened, setOpened] = React.useState(false)
  const [initialTab, setInitialTab] = React.useState<SettingsTab>('file')
  const [initialSection, setInitialSection] = React.useState<SettingsInitialSection>(null)
  const [modelPageRequest, setModelPageRequest] = React.useState<ModelPageRequest>(null)

  const openSettings = React.useCallback((detail?: SettingsOpenDetail) => {
    const section = normalizeInitialSection(detail?.section)
    setInitialTab(normalizeSettingsInitialTab(detail?.tab))
    setInitialSection(section)
    const vendorKey = typeof detail?.vendorKey === 'string' ? detail.vendorKey.trim() : ''
    if (vendorKey) setModelPageRequest((current) => ({ vendorKey, token: (current?.token ?? 0) + 1 }))
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
    modelPageRequest,
    openDefaultSettings,
    openModelSettings,
    opened,
  }
}
