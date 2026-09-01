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
  // 3D 模型节点：其目录桶就是 'model3d'（catalog 按 kind 拉取时才拉得到已接入的 3D 模型，
  // 否则落回 'text' 桶 → 3D 节点的模型选择器永远空 → 生成路径断在选型）。
  if (kind === 'model3d') {
    return 'model3d'
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

export type ModelCatalogStatus =
  | 'loading'
  | 'api_unreachable'
  | 'catalog_read_only'
  | 'catalog_empty'
  | 'kind_empty'
  | 'incomplete'
  | 'ready'

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
  // 只读排在所有其他判定之前：目录写不进去时，「空 / 不完整 / 没有某类模型」全都是它的下游表现，
  // 报那些只会把用户引去「再配一次」——而配了也存不上。必须先说清真正的因，并给出唯一的出路。
  const readOnly = health?.issues.find(
    (issue) => issue.code === 'catalog_read_only_version_skew' && issue.severity === 'error',
  )
  if (readOnly) {
    return {
      status: 'catalog_read_only',
      message: i18n.t('runtime.modelCatalog.readOnlyVersionSkew', {
        diskVersion: readOnly.diskVersion ?? health?.diskVersion,
        appVersion: readOnly.appVersion ?? health?.appVersion,
      }),
    }
  }
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
