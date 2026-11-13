import React, { type JSX } from 'react'
import { IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { confirmDialog, DesignModal, IconActionButton } from '../../design'
import {
  getSettingsEscapeOwnership,
  settingsEscapeTargetWasRemoved,
  shouldYieldSettingsEscape,
} from '../../design/overlayLayers'
import { hasSettingsUnsavedChanges } from '../../workbench/settings/settingsUnsavedChanges'
import type { ModelSettingsDialogEscapeAction } from './modelSettingsNavigation'

export function ModelSettingsDetailDialog({
  label,
  onClose,
  escapeAction,
  children,
}: {
  label: string
  onClose: () => void
  escapeAction: ModelSettingsDialogEscapeAction
  children: React.ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const closePromptOpenRef = React.useRef(false)

  const requestClose = React.useCallback(async (): Promise<void> => {
    if (!hasSettingsUnsavedChanges(contentRef.current)) {
      onClose()
      return
    }
    if (closePromptOpenRef.current) return
    closePromptOpenRef.current = true
    try {
      const discard = await confirmDialog({
        title: t('settings.unsaved.title'),
        message: t('settings.unsaved.message'),
        confirmLabel: t('settings.unsaved.discard'),
        danger: true,
      })
      if (discard) onClose()
    } finally {
      closePromptOpenRef.current = false
    }
  }, [onClose, t])

  React.useEffect(() => {
    if (escapeAction !== 'back') return

    const delegatedEscapes = new WeakSet<KeyboardEvent>()
    const externalEscapes = new WeakSet<KeyboardEvent>()
    const activeDialog = (): HTMLElement | null => contentRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null

    const markDelegatedEscape = (event: KeyboardEvent): void => {
      const dialog = activeDialog()
      if (event.key !== 'Escape' || !dialog) return
      if (event.isComposing) {
        delegatedEscapes.add(event)
        return
      }
      const ownership = getSettingsEscapeOwnership(dialog, event.target)
      if (ownership.dialogAbove) {
        externalEscapes.add(event)
        return
      }
      if (shouldYieldSettingsEscape(ownership)) delegatedEscapes.add(event)
    }

    const handleEscape = (event: KeyboardEvent): void => {
      const dialog = activeDialog()
      if (event.key !== 'Escape' || !dialog || externalEscapes.has(event)) return
      if (getSettingsEscapeOwnership(dialog, event.target).dialogAbove) return

      const ownership = {
        dialogAbove: false,
        openPopup: delegatedEscapes.has(event),
        targetOwnsEscape: event.defaultPrevented,
        targetWasRemoved: settingsEscapeTargetWasRemoved(event.target),
      }
      if (shouldYieldSettingsEscape(ownership)) {
        event.stopPropagation()
        return
      }

      event.preventDefault()
      event.stopPropagation()
      window.dispatchEvent(new CustomEvent('nomi-model-settings-back'))
    }

    window.addEventListener('keydown', markDelegatedEscape, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', markDelegatedEscape, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [escapeAction])

  return (
    <DesignModal
      opened
      onClose={() => { void requestClose() }}
      title={label}
      centered
      size={880}
      padding={0}
      withCloseButton={false}
      closeOnEscape={escapeAction === 'close'}
      closeOnClickOutside
      returnFocus
      // 高度上限和滚动归属归外壳（设计系统 §3.5）：这里只给工作台的固定高度 640（翻页时弹窗不跳），
      // 窗口更矮时由外壳的上限压住；各页自己的列表在页里滚。
      classNames={{
        content: 'h-[640px] w-full rounded-nomi-lg shadow-nomi-lg',
        header: 'sr-only',
        body: 'relative p-0',
      }}
    >
      <div
        ref={contentRef}
        data-model-settings-dialog
        className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden [&_[data-model-settings-page]>header]:pr-14"
      >
        <IconActionButton
          onClick={() => { void requestClose() }}
          aria-label={t('settings.close')}
          title={t('settings.close')}
          className="absolute right-1.5 top-1.5 z-30 size-11 bg-nomi-paper/95 text-nomi-ink-40 shadow-nomi-sm backdrop-blur-sm hover:bg-nomi-ink-05 hover:text-nomi-ink sm:right-3 sm:top-3 sm:size-8"
          icon={<IconX size={16} stroke={1.8} aria-hidden="true" />}
        />
        {children}
      </div>
    </DesignModal>
  )
}
