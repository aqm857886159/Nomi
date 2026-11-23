import React from 'react'
import type { SettingsInitialSection, SettingsTab } from './SettingsDialog'
import { openApimartConnect } from '../../ui/onboarding/apimartConnectRoute'
import { hasPendingCustomCallIntent } from '../../ui/onboarding/customCallIntent'
import { useOnboardingModelAvailability } from '../../ui/onboarding/onboardingModelAvailability'
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
  const { hasUsableModelConnection } = useOnboardingModelAvailability()
  const hasUsableConnectionRef = React.useRef(hasUsableModelConnection)
  hasUsableConnectionRef.current = hasUsableModelConnection

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
    // E0：无可用连接且非报错卡脚本跳转时，全仓连接入口统一进整窗「连接 APIMart」大页；
    // 已有可用连接（如管理模型 / 类型修正）或带报错卡跳转意图时打开设置里的「模型」。
    const handleOpenModelCatalog = () => {
      if (!hasPendingCustomCallIntent() && !hasUsableConnectionRef.current) {
        openApimartConnect()
        return
      }
      openModelSettings()
    }
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
