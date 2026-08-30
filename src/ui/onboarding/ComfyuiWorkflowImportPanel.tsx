/**
 * 本地 ComfyUI「导入自定义工作流」面板（S4）。plan: docs/plan/2026-07-15-comfyui-custom-workflow.md
 *
 * 用户可直接粘贴 ComfyUI 保存的 workflow.json，也可粘贴 Workflow → Export (API) 导出的 workflow_api.json。
 * 「分析」调后端 analyzeComfyWorkflow 自动识别可绑定节点（提示词/首帧/输出/数值），列出建议绑定供用户确认/微调，
 * 「导入」调 importComfyWorkflow 落成用户自有 model+mapping（之后在生成画布直接选用）。
 * 纯解析/识别/落库都在后端（electron/catalog/comfyuiWorkflowImport*，可测）；本组件只做「贴→看→改→导」的壳。
 *
 * ⚠️ 这里**只管导入**（接入动作）。2026-08-12 用户拍板：导入之后的一切配置——改绑定 / 改可调字段 /
 * 改名 / 删除——全部搬进「工作流设置」整页（workflowPage/ComfyuiWorkflowSettingsPage.tsx），
 * 那里有节点图，点节点就能指定角色，不用再对着 `#110 CLIPTextEncode` 猜。
 * 原来这个组件里那套 editMode（initial/onCancel/updateComfyWorkflow）已随同一个 commit 删除，
 * 不留并行版（P1）。**别再把编辑态加回来**——同一件事两个长得不一样的界面正是要治的病。
 * 角色/参数互斥规则的单一真相源在 comfyuiWorkflowBinding.ts，两条路共用同一份。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconFileImport, IconWand, IconAlertTriangle, IconMovie, IconPhoto, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiSelect } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { cancelComfyCandidateTestRevision, type TaskKind } from '../../workbench/api/taskApi'
import { paramCandidates } from './comfyuiParamCandidates'
// 类型与参数塑形规则的单一真相源——整页（工作流设置）与这条导入路共用同一份，
// 抄第二份必然漂（那正是「提示词被参数占位覆盖」反复复发的形状）。
import {
  paramFromCandidate,
  paramKeyProblem,
  workflowMediaBindings,
  type WorkflowAnalysis as Analysis,
  type WorkflowBinding as Binding,
  type WorkflowCandidate as Candidate,
  type WorkflowParam,
  type WorkflowParamType,
} from './comfyuiWorkflowBinding'
import {
  bindingFromAnalysis,
  mediaBindingRows,
  setMediaBinding,
  supportedOutputOptions,
} from './comfyuiWorkflowImportPanelViewModel'

type ParamPresetKey = 'width' | 'height' | 'seconds' | 'fps'
type ParamPreset = { key: ParamPresetKey; labelKey: string; paramKey: string; match: (candidate: Candidate) => boolean }
type Reconcile = {
  serverReachable: boolean
  unknownNodeTypes: string[]
  missingEnumValues: Array<{ nodeId: string; classType: string; title?: string; inputKey: string; value: string }>
  /** (classType, inputKey) → 本机 combo 可选值；导入时烤进参数控件（画布真实文件下拉）。 */
  enumOptions?: Array<{ classType: string; inputKey: string; options: string[] }>
}
type ComfyuiWorkflowImportPanelProps = {
  onImported: () => void
  /** The canonical integration session has been staged and is awaiting the
   * trusted verification handoff. The owner surface decides where to show it. */
  onVerificationRequested?: () => void
  /** 多实例：这张面板属于**哪一台** ComfyUI（对账打它的 /object_info、工作流落它名下）。缺省=第一台。 */
  vendorKey?: string
}

const NONE = '__none__'
const nodeValue = (nodeId: string, inputKey: string) => `${encodeURIComponent(nodeId)}|${encodeURIComponent(inputKey)}`
const parseNodeValue = (raw: string): { nodeId: string; inputKey: string } | null => {
  try {
    const [nodeId, inputKey] = raw.split('|')
    if (nodeId && inputKey) return { nodeId: decodeURIComponent(nodeId), inputKey: decodeURIComponent(inputKey) }
  } catch {
    return null
  }
  return null
}
const nodeOpt = (c: Candidate) => ({ value: nodeValue(c.nodeId, c.inputKey), label: `#${c.nodeId} ${c.classType}` })
const preview = (v: string | number | boolean) => {
  if (typeof v === 'string' && v) return `「${v.slice(0, 18)}${v.length > 18 ? '…' : ''}」`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}
const nodeSelectOptions = (candidates: Candidate[]) => candidates.map((t) => ({ ...nodeOpt(t), trailing: preview(t.value) || undefined }))

const candidateSearchText = (candidate: Candidate): string =>
  `${candidate.nodeId} ${candidate.inputKey} ${candidate.classType} ${candidate.title ?? ''}`.toLowerCase()

/** 缺件清单收短：最多列 4 项，其余归成 (+N)——防一张缺一堆 LoRA 的图把面板撑爆。 */
const shortList = (items: string[], cap = 4): string =>
  items.slice(0, cap).join(' · ') + (items.length > cap ? ` (+${items.length - cap})` : '')

const PARAM_PRESETS: ParamPreset[] = [
  {
    key: 'width',
    labelKey: 'onboardingProviders.comfyWorkflow.presetWidth',
    paramKey: 'comfy_width',
    match: (candidate) => /width|宽度/i.test(candidateSearchText(candidate)),
  },
  {
    key: 'height',
    labelKey: 'onboardingProviders.comfyWorkflow.presetHeight',
    paramKey: 'comfy_height',
    match: (candidate) => /height|高度/i.test(candidateSearchText(candidate)),
  },
  {
    key: 'seconds',
    labelKey: 'onboardingProviders.comfyWorkflow.presetSeconds',
    paramKey: 'comfy_seconds',
    match: (candidate) => /(seconds?|duration|时长|秒数)/i.test(candidateSearchText(candidate)),
  },
  {
    key: 'fps',
    labelKey: 'onboardingProviders.comfyWorkflow.presetFps',
    paramKey: 'comfy_fps',
    match: (candidate) => /\b(fps|frame_rate|帧率)\b/i.test(candidateSearchText(candidate)),
  },
]

export function ComfyuiWorkflowImportPanel({ onImported, onVerificationRequested, vendorKey }: ComfyuiWorkflowImportPanelProps): JSX.Element {
  const { t } = useTranslation()
  const catalog = getDesktopBridge()?.modelCatalog
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null)
  const [binding, setBinding] = React.useState<Binding | null>(null)
  const [labelZh, setLabelZh] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [reconcile, setReconcile] = React.useState<Reconcile | null>(null)
  const [uiWorkflowText, setUiWorkflowText] = React.useState('')
  const reconcileSeq = React.useRef(0)
  const candidateRef = React.useRef<{ revisionId: string; modelKey: string; taskKind: TaskKind } | null>(null)
  const replaceCandidate = React.useCallback((candidate: { revisionId: string; modelKey: string; taskKind: TaskKind } | null) => {
    const previous = candidateRef.current
    candidateRef.current = candidate
    if (previous && previous.revisionId !== candidate?.revisionId) {
      void cancelComfyCandidateTestRevision(previous).catch(() => undefined)
    }
  }, [])
  React.useEffect(() => () => {
    const candidate = candidateRef.current
    candidateRef.current = null
    if (candidate) void cancelComfyCandidateTestRevision(candidate).catch(() => undefined)
  }, [])

  // 缺件对账（异步，不阻塞绑定 UI）：分析成功后问本机 /object_info，缺节点/缺模型在导入前就说清。
  // seq 防串台：快速换文本重新分析时，旧请求晚到不覆盖新结果。
  const runReconcile = React.useCallback((value: string) => {
    const seq = ++reconcileSeq.current
    setReconcile(null)
    const call = getDesktopBridge()?.modelCatalog?.reconcileComfyWorkflow
    if (!call) return
    void call(value, vendorKey)
      .then((r) => { if (reconcileSeq.current === seq && r && r.ok) setReconcile(r) })
      .catch(() => {})
  }, [vendorKey])

  const reset = React.useCallback(() => {
    replaceCandidate(null)
    setText(''); setAnalysis(null); setBinding(null); setLabelZh(''); setError(''); setReconcile(null); setUiWorkflowText('')
  }, [replaceCandidate])

  /**
   * 分析：贴什么格式都吃（T1）。先走 smart（界面格式会借 ComfyUI 自己的前端自动转成 API），
   * 转成功就把编辑框里的原文换成 API 文本——后续导入/编辑链只面对一种形态（不留两套并行）。
   * 老 preload（没有 smart 口）回落到原来的同步分析，行为与今天一致。
   */
  const analyze = React.useCallback(() => {
    setError('')
    const smart = catalog?.analyzeComfyWorkflowSmart
    if (!smart) {
      const r = catalog?.analyzeComfyWorkflow?.(text)
      if (!r) { setError(t('onboardingProviders.comfyWorkflow.unsupported')); return }
      if (!r.ok) { setError(r.error); setAnalysis(null); setBinding(null); setReconcile(null); return }
      const a = r.analysis as Analysis
      setAnalysis(a)
      setBinding(bindingFromAnalysis(a))
      runReconcile(text)
      return
    }
    setBusy(true)
    void smart(text, vendorKey)
      .then((r) => {
        if (!r.ok) { setError(r.error); setAnalysis(null); setBinding(null); setReconcile(null); return }
        const effectiveText = r.convertedText ?? text
        if (r.convertedText) {
          setText(r.convertedText)
          setUiWorkflowText(r.sourceWorkflowText ?? text)
        } else {
          setUiWorkflowText('')
        }
        const a = r.analysis as Analysis
        setAnalysis(a)
        setBinding(bindingFromAnalysis(a))
        runReconcile(effectiveText)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }, [catalog, text, t, runReconcile, vendorKey])

  const paramKeyError = React.useMemo(() => {
    const problem = paramKeyProblem(binding?.params ?? [], workflowMediaBindings(binding ?? {}))
    if (problem === 'invalid') return t('onboardingProviders.comfyWorkflow.paramKeyInvalid')
    if (problem === 'duplicate') return t('onboardingProviders.comfyWorkflow.paramKeyDuplicate')
    return ''
  }, [binding, t])

  const doImport = React.useCallback(async () => {
    if (!binding) return
    const prepare = getDesktopBridge()?.onboarding?.integrationSessionPrepareComfy
    if (!prepare) { setError(t('onboardingProviders.comfyWorkflow.unsupported')); return }
    if (paramKeyError) { setError(paramKeyError); return }
    setBusy(true)
    try {
      const name = labelZh.trim() || t('onboardingProviders.comfyWorkflow.defaultName')
      const enumOptions = reconcile && reconcile.enumOptions?.length ? reconcile.enumOptions : undefined
      await prepare({
        vendorKey: vendorKey || 'comfyui-local',
        name,
        workflow: text,
        binding,
        ...(enumOptions ? { enumOptions } : {}),
        ...(uiWorkflowText ? { uiWorkflow: uiWorkflowText } : {}),
      })
      toast(t('onboardingProviders.comfyWorkflow.awaitingVerification', { name }), 'success')
      reset()
      setOpen(false)
      onImported()
      onVerificationRequested?.()
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally { setBusy(false) }
  }, [binding, text, labelZh, reset, onImported, onVerificationRequested, paramKeyError, reconcile, vendorKey, uiWorkflowText, t])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-nomi-sm border border-nomi-line',
          'text-caption text-nomi-ink-60 hover:text-nomi-accent hover:border-nomi-accent')}
      >
        <IconFileImport size={14} stroke={1.7} />{t('onboardingProviders.comfyWorkflow.importCustom')}
      </button>
    )
  }

  const setPromptRole = (raw: string) => {
    setBinding((b) => {
      if (!b) return b
      if (raw === NONE) {
        return { ...b, promptNodeId: undefined, promptInputKey: undefined }
      }
      const parsed = parseNodeValue(raw)
      if (!parsed) return b
      const { nodeId, inputKey } = parsed
      // 角色抢走这个输入时，原本绑同一处的参数行必须撤掉：一个输入只能有一个身份，
      // 否则导入时参数占位会把角色占位覆盖掉（用户的提示词静默失效）。留着那行等于骗他配了个不生效的参数。
      const params = (b.params ?? []).filter((p) => !(p.nodeId === nodeId && p.inputKey === inputKey))
      return { ...b, params, promptNodeId: nodeId, promptInputKey: inputKey }
    })
  }
  const mediaRows = analysis && binding ? mediaBindingRows(analysis, binding) : []
  const setMedia = (candidate: Candidate, checked: boolean) => {
    setBinding((current) => current ? setMediaBinding(current, candidate, checked) : current)
  }
  const setOutput = (nodeId: string) => {
    setBinding((b) => {
      if (!b || !analysis) return b
      const out = analysis.outputNodes.find((o) => o.nodeId === nodeId)
      if (!out || out.kind === 'unsupported') return b
      return { ...b, outputNodeId: nodeId, outputKind: out.kind }
    })
  }
  // 候选池按**当前** binding 现算：用户改了提示词节点，新选中的立刻从参数里消失、旧的立刻回来。
  // （钉死在 analysis.suggested 上正是 2026-08-03/08-11 两次反馈的那个 bug，见 comfyuiParamCandidates.ts）
  const allWidgetInputs = analysis?.widgetInputs?.length ? analysis.widgetInputs : analysis?.numericInputs ?? []
  const widgetCandidates = paramCandidates(allWidgetInputs, binding)
  const paramTypeOptions = [
    { value: 'number', label: t('onboardingProviders.comfyWorkflow.paramTypeNumber') },
    { value: 'text', label: t('onboardingProviders.comfyWorkflow.paramTypeText') },
    { value: 'boolean', label: t('onboardingProviders.comfyWorkflow.paramTypeBoolean') },
  ]
  const presetOptions = PARAM_PRESETS.map((preset) => {
    const candidate = widgetCandidates.find((c) => typeof c.value === 'number' && preset.match(c))
    const added = Boolean(candidate && (binding?.params ?? []).some((p) =>
      (p.nodeId === candidate.nodeId && p.inputKey === candidate.inputKey) || p.paramKey === preset.paramKey,
    ))
    return { preset, candidate, added }
  })
  const addParam = () => {
    if (!widgetCandidates.length) return
    setBinding((b) => {
      if (!b) return b
      const params = b.params ?? []
      const candidate = widgetCandidates.find((c) => !params.some((p) => p.nodeId === c.nodeId && p.inputKey === c.inputKey)) ?? widgetCandidates[0]
      return { ...b, params: [...params, paramFromCandidate(candidate, [...workflowMediaBindings(b), ...params])] }
    })
  }
  const addPresetParam = (preset: ParamPreset, candidate: Candidate) => {
    setBinding((b) => {
      if (!b) return b
      const params = b.params ?? []
      if (params.some((p) => (p.nodeId === candidate.nodeId && p.inputKey === candidate.inputKey) || p.paramKey === preset.paramKey)) return b
      return {
        ...b,
        params: [
          ...params,
          {
            ...paramFromCandidate({ ...candidate, title: preset.paramKey }, [...workflowMediaBindings(b), ...params]),
            label: t(preset.labelKey),
          },
        ],
      }
    })
  }
  const updateParam = (index: number, patch: Partial<WorkflowParam>) => {
    setBinding((b) => {
      if (!b) return b
      const params = [...(b.params ?? [])]
      const current = params[index]
      if (!current) return b
      params[index] = { ...current, ...patch }
      return { ...b, params }
    })
  }
  const setParamCandidate = (index: number, raw: string) => {
    const parsed = parseNodeValue(raw)
    if (!parsed) return
    const candidate = widgetCandidates.find((c) => c.nodeId === parsed.nodeId && c.inputKey === parsed.inputKey)
    if (!candidate) return
    setBinding((b) => {
      if (!b) return b
      const params = [...(b.params ?? [])]
      const current = params[index]
      if (!current) return b
      const next = paramFromCandidate(candidate, [...workflowMediaBindings(b), ...params.filter((_, i) => i !== index)])
      params[index] = { ...next, paramKey: current.paramKey || next.paramKey, label: current.label || next.label }
      return { ...b, params }
    })
  }
  const removeParam = (index: number) => {
    setBinding((b) => b ? { ...b, params: (b.params ?? []).filter((_, i) => i !== index) } : b)
  }

  const hasFirstFrame = Boolean(binding?.images?.some((item) => item.paramKey === 'first_frame_url'))
  const hasLastFrame = Boolean(binding?.images?.some((item) => item.paramKey === 'last_frame_url'))
  const frameKindLabel = hasFirstFrame && hasLastFrame
    ? t('onboardingProviders.comfyWorkflow.frameKindBoth')
    : hasFirstFrame
      ? t('onboardingProviders.comfyWorkflow.frameKindFirst')
      : hasLastFrame
        ? t('onboardingProviders.comfyWorkflow.frameKindLast')
        : t('onboardingProviders.comfyWorkflow.frameKindNone')

  return (
    <div className="flex flex-col gap-2.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-3">
      <div className="flex items-center gap-2">
        <IconFileImport size={15} stroke={1.7} className="text-nomi-ink-60" />
        <span className="text-body-sm font-semibold text-nomi-ink flex-1">{t('onboardingProviders.comfyWorkflow.title')}</span>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          className="h-6 w-6 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05"
          aria-label={t('onboardingProviders.comfyWorkflow.collapse')}
        >
          <IconX size={14} stroke={1.8} />
        </button>
      </div>
      <div className="text-caption text-nomi-ink-60 leading-relaxed">
        {t('onboardingProviders.comfyWorkflow.instructions')}
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setAnalysis(null); setBinding(null); setError(''); setReconcile(null) }}
        spellCheck={false}
        aria-label={t('onboardingProviders.comfyWorkflow.pasteArea')}
        placeholder={t('onboardingProviders.comfyWorkflow.jsonPlaceholder')}
        className={cn('w-full min-h-[110px] max-h-[220px] rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 py-2',
          'font-mono text-caption text-nomi-ink placeholder:text-nomi-ink-30 focus:border-nomi-accent outline-none resize-y')}
      />

      {error ? (
        <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-2.5 py-2">
          <IconAlertTriangle size={15} className="shrink-0 mt-0.5 text-workbench-danger" />
          <span className="text-caption text-nomi-ink leading-relaxed">{error}</span>
        </div>
      ) : null}

      {!analysis ? (
        <button
          type="button" onClick={analyze} disabled={!text.trim() || busy}
          className={cn('self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
            'text-caption font-medium hover:bg-nomi-accent disabled:opacity-45')}
        >
          <IconWand size={14} stroke={1.8} />
          {busy ? t('onboardingProviders.comfyWorkflow.analyzing') : t('onboardingProviders.comfyWorkflow.analyze')}
        </button>
      ) : binding ? (
        <div className="flex flex-col gap-2.5">
          {/* 自动识别结果 + 可改绑定 */}
          <div className="flex items-center gap-1.5 text-caption text-nomi-ink-60">
            {binding.outputKind === 'video' ? <IconMovie size={14} className="text-nomi-accent" /> : <IconPhoto size={14} className="text-nomi-accent" />}
            {t('onboardingProviders.comfyWorkflow.detectedBefore')}<b className="text-nomi-ink font-semibold">{binding.outputKind === 'video' ? t('onboardingProviders.comfyWorkflow.video') : t('onboardingProviders.comfyWorkflow.image')}</b>{t('onboardingProviders.comfyWorkflow.detectedAfter')}{frameKindLabel}{t('onboardingProviders.comfyWorkflow.confirmBindings')}
          </div>

          {/* 缺件对账（异步）：缺节点/缺模型在导入前说清，不等运行 400。ComfyUI 没开 → 一行说明不阻断。 */}
          {reconcile && !reconcile.serverReachable ? (
            <div className="text-caption text-nomi-ink-40 leading-relaxed">{t('onboardingProviders.comfyWorkflow.reconcileOffline')}</div>
          ) : null}
          {reconcile && reconcile.unknownNodeTypes.length > 0 ? (
            <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-2.5 py-2">
              <IconAlertTriangle size={15} className="shrink-0 mt-0.5 text-workbench-danger" />
              <span className="text-caption text-nomi-ink leading-relaxed">
                {t('onboardingProviders.comfyWorkflow.missingNodes', {
                  count: reconcile.unknownNodeTypes.length,
                  list: shortList(reconcile.unknownNodeTypes),
                })}
              </span>
            </div>
          ) : null}
          {reconcile && reconcile.missingEnumValues.length > 0 ? (
            <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-2.5 py-2">
              <IconAlertTriangle size={15} className="shrink-0 mt-0.5 text-workbench-danger" />
              <span className="text-caption text-nomi-ink leading-relaxed">
                {t('onboardingProviders.comfyWorkflow.missingFiles', {
                  count: reconcile.missingEnumValues.length,
                  list: shortList(reconcile.missingEnumValues.map((m) => `${m.classType}.${m.inputKey}="${m.value.slice(0, 40)}"`)),
                })}
              </span>
            </div>
          ) : null}

          <BindRow label={t('onboardingProviders.comfyWorkflow.promptNode')}>
            <NomiSelect
              ariaLabel={t('onboardingProviders.comfyWorkflow.promptNodeAria')} size="sm"
              value={binding.promptNodeId && binding.promptInputKey ? nodeValue(binding.promptNodeId, binding.promptInputKey) : NONE}
              options={nodeSelectOptions(analysis.textInputs)}
              onChange={setPromptRole}
              triggerMaxWidth={160}
              className="w-full max-w-full justify-between"
            />
          </BindRow>
          {mediaRows.length > 0 ? (
            <BindRow label={t('onboardingProviders.comfyWorkflow.mediaInputs')}>
              <div className="flex flex-col gap-1 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 p-1.5">
                {mediaRows.map((row) => (
                  <label key={`${row.nodeId}:${row.inputKey}`} className="flex items-center gap-2 rounded-nomi-sm px-1.5 py-1 text-caption text-nomi-ink-80">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(event) => setMedia(row, event.currentTarget.checked)}
                      aria-label={`${row.classType}.${row.inputKey}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{row.title?.trim() || `${row.inputKey} #${row.nodeId}`}</span>
                    <span className="text-micro text-nomi-ink-40">{row.mediaKind === 'video' ? t('onboardingProviders.comfyWorkflow.video') : t('onboardingProviders.comfyWorkflow.image')}</span>
                  </label>
                ))}
              </div>
            </BindRow>
          ) : null}
          <BindRow label={t('onboardingProviders.comfyWorkflow.outputNode')}>
            <NomiSelect
              ariaLabel={t('onboardingProviders.comfyWorkflow.outputNodeAria')} size="sm"
              value={binding.outputNodeId ?? ''}
              options={supportedOutputOptions(analysis).map((o) => ({ value: o.nodeId, label: `#${o.nodeId} ${o.classType}（${o.kind === 'video' ? t('onboardingProviders.comfyWorkflow.video') : o.kind === 'model3d' ? t('onboardingProviders.comfyWorkflow.model3d') : t('onboardingProviders.comfyWorkflow.image')}）` }))}
              onChange={setOutput}
              triggerMaxWidth={160}
              className="w-full max-w-full justify-between"
            />
          </BindRow>
          <div className="flex flex-col gap-2 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 p-2">
            <div className="flex items-center gap-2">
              <span className="text-caption font-semibold text-nomi-ink flex-1">{t('onboardingProviders.comfyWorkflow.customParamsTitle')}</span>
              <button
                type="button"
                onClick={addParam}
                disabled={!widgetCandidates.length}
                className={cn('inline-flex items-center gap-1 h-7 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
                  'text-caption text-nomi-ink-80 hover:border-nomi-accent disabled:opacity-45')}
              >
                <IconPlus size={13} stroke={1.8} />{t('onboardingProviders.comfyWorkflow.addParam')}
              </button>
            </div>
            <div className="text-micro text-nomi-ink-40 leading-relaxed">{t('onboardingProviders.comfyWorkflow.customParamsHint')}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-micro text-nomi-ink-40">{t('onboardingProviders.comfyWorkflow.commonParams')}</span>
              {presetOptions.map(({ preset, candidate, added }) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => candidate ? addPresetParam(preset, candidate) : undefined}
                  disabled={!candidate || added}
                  title={candidate ? `#${candidate.nodeId}.${candidate.inputKey}` : undefined}
                  className={cn('inline-flex items-center h-6 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
                    'text-micro text-nomi-ink-80 hover:border-nomi-accent disabled:opacity-45 disabled:hover:border-nomi-line')}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
            {(binding.params ?? []).length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {(binding.params ?? []).map((param, index) => (
                  <div key={`${param.nodeId}:${param.inputKey}:${index}`} className="flex flex-col gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <NomiSelect
                          ariaLabel={t('onboardingProviders.comfyWorkflow.paramNodeAria')} size="xs"
                          value={nodeValue(param.nodeId, param.inputKey)}
                          options={nodeSelectOptions(widgetCandidates)}
                          onChange={(v) => setParamCandidate(index, v)}
                          triggerMaxWidth={190}
                          className="w-full max-w-full justify-between bg-nomi-paper"
                        />
                      </div>
                      <NomiSelect
                        ariaLabel={t('onboardingProviders.comfyWorkflow.paramTypeAria')} size="xs"
                        value={param.type}
                        options={paramTypeOptions}
                        onChange={(v) => updateParam(index, { type: v as WorkflowParamType })}
                        triggerMaxWidth={64}
                        className="shrink-0 bg-nomi-paper"
                      />
                      <button
                        type="button"
                        onClick={() => removeParam(index)}
                        aria-label={t('onboardingProviders.comfyWorkflow.removeParam')}
                        className="h-6 w-6 shrink-0 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-workbench-danger"
                      >
                        <IconTrash size={13} stroke={1.7} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      <input
                        value={param.label}
                        onChange={(e) => updateParam(index, { label: e.target.value })}
                        aria-label={t('onboardingProviders.comfyWorkflow.paramLabelAria')}
                        placeholder={t('onboardingProviders.comfyWorkflow.paramLabelPlaceholder')}
                        className="h-7 min-w-0 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption text-nomi-ink placeholder:text-nomi-ink-30 focus:border-nomi-accent outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-micro text-nomi-ink-40">{t('onboardingProviders.comfyWorkflow.noCustomParams')}</div>
            )}
            {paramKeyError ? <div className="text-micro text-workbench-danger">{paramKeyError}</div> : null}
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <input
              value={labelZh} onChange={(e) => setLabelZh(e.target.value)}
              placeholder={t('onboardingProviders.comfyWorkflow.namePlaceholder')}
              className="flex-1 h-8 px-2.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption text-nomi-ink placeholder:text-nomi-ink-30 focus:border-nomi-accent outline-none"
            />
            <button
              type="button" onClick={doImport} disabled={busy || !binding.outputNodeId || supportedOutputOptions(analysis).length === 0}
              className={cn('inline-flex items-center gap-1.5 h-8 px-3.5 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
                'text-caption font-medium hover:bg-nomi-accent disabled:opacity-45')}
            >
              <IconFileImport size={14} stroke={1.8} />{busy ? t('onboardingProviders.comfyWorkflow.importing') : t('onboardingProviders.comfyWorkflow.import')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BindRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-caption text-nomi-ink-60 w-24 shrink-0">{label}</span>
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
    </div>
  )
}
