import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown } from '@tabler/icons-react'
import { NomiMarkdown } from '../../common/NomiMarkdown'

/** Compact Agent markdown: long replies fold at 60%, while NomiMarkdown owns GFM/token styling. */
export function AgentPanelV4Markdown({ text }: { text: string }): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const long = text.length > 360
  return <div className="min-w-0" data-v4-markdown="true"><div className={long && !expanded ? 'max-h-60 overflow-hidden' : undefined}><NomiMarkdown compact profile="agent-v4" copyLabel={t('agentPanelV4.copy')} imageLabel={t('agentPanelV4.image')} expandLabel={t('agentPanelV4.expand')} collapseLabel={t('agentPanelV4.collapse')}>{text}</NomiMarkdown></div>{long ? <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 text-micro text-nomi-ink-60"><IconChevronDown size={12} className={expanded ? 'rotate-180' : undefined} />{expanded ? t('agentPanelV4.collapse') : t('agentPanelV4.expand')}</button> : null}</div>
}
