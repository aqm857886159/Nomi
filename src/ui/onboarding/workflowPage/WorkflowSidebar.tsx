/**
 * 工作流设置整页的左栏：后端（多台 · 加/删/改地址）+ 这台的工作流列表。
 * plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
 *
 * 「加一台」复用既有的 AddComfyuiInstanceButton（P1：一个功能一个家，不为这页再写一份加机器的表单）。
 *
 * 每行的缺件状态不是装饰：ComfyUI 工作流最常见的死法就是「这台机器上没装那个节点 / 没下那个模型」，
 * 用户点生成才 400。列表里当场标出来，是 D4「缺口明着标」的具体落法。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconMovie,
  IconPhoto,
  IconServerBolt,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { AddComfyuiInstanceButton } from '../AddComfyuiInstanceButton'

export type BackendRow = {
  vendorKey: string
  name: string
  baseUrl: string
  workflowCount: number
  /** null = 还没探完。 */
  reachable: boolean | null
  /** 第一台是种子，只能停用不能删（删了会被重新种回来）。 */
  removable: boolean
}

export type WorkflowRow = {
  modelKey: string
  labelZh: string
  kind?: string
  fieldCount: number
  /** 缺件对账结果；null = 还没对完 / 这台没开。 */
  missing: { nodes: number; files: number } | null
  missingFileNames: string[]
  offline: boolean
  /** 内置文生图没有原始 JSON，改不了绑定——列出来但标明白。 */
  builtin: boolean
}

type WorkflowSidebarProps = {
  backends: BackendRow[]
  selectedVendorKey: string
  onSelectBackend: (vendorKey: string) => void
  onSaveAddress: (vendorKey: string, address: string) => void
  onRemoveBackend: (row: BackendRow) => void
  onBackendsChanged: () => void
  workflows: WorkflowRow[]
  selectedModelKey: string | null
  onSelectWorkflow: (modelKey: string) => void
}

export function WorkflowSidebar({
  backends,
  selectedVendorKey,
  onSelectBackend,
  onSaveAddress,
  onRemoveBackend,
  onBackendsChanged,
  workflows,
  selectedModelKey,
  onSelectWorkflow,
}: WorkflowSidebarProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      {/* 三段一律 shrink-0，滚动交给外层 aside。
          ⚠️ 不加 shrink-0 的话，flex 会为了塞下兄弟节点把它们压扁——真机走查实锤：
          一条工作流暴露 8 个画布字段后，预览段把上面的工作流列表**挤成 0 高**，
          只剩一行「工作流 · 2」标题，用户从此换不了工作流（左栏本来就是拿来导航的）。 */}
      <section className="flex shrink-0 flex-col gap-1.5 rounded-nomi border border-nomi-line bg-nomi-paper p-2.5" data-workflow-backends>
        <div className="text-micro font-semibold text-nomi-ink-40">{t('comfyuiWorkflowPage.backends.title')}</div>
        {backends.map((backend) => (
          <BackendItem
            key={backend.vendorKey}
            backend={backend}
            selected={backend.vendorKey === selectedVendorKey}
            onSelect={() => onSelectBackend(backend.vendorKey)}
            onSaveAddress={(address) => onSaveAddress(backend.vendorKey, address)}
            onRemove={() => onRemoveBackend(backend)}
          />
        ))}
        <AddComfyuiInstanceButton onAdded={onBackendsChanged} />
      </section>

      <section className="flex shrink-0 flex-col gap-1.5 rounded-nomi border border-nomi-line bg-nomi-paper p-2.5" data-workflow-list>
        <div className="text-micro font-semibold text-nomi-ink-40">
          {t('comfyuiWorkflowPage.workflows.title')} · {workflows.length}
        </div>
        {/* 列表自己封顶再内滚（max-h + overflow）：工作流多的时候不许它把下面的画布预览顶出视野。
            封顶而不是任其变长，是因为左栏三段都要「一眼看得到」——这是导航栏，不是列表页。 */}
        {workflows.length === 0 ? (
          <div className="flex flex-col gap-1 pb-1">
            <p className="text-micro text-nomi-ink-40">{t('comfyuiWorkflowPage.workflows.empty')}</p>
            <p className="text-micro leading-relaxed text-nomi-ink-30">{t('comfyuiWorkflowPage.workflows.emptyHint')}</p>
          </div>
        ) : (
          <div className="flex max-h-[240px] flex-col gap-1 overflow-y-auto">
            {workflows.map((workflow) => (
              <WorkflowItem
                key={workflow.modelKey}
                workflow={workflow}
                selected={workflow.modelKey === selectedModelKey}
                onSelect={() => onSelectWorkflow(workflow.modelKey)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function BackendItem({
  backend,
  selected,
  onSelect,
  onSaveAddress,
  onRemove,
}: {
  backend: BackendRow
  selected: boolean
  onSelect: () => void
  onSaveAddress: (address: string) => void
  onRemove: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(backend.baseUrl)

  // 父组件重查后地址会变（改完地址 → onChanged → 重新下传）；非编辑态跟着走，别把旧草稿留在框里。
  React.useEffect(() => {
    if (!editing) setDraft(backend.baseUrl)
  }, [backend.baseUrl, editing])

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-nomi-sm border border-nomi-accent bg-nomi-paper p-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          autoFocus
          aria-label={t('comfyuiWorkflowPage.backends.addressAria', { name: backend.name })}
          className="h-6 min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-1.5 font-nomi-mono text-micro text-nomi-ink outline-none focus:border-nomi-accent"
        />
        <button
          type="button"
          onClick={() => { const next = draft.trim(); if (next) onSaveAddress(next); setEditing(false) }}
          aria-label={t('comfyuiWorkflowPage.backends.save')}
          className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-accent hover:bg-nomi-ink-05"
        >
          <IconCheck size={13} stroke={1.9} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => { setDraft(backend.baseUrl); setEditing(false) }}
          aria-label={t('common.cancel')}
          className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05"
        >
          <IconX size={13} stroke={1.9} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-nomi-sm border p-1.5',
        selected ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line-soft bg-nomi-paper',
      )}
      data-backend-key={backend.vendorKey}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <IconServerBolt size={14} stroke={1.7} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="min-w-0 truncate text-caption text-nomi-ink">{translateModelDisplayText(backend.name)}</span>
            <span
              className={cn('size-1.5 shrink-0 rounded-full', backend.reachable === null
                ? 'bg-nomi-ink-30'
                : backend.reachable ? 'bg-nomi-track-video' : 'bg-nomi-danger')}
              title={backend.reachable === null
                ? t('comfyuiWorkflowPage.backends.checking')
                : backend.reachable ? t('comfyuiWorkflowPage.backends.online') : t('comfyuiWorkflowPage.backends.offline')}
            />
          </span>
          <span className="block truncate font-nomi-mono text-micro text-nomi-ink-40">{backend.baseUrl}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded-nomi-sm px-1 text-micro text-nomi-ink-40 hover:text-nomi-accent"
      >
        {t('comfyuiWorkflowPage.backends.edit')}
      </button>
      {backend.removable ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('comfyuiWorkflowPage.backends.remove')}
          className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-05 hover:text-nomi-danger"
        >
          <IconTrash size={13} stroke={1.7} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

function WorkflowItem({
  workflow,
  selected,
  onSelect,
}: {
  workflow: WorkflowRow
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const Icon = workflow.kind === 'video' ? IconMovie : IconPhoto
  const missing = workflow.missing
  const hasMissing = Boolean(missing && (missing.nodes > 0 || missing.files > 0))

  return (
    <button
      type="button"
      onClick={onSelect}
      data-workflow-key={workflow.modelKey}
      aria-label={t('comfyuiWorkflowPage.workflows.selectAria', { name: workflow.labelZh })}
      aria-current={selected}
      className={cn(
        'flex w-full items-start gap-1.5 rounded-nomi-sm border p-1.5 text-left',
        selected ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line-soft bg-nomi-paper hover:border-nomi-accent',
      )}
    >
      <Icon size={14} stroke={1.7} className="mt-0.5 shrink-0 text-nomi-ink-40" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="min-w-0 truncate text-caption text-nomi-ink">{translateModelDisplayText(workflow.labelZh)}</span>
          {workflow.builtin ? (
            <span className="shrink-0 rounded-full bg-nomi-ink-05 px-1.5 text-micro text-nomi-ink-40">
              {t('comfyuiWorkflowPage.workflows.builtin')}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-micro text-nomi-ink-40">
          <span className="shrink-0">{t('comfyuiWorkflowPage.workflows.fieldCount', { count: workflow.fieldCount })}</span>
          <span aria-hidden="true">·</span>
          {workflow.offline ? (
            <span className="min-w-0 truncate text-nomi-ink-30">{t('comfyuiWorkflowPage.workflows.offline')}</span>
          ) : missing === null ? (
            <span className="min-w-0 truncate text-nomi-ink-30">{t('comfyuiWorkflowPage.backends.checking')}</span>
          ) : hasMissing ? (
            <span
              className="inline-flex min-w-0 items-start gap-0.5 whitespace-normal break-all text-nomi-danger"
              title={workflow.missingFileNames.join(', ')}
            >
              <IconAlertTriangle size={11} stroke={1.9} aria-hidden="true" />
              {missing.nodes > 0
                ? t('comfyuiWorkflowPage.workflows.missingNodes', { count: missing.nodes })
                : t('comfyuiWorkflowPage.workflows.missingFiles', {
                    count: missing.files,
                    names: workflow.missingFileNames.join(', '),
                  })}
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-0.5 truncate text-nomi-track-video">
              <IconCircleCheck size={11} stroke={1.9} aria-hidden="true" />
              {t('comfyuiWorkflowPage.workflows.complete')}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
