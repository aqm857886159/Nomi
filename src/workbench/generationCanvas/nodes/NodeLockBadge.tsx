// 节点锁徽标(harness S6-4,N11)。锁住=实心锁,一次点击解锁;未锁=描边锁,点击上锁。
// AI 改锁住节点由 gate deny(硬禁);对用户永远是一键软门。
//
// 家在**节点浮条**(FloatingToolbarShell),和「复制变体 / 生成记录」同一族——锁的作用对象是
// **这个节点**,不是这一次生成(2026-09-10 样张拍板,见 docs/design/2026-09-10-node-composer-bar-v1.md
// 的「反转『锁在底栏』那条决定的理由」)。生成浮框底栏那一份已同 commit 删除,不留并行版。
// 外挂组件:BaseGenerationNode 是白名单巨壳(R12),不往里塞实现(同 TechnicalReviewBadge)。
//
// 锁态自己从 store 读:浮条只知道 nodeId,再让它把 locked 一路传下来就是把同一个事实抄两份。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLock, IconLockOpen } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectCanvasNodeById } from '../store/canvasNodeGenerationIndex'

export function NodeLockBadge({ nodeId }: { nodeId: string }): JSX.Element {
  const { t } = useTranslation()
  // S3(2026-09-12)：浮条挂在每张选中的卡上，整表 find 等于每张卡每次重渲染都扫一遍全表。
  const locked = useGenerationCanvasStore((state) => Boolean(selectCanvasNodeById(state, nodeId)?.locked))
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
