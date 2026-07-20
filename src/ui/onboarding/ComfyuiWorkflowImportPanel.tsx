/**
 * 本地 ComfyUI「导入自定义工作流」面板（S4）。plan: docs/plan/2026-07-15-comfyui-custom-workflow.md
 *
 * 用户在 ComfyUI 里跑通一条工作流 → 菜单 Workflow → Export (API) → 把 workflow_api.json 贴进来。
 * 「分析」调后端 analyzeComfyWorkflow 自动识别可绑定节点（提示词/首帧/输出/数值），列出建议绑定供用户确认/微调，
 * 「导入」调 importComfyWorkflow 落成用户自有 model+mapping（之后在生成画布直接选用）。
 * 纯解析/识别/落库都在后端（electron/catalog/comfyuiWorkflowImport*，可测）；本组件只做「贴→看→改→导」的壳。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconFileImport, IconWand, IconAlertTriangle, IconMovie, IconPhoto, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiSelect } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'

type Candidate = { nodeId: string; inputKey: string; classType: string; title?: string; value: string | number }
type OutputCand = { nodeId: string; classType: string; kind: 'image' | 'video' }
type NumericParam = { nodeId: string; inputKey: string; paramKey: string; label: string; default: number }
type Binding = {
  promptNodeId?: string
  promptInputKey?: string
  firstFrameNodeId?: string
  firstFrameInputKey?: string
  outputNodeId?: string
  outputKind?: 'image' | 'video'
  numeric: NumericParam[]
}
type Analysis = {
  textInputs: Candidate[]
  imageInputs: Candidate[]
  outputNodes: OutputCand[]
  numericInputs: Candidate[]
  suggested: Binding
}

const NONE = '__none__'
const nodeOpt = (c: Candidate) => ({ value: `${c.nodeId}:${c.inputKey}`, label: `#${c.nodeId} ${c.classType}` })
const preview = (v: string | number) =>
  typeof v === 'string' && v ? `「${v.slice(0, 18)}${v.length > 18 ? '…' : ''}」` : ''

export function ComfyuiWorkflowImportPanel({ onImported }: { onImported: () => void }): JSX.Element {
  const { t } = useTranslation()
  const catalog = getDesktopBridge()?.modelCatalog
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null)
  const [binding, setBinding] = React.useState<Binding | null>(null)
  const [labelZh, setLabelZh] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const reset = React.useCallback(() => {
    setText('')
    setAnalysis(null)
    setBinding(null)
    setLabelZh('')
    setError('')
  }, [])

  const analyze = React.useCallback(() => {
    setError('')
    const r = catalog?.analyzeComfyWorkflow?.(text)
    if (!r) {
      setError(t('onboardingProviders.comfyWorkflow.unsupported'))
      return
    }
    if (!r.ok) {
      setError(r.error)
      setAnalysis(null)
      setBinding(null)
      return
    }
    const a = r.analysis as Analysis
    setAnalysis(a)
    setBinding(a.suggested)
  }, [catalog, text, t])

  const doImport = React.useCallback(() => {
    if (!binding || !catalog?.importComfyWorkflow) return
    setBusy(true)
    try {
      const r = catalog.importComfyWorkflow({
        text,
        binding,
        labelZh: labelZh.trim() || t('onboardingProviders.comfyWorkflow.defaultName'),
      })
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast(
        t('onboardingProviders.comfyWorkflow.imported', {
          name: labelZh.trim() || t('onboardingProviders.comfyWorkflow.defaultShortName'),
          kind:
            r.kind === 'video'
              ? t('onboardingProviders.comfyWorkflow.video')
              : t('onboardingProviders.comfyWorkflow.image'),
        }),
        'success',
      )
      reset()
      setOpen(false)
      onImported()
    } finally {
      setBusy(false)
    }
  }, [binding, catalog, text, labelZh, reset, onImported, t])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-nomi-sm border border-nomi-line',
          'text-caption text-nomi-ink-60 hover:text-nomi-accent hover:border-nomi-accent',
        )}
      >
        <IconFileImport size={14} stroke={1.7} />
        {t('onboardingProviders.comfyWorkflow.importCustom')}
      </button>
    )
  }

  const setRole = (role: 'prompt' | 'firstFrame', raw: string) => {
    setBinding((b) => {
      if (!b) return b
      if (raw === NONE) return { ...b, firstFrameNodeId: undefined, firstFrameInputKey: undefined }
      const [nodeId, inputKey] = raw.split(':')
      return role === 'prompt'
        ? { ...b, promptNodeId: nodeId, promptInputKey: inputKey }
        : { ...b, firstFrameNodeId: nodeId, firstFrameInputKey: inputKey }
    })
  }
  const setOutput = (nodeId: string) => {
    setBinding((b) => {
      if (!b || !analysis) return b
      const out = analysis.outputNodes.find((o) => o.nodeId === nodeId)
      return { ...b, outputNodeId: nodeId, outputKind: out?.kind }
    })
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-3">
      <div className="flex items-center gap-2">
        <IconFileImport size={15} stroke={1.7} className="text-nomi-ink-60" />
        <span className="text-body-sm font-semibold text-nomi-ink flex-1">
          {t('onboardingProviders.comfyWorkflow.title')}
        </span>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          className="h-6 w-6 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05"
          aria-label={t('onboardingProviders.comfyWorkflow.collapse')}
        >
          <IconX size={14} stroke={1.8} />
        </button>
      </div>
      <div className="text-caption text-nomi-ink-60 leading-relaxed">
        {t('onboardingProviders.comfyWorkflow.instructionsBefore')}{' '}
        <code className="font-mono text-nomi-ink">{t('onboardingProviders.comfyWorkflow.exportCommand')}</code>{' '}
        {t('onboardingProviders.comfyWorkflow.instructionsMiddle')}{' '}
        <code className="font-mono text-nomi-ink">{t('onboardingProviders.comfyWorkflow.fileName')}</code>{' '}
        {t('onboardingProviders.comfyWorkflow.instructionsAfter')}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label={t('onboardingProviders.comfyWorkflow.pasteArea')}
        placeholder={t('onboardingProviders.comfyWorkflow.jsonPlaceholder')}
        className={cn(
          'w-full min-h-[110px] max-h-[220px] rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 py-2',
          'font-mono text-caption text-nomi-ink placeholder:text-nomi-ink-30 focus:border-nomi-accent outline-none resize-y',
        )}
      />

      {error ? (
        <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-2.5 py-2">
          <IconAlertTriangle size={15} className="shrink-0 mt-0.5 text-workbench-danger" />
          <span className="text-caption text-nomi-ink leading-relaxed">{error}</span>
        </div>
      ) : null}

      {!analysis ? (
        <button
          type="button"
          onClick={analyze}
          disabled={!text.trim()}
          className={cn(
            'self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
            'text-caption font-medium hover:bg-nomi-accent disabled:opacity-45',
          )}
        >
          <IconWand size={14} stroke={1.8} />
          {t('onboardingProviders.comfyWorkflow.analyze')}
        </button>
      ) : binding ? (
        <div className="flex flex-col gap-2.5">
          {/* 自动识别结果 + 可改绑定 */}
          <div className="flex items-center gap-1.5 text-caption text-nomi-ink-60">
            {binding.outputKind === 'video' ? (
              <IconMovie size={14} className="text-nomi-accent" />
            ) : (
              <IconPhoto size={14} className="text-nomi-accent" />
            )}
            {t('onboardingProviders.comfyWorkflow.detectedBefore')}
            <b className="text-nomi-ink font-semibold">
              {binding.outputKind === 'video'
                ? t('onboardingProviders.comfyWorkflow.video')
                : t('onboardingProviders.comfyWorkflow.image')}
            </b>
            {t('onboardingProviders.comfyWorkflow.detectedAfter')}
            {binding.firstFrameNodeId
              ? t('onboardingProviders.comfyWorkflow.imageToImage')
              : t('onboardingProviders.comfyWorkflow.textToImage')}
            {t('onboardingProviders.comfyWorkflow.confirmBindings')}
          </div>

          <BindRow label={t('onboardingProviders.comfyWorkflow.promptNode')}>
            <NomiSelect
              ariaLabel={t('onboardingProviders.comfyWorkflow.promptNodeAria')}
              size="sm"
              value={binding.promptNodeId ? `${binding.promptNodeId}:${binding.promptInputKey}` : NONE}
              options={analysis.textInputs.map((t) => ({
                ...nodeOpt(t),
                label: `${nodeOpt(t).label} ${preview(t.value)}`,
              }))}
              onChange={(v) => setRole('prompt', v)}
            />
          </BindRow>
          {analysis.imageInputs.length > 0 ? (
            <BindRow label={t('onboardingProviders.comfyWorkflow.firstFrameNode')}>
              <NomiSelect
                ariaLabel={t('onboardingProviders.comfyWorkflow.firstFrameNodeAria')}
                size="sm"
                value={binding.firstFrameNodeId ? `${binding.firstFrameNodeId}:${binding.firstFrameInputKey}` : NONE}
                options={[
                  { value: NONE, label: t('onboardingProviders.comfyWorkflow.noFirstFrame') },
                  ...analysis.imageInputs.map((candidate) => ({
                    ...nodeOpt(candidate),
                    label: `${nodeOpt(candidate).label} ${preview(candidate.value)}`,
                  })),
                ]}
                onChange={(v) => setRole('firstFrame', v)}
              />
            </BindRow>
          ) : null}
          <BindRow label={t('onboardingProviders.comfyWorkflow.outputNode')}>
            <NomiSelect
              ariaLabel={t('onboardingProviders.comfyWorkflow.outputNodeAria')}
              size="sm"
              value={binding.outputNodeId ?? ''}
              options={analysis.outputNodes.map((o) => ({
                value: o.nodeId,
                label: `#${o.nodeId} ${o.classType} (${o.kind === 'video' ? t('onboardingProviders.comfyWorkflow.video') : t('onboardingProviders.comfyWorkflow.image')})`,
              }))}
              onChange={setOutput}
            />
          </BindRow>
          {binding.numeric.length > 0 ? (
            <div className="text-micro text-nomi-ink-40">
              {t('onboardingProviders.comfyWorkflow.adjustableParams', {
                params: binding.numeric.map((n) => n.label).join(' · '),
              })}
              {t('onboardingProviders.comfyWorkflow.adjustableHint')}
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-0.5">
            <input
              value={labelZh}
              onChange={(e) => setLabelZh(e.target.value)}
              placeholder={t('onboardingProviders.comfyWorkflow.namePlaceholder')}
              className="flex-1 h-8 px-2.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption text-nomi-ink placeholder:text-nomi-ink-30 focus:border-nomi-accent outline-none"
            />
            <button
              type="button"
              onClick={doImport}
              disabled={busy || !binding.outputNodeId}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
                'text-caption font-medium hover:bg-nomi-accent disabled:opacity-45',
              )}
            >
              <IconFileImport size={14} stroke={1.8} />
              {busy ? t('onboardingProviders.comfyWorkflow.importing') : t('onboardingProviders.comfyWorkflow.import')}
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
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
