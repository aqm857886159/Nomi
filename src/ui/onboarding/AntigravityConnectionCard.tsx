import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconExternalLink, IconSparkles } from '@tabler/icons-react'
import { ANTIGRAVITY_VENDOR_KEY, ANTIGRAVITY_IMAGE_MODEL_KEY } from '../../../electron/shared/antigravity'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { TranslationKey } from '../../i18n/translationKey'
import { FoldableModelCard } from './FoldableModelCard'
import { ModelChipGroups, type ChipModel } from './ModelChipGroups'
import { groupAntigravityCatalogModels } from './antigravityCardModel'
import type { AntigravitySettingsSession } from './useAntigravitySettings'

const installUrl = 'https://antigravity.google/docs/cli/install/'
type Props = {
  enabled: boolean
  models: ChipModel[]
  selectedVariants: Readonly<Record<string, string>>
  session: AntigravitySettingsSession
  onOpenModel: (model: ChipModel) => void
  onChanged: () => void
}

type AntigravityFeedback = 'copied' | 'copyFailed' | 'saveFailed'

// 存**整键**而非 `antigravity.${feedback}` 拼接：拼接的模板 head 覆盖整棵 antigravity 命名空间，
// 死键门岗对它整片失明（见 src/i18n/translationKey.ts）；整键还顺带让编译器校验键存在。
const FEEDBACK_KEY = {
  copied: 'antigravity.copied',
  copyFailed: 'antigravity.copyFailed',
  saveFailed: 'antigravity.issues.saveFailed',
} as const satisfies Record<AntigravityFeedback, TranslationKey>

export function AntigravityConnectionCard({ enabled, models, selectedVariants, session, onOpenModel, onChanged }: Props): JSX.Element {
  const { t } = useTranslation()
  const [feedback, setFeedback] = React.useState<AntigravityFeedback | null>(null)
  const { view, controller, perform } = session
  const status = view.status
  const state = status?.state ?? 'unverified'
  const busy = !!view.busy || !controller
  // Cached discovery is useful while checking; it never grants verification or enablement.
  const discovered = new Set(status?.models.map((model) => model.id)
    ?? models.filter((model) => model.modelKey !== 'auto' && model.modelKey !== ANTIGRAVITY_IMAGE_MODEL_KEY).map((model) => model.modelKey))
  const groups = groupAntigravityCatalogModels(models.filter((model) => discovered.has(model.modelKey)), selectedVariants)
  const tools = models.filter((model) => model.modelKey === ANTIGRAVITY_IMAGE_MODEL_KEY).map((model) => ({ ...model, labelZh: t('antigravity.tool') }))
  const routes = models.filter((model) => model.modelKey === 'auto').map((model) => ({ ...model, labelZh: t('antigravity.automatic') }))
  const copyLogin = async () => {
    try { await navigator.clipboard.writeText(status?.loginCommand || 'agy'); setFeedback('copied') }
    catch { setFeedback('copyFailed') }
  }
  const disableConnection = () => {
    try { getDesktopBridge()?.modelCatalog.upsertVendor({ key: ANTIGRAVITY_VENDOR_KEY, enabled: false }); onChanged() }
    catch { setFeedback('saveFailed') }
  }
  return (
    <FoldableModelCard glyph={<IconSparkles size={16} stroke={1.5} />} name={t('antigravity.name')}
      subtitle={t('antigravity.subtitle')} status={state === 'error' || state === 'limited' ? 'error' : enabled ? 'ok' : 'todo'}
      statusLabel={enabled ? t('antigravity.enabled') : t(`antigravity.state.${state}`)} detailMode>
      <div className="flex items-center justify-between gap-3 border-b border-nomi-line pb-3">
        <div className="min-w-0">
          <div className="text-caption font-semibold text-nomi-ink">{t('antigravity.nativeAccount')}</div>
          <div role="status" className="mt-1 text-micro text-nomi-ink-60">{view.busy === 'checking' ? t('antigravity.checking') : t(`antigravity.state.${state}`)}</div>
        </div>
        {state === 'missing' ? <a href={installUrl} target="_blank" rel="noopener noreferrer" className="text-caption text-nomi-accent">{t('antigravity.install')}</a>
          : state === 'login-required' ? <DesignButton variant="light" onClick={() => void copyLogin()} disabled={busy}>{t('antigravity.copyLogin')}</DesignButton>
            : <DesignButton variant="light" onClick={() => void perform('check')} disabled={busy}>{t('antigravity.recheck')}</DesignButton>}
      </div>
      <div data-agy-models className="flex flex-col gap-4">
        <ModelChipGroups models={groups.map((group) => group.model)} connected={enabled} onOpenModel={onOpenModel} />
        {!groups.length ? <p className="text-caption text-nomi-ink-60">{t('antigravity.emptyModels')}</p> : null}
        <ModelChipGroups models={tools} connected={enabled} onOpenModel={onOpenModel} kindLabels={{ image: t('antigravity.imageTools') }} />
        <ModelChipGroups models={routes} connected={enabled} onOpenModel={onOpenModel} kindLabels={{ text: t('antigravity.routing') }} />
      </div>
      {view.issue || feedback ? <p role="status" className="text-caption text-nomi-ink-60">{view.issue ? t(`antigravity.issues.${view.issue}`) : t(FEEDBACK_KEY[feedback!])}</p> : null}
      <details className="border-t border-nomi-line pt-3 text-caption text-nomi-ink-60">
        <summary className="cursor-pointer font-semibold">{t('antigravity.details')}</summary>
        <div className="mt-2 flex flex-col gap-2 text-micro leading-relaxed">
          <div>{t('antigravity.version')}: {status?.version ?? t('antigravity.unknown')}</div>
          {status?.code ? <div>{t('antigravity.errorCode')}: <code>{status.code}</code></div> : null}
          <p>{t('antigravity.automaticHint')}</p><p>{t('antigravity.toolHint')}</p>
          <p>{t('antigravity.network')}</p><p>{t('antigravity.noAudioVideo')}</p><p>{t('antigravity.limits')}</p>
          <a href={installUrl} target="_blank" rel="noopener noreferrer" className="inline-flex self-start items-center gap-1 text-nomi-accent">{t('antigravity.docs')}<IconExternalLink size={14} stroke={1.5} /></a>
          {enabled ? <button type="button" disabled={busy} onClick={disableConnection} className="self-start text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50">{t('antigravity.turnOff')}</button> : null}
        </div>
      </details>
    </FoldableModelCard>
  )
}
