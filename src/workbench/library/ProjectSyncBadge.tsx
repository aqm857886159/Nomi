import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconRefresh } from '@tabler/icons-react'
import { AnchoredPopover } from '../../design'
import { syncFaceOf, SYNC_TONE_CLASS } from './projectSyncFace'
import { cn } from '../../utils/cn'
import type { WorkspaceSyncInspection } from '../../../electron/shared/workspaceSyncContracts'

/**
 * 项目卡上的同步角标 + 它的详情浮层。
 *
 * 2026-09-11 用户实测反馈两条，都出在这一枚上：
 *
 * ① **角标被截断**。角标显示的一直是那句完整的话（「可在另一台电脑继续」/
 *    英文 "Ready to continue on another computer"），而卡片列宽只有 `minmax(200px, 1fr)`，
 *    这一行左边还站着更新时间。`max-w-[12rem] truncate` 于是每次都真的在截，
 *    截出来是「可在另一台电…」——而 `title` 写的又是同一句被截的话，悬停也读不到新东西。
 *    改法：**角标只说状态**（两到四个字），完整那句退回它本来的两个位置——
 *    `title` 悬停提示与浮层正文。短到不需要 `truncate`，所以 `truncate` 一并删掉：
 *    留着它等于宣布"我还准备继续截"。
 *
 * ② **浮层位置不对**。原来是 `absolute right-2 top-full` 挂在卡片上——意思是
 *    「贴着这张卡的下边缘、右对齐」，跟点的是哪一枚角标毫无关系；卡在网格最后一行时
 *    它还会被滚动容器切掉。改走 `AnchoredPopover`（Portal 到 body + fixed 贴锚点）：
 *    它贴的是**被点的那枚角标**，逃得出任何祖先的 overflow，
 *    并且顺手补上原来根本没有的「点外面 / Esc 关闭」。
 */

export default function ProjectSyncBadge({
  inspection,
  rootPath,
  open,
  onToggle,
  onClose,
  onRecheck,
  onOpenFolder,
  recheckFailed,
}: {
  inspection: WorkspaceSyncInspection
  rootPath: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  onRecheck: () => void
  /** 缺省 = 宿主没有「打开目录」这条路（如 Web 预览），那颗钮整枚不渲染。 */
  onOpenFolder?: (() => void) | undefined
  recheckFailed: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const anchorRef = React.useRef<HTMLButtonElement | null>(null)
  const face = syncFaceOf(inspection, t)
  const ready = inspection.status === 'ready'
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-sync-status={inspection.status}
        aria-label={face.full}
        aria-expanded={open}
        title={face.full}
        className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-0 bg-transparent p-0 font-inherit text-micro cursor-pointer', SYNC_TONE_CLASS[face.tone])}
        onClick={(event) => { event.stopPropagation(); onToggle() }}
      >
        <face.Icon size={12} stroke={1.8} aria-hidden="true" />
        <span>{face.badge}</span>
      </button>
      {open ? (
        <AnchoredPopover anchorRef={anchorRef} align="start" onClose={onClose}>
          <div
            role="dialog"
            aria-label={face.title}
            data-sync-popover
            className="w-64 rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-caption font-medium text-nomi-ink">{face.title}</div>
            <div className="mt-1 text-micro leading-relaxed text-nomi-ink-60">{face.hint}</div>
            <div className="mt-2 truncate rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 font-mono text-micro text-nomi-ink-60" title={rootPath}>{rootPath}</div>
            <div className="mt-3 flex items-center gap-2">
              {!ready ? (
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-nomi-sm border-0 bg-nomi-ink px-2.5 text-micro font-medium text-nomi-paper cursor-pointer hover:bg-nomi-accent"
                  onClick={onRecheck}
                >
                  <IconRefresh size={13} stroke={1.8} className="mr-1" aria-hidden="true" />
                  {t('library.syncRecheck')}
                </button>
              ) : null}
              {onOpenFolder ? (
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-micro text-nomi-ink cursor-pointer hover:bg-nomi-ink-05"
                  onClick={onOpenFolder}
                >
                  {t('library.syncOpenFolder')}
                </button>
              ) : null}
            </div>
            {recheckFailed ? (
              <div role="alert" className="mt-2 text-micro leading-relaxed text-nomi-danger">
                {t('library.syncRecheckFailed')}
              </div>
            ) : null}
          </div>
        </AnchoredPopover>
      ) : null}
    </>
  )
}
