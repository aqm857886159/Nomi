import { IconAlertTriangle, IconCheck, IconChevronRight, IconPlayerPlayFilled } from '@tabler/icons-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { NomiLoadingMark, WorkbenchButton } from '../../design'
import { buildNomiLocalAssetUrl } from '../../media/nomiLocalAssetUrl'
import { cn } from '../../utils/cn'
import { ProductionDetails } from './ProductionDetails'
import type { ProductionRunPrimaryAction, ProductionRunView } from './productionRunView'
import type { ProductionArtifact } from '../../../electron/productionRun/productionRunTypes'

// 制作任务卡（任务中心里的「看片台 + 兜底」· plan 2026-08-11-nomi-side-viewer-and-fallback N1/N4）。
//
// 归位：取代原先挂在画布助手面板里的 ProductionStatusPanel（P1 同 commit 删旧）。理由——
// ① 一功能一个家（§1.5.2）：run 本来就在任务中心列着，操作却在助手面板 = 一半住这一半住那；
// ② 任务中心顶栏常驻、任何视图都能开，助手面板只在生成区有；
// ③ 助手面板不再挤两套操作（用户实测「两个地方能操作、容易误点」的根因）。
//
// 范围：Nomi 侧只做 CLI 做不到的事——看像素 + 兜底。外部驱动（decisionHome='origin'）时，
// 门的主决策在发起端，这里只「指路 + 次级兜底键」，不复刻一套候选/批准 UI。
export type ProductionRunCardCopy = {
  /** 「Codex 那边等你决定」——指路条主句（已按门类取好措辞）。 */
  routeMessage: string
  /** 兜底键文案（「也可以在这里决定」）。 */
  routeFallback: string
}

type Props = {
  projectId: string
  view: ProductionRunView
  playbookName: string
  artifacts?: ProductionArtifact[]
  focusedArtifactId?: string | null
  onPrimaryAction: (action: Exclude<ProductionRunPrimaryAction, null>) => void
  onControl: (action: 'pause' | 'cancel') => void
  /** 点预览 = 跳到该产物（画布节点 / 预览页）。 */
  onOpenPreview?: () => void
}

const toneDot: Record<ProductionRunView['tone'], string> = {
  working: 'bg-nomi-accent',
  attention: 'bg-nomi-warning',
  danger: 'bg-workbench-danger',
  success: 'bg-workbench-success',
  neutral: 'bg-nomi-ink-30',
}

const tonePill: Record<ProductionRunView['tone'], string> = {
  working: 'bg-nomi-accent-soft text-nomi-accent',
  attention: 'bg-nomi-warning/20 text-nomi-warning',
  danger: 'bg-workbench-danger-soft text-workbench-danger',
  success: 'bg-workbench-success-soft text-workbench-success-ink',
  neutral: 'bg-nomi-ink-05 text-nomi-ink-60',
}

/** N4：主动作图标按语义派生——正向操作不再挂警告三角（那是错误符号）。 */
function ActionIcon({ tone }: { tone: ProductionRunView['tone'] }): JSX.Element {
  if (tone === 'danger') return <IconAlertTriangle size={13} stroke={1.6} aria-hidden />
  if (tone === 'success') return <IconCheck size={13} stroke={1.6} aria-hidden />
  return <IconChevronRight size={13} stroke={1.6} aria-hidden />
}

function safePreviewPath(value: string | undefined): value is string {
  return Boolean(
    value &&
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !/^[A-Za-z]:[\\/]/.test(value) &&
    !value.split(/[\\/]+/).includes('..'),
  )
}

export function ProductionRunTaskCard({
  projectId,
  view,
  playbookName,
  artifacts = [],
  focusedArtifactId = null,
  onPrimaryAction,
  onControl,
  onOpenPreview,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const actionInFlightRef = React.useRef(false)
  const [actionInFlight, setActionInFlight] = React.useState(false)
  // N4：视频先出封面 + 播放键；点了才换成真播放器（原生 controls chrome 在窄卡里又挤又脏）。
  const [videoLive, setVideoLive] = React.useState(false)

  const focusedArtifact = focusedArtifactId
    ? artifacts.find(
        (artifact) =>
          artifact.artifactId === focusedArtifactId &&
          ['image', 'video', 'export'].includes(artifact.kind) &&
          (safePreviewPath(artifact.thumbnailRelativePath) || safePreviewPath(artifact.projectRelativePath)),
      )
    : undefined
  const preview = focusedArtifact
    ? {
        artifactId: focusedArtifact.artifactId,
        kind: focusedArtifact.kind,
        ...(safePreviewPath(focusedArtifact.thumbnailRelativePath)
          ? { thumbnailRelativePath: focusedArtifact.thumbnailRelativePath }
          : {}),
        ...(safePreviewPath(focusedArtifact.projectRelativePath)
          ? { projectRelativePath: focusedArtifact.projectRelativePath }
          : {}),
      }
    : view.preview
  const imageRelativePath =
    preview?.thumbnailRelativePath ?? (preview?.kind === 'image' ? preview.projectRelativePath : undefined)
  const videoRelativePath =
    preview && ['video', 'export'].includes(preview.kind) ? preview.projectRelativePath : undefined
  const previewUrl = imageRelativePath ? buildNomiLocalAssetUrl(projectId, imageRelativePath) : null
  const videoUrl = videoRelativePath ? buildNomiLocalAssetUrl(projectId, videoRelativePath) : null
  React.useEffect(() => { setVideoLive(false) }, [videoUrl])

  const action = view.primaryAction
  const runAction = React.useCallback((fn: () => unknown) => {
    if (actionInFlightRef.current) return
    actionInFlightRef.current = true
    setActionInFlight(true)
    Promise.resolve(fn()).finally(() => {
      actionInFlightRef.current = false
      setActionInFlight(false)
    })
  }, [])

  // 门在发起端（外部 CLI 驱动）→ 这里只指路，兜底键降为次级文字键；
  // 门在本地（origin=nomi，没有 CLI 可用）→ 主按钮直接开门。
  const routedGate = Boolean(view.gateKind && view.decisionHome === 'origin')
  // 取消是这张卡上唯一能点的东西（无主动作、无暂停）——推不动的坏 Run 就长这样。
  const onlyExit = !action && view.controls.length === 1 && view.controls[0] === 'cancel'
  const hostLabel = t(`generationCommon.production.origin.${view.originHost}`)
  const previewFocused = Boolean(focusedArtifactId && preview?.artifactId === focusedArtifactId)
  const gateCopyParams = view.gateJob ? {
    index: view.gateJob.index,
    node: view.gateJob.nodeId,
    provider: view.gateJob.provider,
    model: view.gateJob.model,
  } : {}

  return (
    <section
      data-production-task-card
      className={cn('grid gap-2.5 rounded-nomi border border-nomi-line-soft bg-nomi-bg p-2.5')}
      aria-label={t('generationCommon.production.runPanel.aria')}
    >
      <div className={cn('flex items-center gap-2')}>
        <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-micro text-nomi-ink-60')}>
          <span className={cn('size-1.5 shrink-0 rounded-full', toneDot[view.tone])} aria-hidden />
          <span className={cn('truncate font-medium text-nomi-ink-80')}>
            {t('generationCommon.production.runPanel.origin', { host: hostLabel })}
          </span>
        </span>
        <span
          data-production-tone={view.tone}
          className={cn(
            'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold',
            tonePill[view.tone],
          )}
        >
          {view.tone === 'working' ? <NomiLoadingMark size={10} /> : null}
          {t(`generationCommon.production.runTone.${view.tone}`)}
        </span>
      </div>

      <div className={cn('grid gap-1')}>
        <h3 data-production-status-title className={cn('text-caption font-semibold leading-snug text-nomi-ink')}>
          {t(view.titleKey, gateCopyParams)}
        </h3>
        <p className={cn('text-micro leading-relaxed text-nomi-ink-60')}>
          {t(view.descriptionKey, gateCopyParams)}
        </p>
      </div>

      <div className={cn('flex flex-wrap gap-1')}>
        <span className={cn('rounded-full bg-nomi-ink-05 px-2 py-0.5 text-micro text-nomi-ink-60')}>{playbookName}</span>
        {/* 一个阶段都没有时不挂「0 / 0 已完成」——那是在给一条根本不存在的流水线报进度（同 N4 无产物不渲染）。 */}
        {view.details.totalStages > 0 ? (
          <span className={cn('rounded-full bg-nomi-ink-05 px-2 py-0.5 text-micro text-nomi-ink-60')}>
            {t('generationCommon.production.runDetails.stageCount', {
              completed: view.details.completedStages,
              total: view.details.totalStages,
            })}
          </span>
        ) : null}
        {typeof view.percent === 'number' ? (
          <span className={cn('rounded-full bg-nomi-ink-05 px-2 py-0.5 text-micro tabular-nums text-nomi-ink-60')}>
            {view.percent}%
          </span>
        ) : null}
      </div>

      {routedGate ? (
        <div
          data-production-route-hint
          className={cn('grid gap-1 rounded-nomi-sm bg-nomi-warning/12 px-2.5 py-2')}
        >
          <span className={cn('text-micro leading-relaxed text-nomi-ink-80')}>
            {t('generationCommon.production.route.waiting', { host: hostLabel })}
          </span>
          {action ? (
            <button
              type="button"
              data-production-primary-action
              disabled={actionInFlight}
              onClick={() => runAction(() => onPrimaryAction(action))}
              className={cn(
                'justify-self-start text-micro text-nomi-ink-60 underline underline-offset-2',
                'hover:text-nomi-ink disabled:text-nomi-ink-30',
              )}
            >
              {t('generationCommon.production.route.fallback')}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* N4：无产物不渲染——不再用 220px 空框 + 三处「没有产物」文案占掉决策空间。 */}
      {previewUrl || videoUrl ? (
        <figure
          data-production-preview
          data-production-focused-artifact={previewFocused ? focusedArtifactId : undefined}
          className={cn(
            'm-0 overflow-hidden rounded-nomi-sm border border-nomi-line-soft',
            previewFocused && 'ring-1 ring-nomi-accent',
          )}
        >
          {videoUrl && videoLive ? (
            <video
              src={videoUrl}
              {...(previewUrl ? { poster: previewUrl } : {})}
              controls
              autoPlay
              playsInline
              preload="metadata"
              aria-label={t('generationCommon.production.runPanel.previewAlt')}
              className={cn('aspect-video w-full bg-nomi-ink object-contain')}
            />
          ) : (
            <button
              type="button"
              data-production-preview-open
              onClick={() => (videoUrl ? setVideoLive(true) : onOpenPreview?.())}
              className={cn('relative block w-full')}
              aria-label={
                videoUrl
                  ? t('generationCommon.production.runPanel.playPreview')
                  : t('generationCommon.production.runPanel.openPreview')
              }
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={t('generationCommon.production.runPanel.previewAlt')}
                  className={cn('aspect-video w-full object-cover')}
                />
              ) : (
                <span className={cn('grid aspect-video w-full place-items-center bg-nomi-ink-05')} aria-hidden />
              )}
              {videoUrl ? (
                <span
                  className={cn(
                    'absolute inset-0 m-auto grid size-8 place-items-center rounded-full',
                    'bg-nomi-paper/90 text-nomi-ink shadow-nomi-sm',
                  )}
                  aria-hidden
                >
                  <IconPlayerPlayFilled size={13} />
                </span>
              ) : null}
              <span
                className={cn(
                  'absolute bottom-1.5 left-1.5 rounded-full bg-nomi-ink/70 px-1.5 py-0.5',
                  'text-micro text-nomi-paper backdrop-blur-sm',
                )}
              >
                {preview ? t(`generationCommon.production.artifactKind.${preview.kind}`) : ''}
              </span>
            </button>
          )}
        </figure>
      ) : null}

      <div className={cn('flex items-center gap-2')}>
        {!routedGate && action ? (
          <WorkbenchButton
            data-production-primary-action
            variant="primary"
            className={cn('h-7 flex-1 text-micro')}
            disabled={actionInFlight}
            aria-busy={actionInFlight}
            onClick={() => runAction(() => onPrimaryAction(action))}
          >
            <ActionIcon tone={view.tone} />
            {t(`generationCommon.production.runAction.${action}`)}
          </WorkbenchButton>
        ) : null}
        {view.controls.includes('pause') ? (
          <WorkbenchButton
            data-production-control="pause"
            className={cn('h-7 flex-1 text-micro')}
            disabled={actionInFlight}
            onClick={() => runAction(() => onControl('pause'))}
          >
            {t('generationCommon.production.control.pause')}
          </WorkbenchButton>
        ) : null}
        {/* N4：取消不可逆，不与暂停等权——降为弱化文字键，hover 转危险色。
            例外：这张卡上**没有别的可点**时（推不动的坏 Run），取消就是唯一出路，
            再压成灰色小字就又变成「没看到点的地方」。没有竞争对象时降权没有意义，
            误点的防线本来也是那道 confirmDialog，不是把它藏起来。 */}
        {view.controls.includes('cancel') ? (
          onlyExit ? (
            <WorkbenchButton
              data-production-control="cancel"
              className={cn('h-7 flex-1 text-micro')}
              disabled={actionInFlight}
              onClick={() => runAction(() => onControl('cancel'))}
            >
              {t('generationCommon.production.control.cancel')}
            </WorkbenchButton>
          ) : (
            <button
              type="button"
              data-production-control="cancel"
              disabled={actionInFlight}
              onClick={() => runAction(() => onControl('cancel'))}
              className={cn(
                'shrink-0 text-micro text-nomi-ink-40 transition-colors',
                'hover:text-workbench-danger disabled:text-nomi-ink-30',
              )}
            >
              {t('generationCommon.production.control.cancel')}
            </button>
          )
        ) : null}
      </div>

      <details className={cn('group')}>
        <summary
          className={cn('flex cursor-pointer list-none items-center gap-1 text-micro font-medium text-nomi-ink-60')}
        >
          <IconChevronRight
            size={12}
            stroke={1.5}
            className={cn('transition-transform group-open:rotate-90')}
            aria-hidden
          />
          {t('generationCommon.production.runPanel.details')}
        </summary>
        <ProductionDetails details={view.details} />
      </details>
    </section>
  )
}
