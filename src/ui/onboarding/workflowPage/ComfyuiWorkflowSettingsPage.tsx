/**
 * ComfyUI「工作流设置」整页。
 * plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
 *
 * 为什么另起一层、不塞进设置对话框：那张对话框是 760×560，装不下节点图。整页 Portal 到 body，
 * 盖在设置之上（设置 z-9000 → 这里 z-9100），返回时设置还在原样开着（用户的上下文不丢）。
 *
 * 为什么要这页（2026-08-11 反馈的体验根源）：以前配一条工作流，是在 320px 窄栏里对着
 * 「#110 CLIPTextEncode」猜哪个是提示词。现在图摆在眼前，点那张卡说「你是提示词」。
 *
 * 与「导入自定义工作流」的分工（§1.5.2 一功能一个家，2026-08-12 用户拍板）：
 *   贴 JSON 导入 = 接入动作，留在 ComfyUI 卡里；
 *   改绑定/改字段/改名/删除 = 配置动作，全在这页。窄栏那套编辑态已同 commit 删除，不留并行版（P1）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import { IconAlertTriangle, IconArrowLeft, IconTrash, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { alertDialog, confirmDialog, NOMI_OVERLAY_Z_INDEX } from '../../../design'
import { getDesktopBridge } from '../../../desktop/bridge'
import { toast } from '../../toast'
import { buildWorkflowGraphView, type GraphInput } from '../comfyuiWorkflowGraphView'
import { buildCanvasPreview, previewValuesToExtras } from '../comfyuiCanvasPreview'
import {
  assignRole,
  clearRole,
  fieldChoicesForNode,
  normalizeBinding,
  roleChoicesForNode,
  toggleField,
  workflowMediaBindings,
  type RoleChoice,
  type WorkflowAnalysis,
  type WorkflowBinding,
  type WorkflowCandidate,
  type WorkflowRole,
} from '../comfyuiWorkflowBinding'
import { WorkflowSidebar, type BackendRow } from './WorkflowSidebar'
import { WorkflowGraphCanvas } from './WorkflowGraphCanvas'
import { WorkflowCanvasPreview } from './WorkflowCanvasPreview'
import { useWorkflowCatalog } from './useWorkflowCatalog'
import { runTestGeneration } from './runTestGeneration'
import { candidateFailureText, candidateFromWorkflowMutation, settleCandidateUiRun, type ComfyCandidateUiState } from '../comfyCandidateUiFlow'

type ComfyuiWorkflowSettingsPageProps = {
  /** 从哪台 ComfyUI 进来的。 */
  vendorKey: string
  /** 进来时直接打开哪条工作流（从工作流行进来时带上）。 */
  initialModelKey?: string
  onClose: () => void
  /** 保存/删除后冒泡，让底下的模型面重查。 */
  onChanged: () => void
}

export function ComfyuiWorkflowSettingsPage({
  vendorKey: initialVendorKey,
  initialModelKey,
  onClose,
  onChanged,
}: ComfyuiWorkflowSettingsPageProps): JSX.Element {
  const { t } = useTranslation()
  const [vendorKey, setVendorKey] = React.useState(initialVendorKey)
  const [refreshToken, setRefreshToken] = React.useState(0)
  const catalog = useWorkflowCatalog(vendorKey, refreshToken)

  const [selectedModelKey, setSelectedModelKey] = React.useState<string | null>(initialModelKey ?? null)
  const [analysis, setAnalysis] = React.useState<WorkflowAnalysis | null>(null)
  const [binding, setBinding] = React.useState<WorkflowBinding | null>(null)
  const [graphText, setGraphText] = React.useState('')
  const [uiWorkflowText, setUiWorkflowText] = React.useState('')
  const [name, setName] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [previewValues, setPreviewValues] = React.useState<Record<string, string>>({})
  const [candidate, setCandidate] = React.useState<ComfyCandidateUiState | null>(null)
  const candidateRef = React.useRef<ComfyCandidateUiState | null>(null)
  React.useEffect(() => { candidateRef.current = candidate }, [candidate])

  const bumpAll = React.useCallback(() => {
    setRefreshToken((v) => v + 1)
    onChanged()
  }, [onChanged])

  // Esc 关整页。capture 阶段并 stopPropagation：否则会一路冒到设置对话框那个 window keydown，
  // 把设置也一起关掉（用户只想退出这一层）。节点菜单开着时它自己先吃掉 Esc。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 换后端 → 选中它的第一条工作流（别把上一台的选中项留在这儿，那条在这台上不存在）。
  const workflowKeys = catalog.workflows.map((w) => w.modelKey).join(',')
  React.useEffect(() => {
    // The initial empty array means "not loaded", not "requested workflow was deleted".
    if (!catalog.ready) return
    setSelectedModelKey((current) => {
      if (current && catalog.workflows.some((w) => w.modelKey === current)) return current
      return catalog.workflows.find((w) => !w.builtin)?.modelKey ?? catalog.workflows[0]?.modelKey ?? null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKeys, catalog.ready])

  // 选中的工作流 → 读原始 JSON → 分析出候选 → 回填已存绑定。
  //
  // ⚠️ deps 只认「选了谁 / 哪台 / 工作流清单变没变」，**绝不能挂 draftOf/labelOf 这类回调身份**：
  // 它们每次探测、对账、保存后重查都是新引用，挂上去等于「目录一刷新就重置编辑器」——
  // 走查实锤：点完「运行测试」（内部先保存 → 触发重查），用户刚打的提示词和填的参数值被当场清空，
  // 看起来像输入丢了。workflowKeys 只在真的增删工作流时才变，那时重置才是对的。
  const draftOf = catalog.draftOf
  const labelOf = catalog.labelOf
  React.useEffect(() => {
    if (!catalog.ready) return
    if (!selectedModelKey) { setAnalysis(null); setBinding(null); setGraphText(''); setUiWorkflowText(''); setName(''); return }
    const draft = draftOf(selectedModelKey)
    setError('')
    setDirty(false)
    setPreviewValues({})
    setName(labelOf(selectedModelKey))
    if (!draft) { setAnalysis(null); setBinding(null); setGraphText(''); setError(t('comfyuiWorkflowPage.errors.noDraft')); return }
    setGraphText(draft.text)
    setUiWorkflowText(draft.uiWorkflowText ?? '')
    const result = getDesktopBridge()?.modelCatalog?.analyzeComfyWorkflow?.(draft.text)
    if (!result) { setAnalysis(null); setBinding(null); setError(t('comfyuiWorkflowPage.errors.unsupported')); return }
    if (!result.ok) { setAnalysis(null); setBinding(null); setError(t('comfyuiWorkflowPage.errors.analyzeFailed', { error: result.error })); return }
    const parsed = result.analysis as WorkflowAnalysis
    setAnalysis(parsed)
    // 老导入没存绑定 → 回落到自动识别的建议（总比空绑定强，用户看到的是「猜的」而不是「空的」）。
    setBinding(normalizeBinding(draft.binding ?? parsed.suggested))
  // draftOf/labelOf 故意不进 deps（见上方注释）：它们每次重查都换身份，会把用户正在编辑的内容冲掉。
  // workflowKeys 变时这一轮渲染里的 draftOf 已是最新的，闭包取到的就是新数据，不会读到旧目录。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelKey, vendorKey, workflowKeys, catalog.ready, t])

  // 原始 JSON → 图。**必须容错**：草稿是落库的用户数据，手改坏过的、老版本存的半形态都可能进来，
  // 一个 throw 就是整页白屏（buildWorkflowGraphView 内部对畸形节点已经是逐个跳过，不会炸）。
  const graph = React.useMemo((): GraphInput | null => {
    if (!graphText) return null
    try {
      const parsed: unknown = JSON.parse(graphText)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as GraphInput) : null
    } catch {
      return null
    }
  }, [graphText])

  const view = React.useMemo(
    () => buildWorkflowGraphView(graph ?? {}, binding ?? {}),
    [graph, binding],
  )
  const classTypeByNodeId = React.useMemo(
    () => new Map(view.nodes.map((node) => [node.nodeId, node.classType])),
    [view.nodes],
  )
  const reconcile = selectedModelKey ? catalog.reconcileOf(selectedModelKey) : null
  const preview = React.useMemo(
    () => buildCanvasPreview(binding, { classTypeByNodeId, enumOptions: reconcile?.enumOptions }),
    [binding, classTypeByNodeId, reconcile?.enumOptions],
  )
  const exposedCount = (binding?.params ?? []).length

  const patchBinding = React.useCallback((next: (current: WorkflowBinding) => WorkflowBinding) => {
    setBinding((current) => (current ? next(current) : current))
    setDirty(true)
  }, [])

  const roleChoicesFor = React.useCallback(
    (nodeId: string) => roleChoicesForNode(analysis, binding ?? {}, nodeId),
    [analysis, binding],
  )
  const fieldChoicesFor = React.useCallback(
    (nodeId: string) => fieldChoicesForNode(analysis, binding ?? {}, nodeId),
    [analysis, binding],
  )
  const onPickRole = React.useCallback((nodeId: string, choice: RoleChoice) => {
    patchBinding((current) => assignRole(current, choice.role, {
      nodeId,
      ...(choice.inputKey ? { inputKey: choice.inputKey } : {}),
      ...(choice.outputKind ? { outputKind: choice.outputKind } : {}),
    }))
  }, [patchBinding])
  const onClearRole = React.useCallback((role: Exclude<WorkflowRole, 'output'>) => {
    patchBinding((current) => clearRole(current, role))
  }, [patchBinding])
  const onToggleField = React.useCallback((candidate: WorkflowCandidate) => {
    patchBinding((current) => toggleField(current, candidate))
  }, [patchBinding])

  const save = React.useCallback((): ComfyCandidateUiState | null => {
    if (!selectedModelKey || !binding) return null
    const update = getDesktopBridge()?.modelCatalog?.updateComfyWorkflow
    if (!update) { setError(t('comfyuiWorkflowPage.errors.unsupported')); return null }
    const label = name.trim() || labelOf(selectedModelKey)
    setBusy(true)
    try {
      const result = update({
        modelKey: selectedModelKey,
        text: graphText,
        binding,
        labelZh: label,
        // enumOptions 随保存烤回参数控件——combo 参数在画布才是真实文件下拉（与导入同口径）。
        ...(reconcile?.enumOptions?.length ? { enumOptions: reconcile.enumOptions } : {}),
        vendorKey,
        ...(uiWorkflowText ? { uiWorkflowText } : {}),
      })
      if (!result.ok) { setError(t('comfyuiWorkflowPage.errors.saveFailed', { error: result.error })); return null }
      const staged = candidateFromWorkflowMutation(result)
      if (!staged) return null
      candidateRef.current = staged
      setCandidate(staged)
      setDirty(false)
      setError('')
      toast(t('comfyuiWorkflowPage.header.saved', { name: label }), 'success')
      bumpAll()
      return staged
    } finally {
      setBusy(false)
    }
  }, [selectedModelKey, binding, name, graphText, reconcile?.enumOptions, vendorKey, uiWorkflowText, labelOf, bumpAll, t])

  const remove = React.useCallback(async () => {
    if (!selectedModelKey) return
    const label = labelOf(selectedModelKey)
    const ok = await confirmDialog({
      title: t('comfyuiWorkflowPage.header.deleteTitle'),
      message: t('comfyuiWorkflowPage.header.deleteMessage', { name: label }),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!ok) return
    try {
      getDesktopBridge()?.modelCatalog?.deleteModels([{ vendorKey, modelKey: selectedModelKey }])
      setSelectedModelKey(null)
      toast(t('comfyuiWorkflowPage.header.deleted', { name: label }), 'success')
      bumpAll()
    } catch (e) {
      void alertDialog({
        title: t('comfyuiWorkflowPage.errors.deleteFailed', { error: '' }),
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }, [selectedModelKey, vendorKey, labelOf, bumpAll, t])

  const removeBackend = React.useCallback(async (backend: BackendRow) => {
    const ok = await confirmDialog({
      title: t('comfyuiWorkflowPage.backends.removeTitle'),
      message: t('comfyuiWorkflowPage.backends.removeMessage', { name: backend.name, count: backend.workflowCount }),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!ok) return
    const bridge = getDesktopBridge()?.modelCatalog
    if (!bridge) return
    try {
      // 整台移除连它名下的工作流一起删——那些工作流指向的是这台的地址，留着是死的（同 ComfyuiLocalCard）。
      const owned = (bridge.listModels() as Array<Record<string, unknown>>)
        .filter((m) => String(m.vendorKey) === backend.vendorKey)
        .map((m) => ({ vendorKey: backend.vendorKey, modelKey: String(m.modelKey) }))
      if (owned.length > 0) bridge.deleteModels(owned)
      bridge.deleteVendor?.(backend.vendorKey)
      if (backend.vendorKey === vendorKey) setVendorKey(initialVendorKey)
      toast(t('comfyuiWorkflowPage.backends.removed', { name: backend.name }), 'success')
      bumpAll()
    } catch (e) {
      void alertDialog({ title: t('comfyuiWorkflowPage.backends.remove'), message: e instanceof Error ? e.message : String(e) })
    }
  }, [vendorKey, initialVendorKey, bumpAll, t])

  const saveAddress = React.useCallback((key: string, address: string) => {
    try {
      getDesktopBridge()?.modelCatalog?.upsertVendor({ key, baseUrlHint: address })
      toast(t('comfyuiWorkflowPage.backends.saved'), 'success')
      bumpAll()
    } catch (e) {
      void alertDialog({ title: t('comfyuiWorkflowPage.backends.edit'), message: e instanceof Error ? e.message : String(e) })
    }
  }, [bumpAll, t])

  // 试跑挡门（§1.6 C1：挡住就 disabled + title 说清为什么，不做沟通死路）。
  //
  // 绑了首帧/尾帧的那条为什么也挡：试跑**不带素材**（上传资产是画布的活），而 image_to_* 通道
  // 没图根本发不出去——主进程会原地报「缺少参考图」。走查实锤过一次：与其让用户点了才撞上一句
  // 他看不懂的失败，不如一开始就说清「这条得去画布上跑」（C4：禁用不做沟通死路）。
  const needsFrame = Boolean(binding && workflowMediaBindings(binding).some((image) => image.mediaKind === 'image'))
  const runBlockedReason = !binding?.outputNodeId
    ? t('comfyuiWorkflowPage.preview.runNeedsOutput')
    : catalog.reachable === false
      ? t('comfyuiWorkflowPage.preview.runNeedsBackend')
      : needsFrame
        ? t('comfyuiWorkflowPage.preview.runNeedsFrame')
        : null

  const runTest = React.useCallback(async () => {
    if (!selectedModelKey || !binding) return
    // 没有精确 staged revision 时先隔离保存；绝不回落到旧 active mapping。
    const staged = dirty || !candidate ? save() : candidate
    if (!staged) { setError(t('comfyuiWorkflowPage.preview.runNeedsSave')); return }
    setRunning(true)
    try {
      const result = await runTestGeneration({
        vendorKey,
        candidateVendorKey: staged.vendorKey,
        revisionId: staged.revisionId,
        modelKey: staged.modelKey,
        binding,
        prompt: previewValues.prompt ?? '',
        extras: previewValuesToExtras(preview.fields, previewValues),
      })
      const settled = settleCandidateUiRun(candidateRef.current, result)
      if (!settled.applied) return
      candidateRef.current = settled.candidate
      setCandidate(settled.candidate)
      if (result.ok && settled.active) {
        setVendorKey(settled.active.vendorKey)
        setSelectedModelKey(settled.active.modelKey)
        bumpAll()
        toast(t('comfyuiWorkflowPage.preview.runStarted'), 'success')
      } else if (!result.ok) {
        const failure = candidateFailureText(result)
        setError(failure)
        toast(t('comfyuiWorkflowPage.preview.runFailed', { error: failure }), 'error')
      }
    } finally {
      setRunning(false)
    }
  }, [selectedModelKey, binding, dirty, candidate, save, vendorKey, previewValues, preview.fields, bumpAll, t])

  const nodeCount = view.nodes.length

  return (
    <Portal>
      <div
        className="fixed inset-0 flex flex-col bg-nomi-bg"
        style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }}
        role="dialog"
        aria-modal="true"
        aria-label={t('comfyuiWorkflowPage.aria')}
        data-comfyui-workflow-page
      >
        <header className="flex flex-none items-center gap-2 border-b border-nomi-line px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center gap-1.5 rounded-nomi-sm px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
          >
            <IconArrowLeft size={14} stroke={1.8} aria-hidden="true" />{t('comfyuiWorkflowPage.back')}
          </button>
          <span className="h-3 w-px bg-nomi-line" aria-hidden="true" />
          <span className="text-body-sm text-nomi-ink">{t('comfyuiWorkflowPage.title')}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('comfyuiWorkflowPage.close')}
            className="grid size-7 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
          >
            <IconX size={15} stroke={1.8} aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <aside className="flex w-[268px] flex-none flex-col gap-3 overflow-y-auto">
            <WorkflowSidebar
              backends={catalog.backends}
              selectedVendorKey={vendorKey}
              onSelectBackend={setVendorKey}
              onSaveAddress={saveAddress}
              onRemoveBackend={(row) => void removeBackend(row)}
              onBackendsChanged={bumpAll}
              workflows={catalog.workflows}
              selectedModelKey={selectedModelKey}
              onSelectWorkflow={setSelectedModelKey}
            />
            {selectedModelKey && binding ? (
              <WorkflowCanvasPreview
                fields={preview.fields}
                isEmpty={preview.isEmpty}
                values={previewValues}
                onChangeValue={(key, value) => setPreviewValues((current) => ({ ...current, [key]: value }))}
                blockedReason={runBlockedReason}
                running={running}
                onRun={() => void runTest()}
              />
            ) : null}
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col rounded-nomi border border-nomi-line bg-nomi-paper">
            <div className="flex flex-none items-center gap-2 border-b border-nomi-line p-2.5">
              <div className="min-w-0 flex-1">
                <input
                  value={name}
                  onChange={(event) => { setName(event.target.value); setDirty(true) }}
                  disabled={!selectedModelKey || !binding}
                  aria-label={t('comfyuiWorkflowPage.header.nameAria')}
                  placeholder={t('comfyuiWorkflowPage.header.namePlaceholder')}
                  className={cn(
                    'h-6 w-full max-w-[320px] rounded-nomi-sm border border-transparent bg-transparent px-1 -mx-1',
                    'text-body-sm text-nomi-ink outline-none placeholder:text-nomi-ink-30',
                    'hover:border-nomi-line focus:border-nomi-accent disabled:opacity-60',
                  )}
                />
                <div className="mt-0.5 flex items-center gap-1.5 px-0 text-micro text-nomi-ink-40">
                  <span>{t('comfyuiWorkflowPage.header.nodeCount', { count: nodeCount })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('comfyuiWorkflowPage.header.exposedCount', { count: exposedCount })}</span>
                  {dirty ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-nomi-accent">{t('comfyuiWorkflowPage.header.unsaved')}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={!selectedModelKey}
                className="inline-flex h-7 items-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-60 hover:border-nomi-danger hover:text-nomi-danger disabled:opacity-45"
              >
                <IconTrash size={12} stroke={1.7} aria-hidden="true" />{t('comfyuiWorkflowPage.header.delete')}
              </button>
              {/* 禁用的 button 自己不触发 title → 外层包一层（设计系统 §1.6 C1 的既有范式）。 */}
              <span
                title={!binding?.outputNodeId ? t('comfyuiWorkflowPage.header.noOutput') : undefined}
                style={{ display: 'contents' }}
              >
                <button
                  type="button"
                  onClick={() => { save() }}
                  disabled={!selectedModelKey || !binding || busy || !binding.outputNodeId}
                  data-workflow-save
                  className="inline-flex h-7 items-center rounded-nomi-sm bg-nomi-ink px-3 text-micro font-semibold text-nomi-paper hover:bg-nomi-accent disabled:opacity-45"
                >
                  {busy ? t('comfyuiWorkflowPage.header.saving') : t('comfyuiWorkflowPage.header.save')}
                </button>
              </span>
            </div>

            {error ? (
              <div className="flex flex-none items-start gap-2 border-b border-nomi-line bg-nomi-ink-05 px-2.5 py-2">
                <IconAlertTriangle size={14} className="mt-0.5 shrink-0 text-nomi-danger" aria-hidden="true" />
                <span className="text-caption leading-relaxed text-nomi-ink">{error}</span>
              </div>
            ) : null}

            <div className="flex flex-none items-center gap-1.5 px-2.5 py-1.5 text-micro text-nomi-ink-40">
              {t('comfyuiWorkflowPage.graph.hint')}
            </div>

            <WorkflowGraphCanvas
              view={view}
              roleChoicesFor={roleChoicesFor}
              fieldChoicesFor={fieldChoicesFor}
              onPickRole={onPickRole}
              onClearRole={onClearRole}
              onToggleField={onToggleField}
            />
          </main>
        </div>
      </div>
    </Portal>
  )
}
