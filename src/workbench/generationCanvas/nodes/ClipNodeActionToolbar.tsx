import { IconCopy, IconCut, IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../design'

type Props = {
  canEdit: boolean
  canSplit: boolean
  editDisabledReason?: string
  splitDisabledReason?: string
  onSplit: () => void
  onDuplicate: () => void
  onRemove: () => void
}

export default function ClipNodeActionToolbar({
  canEdit,
  canSplit,
  editDisabledReason,
  splitDisabledReason,
  onSplit,
  onDuplicate,
  onRemove,
}: Props): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="ml-1 flex shrink-0 items-center gap-0.5 rounded-nomi-sm bg-nomi-ink-05" role="toolbar" aria-label={t('generationCommon.clipNode.actions')} data-testid="clip-node-actions">
      <span className="inline-flex" title={splitDisabledReason}>
        <WorkbenchIconButton
          label={t('generationCommon.clipNode.split')}
          title={splitDisabledReason ? '' : t('generationCommon.clipNode.split')}
          icon={<IconCut />}
          className="shrink-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 hover:bg-nomi-paper hover:text-nomi-ink"
          disabled={!canSplit}
          data-testid="clip-node-split"
          onClick={onSplit}
        />
      </span>
      <span className="inline-flex" title={editDisabledReason}>
        <WorkbenchIconButton
          label={t('generationCommon.clipNode.duplicate')}
          title={editDisabledReason ? '' : t('generationCommon.clipNode.duplicate')}
          icon={<IconCopy />}
          className="shrink-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 hover:bg-nomi-paper hover:text-nomi-ink"
          disabled={!canEdit}
          data-testid="clip-node-duplicate"
          onClick={onDuplicate}
        />
      </span>
      <span className="inline-flex" title={editDisabledReason}>
        <WorkbenchIconButton
          label={t('generationCommon.clipNode.remove')}
          title={editDisabledReason ? '' : t('generationCommon.clipNode.remove')}
          icon={<IconTrash />}
          className="shrink-0 rounded-nomi-sm bg-transparent text-nomi-ink-40 hover:bg-workbench-danger-soft hover:text-workbench-danger"
          disabled={!canEdit}
          data-testid="clip-node-remove"
          onClick={onRemove}
        />
      </span>
    </div>
  )
}
