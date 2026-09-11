/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../DirectorEditorContext、../../model/directorTypes、
 *          ../fields/FieldPrimitives 的 InspectorCard / SectionHeader、../fields/SliderNumberField
 * [OUTPUT]: 对外提供 CrowdMatrixCard：选中角色时的「批量生成群众队列」——行数 / 列数 / 间距 + 确定生成
 * [POS]: director/panels/inspector 的角色情境动作。2026-09-09 从视口底栏归位到这里：它要先选中一个角色才有意义，
 *        属于设计系统 §1.5 的 L2 情境层，塞在常驻条上既占预算又永远是灰的（原底栏就是 disabled + tooltip 解释）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../../../../design'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject } from '../../model/directorTypes'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

export function CrowdMatrixCard({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [rows, setRows] = React.useState(2)
  const [cols, setCols] = React.useState(3)
  const [spacing, setSpacing] = React.useState(2)

  return (
    <InspectorCard>
      <SectionHeader title={t('director.bottomBar.crowdTitle')} />
      <SliderNumberField label={t('director.bottomBar.crowdRows')} value={rows} min={1} max={10} step={1} onChange={setRows} />
      <SliderNumberField label={t('director.bottomBar.crowdCols')} value={cols} min={1} max={10} step={1} onChange={setCols} />
      <SliderNumberField label={t('director.bottomBar.crowdSpacing')} value={spacing} min={0.5} max={5} step={0.1} unit="m" onChange={setSpacing} />
      <WorkbenchButton
        size="sm"
        variant="primary"
        className="mt-2 w-full"
        data-testid="director-crowd-confirm"
        onClick={() => store.getState().batchCreateCrowd(object.id, rows, cols, spacing, t('director.bottomBar.crowdGroupName', { name: object.name }))}
      >
        {t('director.bottomBar.crowdConfirm')}
      </WorkbenchButton>
    </InspectorCard>
  )
}
