// 节点锁徽标(harness S6-4,N11)。锁住=实心锁常显,一次点击解锁;未锁=选中节点时
// 出现描边锁,点击上锁。AI 改锁住节点由 gate deny(硬禁);对用户永远是一键软门。
// 外挂组件:BaseGenerationNode 是白名单巨壳(R12),不往里塞实现(同 TechnicalReviewBadge)。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLock, IconLockOpen } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export function NodeLockBadge({
  nodeId,
  locked,
  selected,
}: {
  nodeId: string
  locked?: boolean
  selected?: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  if (!locked && !selected) return null
  return (
    <button
      type="button"
      className={cn(
        'inline-grid place-items-center w-6 h-6 rounded-full border-0 p-0',
        'backdrop-blur-[8px] cursor-pointer pointer-events-auto transition-colors duration-150',
        locked
          ? 'bg-nomi-ink text-nomi-paper hover:bg-nomi-ink-80'
          : 'bg-nomi-paper/[0.82] text-nomi-ink-40 hover:text-nomi-ink',
      )}
      aria-label={locked ? t('generationCommon.node.lock.unlockAria') : t('generationCommon.node.lock.lockAria')}
      title={locked ? t('generationCommon.node.lock.unlockHint') : t('generationCommon.node.lock.lockHint')}
      data-node-lock={locked ? 'locked' : 'unlocked'}
      onClick={(event) => {
        event.stopPropagation()
        useGenerationCanvasStore.getState().setNodeLocked(nodeId, !locked)
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {locked ? <IconLock size={13} stroke={1.8} /> : <IconLockOpen size={13} stroke={1.8} />}
    </button>
  )
}
