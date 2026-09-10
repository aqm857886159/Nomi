/**
 * [INPUT]: react-i18next、NomiSelect、DirectorEditorContext。
 * [OUTPUT]: WaypointAimField：单/批路标共用看向目标下拉，只列其他非组对象。
 * [POS]: 已选路标的 L2 检查器字段；动态跟踪仍由视线/特写片段负责。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect } from '../../../../../../design'
import { useDirectorStore } from '../../DirectorEditorContext'

export function WaypointAimField({ entityId, value, onChange }: { entityId: string; value: string; onChange: (target: string) => void }): JSX.Element {
  const { t } = useTranslation()
  const objects = useDirectorStore(state => state.activeScene().objects)
  const options = [{ value: '', label: t('director.timelineInspector.freeOrientation') }, ...objects.filter(object => object.id !== entityId && object.type !== 'group').map(object => ({ value: object.id, label: object.name }))]
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2 py-1 text-caption text-nomi-ink-80">
      <span>{t('director.timelineInspector.aimAt')}</span>
      <NomiSelect size="xs" ariaLabel={t('director.timelineInspector.aimAt')} value={options.some(option => option.value === value) ? value : ''} options={options} onChange={onChange} />
    </div>
  )
}
