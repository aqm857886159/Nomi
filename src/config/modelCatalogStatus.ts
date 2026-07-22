import type { BillingModelKind, ModelCatalogHealthDto } from '../workbench/api/modelCatalogApi'
import type { ModelOption, NodeKind } from './models'
import i18n from '../i18n'

export function resolveCatalogKind(kind?: NodeKind): BillingModelKind {
  if (kind === 'image' || kind === 'imageEdit') {
    return 'image'
  }
  if (kind === 'video') {
    return 'video'
  }
  if (kind === 'audio') {
    return 'audio'
  }
  return 'text'
}

export function normalizeCatalogLoadError(caught: unknown): Error {
  if (caught instanceof Error) {
    const message = caught.message.trim()
    if (caught instanceof TypeError || /failed to fetch|networkerror|load failed|fetch failed/i.test(message)) {
      return new Error(i18n.t('runtime.modelCatalog.desktopUnavailable'))
    }
    return caught
  }
  return new Error(i18n.t('runtime.modelCatalog.loadFailed'))
}

export type ModelCatalogStatus = 'loading' | 'api_unreachable' | 'catalog_empty' | 'kind_empty' | 'incomplete' | 'ready'

export function deriveModelCatalogStatus(input: {
  kind?: NodeKind
  options: readonly ModelOption[]
  health: ModelCatalogHealthDto | null
  error: Error | null
  healthError?: Error | null
  loading: boolean
}): { status: ModelCatalogStatus; message: string } {
  if (input.loading) {
    return { status: 'loading', message: i18n.t('runtime.modelCatalog.loading') }
  }
  if (input.error) {
    return {
      status: 'api_unreachable',
      message: i18n.t('runtime.modelCatalog.loadFailedWithMessage', { message: input.error.message }),
    }
  }
  if (input.healthError) {
    return {
      status: 'api_unreachable',
      message: i18n.t('runtime.modelCatalog.healthFailed', { message: input.healthError.message }),
    }
  }
  const catalogKind = resolveCatalogKind(input.kind)
  const health = input.health
  if (health?.issues.some((issue) => issue.code === 'catalog_empty' && issue.severity === 'error')) {
    return { status: 'catalog_empty', message: i18n.t('runtime.modelCatalog.empty') }
  }
  const kindSummary = health?.byKind.find((item) => item.kind === catalogKind)
  if (kindSummary && kindSummary.enabledModels === 0) {
    const label = i18n.t(`runtime.modelCatalog.kind.${catalogKind}` as 'runtime.modelCatalog.kind.image')
    return { status: 'kind_empty', message: i18n.t('runtime.modelCatalog.noKind', { kind: label }) }
  }
  if (
    health?.issues.some(
      (issue) => issue.severity === 'error' && (issue.kind === catalogKind || typeof issue.kind === 'undefined'),
    )
  ) {
    return { status: 'incomplete', message: i18n.t('runtime.modelCatalog.incomplete') }
  }
  if (input.options.length === 0) {
    const label = i18n.t(`runtime.modelCatalog.kind.${catalogKind}` as 'runtime.modelCatalog.kind.image')
    return { status: 'kind_empty', message: i18n.t('runtime.modelCatalog.noKind', { kind: label }) }
  }
  return { status: 'ready', message: i18n.t('runtime.modelCatalog.ready') }
}
