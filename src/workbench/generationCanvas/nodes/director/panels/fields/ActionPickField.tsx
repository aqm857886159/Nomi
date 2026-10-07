/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../../../../../vendor/tablerIcons、../../model/actionLibrary 的 findActionEntry
 * [OUTPUT]: 对外提供 ActionPickField：「动作」一行——标签 + 当前动作名按钮，点它由宿主打开动作选择弹窗（ActionSelectModal）
 * [POS]: director/panels/fields 的动作选择字段。只是入口按钮，不自带弹窗：「＋→角色→群众」浮层里的弹窗必须挂在浮层外（浮层外点会收起并卸载里面的东西），
 *        群众组右卡里同一个字段由卡自己挂弹窗；选择器本身永远是 panels/dialogs/ActionSelectModal 一份。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../../../../design'
import { IconChevronRight } from '../../../../../../vendor/tablerIcons'
import { findActionEntry } from '../../model/actionLibrary'

export function ActionPickField({ label, actionId, onOpen, mixed }: { label: string; actionId: string | null; onOpen: () => void; /** 组里的人动作不一致时显示「—」 */ mixed?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const known = actionId ? findActionEntry(actionId) : null
  const name = mixed || !known ? '—' : t(`director.action.library.${known.id}`)
  return (
    <div className="mb-2 grid grid-cols-[64px_1fr] items-center gap-2 text-caption">
      <span className="truncate text-nomi-ink-60">{label}</span>
      <WorkbenchButton size="sm" className="w-full" data-testid="director-action-pick" onClick={onOpen}>
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        <IconChevronRight size={14} stroke={1.9} className="text-nomi-ink-40" />
      </WorkbenchButton>
    </div>
  )
}
