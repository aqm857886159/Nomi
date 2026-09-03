import React from 'react'
import {
  IconAt,
  IconFileText,
  IconTimelineEvent,
  IconVideo,
  IconWorld,
  IconX,
  IconPhoto,
} from '@tabler/icons-react'
import type { ProjectAgentReference } from '../../workbenchStore'
import { cn } from '../../../utils/cn'
import { isResidentReferenceStale, presentResidentReference } from './residentReferenceDisplay'

type Translate = (key: string, options?: Record<string, unknown>) => string

function ReferenceIcon({ kind }: { kind: ProjectAgentReference['kind'] }): JSX.Element {
  if (kind === 'document') return <IconFileText size={12} aria-hidden="true" />
  if (kind === 'canvas') return <IconPhoto size={12} aria-hidden="true" />
  if (kind === 'preview') return <IconVideo size={12} aria-hidden="true" />
  if (kind === 'timeline') return <IconTimelineEvent size={12} aria-hidden="true" />
  if (kind === 'browser') return <IconWorld size={12} aria-hidden="true" />
  return <IconAt size={12} aria-hidden="true" />
}

export function ResidentReferenceChip({
  reference,
  t,
  onRemove,
  className,
}: {
  reference: ProjectAgentReference & Readonly<{ intentRole?: string; state?: string }>
  t: Translate
  onRemove: () => void
  className?: string
}): JSX.Element {
  const presentation = presentResidentReference(t, reference)
  return <span
    data-agent-reference={reference.id}
    data-agent-at-token="true"
    data-stale={isResidentReferenceStale(reference.state) ? 'true' : undefined}
    data-agent-reference-kind={reference.kind}
    data-agent-reference-context-bound={reference.contextHandle ? 'true' : 'false'}
    data-agent-reference-role={presentation.role}
    data-agent-reference-state={presentation.state}
    className={cn('inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-micro text-nomi-ink-80', className)}
    title={presentation.accessibleLabel}
    aria-label={presentation.accessibleLabel}
  >
    <ReferenceIcon kind={reference.kind} />
    <span className="shrink-0 text-nomi-ink-40" data-agent-reference-role-label="true">{presentation.role}</span>
    <span className="min-w-0 truncate">{reference.label}</span>
    {presentation.state ? <span className="shrink-0 text-nomi-ink-40" data-agent-reference-state-label="true">{presentation.state}</span> : null}
    <button type="button" aria-label={t('agentResident.removeReference')} title={t('agentResident.removeReference')} onClick={onRemove} className="grid size-4 shrink-0 place-items-center rounded-pill hover:bg-nomi-ink-10">
      <IconX size={11} aria-hidden="true" />
    </button>
  </span>
}
