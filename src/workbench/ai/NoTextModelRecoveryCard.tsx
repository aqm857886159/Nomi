// 「创作助手缺文本模型」指路与一键自愈卡（O1c-agent entry.agent-pointer + entry.kept-recovery）：
//
// 触发：目录里没有任何可用 text 模型（ProjectAgentResidentShell 用 useHasTextModel 判定 hasTextModel === false 时挂载）。
//
// 两条分支共用同一处单一真相源（P1 不拆两套）：
// 1. 存在「供应商已存 Key、只是文本模型被关掉」的可恢复大脑（entry.kept-recovery）：
//    优先给「启用 {{model}}」一键恢复主按钮 +「连接模型」次按钮。
// 2. 全新未连模型（无已存 Key 的可恢复文本模型，O1c-agent entry.agent-pointer）：
//    遵守 §P5「一个东西一个家、Agent 只指路」——只放静态身份行、两句人话说明与可点击指路卡「连接 APIMart」，
//    点一下直接打开整窗「连接 APIMart」大页（openApimartConnect），绝不在聊天流内塞配置表单。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconBulb, IconCheck, IconChevronRight, IconPlugConnected } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { WorkbenchButton } from '../../design'
import { openApimartConnect } from '../../ui/onboarding/apimartConnectRoute'
import { fitsAssistantTextRole } from './assistantModelIdentity'
import { NomiIdentityRow } from './NomiIdentityRow'
import {
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
  upsertWorkbenchModelCatalogModel,
} from '../api/modelCatalogApi'

export type RecoverableTextBrain = { vendorKey: string; modelKey: string; labelZh: string }
type CardState = 'prompt' | 'enabling' | 'done'

/** 找一个「供应商已配 key、但被禁用」的文本模型（可一键启用的大脑，必须满足助手主控角色判据）。无则返回 null。 */
export async function findRecoverableBrain(): Promise<RecoverableTextBrain | null> {
  try {
    const [disabledTexts, vendors] = await Promise.all([
      listWorkbenchModelCatalogModels({ kind: 'text', enabled: false }),
      listWorkbenchModelCatalogVendors(),
    ])
    const keyed = new Set(vendors.filter((v) => v.hasApiKey).map((v) => v.key))
    const hit = disabledTexts.find((m) => keyed.has(m.vendorKey) && !m.unlisted && fitsAssistantTextRole(m))
    return hit ? { vendorKey: hit.vendorKey, modelKey: hit.modelKey, labelZh: hit.labelZh } : null
  } catch {
    return null
  }
}

export function NoTextModelRecoveryCard({
  onResolved,
  initialRecoverable,
}: {
  onResolved?: () => void
  initialRecoverable?: RecoverableTextBrain | null
}): JSX.Element | null {
  const { t } = useTranslation()
  const [state, setState] = React.useState<CardState>('prompt')
  const [recoverable, setRecoverable] = React.useState<RecoverableTextBrain | null>(
    initialRecoverable ?? null,
  )
  const [checked, setChecked] = React.useState(initialRecoverable !== undefined)

  React.useEffect(() => {
    let alive = true
    const load = (): void => {
      void findRecoverableBrain().then((r) => {
        if (!alive) return
        setRecoverable(r)
        setChecked(true)
      })
    }
    load()
    window.addEventListener('nomi-model-catalog-changed', load)
    return () => {
      alive = false
      window.removeEventListener('nomi-model-catalog-changed', load)
    }
  }, [])

  const openConnect = React.useCallback(() => {
    openApimartConnect()
  }, [])

  const enableBrain = React.useCallback(async () => {
    if (!recoverable) return
    setState('enabling')
    try {
      await upsertWorkbenchModelCatalogModel({ ...recoverable, kind: 'text', enabled: true })
      window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
      setState('done')
      onResolved?.()
    } catch {
      setState('prompt')
    }
  }, [recoverable, onResolved])

  if (!checked && state !== 'done') return null

  if (state === 'done') {
    return (
      <div className={cn('w-full max-w-full self-start')} data-role="assistant" data-recovery="no-text-model">
        <NomiIdentityRow />
        <div className={cn('flex items-start gap-2 rounded-nomi border border-nomi-line bg-nomi-ink-05 p-3')}>
          <IconCheck size={16} className={cn('mt-0.5 shrink-0 text-nomi-ink-80')} />
          <div className={cn('flex flex-col gap-1')}>
            <span className={cn('text-body-sm font-medium text-nomi-ink')}>
              {t('creationAi.noTextModel.readyTitle')}
            </span>
            <span className={cn('text-caption leading-snug text-nomi-ink-60')}>
              {t('creationAi.noTextModel.readyDescription')}
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (recoverable) {
    return (
      <div className={cn('w-full max-w-full self-start')} data-role="assistant" data-recovery="no-text-model">
        <NomiIdentityRow />
        <div className={cn('flex flex-col gap-3 rounded-nomi border border-nomi-line p-3')}>
          <div className={cn('flex items-start gap-2')}>
            <IconBulb size={18} className={cn('mt-0.5 shrink-0 text-nomi-ink-60')} />
            <div className={cn('flex flex-col gap-1')}>
              <span className={cn('text-body-sm font-medium leading-snug text-nomi-ink')}>
                {t('creationAi.noTextModel.title')}
              </span>
              <span className={cn('text-caption leading-snug text-nomi-ink-60')}>
                {t('creationAi.noTextModel.descriptionBefore')}
                <span className={cn('text-nomi-ink')}>{t('creationAi.noTextModel.textModel')}</span>
                {t('creationAi.noTextModel.descriptionAfter')}
              </span>
            </div>
          </div>
          <div className={cn('flex flex-col gap-2')}>
            <WorkbenchButton
              variant="primary"
              className="w-full"
              loading={state === 'enabling'}
              data-recovery-enable={recoverable.modelKey}
              onClick={() => void enableBrain()}
            >
              <IconBulb />
              <span className="min-w-0 truncate">
                {t('creationAi.noTextModel.enable', { model: recoverable.labelZh })}
              </span>
            </WorkbenchButton>
            <WorkbenchButton variant="default" className="w-full" onClick={openConnect}>
              <IconPlugConnected />
              {t('creationAi.noTextModel.settings')}
            </WorkbenchButton>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex w-full max-w-full flex-col gap-2 self-start pt-1"
      data-role="assistant"
      data-agent-pointer="apimart"
    >
      <NomiIdentityRow />
      <p className="m-0 text-body leading-[22px] text-nomi-ink">
        {t('onboardingProviders.entries.agentPointerBody')}
      </p>
      <button
        type="button"
        onClick={openConnect}
        data-agent-pointer-action="apimart"
        className="flex w-full max-w-max cursor-pointer items-center gap-2 rounded-panel border border-nomi-line bg-nomi-paper py-2 pl-2 pr-2.5 text-left transition-colors hover:border-nomi-ink-20 hover:bg-nomi-ink-05 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink"
      >
        <span
          aria-hidden="true"
          className="inline-grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink-05 text-nomi-ink-80 ring-1 ring-inset ring-nomi-line"
        >
          <IconPlugConnected size={16} stroke={1.8} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-body-sm font-semibold leading-5 text-nomi-ink">
            {t('onboardingProviders.entries.agentPointerTitle')}
          </span>
          <span className="text-caption leading-[18px] text-nomi-ink-60">
            {t('onboardingProviders.entries.agentPointerSubtitle')}
          </span>
        </span>
        <IconChevronRight size={13} stroke={1.8} className="shrink-0 text-nomi-ink-60" aria-hidden="true" />
      </button>
    </div>
  )
}
